#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v8 — ESP32 + CC1101
 *
 * Рабочий профиль:
 *   435.000 MHz, 4.8 kbps, 2-FSK, deviation 5 kHz,
 *   RX bandwidth 203 kHz, sync 0x12AD, NRZ, variable packet, CRC CC1101 ON.
 *
 * Главное отличие v8:
 *   - прикладная XOR-контрольная сумма НЕ проверяется;
 *   - изменение ID/полей не требует пересчёта последних двух HEX-символов;
 *   - поддерживаются 7 полей (без ANTENNA) и 8 полей (с ANTENNA);
 *   - из ЦУПа можно передавать RF-команды через этот же CC1101.
 */

#define CC_SCK   18
#define CC_MISO  19
#define CC_MOSI  23
#define CC_CS    21
#define CC_GDO0  4
#define CC_GDO2  27

static constexpr char FW_VERSION[] = "8.0.0";
static constexpr float RF_FREQ_MHZ = 435.000f;
static constexpr float RF_BITRATE_KBPS = 4.8f;
static constexpr float RF_DEVIATION_KHZ = 5.0f;
static constexpr float RF_BW_KHZ = 203.0f;
static constexpr int8_t RF_POWER_DBM = 5;
static constexpr uint16_t RF_PREAMBLE_BITS = 16;

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);
String usbLine;

bool splitCsv(const String& packet, String fields[], int maxFields, int& count) {
  count = 0;
  int start = 0;
  for (int i = 0; i <= packet.length(); i++) {
    if (i == packet.length() || packet[i] == ',') {
      if (count >= maxFields) return false;
      fields[count] = packet.substring(start, i);
      fields[count].trim();
      count++;
      start = i + 1;
    }
  }
  return count > 0;
}

void startReceiveAgain() {
  radio.startReceive();
}

void printRadioStatus() {
  Serial.println("$INFO,RADIO,TYPE=CC1101,FREQ=435.000,RATE=4.8,MOD=2FSK,DEV=5,BW=203,POWER=5,SYNC=12AD,CRC=1,XOR=OFF,RF_TX=ON,PROFILE=FIXED_V8");
}

bool transmitRf(String payload) {
  payload.trim();
  if (!payload.length()) return false;

  radio.standby();
  const int state = radio.transmit(payload);
  startReceiveAgain();

  if (state == RADIOLIB_ERR_NONE) {
    Serial.print("$ACK,RF_TX,BYTES=");
    Serial.print(payload.length());
    Serial.print(",DATA=");
    Serial.println(payload);
    return true;
  }

  Serial.print("$ERR,RF_TX,CODE=");
  Serial.println(state);
  return false;
}

void handleUsbCommand(String line) {
  line.trim();
  if (!line.length()) return;

  if (line.equalsIgnoreCase("$CMD,GATEWAY_PING")) {
    Serial.println("$ACK,GATEWAY_PONG,V=8.0.0");
    return;
  }

  if (line.equalsIgnoreCase("$CMD,GATEWAY_INFO")) {
    Serial.println("$INFO,GATEWAY=ALTAIR_V8,FREQ=435.000,RATE=4.8,DEV=5,BW=203,XOR=OFF,RF_TX=ON");
    return;
  }

  if (line.equalsIgnoreCase("$CMD,RADIO_STATUS")) {
    printRadioStatus();
    return;
  }

  // В v8 радиопрофиль наземного CC1101 намеренно фиксирован на
  // проверенной стендовой конфигурации. Старые команды конфигурации
  // принимаем как служебные, но параметры по ним не меняем.
  if (line.startsWith("$CMD,RADIO,")) {
    Serial.println("$ERR,RADIO_CONFIG_FIXED,FREQ=435.000,RATE=4.8,DEV=5,BW=203");
    return;
  }

  // Команда из программы:
  // $CMD,RF,TO=02,NAME=PING
  //
  // В эфир отправляется:
  // $CMD,TO=02,NAME=PING
  if (line.startsWith("$CMD,RF,")) {
    String onAir = "$CMD," + line.substring(8);
    transmitRf(onAir);
    return;
  }

  // Для отладки разрешаем отправить произвольную строку:
  // $RF,любой текст
  if (line.startsWith("$RF,")) {
    transmitRf(line.substring(4));
    return;
  }

  Serial.print("$ERR,UNKNOWN_USB_COMMAND,DATA=");
  Serial.println(line);
}

void pollUsb() {
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;

    if (c == '\n') {
      handleUsbCommand(usbLine);
      usbLine = "";
      continue;
    }

    if (usbLine.length() < 220) {
      usbLine += c;
    } else {
      usbLine = "";
      Serial.println("$ERR,USB_LINE_TOO_LONG");
    }
  }
}

void emitTelemetry(String packet) {
  packet.trim();

  String f[8];
  int count = 0;
  if (!splitCsv(packet, f, 8, count) || (count != 7 && count != 8)) {
    Serial.print("$RAW,");
    Serial.println(packet);
    return;
  }

  // 7 полей:
  // ID,PACKET,UPTIME,PANEL_POWER,VOLT,MODE,CHECKSUM
  //
  // 8 полей:
  // ID,PACKET,UPTIME,PANEL_POWER,VOLT,MODE,ANTENNA,CHECKSUM
  const bool hasAntenna = (count == 8);
  const int checksumIndex = hasAntenna ? 7 : 6;

  const float rssi = radio.getRSSI();
  const uint8_t lqi = radio.getLQI();

  // CC1101 не выдаёт аппаратный SNR как отдельную величину.
  // Это диагностическая оценка относительно опорного уровня -105 dBm.
  float snr = rssi + 105.0f;
  if (snr > 60.0f) snr = 60.0f;
  if (snr < -10.0f) snr = -10.0f;

  Serial.print("$TEL,ID="); Serial.print(f[0]);
  Serial.print(",PACKET="); Serial.print(f[1]);
  Serial.print(",UPTIME="); Serial.print(f[2]);
  Serial.print(",PANEL_POWER="); Serial.print(f[3]);
  Serial.print(",VOLT="); Serial.print(f[4]);
  Serial.print(",MODE="); Serial.print(f[5]);

  if (hasAntenna) {
    Serial.print(",ANTENNA=");
    Serial.print(f[6]);
  }

  // Поле сохраняется для совместимости интерфейса,
  // но НЕ проверяется и НЕ пересчитывается.
  Serial.print(",CHECKSUM=");
  Serial.print(f[checksumIndex]);
  Serial.print(",CHECKSUM_BYPASS=1");

  Serial.print(",RSSI="); Serial.print(rssi, 1);
  Serial.print(",SNR="); Serial.print(snr, 1);
  Serial.print(",LQI="); Serial.println(lqi);
}

void setup() {
  Serial.begin(115200);
  delay(700);
  usbLine.reserve(240);

  SPI.begin(CC_SCK, CC_MISO, CC_MOSI, CC_CS);

  int state = radio.begin(
    RF_FREQ_MHZ,
    RF_BITRATE_KBPS,
    RF_DEVIATION_KHZ,
    RF_BW_KHZ,
    RF_POWER_DBM,
    RF_PREAMBLE_BITS
  );

  if (state != RADIOLIB_ERR_NONE) {
    Serial.print("$ERR,CC1101_INIT,CODE=");
    Serial.println(state);
    while (true) delay(1000);
  }

  radio.setOOK(false);
  radio.setDataShaping(RADIOLIB_SHAPING_NONE);
  radio.setEncoding(RADIOLIB_ENCODING_NRZ);
  radio.setSyncWord(0x12, 0xAD, 0, false);
  radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);

  // Это CRC самого пакетного механизма CC1101.
  // Прикладной XOR в текстовом пакете НЕ проверяется.
  radio.setCrcFiltering(true);

  Serial.print("$INFO,GATEWAY=ALTAIR_V8,FW="); Serial.println(FW_VERSION);
  Serial.println("$INFO,RADIO_READY,TYPE=CC1101,FREQ=435.000,RATE=4.8,DEV=5,BW=203,SYNC=12AD,CRC=1");
  Serial.println("$INFO,APPLICATION_XOR_CHECK=DISABLED,RF_TX=ENABLED");
}

void loop() {
  pollUsb();

  String packet;

  // Проверенный на стенде путь RadioLib.
  const int state = radio.receive(packet);

  if (state == RADIOLIB_ERR_NONE) {
    emitTelemetry(packet);
  } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    // Это только аппаратный CRC CC1101.
    Serial.println("$ERR,RADIO_RX_CRC");
  }

  pollUsb();
}
