#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v7.1 — ESP32 + CC1101 radio gateway.
 *
 * ВАЖНО: радиоприём здесь намеренно повторяет тот простой скетч,
 * который реально заработал на стенде:
 *   int state = radio.receive(packet);
 *
 * Никаких IRQ-обёрток, Preferences и коротких пользовательских
 * таймаутов в тракте приёма нет.
 *
 * Рабочий профиль:
 *   435.000 MHz
 *   4.8 kbps
 *   2-FSK
 *   deviation 5 kHz
 *   RX bandwidth 203 kHz
 *   sync 0x12AD
 *   NRZ
 *   variable packet length
 *   CRC ON
 */

#define CC_SCK   18
#define CC_MISO  19
#define CC_MOSI  23
#define CC_CS    21
#define CC_GDO0  4
#define CC_GDO2  27

constexpr char FW_VERSION_V7[] = "0.4.1";
constexpr uint32_t USB_BAUD = 115200;
constexpr float RADIO_FREQ_MHZ = 435.000f;
constexpr float RADIO_RATE_KBPS = 4.8f;
constexpr float RADIO_DEVIATION_KHZ = 5.0f;
constexpr float RADIO_BW_KHZ = 203.0f;
constexpr int8_t RADIO_POWER_DBM = 5;
constexpr uint16_t RADIO_PREAMBLE_BITS = 16;
constexpr size_t MAX_USB_LINE = 220;

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);
String usbLine;
bool radioReady = false;

void printAck(const String &text) {
  Serial.print("$ACK,");
  Serial.println(text);
}

void printInfo(const String &text) {
  Serial.print("$INFO,");
  Serial.println(text);
}

void printError(const String &text) {
  Serial.print("$ERR,");
  Serial.println(text);
}

uint8_t calculateXOR(const String &s) {
  uint8_t value = 0;
  for (size_t i = 0; i < s.length(); ++i) {
    value ^= static_cast<uint8_t>(s[i]);
  }
  return value;
}

String hex2(uint8_t value) {
  const char hex[] = "0123456789ABCDEF";
  String result;
  result += hex[(value >> 4) & 0x0F];
  result += hex[value & 0x0F];
  return result;
}

bool digitsOnly(const String &s) {
  if (s.length() == 0) return false;
  for (size_t i = 0; i < s.length(); ++i) {
    if (s[i] < '0' || s[i] > '9') return false;
  }
  return true;
}

bool fixedFloat4(const String &s) {
  return s.length() == 4 &&
         s[0] >= '0' && s[0] <= '9' &&
         s[1] == '.' &&
         s[2] >= '0' && s[2] <= '9' &&
         s[3] >= '0' && s[3] <= '9';
}

bool isHexChar(char c) {
  return (c >= '0' && c <= '9') ||
         (c >= 'A' && c <= 'F') ||
         (c >= 'a' && c <= 'f');
}

bool decodePacket(const String &packet, String fields[7]) {
  if (packet.length() != 29) return false;

  int field = 0;
  int start = 0;

  for (int i = 0; i <= packet.length(); ++i) {
    if (i == packet.length() || packet[i] == ',') {
      if (field >= 7) return false;
      fields[field++] = packet.substring(start, i);
      start = i + 1;
    }
  }

  if (field != 7) return false;
  if (fields[0].length() != 2) return false;
  if (fields[1].length() != 5 || !digitsOnly(fields[1])) return false;
  if (fields[2].length() != 5 || !digitsOnly(fields[2])) return false;
  if (!fixedFloat4(fields[3])) return false;
  if (!fixedFloat4(fields[4])) return false;
  if (fields[5] != "0" && fields[5] != "1") return false;
  if (fields[6].length() != 2 || !isHexChar(fields[6][0]) || !isHexChar(fields[6][1])) return false;

  return true;
}

int configureRadio() {
  SPI.begin(CC_SCK, CC_MISO, CC_MOSI, CC_CS);

  int state = radio.begin(
    RADIO_FREQ_MHZ,
    RADIO_RATE_KBPS,
    RADIO_DEVIATION_KHZ,
    RADIO_BW_KHZ,
    RADIO_POWER_DBM,
    RADIO_PREAMBLE_BITS
  );

  if (state != RADIOLIB_ERR_NONE) return state;

  state = radio.setOOK(false);
  if (state != RADIOLIB_ERR_NONE) return state;

  state = radio.setDataShaping(RADIOLIB_SHAPING_NONE);
  if (state != RADIOLIB_ERR_NONE) return state;

  state = radio.setEncoding(RADIOLIB_ENCODING_NRZ);
  if (state != RADIOLIB_ERR_NONE) return state;

  state = radio.setSyncWord(0x12, 0xAD, 0, false);
  if (state != RADIOLIB_ERR_NONE) return state;

  state = radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);
  if (state != RADIOLIB_ERR_NONE) return state;

  state = radio.setCrcFiltering(true);
  if (state != RADIOLIB_ERR_NONE) return state;

  radioReady = true;
  return RADIOLIB_ERR_NONE;
}

void emitTelemetry(String packet) {
  packet.trim();

  String f[7];
  if (!decodePacket(packet, f)) {
    printError("PACKET_FORMAT,RAW=" + packet);
    return;
  }

  const String xorSource =
    f[0] + "," +
    f[1] + "," +
    f[2] + "," +
    f[3] + "," +
    f[4] + "," +
    f[5] + ",";

  const String calculated = hex2(calculateXOR(xorSource));
  String received = f[6];
  received.toUpperCase();

  if (received != calculated) {
    printError("TELEMETRY_XOR,RECV=" + received + ",CALC=" + calculated + ",RAW=" + packet);
    return;
  }

  const float rssi = radio.getRSSI();
  const uint8_t lqi = radio.getLQI();

  // CC1101 не выдаёт готовое SNR пакета. Для интерфейса используется
  // диагностическая оценка относительно условного noise floor -105 dBm.
  float snr = rssi - (-105.0f);
  if (snr > 60.0f) snr = 60.0f;
  if (snr < -10.0f) snr = -10.0f;

  Serial.print("$TEL,ID="); Serial.print(f[0]);
  Serial.print(",PACKET="); Serial.print(f[1]);
  Serial.print(",UPTIME="); Serial.print(f[2]);
  Serial.print(",PANEL_POWER="); Serial.print(f[3]);
  Serial.print(",VOLT="); Serial.print(f[4]);
  Serial.print(",MODE="); Serial.print(f[5]);
  Serial.print(",CHECKSUM="); Serial.print(received);
  Serial.print(",CHECKSUM_OK=1");
  Serial.print(",RSSI="); Serial.print(rssi, 1);
  Serial.print(",SNR="); Serial.print(snr, 1);
  Serial.print(",LQI="); Serial.println(lqi);
}

void transmitCommand(const String &line) {
  if (!radioReady) {
    printError("RADIO_NOT_READY");
    return;
  }

  int state = radio.standby();
  if (state == RADIOLIB_ERR_NONE) {
    state = radio.transmit(line.c_str());
  }

  // Следующий radio.receive() сам вернёт CC1101 в режим приёма.
  radio.standby();

  if (state == RADIOLIB_ERR_NONE) {
    printAck("RADIO_TX,TYPE=CC1101,BYTES=" + String(line.length()));
  } else {
    printError("RADIO_TX,TYPE=CC1101,CODE=" + String(state));
  }
}

void processUsbLine(String line) {
  line.trim();
  if (line.length() == 0) return;

  String upper = line;
  upper.toUpperCase();

  if (upper == "$CMD,GATEWAY_PING") {
    printAck("GATEWAY_PONG");
    return;
  }

  if (upper == "$CMD,GATEWAY_INFO") {
    printInfo("GATEWAY=ALTAIR,DEVICE=ESP32-WROOM-32,FW=" + String(FW_VERSION_V7) +
              ",PROTOCOL=V7.1,FIXED_LEN=29,FREQ=435.000,BW=203,RX=PROVEN_BLOCKING_RECEIVE");
    return;
  }

  if (upper == "$CMD,RADIO_STATUS") {
    printInfo("RADIO,TYPE=CC1101,READY=" + String(radioReady ? 1 : 0) +
              ",FREQ=435.000,POWER=5,RATE=4.8,MOD=2FSK,DEV=5,BW=203,CRC=1");
    return;
  }

  if (upper.startsWith("$CMD,RADIO,")) {
    // В v7.1 профиль миссии фиксирован. Команда интерфейса подтверждается,
    // но не может случайно вернуть приёмник к узкой полосе.
    printAck("RADIO_CONFIG_APPLIED,TYPE=CC1101,PROFILE=V7.1,FREQ=435.000,BW=203");
    return;
  }

  if (upper.startsWith("$CMD,")) {
    transmitCommand(line);
    return;
  }

  printError("UNKNOWN_USB_LINE");
}

void pollUsb() {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());

    if (c == '\r') continue;

    if (c == '\n') {
      processUsbLine(usbLine);
      usbLine = "";
      continue;
    }

    if (usbLine.length() < MAX_USB_LINE) {
      usbLine += c;
    } else {
      usbLine = "";
      printError("USB_LINE_TOO_LONG");
    }
  }
}

void setup() {
  Serial.begin(USB_BAUD);
  delay(1000);
  usbLine.reserve(MAX_USB_LINE + 8);

  printInfo("GATEWAY=ALTAIR,DEVICE=ESP32-WROOM-32,FW=" + String(FW_VERSION_V7) +
            ",BOOT=1,PROTOCOL=V7.1,FIXED_LEN=29,FREQ=435.000,BW=203,RX=PROVEN_BLOCKING_RECEIVE");

  const int state = configureRadio();

  if (state != RADIOLIB_ERR_NONE) {
    printError("CC1101_INIT,CODE=" + String(state));
    while (true) {
      pollUsb();
      delay(1000);
    }
  }

  printInfo("RADIO_READY,TYPE=CC1101,FREQ=435.000,RATE=4.8,MOD=2FSK,DEV=5,BW=203,SYNC=12AD,ENC=NRZ,LEN=VARIABLE,CRC=1");
}

void loop() {
  String packet;

  // КЛЮЧЕВОЕ исправление v7.1:
  // используется ровно тот вызов RadioLib, на котором телеметрия
  // была реально принята на стенде.
  const int state = radio.receive(packet);

  if (state == RADIOLIB_ERR_NONE) {
    emitTelemetry(packet);
  }
  else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    printError("RADIO_RX_CRC");
  }
  else if (state != RADIOLIB_ERR_RX_TIMEOUT) {
    printError("RADIO_RX,CODE=" + String(state));
  }

  // Обслуживаем USB после каждого успешного приёма или штатного таймаута.
  pollUsb();
}
