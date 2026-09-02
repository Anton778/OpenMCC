#include <Arduino.h>   // Подключает основные функции, регистры и типы данных Arduino.
#include <SPI.h>       // Подключает аппаратный интерфейс SPI выводов D11, D12 и D13.
#include <RadioLib.h>  // Подключает библиотеку управления радиомодулем CC1101.

/*
 * ЦУП Альтаир — спутниковый скетч, шаг 04.
 *
 * Отличие от шага 03:
 *   - поле MCU_TEMP теперь содержит измеренную температуру кристалла ATmega328P;
 *   - внешний датчик температуры не требуется.
 *
 * Уже реализовано:
 *   - PACKET увеличивается после каждой попытки передачи;
 *   - UPTIME содержит время работы в секундах;
 *   - CHECKSUM пересчитывается автоматически.
 *
 * Поля ID, PANEL_POWER, VOLT и MODE пока остаются постоянными.
 * Приёмник и обработка команд ЦУПа отсутствуют.
 *
 * Внутренний температурный канал измеряет температуру кристалла, а не воздуха.
 * Его абсолютная погрешность может быть значительной, поэтому предусмотрена
 * поправка TEMPERATURE_CALIBRATION_OFFSET_C для калибровки конкретной платы.
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
 * CC1101 нельзя питать от 5 В. Линии SCK, MOSI и CSN классического
 * Arduino Nano следует подключать через преобразователь уровней 5 В -> 3,3 В.
 */

#define CC_CS 10    // Задаёт вывод D10 для линии выбора микросхемы CSN.
#define CC_GDO0 2   // Задаёт вывод D2 для сигнальной линии GDO0.
#define CC_GDO2 3   // Задаёт вывод D3 для сигнальной линии GDO2.

static const unsigned long TRANSMISSION_PERIOD_MS = 1000UL;  // Задаёт период передачи, равный одной секунде.
static const uint32_t TIMER_MAX_VALUE = 99999UL;             // Ограничивает PACKET и UPTIME пятью цифрами.
static const uint8_t TEMPERATURE_SAMPLE_COUNT = 32;          // Задаёт число измерений АЦП для усреднения.
static const float ADC_REFERENCE_MV = 1100.0f;               // Задаёт номинальное внутреннее опорное напряжение АЦП.
static const float SENSOR_VOLTAGE_AT_25C_MV = 314.0f;        // Задаёт типовое напряжение температурного канала при 25 °C.
static const float SENSOR_SLOPE_MV_PER_C = 1.22f;            // Задаёт типовую чувствительность температурного канала.
static const float TEMPERATURE_CALIBRATION_OFFSET_C = 0.0f;  // Задаёт индивидуальную поправку после калибровки.

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);  // Создаёт объект радиомодуля.
uint32_t packetNumber = 1;                                         // Хранит номер текущего пакета, начиная с 00001.

uint8_t calculateXorChecksum(const char* text) {          // Вычисляет контрольную сумму текстовой части пакета.
  uint8_t checksum = 0;                                   // Устанавливает начальное значение суммы равным нулю.
  while (*text != '\0') {                                // Перебирает строку до завершающего нулевого символа.
    checksum ^= static_cast<uint8_t>(*text);               // Выполняет XOR очередного символа с накопленным значением.
    ++text;                                                // Переходит к следующему символу.
  }
  return checksum;                                         // Возвращает рассчитанную восьмибитную сумму.
}

uint32_t getUptimeSeconds() {                              // Возвращает время работы Arduino Nano в секундах.
  const uint32_t seconds = millis() / 1000UL;             // Переводит миллисекунды с момента запуска в секунды.
  return seconds % (TIMER_MAX_VALUE + 1UL);               // Оставляет пять младших десятичных разрядов.
}

uint16_t readInternalTemperatureAdc() {                              // Считывает внутренний температурный канал АЦП.
  const uint8_t previousAdmux = ADMUX;                               // Сохраняет прежний источник опоры и канал АЦП.
  const uint8_t previousAdcsra = ADCSRA;                             // Сохраняет прежнее состояние АЦП.
  ADCSRA |= _BV(ADEN);                                               // Включает аналого-цифровой преобразователь.
  ADMUX = _BV(REFS1) | _BV(REFS0) | _BV(MUX3);                      // Выбирает внутреннюю опору 1,1 В и канал датчика температуры.
  delay(2);                                                          // Ожидает стабилизации внутреннего источника опорного напряжения.

  ADCSRA |= _BV(ADSC);                                               // Запускает первое служебное преобразование.
  while (bit_is_set(ADCSRA, ADSC)) {                                 // Ожидает завершения служебного преобразования.
    // Дополнительные действия во время ожидания не требуются.
  }
  (void)ADC;                                                         // Считывает и отбрасывает первый нестабильный результат.

  uint32_t adcSum = 0;                                               // Создаёт накопитель результатов АЦП.
  for (uint8_t sample = 0; sample < TEMPERATURE_SAMPLE_COUNT; ++sample) {  // Выполняет серию измерений.
    ADCSRA |= _BV(ADSC);                                             // Запускает очередное преобразование.
    while (bit_is_set(ADCSRA, ADSC)) {                               // Ожидает завершения текущего измерения.
      // Дополнительные действия во время ожидания не требуются.
    }
    adcSum += ADC;                                                   // Добавляет результат к общей сумме.
  }

  ADMUX = previousAdmux;                                             // Восстанавливает прежние настройки входа АЦП.
  ADCSRA = previousAdcsra;                                           // Восстанавливает прежнее состояние АЦП.
  return static_cast<uint16_t>(adcSum / TEMPERATURE_SAMPLE_COUNT);   // Возвращает усреднённый код АЦП.
}

float readMcuTemperatureC() {                                       // Переводит код АЦП в градусы Цельсия.
  const uint16_t adcCode = readInternalTemperatureAdc();            // Получает усреднённый результат измерения.
  const float sensorVoltageMv =                                    // Вычисляет напряжение температурного канала.
    static_cast<float>(adcCode) * ADC_REFERENCE_MV / 1024.0f;       // Пересчитывает десятибитный код в милливольты.
  return 25.0f +                                                    // Использует 25 °C как опорную температуру.
    (sensorVoltageMv - SENSOR_VOLTAGE_AT_25C_MV) /                  // Находит изменение напряжения относительно опорной точки.
    SENSOR_SLOPE_MV_PER_C +                                         // Переводит изменение напряжения в градусы.
    TEMPERATURE_CALIBRATION_OFFSET_C;                               // Добавляет калибровочную поправку.
}

void buildTelemetryPacket(float temperatureC, char* packet, size_t packetSize) {  // Формирует пакет с актуальными значениями.
  const uint32_t uptimeSeconds = getUptimeSeconds();                // Получает фактическое время работы платы.
  char temperatureText[12];                                        // Создаёт буфер для записи температуры текстом.
  dtostrf(temperatureC, 0, 1, temperatureText);                     // Записывает температуру с одним знаком после точки.

  char packetBody[48];                                              // Создаёт буфер для строки без CHECKSUM.
  snprintf(                                                         // Записывает изменяемые и постоянные поля.
    packetBody,                                                     // Указывает выходной буфер.
    sizeof(packetBody),                                             // Ограничивает максимальную длину записи.
    "02,%05lu,%05lu,1.00,4.20,%s,1,",                              // Подставляет PACKET, UPTIME и измеренную MCU_TEMP.
    static_cast<unsigned long>(packetNumber),                       // Подставляет номер пакета пятью цифрами.
    static_cast<unsigned long>(uptimeSeconds),                      // Подставляет время работы пятью цифрами.
    temperatureText                                                 // Подставляет измеренную температуру кристалла.
  );

  const uint8_t checksum = calculateXorChecksum(packetBody);        // Пересчитывает зависимое поле CHECKSUM.
  snprintf(packet, packetSize, "%s%02X", packetBody, checksum);     // Добавляет две шестнадцатеричные цифры суммы.
}

void setup() {                                                                  // Выполняется один раз после включения Arduino Nano.
  Serial.begin(115200);                                                         // Открывает диагностический последовательный порт.
  delay(500);                                                                   // Ожидает стабилизации питания Arduino Nano и CC1101.

  int state = radio.begin(435.000, 4.8, 5.0, 203.0, 5, 16);                    // Настраивает рабочий радиопрофиль.
  if (state == RADIOLIB_ERR_NONE) state = radio.setOOK(false);                  // Выбирает частотную манипуляцию 2-FSK.
  if (state == RADIOLIB_ERR_NONE) state = radio.setDataShaping(RADIOLIB_SHAPING_NONE);  // Отключает сглаживание.
  if (state == RADIOLIB_ERR_NONE) state = radio.setEncoding(RADIOLIB_ENCODING_NRZ);     // Выбирает кодирование NRZ.
  if (state == RADIOLIB_ERR_NONE) state = radio.setSyncWord(0x12, 0xAD, 0, false);      // Устанавливает sync word 0x12AD.
  if (state == RADIOLIB_ERR_NONE) state = radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);  // Включает переменную длину пакета.
  if (state == RADIOLIB_ERR_NONE) state = radio.setCrcFiltering(true);           // Включает аппаратный CRC CC1101.

  if (state != RADIOLIB_ERR_NONE) {                                             // Проверяет результат настройки радиомодуля.
    Serial.print(F("Ошибка инициализации CC1101, код "));                       // Выводит пояснение ошибки.
    Serial.println(state);                                                      // Выводит код ошибки RadioLib.
    while (true) delay(1000);                                                   // Останавливает скетч до перезапуска.
  }

  Serial.println(F("Шаг 04: добавлено измерение температуры кристалла"));       // Сообщает об успешном запуске.
  Serial.println(F("Для точного значения требуется калибровка конкретной платы"));  // Предупреждает об абсолютной погрешности.
}

void loop() {                                                                   // Выполняет очередной цикл передачи.
  const float mcuTemperatureC = readMcuTemperatureC();                          // Измеряет температуру кристалла ATmega328P.
  char telemetryPacket[48];                                                     // Выделяет память для полного текстового пакета.
  buildTelemetryPacket(mcuTemperatureC, telemetryPacket, sizeof(telemetryPacket));  // Формирует строку с актуальными значениями.

  const int state = radio.transmit(telemetryPacket);                            // Передаёт сформированный пакет через CC1101.
  radio.standby();                                                              // Переводит радиомодуль в ожидание без включения приёмника.

  if (state == RADIOLIB_ERR_NONE) {                                             // Проверяет успешность передачи.
    Serial.print(F("Передано: "));                                              // Выводит диагностическую подпись.
    Serial.println(telemetryPacket);                                            // Показывает фактически переданную строку.
  } else {                                                                      // Выполняется при ошибке передачи.
    Serial.print(F("Ошибка передачи CC1101, код "));                            // Выводит сообщение об ошибке.
    Serial.println(state);                                                      // Выводит код ошибки RadioLib.
  }

  packetNumber = packetNumber >= TIMER_MAX_VALUE ? 1 : packetNumber + 1;        // Увеличивает PACKET и после 99999 возвращается к 00001.
  delay(TRANSMISSION_PERIOD_MS);                                                 // Ожидает одну секунду перед следующим пакетом.
}
