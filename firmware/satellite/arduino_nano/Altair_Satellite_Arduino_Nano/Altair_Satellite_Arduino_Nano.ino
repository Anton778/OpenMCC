#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v8 — бортовая прошивка Arduino Nano + CC1101.
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
 * ВАЖНО: классический Nano работает с логическими уровнями 5 В.
 * Линии SCK, MOSI и CSN необходимо подключать через преобразователь
 * уровней 5 В ↔ 3,3 В. Питать CC1101 от 5 В нельзя.
 *
 * Один CC1101 поочерёдно передаёт телеметрию и принимает команды.
 */

#define CC_CS    10
#define CC_GDO0  2
#define CC_GDO2  3

static const char SATELLITE_ID[] = "02";
static const char FW_VERSION[] = "8.1.0";

static const float RF_FREQ_MHZ = 435.000f;
static const float RF_BITRATE_KBPS = 4.8f;
static const float RF_DEVIATION_KHZ = 5.0f;
static const float RF_BW_KHZ = 203.0f;
static const int8_t RF_POWER_DBM = 5;
static const uint16_t RF_PREAMBLE_BITS = 16;

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);

bool telemetryEnabled = true;
uint32_t telemetryPeriodMs = 1000;
uint32_t lastTelemetryMs = 0;
uint32_t packetNumber = 1;
String radioCommand;

uint8_t calculateXor(const char* text) {
  uint8_t value = 0;
  while (*text != '\0') value ^= static_cast<uint8_t>(*text++);
  return value;
}

// Настраивает единый радиопрофиль проекта.
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

// Формирует пакет: ID,PACKET,UPTIME,PANEL_POWER,VOLT,MODE,CHECKSUM.
void buildTelemetry(char* packet, size_t packetSize) {
  const uint32_t shortPacketNumber = packetNumber % 100000UL;
  const uint32_t uptimeSeconds = (millis() / 1000UL) % 100000UL;

  char body[72];
  snprintf(
    body,
    sizeof(body),
    "%s,%05lu,%05lu,3.00,4.20,1,",
    SATELLITE_ID,
    static_cast<unsigned long>(shortPacketNumber),
    static_cast<unsigned long>(uptimeSeconds)
  );

  const uint8_t checksum = calculateXor(body);
  snprintf(packet, packetSize, "%s%02X", body, checksum);
}

bool transmitPayload(const char* payload) {
  radio.standby();
  const int state = radio.transmit(payload);
  radio.standby();

  if (state != RADIOLIB_ERR_NONE) {
    Serial.print(F("Ошибка передачи CC1101, код "));
    Serial.println(state);
    return false;
  }

  return true;
}

void sendTelemetry() {
  char packet[80];
  buildTelemetry(packet, sizeof(packet));

  Serial.print(F("Телеметрия TX: "));
  Serial.println(packet);
  if (transmitPayload(packet)) ++packetNumber;
}

// Ищет поле KEY=VALUE в команде и копирует значение в буфер.
bool extractField(const char* command, const char* key, char* value, size_t valueSize) {
  char marker[18];
  snprintf(marker, sizeof(marker), ",%s=", key);

  const char* start = strstr(command, marker);
  if (start == nullptr) return false;
  start += strlen(marker);

  const char* end = strchr(start, ',');
  const size_t length = end == nullptr ? strlen(start) : static_cast<size_t>(end - start);
  if (length == 0 || length >= valueSize) return false;

  memcpy(value, start, length);
  value[length] = '\0';
  return true;
}

void sendCommandReply(const char* name, const char* extra = nullptr) {
  char reply[120];
  if (extra != nullptr && extra[0] != '\0') {
    snprintf(reply, sizeof(reply), "$ACK,FROM=%s,NAME=%s,%s", SATELLITE_ID, name, extra);
  } else {
    snprintf(reply, sizeof(reply), "$ACK,FROM=%s,NAME=%s", SATELLITE_ID, name);
  }
  transmitPayload(reply);
}

// Выполняет команды, адресованные этому спутнику или группе ALL.
void handleRadioCommand(const char* command) {
  if (strncmp(command, "$CMD,", 5) != 0) return;

  char recipient[8];
  char name[20];
  if (!extractField(command, "TO", recipient, sizeof(recipient))) return;
  if (!extractField(command, "NAME", name, sizeof(name))) return;
  if (strcmp(recipient, SATELLITE_ID) != 0 && strcmp(recipient, "ALL") != 0) return;

  if (strcmp(name, "PING") == 0) {
    sendCommandReply("PONG");
    return;
  }

  if (strcmp(name, "INFO") == 0) {
    char extra[48];
    snprintf(extra, sizeof(extra), "BOARD=ARDUINO_NANO,FW=%s", FW_VERSION);
    sendCommandReply("INFO", extra);
    return;
  }

  if (strcmp(name, "TM_START") == 0 || strcmp(name, "START") == 0) {
    telemetryEnabled = true;
    sendCommandReply("TM_STARTED");
    return;
  }

  if (strcmp(name, "TM_STOP") == 0 || strcmp(name, "STOP") == 0) {
    sendCommandReply("TM_STOPPED");
    telemetryEnabled = false;
    return;
  }

  if (strcmp(name, "TM_PERIOD") == 0) {
    char periodText[12];
    if (!extractField(command, "MS", periodText, sizeof(periodText))) {
      sendCommandReply("ERROR", "REASON=NO_PERIOD");
      return;
    }

    const uint32_t requestedPeriod = strtoul(periodText, nullptr, 10);
    if (requestedPeriod >= 200 && requestedPeriod <= 60000) {
      telemetryPeriodMs = requestedPeriod;
      char extra[24];
      snprintf(extra, sizeof(extra), "MS=%lu", static_cast<unsigned long>(telemetryPeriodMs));
      sendCommandReply("TM_PERIOD_OK", extra);
    } else {
      sendCommandReply("ERROR", "REASON=BAD_PERIOD");
    }
    return;
  }

  if (strcmp(name, "USER") == 0) {
    sendCommandReply("USER_OK");
    return;
  }

  sendCommandReply("ERROR", "REASON=UNKNOWN_COMMAND");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  radioCommand.reserve(120);

  const int state = configureRadio();
  if (state != RADIOLIB_ERR_NONE) {
    Serial.print(F("Ошибка инициализации CC1101, код "));
    Serial.println(state);
    while (true) delay(1000);
  }

  Serial.println(F("Спутник Альтаир: Arduino Nano + CC1101 готов"));
  Serial.println(F("Профиль: 435,000 МГц / 4,8 кбит/с / 2-FSK / BW 203 кГц"));
}

void loop() {
  const uint32_t now = millis();
  if (telemetryEnabled && now - lastTelemetryMs >= telemetryPeriodMs) {
    lastTelemetryMs = now;
    sendTelemetry();
  }

  radioCommand = "";
  const int state = radio.receive(radioCommand);

  if (state == RADIOLIB_ERR_NONE) {
    Serial.print(F("Команда RX: "));
    Serial.println(radioCommand);

    char commandBuffer[120];
    radioCommand.toCharArray(commandBuffer, sizeof(commandBuffer));
    handleRadioCommand(commandBuffer);
  } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    Serial.println(F("Принят пакет с ошибкой аппаратного CRC"));
  }
}
