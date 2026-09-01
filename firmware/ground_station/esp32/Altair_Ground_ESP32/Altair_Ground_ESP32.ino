#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v8 — наземный радиошлюз ESP32-WROOM-32 + CC1101.
 *
 * Рабочий радиопрофиль:
 *   частота 435,000 МГц;
 *   скорость 4,8 кбит/с;
 *   модуляция 2-FSK;
 *   девиация 5 кГц;
 *   полоса приёмника 203 кГц;
 *   слово синхронизации 0x12AD;
 *   кодирование NRZ;
 *   переменная длина пакета;
 *   аппаратный CRC CC1101 включён.
 *
 * Прикладная XOR-сумма в текстовом пакете сохраняется, но не проверяется.
 * Один CC1101 поочерёдно работает на приём телеметрии и передачу команд.
 */

#define CC_SCK   18
#define CC_MISO  19
#define CC_MOSI  23
#define CC_CS    21
#define CC_GDO0  4
#define CC_GDO2  27

static constexpr char FW_VERSION[] = "8.3.0";
static constexpr float RF_FREQ_MHZ = 435.000f;
static constexpr float RF_BITRATE_KBPS = 4.8f;
static constexpr float RF_DEVIATION_KHZ = 5.0f;
static constexpr float RF_BW_KHZ = 203.0f;
static constexpr int8_t RF_POWER_DBM = 5;
static constexpr uint16_t RF_PREAMBLE_BITS = 16;
static constexpr float RF_MIN_FREQ_MHZ = 387.000f;
static constexpr float RF_MAX_FREQ_MHZ = 464.000f;

static const int8_t RF_ALLOWED_POWERS_DBM[] = {
  -30, -20, -15, -10, 0, 5, 7, 10
};

static const uint16_t RF_ALLOWED_BANDWIDTHS_KHZ[] = {
  58, 68, 81, 102, 116, 135, 162, 203,
  232, 270, 325, 406, 464, 541, 650, 812
};

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);
String usbLine;
volatile bool rfPacketReceived = false;
float activeRfFrequencyMHz = RF_FREQ_MHZ;
int8_t activeRfPowerDbm = RF_POWER_DBM;
uint16_t activeRfBandwidthKHz = static_cast<uint16_t>(RF_BW_KHZ);

// Обработчик прерывания только устанавливает флаг. Чтение SPI и вывод в USB
// выполняются в основном цикле, а не внутри обработчика прерывания.
void IRAM_ATTR onRfPacketReceived() {
  rfPacketReceived = true;
}

// Разделяет принятую строку по запятым без проверки значений полей.
bool splitCsv(const String& packet, String fields[], int maxFields, int& count) {
  count = 0;
  int start = 0;

  for (int i = 0; i <= packet.length(); ++i) {
    if (i == packet.length() || packet[i] == ',') {
      if (count >= maxFields) return false;
      fields[count] = packet.substring(start, i);
      fields[count].trim();
      ++count;
      start = i + 1;
    }
  }

  return count > 0;
}

int startReceiveAgain() {
  rfPacketReceived = false;
  return radio.startReceive();
}

void printRadioStatus() {
  Serial.print("$INFO,RADIO,TYPE=CC1101,FREQ=");
  Serial.print(activeRfFrequencyMHz, 3);
  Serial.print(",RATE=4.8,MOD=2FSK,DEV=5,BW=");
  Serial.print(activeRfBandwidthKHz);
  Serial.print(",POWER=");
  Serial.print(static_cast<int>(activeRfPowerDbm));
  Serial.println(",SYNC=12AD,CRC=1,XOR=OFF,RF_TX=ON,RX_MODE=INTERRUPT,PROFILE=RUNTIME_V8");
}

bool isAllowedPower(int value) {
  for (const int8_t allowed : RF_ALLOWED_POWERS_DBM) {
    if (value == allowed) return true;
  }
  return false;
}

bool isAllowedBandwidth(int value) {
  for (const uint16_t allowed : RF_ALLOWED_BANDWIDTHS_KHZ) {
    if (value == allowed) return true;
  }
  return false;
}

// Извлекает значение параметра KEY из фрагмента вида ,KEY=VALUE.
bool readCommandParameter(const String& line, const char* key, String& value) {
  String token = ",";
  token += key;
  token += "=";
  const int tokenStart = line.indexOf(token);
  if (tokenStart < 0) return false;

  const int valueStart = tokenStart + token.length();
  int valueEnd = line.indexOf(',', valueStart);
  if (valueEnd < 0) valueEnd = line.length();

  value = line.substring(valueStart, valueEnd);
  value.trim();
  return value.length() > 0;
}

bool parseFloatStrict(const String& text, float& value) {
  char* end = nullptr;
  value = strtof(text.c_str(), &end);
  return end != text.c_str() && *end == '\0' && isfinite(value);
}

bool parseIntegerStrict(const String& text, int& value) {
  char* end = nullptr;
  const long parsed = strtol(text.c_str(), &end, 10);
  if (end == text.c_str() || *end != '\0') return false;
  value = static_cast<int>(parsed);
  return true;
}

void printRadioConfigResult(const char* result) {
  Serial.print("$ACK,");
  Serial.print(result);
  Serial.print(",FREQ=");
  Serial.print(activeRfFrequencyMHz, 3);
  Serial.print(",POWER=");
  Serial.print(static_cast<int>(activeRfPowerDbm));
  Serial.print(",BW=");
  Serial.println(activeRfBandwidthKHz);
}

// Применяет новый профиль как одну транзакцию. Если любой вызов RadioLib
// завершается ошибкой, предыдущий рабочий профиль восстанавливается.
bool applyRadioSettings(float frequencyMHz, int powerDbm, int bandwidthKHz, const char* result) {
  if (
    frequencyMHz < RF_MIN_FREQ_MHZ ||
    frequencyMHz > RF_MAX_FREQ_MHZ ||
    !isAllowedPower(powerDbm) ||
    !isAllowedBandwidth(bandwidthKHz)
  ) {
    Serial.print("$ERR,RADIO_CONFIG_INVALID,FREQ=");
    Serial.print(frequencyMHz, 3);
    Serial.print(",POWER=");
    Serial.print(powerDbm);
    Serial.print(",BW=");
    Serial.println(bandwidthKHz);
    return false;
  }

  const float previousFrequencyMHz = activeRfFrequencyMHz;
  const int8_t previousPowerDbm = activeRfPowerDbm;
  const uint16_t previousBandwidthKHz = activeRfBandwidthKHz;

  rfPacketReceived = false;
  int state = radio.standby();
  if (state == RADIOLIB_ERR_NONE) state = radio.setFrequency(frequencyMHz);
  if (state == RADIOLIB_ERR_NONE) state = radio.setOutputPower(static_cast<int8_t>(powerDbm));
  if (state == RADIOLIB_ERR_NONE) state = radio.setRxBandwidth(static_cast<float>(bandwidthKHz));

  if (state != RADIOLIB_ERR_NONE) {
    // Восстановление выполняется полностью, даже если ошибка возникла
    // после успешного изменения одного из предыдущих параметров.
    radio.standby();
    radio.setFrequency(previousFrequencyMHz);
    radio.setOutputPower(previousPowerDbm);
    radio.setRxBandwidth(static_cast<float>(previousBandwidthKHz));
    startReceiveAgain();

    Serial.print("$ERR,RADIO_CONFIG_APPLY,CODE=");
    Serial.println(state);
    return false;
  }

  activeRfFrequencyMHz = frequencyMHz;
  activeRfPowerDbm = static_cast<int8_t>(powerDbm);
  activeRfBandwidthKHz = static_cast<uint16_t>(bandwidthKHz);

  const int receiveState = startReceiveAgain();
  if (receiveState != RADIOLIB_ERR_NONE) {
    Serial.print("$ERR,RF_RX_RESTART,CODE=");
    Serial.println(receiveState);
    return false;
  }

  printRadioConfigResult(result);
  return true;
}

// Передаёт одну строку в эфир и возвращает CC1101 в режим приёма.
bool transmitRf(String payload) {
  payload.trim();
  if (payload.length() == 0) return false;

  // Удаляем возможный старый флаг RX: команда имеет приоритет, а после TX
  // приёмник будет запущен заново с очищенным FIFO.
  rfPacketReceived = false;

  const uint32_t startedAt = millis();
  int state = radio.standby();
  if (state == RADIOLIB_ERR_NONE) {
    state = radio.transmit(payload);
  }

  const int receiveState = startReceiveAgain();

  if (state == RADIOLIB_ERR_NONE) {
    if (receiveState != RADIOLIB_ERR_NONE) {
      Serial.print("$ERR,RF_RX_RESTART,CODE=");
      Serial.println(receiveState);
      return false;
    }

    Serial.print("$ACK,RF_TX,BYTES=");
    Serial.print(payload.length());
    Serial.print(",TX_MS=");
    Serial.print(millis() - startedAt);
    Serial.print(",DATA=");
    Serial.println(payload);
    return true;
  }

  Serial.print("$ERR,RF_TX,CODE=");
  Serial.println(state);
  return false;
}

// Обрабатывает служебные команды, поступающие от программы ЦУП по USB.
void handleUsbCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  if (line.equalsIgnoreCase("$CMD,GATEWAY_PING")) {
    Serial.print("$ACK,GATEWAY_PONG,V=");
    Serial.println(FW_VERSION);
    return;
  }

  if (line.equalsIgnoreCase("$CMD,GATEWAY_INFO")) {
    Serial.print("$INFO,GATEWAY=ALTAIR_V8,BOARD=ESP32-WROOM-32,FW=");
    Serial.print(FW_VERSION);
    Serial.print(",FREQ=");
    Serial.print(activeRfFrequencyMHz, 3);
    Serial.print(",RATE=4.8,DEV=5,BW=");
    Serial.print(activeRfBandwidthKHz);
    Serial.print(",POWER=");
    Serial.print(static_cast<int>(activeRfPowerDbm));
    Serial.println(",XOR=OFF,RF_TX=ON,RX_MODE=INTERRUPT");
    return;
  }

  if (line.equalsIgnoreCase("$CMD,RADIO_STATUS")) {
    printRadioStatus();
    return;
  }

  if (line.equalsIgnoreCase("$CMD,RADIO,RESET")) {
    applyRadioSettings(
      RF_FREQ_MHZ,
      RF_POWER_DBM,
      static_cast<int>(RF_BW_KHZ),
      "RADIO_CONFIG_RESET"
    );
    return;
  }

  // Формат: $CMD,RADIO,SET,FREQ=435.000,POWER=5,BW=203
  if (line.startsWith("$CMD,RADIO,SET,")) {
    String frequencyText;
    String powerText;
    String bandwidthText;

    if (
      !readCommandParameter(line, "FREQ", frequencyText) ||
      !readCommandParameter(line, "POWER", powerText) ||
      !readCommandParameter(line, "BW", bandwidthText)
    ) {
      Serial.println("$ERR,RADIO_CONFIG_FIELDS_REQUIRED,FIELDS=FREQ|POWER|BW");
      return;
    }

    float frequencyMHz = 0.0f;
    int powerDbm = 0;
    int bandwidthKHz = 0;
    if (
      !parseFloatStrict(frequencyText, frequencyMHz) ||
      !parseIntegerStrict(powerText, powerDbm) ||
      !parseIntegerStrict(bandwidthText, bandwidthKHz)
    ) {
      Serial.println("$ERR,RADIO_CONFIG_NUMBER_FORMAT");
      return;
    }

    applyRadioSettings(
      frequencyMHz,
      powerDbm,
      bandwidthKHz,
      "RADIO_CONFIG_APPLIED"
    );
    return;
  }

  if (line.startsWith("$CMD,RADIO,")) {
    Serial.println("$ERR,RADIO_CONFIG_UNKNOWN,SUPPORTED=SET|RESET|STATUS");
    return;
  }

  // Команда программы вида $CMD,RF,TO=02,NAME=PING
  // преобразуется в эфирную строку $CMD,TO=02,NAME=PING.
  if (line.startsWith("$CMD,RF,")) {
    transmitRf("$CMD," + line.substring(8));
    return;
  }

  // Служебный режим передачи произвольной строки для стендовой проверки.
  if (line.startsWith("$RF,")) {
    transmitRf(line.substring(4));
    return;
  }

  Serial.print("$ERR,UNKNOWN_USB_COMMAND,DATA=");
  Serial.println(line);
}

// Собирает одну строку USB до символа перевода строки.
void pollUsb() {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());
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

// Преобразует принятую телеметрию в формат, который понимает ЦУП Альтаир.
void emitTelemetry(String packet) {
  packet.trim();

  String fields[8];
  int count = 0;
  if (!splitCsv(packet, fields, 8, count) || (count != 7 && count != 8)) {
    Serial.print("$RAW,");
    Serial.println(packet);
    return;
  }

  // Семь полей: ID,PACKET,UPTIME,PANEL_POWER,VOLT,MODE,CHECKSUM.
  // Восьмое необязательное поле ANTENNA располагается перед CHECKSUM.
  const bool hasAntenna = (count == 8);
  const int checksumIndex = hasAntenna ? 7 : 6;

  const float rssi = radio.getRSSI();
  const uint8_t lqi = radio.getLQI();

  // CC1101 не измеряет SNR непосредственно. Используется оценка
  // относительно условного уровня шума -105 дБм.
  float snr = rssi + 105.0f;
  if (snr > 60.0f) snr = 60.0f;
  if (snr < -10.0f) snr = -10.0f;

  Serial.print("$TEL,ID="); Serial.print(fields[0]);
  Serial.print(",PACKET="); Serial.print(fields[1]);
  Serial.print(",UPTIME="); Serial.print(fields[2]);
  Serial.print(",PANEL_POWER="); Serial.print(fields[3]);
  Serial.print(",VOLT="); Serial.print(fields[4]);
  Serial.print(",MODE="); Serial.print(fields[5]);

  if (hasAntenna) {
    Serial.print(",ANTENNA=");
    Serial.print(fields[6]);
  }

  // Поле выводится для совместимости, но шлюз его не проверяет.
  Serial.print(",CHECKSUM="); Serial.print(fields[checksumIndex]);
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

  state = radio.setOOK(false);
  if (state == RADIOLIB_ERR_NONE) state = radio.setDataShaping(RADIOLIB_SHAPING_NONE);
  if (state == RADIOLIB_ERR_NONE) state = radio.setEncoding(RADIOLIB_ENCODING_NRZ);
  if (state == RADIOLIB_ERR_NONE) state = radio.setSyncWord(0x12, 0xAD, 0, false);
  if (state == RADIOLIB_ERR_NONE) state = radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);
  if (state == RADIOLIB_ERR_NONE) state = radio.setCrcFiltering(true);

  if (state != RADIOLIB_ERR_NONE) {
    Serial.print("$ERR,CC1101_PROFILE,CODE=");
    Serial.println(state);
    while (true) delay(1000);
  }

  // Приём запускается один раз и далее работает в фоне. GDO0 формирует
  // прерывание только после получения полного пакета. Благодаря этому
  // loop() постоянно опрашивает USB и команда передаётся без ожидания
  // тайм-аута блокирующего radio.receive().
  radio.setPacketReceivedAction(onRfPacketReceived);
  state = startReceiveAgain();

  if (state != RADIOLIB_ERR_NONE) {
    Serial.print("$ERR,CC1101_RX_START,CODE=");
    Serial.println(state);
    while (true) delay(1000);
  }

  Serial.print("$INFO,GATEWAY=ALTAIR_V8,BOARD=ESP32-WROOM-32,FW=");
  Serial.println(FW_VERSION);
  Serial.println("$INFO,RADIO_READY,TYPE=CC1101,FREQ=435.000,RATE=4.8,DEV=5,BW=203,POWER=5,SYNC=12AD,CRC=1,RX_MODE=INTERRUPT,RUNTIME_CONFIG=1");
  Serial.println("$INFO,APPLICATION_XOR_CHECK=DISABLED,RF_TX=ENABLED");
}

void loop() {
  pollUsb();

  if (rfPacketReceived) {
    // После срабатывания GDO0 пакет уже полностью находится в RX FIFO.
    rfPacketReceived = false;

    String packet;
    const int state = radio.readData(packet);

    if (state == RADIOLIB_ERR_NONE) {
      emitTelemetry(packet);
    } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
      Serial.println("$ERR,RADIO_RX_CRC");
    } else {
      Serial.print("$ERR,RADIO_RX,CODE=");
      Serial.println(state);
    }

    const int receiveState = startReceiveAgain();
    if (receiveState != RADIOLIB_ERR_NONE) {
      Serial.print("$ERR,RF_RX_RESTART,CODE=");
      Serial.println(receiveState);
    }
  }

  // Освобождаем время системным задачам ESP32, не блокируя обработку USB.
  delay(1);
}
