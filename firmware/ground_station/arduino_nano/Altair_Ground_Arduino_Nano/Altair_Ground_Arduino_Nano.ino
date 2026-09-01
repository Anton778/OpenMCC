#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v8 — наземный радиошлюз Arduino Nano + CC1101.
 *
 * Подключение CC1101:
 *   CSN  -> D10
 *   MOSI -> D11
 *   MISO -> D12
 *   SCK  -> D13
 *   GDO0 -> D2
 *   GDO2 -> D3
 *   VCC  -> 3,3 В
 *   GND  -> GND
 *
 * ВАЖНО: классический Nano на ATmega328P использует уровни 5 В.
 * Линии SCK, MOSI и CSN необходимо подключать к CC1101 через
 * преобразователь логических уровней. Питать CC1101 от 5 В нельзя.
 *
 * Код использует фиксированные символьные буферы, чтобы экономить
 * оперативную память Arduino Nano.
 */

#define CC_CS    10
#define CC_GDO0  2
#define CC_GDO2  3

static const char FW_VERSION[] = "8.1.0";
static const char BOARD_NAME[] = "ARDUINO_NANO";
static const float RF_FREQ_MHZ = 435.000f;
static const float RF_BITRATE_KBPS = 4.8f;
static const float RF_DEVIATION_KHZ = 5.0f;
static const float RF_BW_KHZ = 203.0f;
static const int8_t RF_POWER_DBM = 5;
static const uint16_t RF_PREAMBLE_BITS = 16;

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);

char usbLine[161];
uint8_t usbLength = 0;
String radioPacket;

// Настраивает одинаковый радиопрофиль на всех платах проекта.
int configureRadio() {
  SPI.begin();

  int state = radio.begin(
    RF_FREQ_MHZ,
    RF_BITRATE_KBPS,
    RF_DEVIATION_KHZ,
    RF_BW_KHZ,
    RF_POWER_DBM,
    RF_PREAMBLE_BITS
  );

  if (state == RADIOLIB_ERR_NONE) state = radio.setOOK(false);
  if (state == RADIOLIB_ERR_NONE) state = radio.setDataShaping(RADIOLIB_SHAPING_NONE);
  if (state == RADIOLIB_ERR_NONE) state = radio.setEncoding(RADIOLIB_ENCODING_NRZ);
  if (state == RADIOLIB_ERR_NONE) state = radio.setSyncWord(0x12, 0xAD, 0, false);
  if (state == RADIOLIB_ERR_NONE) state = radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);
  if (state == RADIOLIB_ERR_NONE) state = radio.setCrcFiltering(true);

  return state;
}

void printRadioStatus() {
  Serial.println(F("$INFO,RADIO,TYPE=CC1101,FREQ=435.000,RATE=4.8,MOD=2FSK,DEV=5,BW=203,POWER=5,SYNC=12AD,CRC=1,XOR=OFF,RF_TX=ON,PROFILE=FIXED_V8"));
}

// Передаёт строку в эфир и сообщает программе результат операции.
bool transmitRf(const char* payload) {
  if (payload == nullptr || payload[0] == '\0') return false;

  radio.standby();
  const int state = radio.transmit(payload);
  radio.standby();

  if (state == RADIOLIB_ERR_NONE) {
    Serial.print(F("$ACK,RF_TX,BYTES="));
    Serial.println(strlen(payload));
    return true;
  }

  Serial.print(F("$ERR,RF_TX,CODE="));
  Serial.println(state);
  return false;
}

// Обрабатывает одну законченную команду из USB-порта.
void handleUsbCommand(char* line) {
  if (line == nullptr || line[0] == '\0') return;

  if (strcmp(line, "$CMD,GATEWAY_PING") == 0) {
    Serial.print(F("$ACK,GATEWAY_PONG,V="));
    Serial.println(FW_VERSION);
    return;
  }

  if (strcmp(line, "$CMD,GATEWAY_INFO") == 0) {
    Serial.print(F("$INFO,GATEWAY=ALTAIR_V8,BOARD="));
    Serial.print(BOARD_NAME);
    Serial.print(F(",FW="));
    Serial.print(FW_VERSION);
    Serial.println(F(",FREQ=435.000,RATE=4.8,DEV=5,BW=203,XOR=OFF,RF_TX=ON"));
    return;
  }

  if (strcmp(line, "$CMD,RADIO_STATUS") == 0) {
    printRadioStatus();
    return;
  }

  // Параметры профиля намеренно не изменяются командами интерфейса.
  if (strncmp(line, "$CMD,RADIO,", 11) == 0) {
    Serial.println(F("$ERR,RADIO_CONFIG_FIXED,FREQ=435.000,RATE=4.8,DEV=5,BW=203"));
    return;
  }

  // Удаляем служебную вставку RF перед передачей команды спутнику.
  if (strncmp(line, "$CMD,RF,", 8) == 0) {
    char onAir[145];
    strcpy(onAir, "$CMD,");
    strncat(onAir, line + 8, sizeof(onAir) - strlen(onAir) - 1);
    transmitRf(onAir);
    return;
  }

  if (strncmp(line, "$RF,", 4) == 0) {
    transmitRf(line + 4);
    return;
  }

  Serial.println(F("$ERR,UNKNOWN_USB_COMMAND"));
}

// Считывает команды без динамического выделения памяти.
void pollUsb() {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') continue;

    if (c == '\n') {
      usbLine[usbLength] = '\0';
      handleUsbCommand(usbLine);
      usbLength = 0;
      continue;
    }

    if (usbLength < sizeof(usbLine) - 1) {
      usbLine[usbLength++] = c;
    } else {
      usbLength = 0;
      Serial.println(F("$ERR,USB_LINE_TOO_LONG"));
    }
  }
}

// Разделяет буфер телеметрии на поля, заменяя запятые нулевыми байтами.
uint8_t splitFields(char* data, char* fields[], uint8_t maxFields) {
  if (data == nullptr || data[0] == '\0' || maxFields == 0) return 0;

  uint8_t count = 1;
  fields[0] = data;

  for (char* p = data; *p != '\0'; ++p) {
    if (*p == ',') {
      *p = '\0';
      if (count >= maxFields) return 0;
      fields[count++] = p + 1;
    }
  }

  return count;
}

// Выводит телеметрию в формате последовательного протокола ЦУПа.
void emitTelemetry(String& packet) {
  packet.trim();

  char data[112];
  if (packet.length() == 0 || packet.length() >= sizeof(data)) {
    Serial.println(F("$ERR,RADIO_PACKET_TOO_LONG"));
    return;
  }
  packet.toCharArray(data, sizeof(data));

  char* fields[8];
  const uint8_t count = splitFields(data, fields, 8);
  if (count != 7 && count != 8) {
    Serial.print(F("$RAW,"));
    Serial.println(packet);
    return;
  }

  const bool hasAntenna = (count == 8);
  const uint8_t checksumIndex = hasAntenna ? 7 : 6;
  const float rssi = radio.getRSSI();
  const uint8_t lqi = radio.getLQI();

  float snr = rssi + 105.0f;
  if (snr > 60.0f) snr = 60.0f;
  if (snr < -10.0f) snr = -10.0f;

  Serial.print(F("$TEL,ID=")); Serial.print(fields[0]);
  Serial.print(F(",PACKET=")); Serial.print(fields[1]);
  Serial.print(F(",UPTIME=")); Serial.print(fields[2]);
  Serial.print(F(",PANEL_POWER=")); Serial.print(fields[3]);
  Serial.print(F(",VOLT=")); Serial.print(fields[4]);
  Serial.print(F(",MODE=")); Serial.print(fields[5]);

  if (hasAntenna) {
    Serial.print(F(",ANTENNA="));
    Serial.print(fields[6]);
  }

  Serial.print(F(",CHECKSUM=")); Serial.print(fields[checksumIndex]);
  Serial.print(F(",CHECKSUM_BYPASS=1,RSSI=")); Serial.print(rssi, 1);
  Serial.print(F(",SNR=")); Serial.print(snr, 1);
  Serial.print(F(",LQI=")); Serial.println(lqi);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  radioPacket.reserve(112);

  const int state = configureRadio();
  if (state != RADIOLIB_ERR_NONE) {
    Serial.print(F("$ERR,CC1101_INIT,CODE="));
    Serial.println(state);
    while (true) {
      pollUsb();
      delay(500);
    }
  }

  Serial.print(F("$INFO,GATEWAY=ALTAIR_V8,BOARD="));
  Serial.print(BOARD_NAME);
  Serial.print(F(",FW="));
  Serial.println(FW_VERSION);
  Serial.println(F("$INFO,RADIO_READY,TYPE=CC1101,FREQ=435.000,RATE=4.8,DEV=5,BW=203,SYNC=12AD,CRC=1"));
}

void loop() {
  pollUsb();

  radioPacket = "";
  const int state = radio.receive(radioPacket);

  if (state == RADIOLIB_ERR_NONE) {
    emitTelemetry(radioPacket);
  } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    Serial.println(F("$ERR,RADIO_RX_CRC"));
  }

  pollUsb();
}
