#include <Arduino.h>   // Подключает основные функции и типы данных Arduino.
#include <SPI.h>       // Подключает аппаратный интерфейс SPI выводов D11, D12 и D13.
#include <RadioLib.h>  // Подключает библиотеку управления радиомодулем CC1101.

/*
 * ЦУП Альтаир — спутниковый скетч, шаг 01.
 *
 * Назначение:
 *   - передавать одну заранее заданную строку телеметрии;
 *   - повторять передачу один раз в секунду;
 *   - не включать приёмник и не обрабатывать команды ЦУПа.
 *
 * Порядок полей:
 * ID,PACKET,UPTIME,PANEL_POWER,VOLT,MCU_TEMP,MODE,CHECKSUM
 *
 * Все значения статичны. Номер пакета, время работы и температура
 * не изменяются — в эфир всегда передаётся одна и та же строка.
 *
 * Подключение CC1101 к классическому Arduino Nano:
 *   CSN  -> D10
 *   MOSI -> D11
 *   MISO -> D12
 *   SCK  -> D13
 *   GDO0 -> D2
 *   GDO2 -> D3
 *   VCC  -> 3,3 В
 *   GND  -> GND
 *
 * ВАЖНО:
 *   - питать CC1101 напряжением 5 В нельзя;
 *   - линии SCK, MOSI и CSN следует подключать через преобразователь
 *     логических уровней 5 В -> 3,3 В.
 */

#define CC_CS 10    // Задаёт вывод D10 для линии выбора микросхемы CSN.
#define CC_GDO0 2   // Задаёт вывод D2 для сигнальной линии GDO0.
#define CC_GDO2 3   // Задаёт вывод D3 для сигнальной линии GDO2.

static const char TELEMETRY_PACKET[] = "02,00001,00015,1.00,4.20,31.6,1,07";  // Хранит неизменяемый пакет телеметрии.
static const unsigned long TRANSMISSION_PERIOD_MS = 1000UL;                    // Задаёт период передачи, равный одной секунде.

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);  // Создаёт объект радиомодуля с указанными выводами.

void setup() {                                                                  // Выполняется один раз после включения Arduino Nano.
  Serial.begin(115200);                                                         // Открывает диагностический последовательный порт.
  delay(500);                                                                   // Ожидает стабилизации питания Arduino Nano и CC1101.

  int state = radio.begin(435.000, 4.8, 5.0, 203.0, 5, 16);                    // Настраивает частоту, скорость, девиацию, полосу, мощность и преамбулу.
  if (state == RADIOLIB_ERR_NONE) state = radio.setOOK(false);                  // Выбирает частотную манипуляцию 2-FSK.
  if (state == RADIOLIB_ERR_NONE) state = radio.setDataShaping(RADIOLIB_SHAPING_NONE);  // Отключает дополнительное сглаживание.
  if (state == RADIOLIB_ERR_NONE) state = radio.setEncoding(RADIOLIB_ENCODING_NRZ);     // Выбирает кодирование NRZ.
  if (state == RADIOLIB_ERR_NONE) state = radio.setSyncWord(0x12, 0xAD, 0, false);      // Устанавливает слово синхронизации 0x12AD.
  if (state == RADIOLIB_ERR_NONE) state = radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);  // Включает переменную длину пакета.
  if (state == RADIOLIB_ERR_NONE) state = radio.setCrcFiltering(true);           // Включает аппаратный CRC радиопакета CC1101.

  if (state != RADIOLIB_ERR_NONE) {                                             // Проверяет результат полной настройки радиомодуля.
    Serial.print(F("Ошибка инициализации CC1101, код "));                       // Выводит пояснение ошибки.
    Serial.println(state);                                                      // Выводит числовой код ошибки RadioLib.
    while (true) delay(1000);                                                   // Останавливает скетч до перезапуска питания.
  }

  Serial.println(F("Шаг 01: статичный передатчик готов"));                      // Сообщает об успешном запуске.
  Serial.print(F("Постоянный пакет: "));                                        // Выводит подпись диагностической строки.
  Serial.println(TELEMETRY_PACKET);                                             // Показывает пакет, который будет передаваться.
}

void loop() {                                                                   // Бесконечно повторяет передачу одного пакета.
  const int state = radio.transmit(TELEMETRY_PACKET);                            // Передаёт неизменяемую строку через CC1101.
  radio.standby();                                                              // Возвращает CC1101 в режим ожидания без включения приёмника.

  if (state == RADIOLIB_ERR_NONE) {                                             // Проверяет, завершилась ли передача без ошибки.
    Serial.print(F("Передано: "));                                              // Выводит подпись перед отправленной строкой.
    Serial.println(TELEMETRY_PACKET);                                           // Повторяет в мониторе порта переданный пакет.
  } else {                                                                      // Выполняется при ошибке передачи.
    Serial.print(F("Ошибка передачи CC1101, код "));                            // Выводит диагностическое сообщение.
    Serial.println(state);                                                      // Выводит код ошибки RadioLib.
  }

  delay(TRANSMISSION_PERIOD_MS);                                                 // Ожидает одну секунду перед следующей передачей.
}
