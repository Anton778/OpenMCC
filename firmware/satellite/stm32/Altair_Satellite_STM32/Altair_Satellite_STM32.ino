#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v8 — бортовая прошивка STM32/Blue Pill + CC1101.
 * Предназначена для учебного спутника IntroSat.
 *
 * Рабочее подключение IntroSat:
 *   CSN  -> PA2
 *   GDO0 -> PA0
 *   GDO2 -> PA1
 *   SCK  -> PA5
 *   MISO -> PA6
 *   MOSI -> PA7
 *   VCC  -> 3,3 В
 *   GND  -> GND
 *
 * На некоторых ревизиях шилда IntroSat линии CSN, GDO0 и GDO2
 * необходимо подпаивать отдельными проводами. Перед пайкой следует
 * проверить маркировку конкретной платы.
 *
 * Один CC1101 передаёт телеметрию и принимает команды в полудуплексном
 * режиме. Период телеметрии и идентификатор спутника задаются ниже.
 */

#define CC_CS    PA2
#define CC_GDO0  PA0
#define CC_GDO2  PA1

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

// Вычисляет прикладную XOR-сумму ASCII-символов.
// Наземный шлюз v8 её не проверяет, но поле сохраняется в пакете.
uint8_t calculateXor(const char* text) {
  uint8_t value = 0;
  while (*text != '\0') value ^= static_cast<uint8_t>(*text++);
  return value;
}

// Устанавливает общий радиопрофиль ЦУПа и спутника.
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

// Формирует строку телеметрии с номером пакета и временем работы.
void buildTelemetry(char* packet, size_t packetSize) {
  const uint32_t shortPacketNumber = packetNumber % 100000UL;
  const uint32_t uptimeSeconds = (millis() / 1000UL) % 100000UL;

  // Значения 3.00 Вт и 4.20 В являются демонстрационными.
  // Вместо них можно подставить реальные измерения датчиков спутника.
  char body[80];
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

// Передаёт произвольную строку через тот же CC1101.
bool transmitPayload(String payload) {
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
  char packet[96];
  buildTelemetry(packet, sizeof(packet));

  Serial.print(F("Телеметрия TX: "));
  Serial.println(packet);

  if (transmitPayload(String(packet))) ++packetNumber;
}

// Извлекает значение поля KEY=VALUE из команды с разделителями-запятыми.
String commandField(const String& line, const char* key) {
  const String marker = String(key) + "=";
  int start = line.indexOf(marker);
  if (start < 0) return "";

  // Поле должно начинаться после символа начала строки или запятой.
  if (start > 0 && line[start - 1] != ',') return "";
  start += marker.length();

  int end = line.indexOf(',', start);
  if (end < 0) end = line.length();
  return line.substring(start, end);
}

void sendCommandReply(const String& name, const String& extra = "") {
  String reply = "$ACK,FROM=" + String(SATELLITE_ID) + ",NAME=" + name;
  if (extra.length() > 0) reply += "," + extra;
  transmitPayload(reply);
}

// Выполняет адресованные спутнику команды наземного ЦУПа.
void handleRadioCommand(String command) {
  command.trim();
  if (!command.startsWith("$CMD,")) return;

  String recipient = commandField(command, "TO");
  String name = commandField(command, "NAME");
  recipient.toUpperCase();
  name.toUpperCase();

  if (recipient != SATELLITE_ID && recipient != "ALL") return;

  if (name == "PING") {
    sendCommandReply("PONG");
    return;
  }

  if (name == "INFO") {
    sendCommandReply("INFO", "BOARD=STM32,FW=" + String(FW_VERSION));
    return;
  }

  if (name == "TM_START" || name == "START") {
    telemetryEnabled = true;
    sendCommandReply("TM_STARTED");
    return;
  }

  if (name == "TM_STOP" || name == "STOP") {
    sendCommandReply("TM_STOPPED");
    telemetryEnabled = false;
    return;
  }

  if (name == "TM_PERIOD") {
    const uint32_t requestedPeriod = commandField(command, "MS").toInt();
    if (requestedPeriod >= 200 && requestedPeriod <= 60000) {
      telemetryPeriodMs = requestedPeriod;
      sendCommandReply("TM_PERIOD_OK", "MS=" + String(telemetryPeriodMs));
    } else {
      sendCommandReply("ERROR", "REASON=BAD_PERIOD");
    }
    return;
  }

  if (name == "USER") {
    sendCommandReply("USER_OK");
    return;
  }

  sendCommandReply("ERROR", "REASON=UNKNOWN_COMMAND");
}

void setup() {
  Serial.begin(115200);
  delay(500);

  const int state = configureRadio();
  if (state != RADIOLIB_ERR_NONE) {
    Serial.print(F("Ошибка инициализации CC1101, код "));
    Serial.println(state);
    while (true) delay(1000);
  }

  Serial.println(F("Спутник Альтаир: STM32 + CC1101 готов"));
  Serial.println(F("Профиль: 435,000 МГц / 4,8 кбит/с / 2-FSK / BW 203 кГц"));
}

void loop() {
  const uint32_t now = millis();
  if (telemetryEnabled && now - lastTelemetryMs >= telemetryPeriodMs) {
    lastTelemetryMs = now;
    sendTelemetry();
  }

  // Между передачами телеметрии модуль ожидает команду от ЦУПа.
  String command;
  const int state = radio.receive(command);

  if (state == RADIOLIB_ERR_NONE) {
    Serial.print(F("Команда RX: "));
    Serial.println(command);
    handleRadioCommand(command);
  } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
    Serial.println(F("Принят пакет с ошибкой аппаратного CRC"));
  }
}
