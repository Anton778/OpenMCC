#include <Arduino.h>   // Подключает основные функции и типы данных Arduino.
#include <SPI.h>       // Подключает аппаратный интерфейс SPI выводов D11, D12 и D13.
#include <RadioLib.h>  // Подключает библиотеку управления радиомодулем CC1101.

/*
 * ЦУП Альтаир — спутниковый скетч, шаг 02.
 *
 * Отличие от шага 01:
 *   - изменяется только поле PACKET;
 *   - номер пакета увеличивается после каждой попытки передачи;
 *   - CHECKSUM пересчитывается автоматически, поскольку зависит от текста пакета.
 *
 * Остальные поля остаются постоянными:
 * ID, UPTIME, PANEL_POWER, VOLT, MCU_TEMP и MODE.
 *
 * Приёмник и обработка команд ЦУПа отсутствуют.
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
static const uint32_t MAX_PACKET_NUMBER = 99999UL;           // Ограничивает номер пятью десятичными цифрами.

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

void buildTelemetryPacket(char* packet, size_t packetSize) {       // Формирует пакет с текущим значением PACKET.
  char packetBody[48];                                              // Создаёт буфер для строки без CHECKSUM.
  snprintf(                                                         // Записывает статичные поля и изменяемый номер пакета.
    packetBody,                                                     // Указывает выходной буфер.
    sizeof(packetBody),                                             // Ограничивает максимальную длину записи.
    "02,%05lu,00015,1.00,4.20,31.6,1,",                            // Оставляет изменяемым только поле PACKET.
    static_cast<unsigned long>(packetNumber)                        // Подставляет номер как пять цифр с ведущими нулями.
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

  Serial.println(F("Шаг 02: передатчик со счётчиком пакетов готов"));           // Сообщает об успешном запуске.
}

void loop() {                                                                   // Выполняет очередной цикл передачи.
  char telemetryPacket[48];                                                     // Выделяет память для полного текстового пакета.
  buildTelemetryPacket(telemetryPacket, sizeof(telemetryPacket));               // Формирует строку с текущим номером PACKET.

  const int state = radio.transmit(telemetryPacket);                            // Передаёт сформированный пакет через CC1101.
  radio.standby();                                                              // Переводит радиомодуль в ожидание без включения приёмника.

  if (state == RADIOLIB_ERR_NONE) {                                             // Проверяет успешность передачи.
    Serial.print(F("Передано: "));                                              // Выводит диагностическую подпись.
    Serial.println(telemetryPacket);                                            // Показывает фактически переданную строку.
  } else {                                                                      // Выполняется при ошибке передачи.
    Serial.print(F("Ошибка передачи CC1101, код "));                            // Выводит сообщение об ошибке.
    Serial.println(state);                                                      // Выводит код ошибки RadioLib.
  }

  packetNumber = packetNumber >= MAX_PACKET_NUMBER ? 1 : packetNumber + 1;      // Увеличивает PACKET и после 99999 возвращается к 00001.
  delay(TRANSMISSION_PERIOD_MS);                                                 // Ожидает одну секунду перед следующим пакетом.
}
