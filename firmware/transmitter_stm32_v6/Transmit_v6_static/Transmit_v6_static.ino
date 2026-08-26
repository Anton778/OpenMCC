#include <RadioLib.h>

/*
 * ЦУП Альтаир v6 — статический передатчик телеметрии
 * Технопром 2026 · Миссия на Луну
 *
 * Плата: STM32 с Arduino Core (тот же вариант подключения, что использовался
 * в ранее работавшем Transmit_original.ino).
 * Радиомодуль: CC1101.
 *
 * Подключение, сохранённое из рабочего скетча:
 *   CS   -> PA2
 *   GDO0 -> PA0
 *   GDO2 -> PA1
 *   SPI  -> штатные SPI-выводы выбранной STM32-платы
 *
 * Радиопрофиль:
 *   435.000 МГц
 *   4.8 kbps
 *   2-FSK
 *   deviation 5 кГц
 *   RX bandwidth 58 кГц
 *   TX power 5 dBm
 *   preamble 16 bits
 *
 * Основной пакет v6 — РОВНО 29 ASCII-символов:
 *   02,00001,00015,3.00,4.20,1,33
 *
 * XOR = 0x33 рассчитан по строке:
 *   02,00001,00015,3.00,4.20,1,
 * То есть последняя запятая входит в XOR, а два символа HEX — нет.
 */

#define CC_CS   PA2
#define CC_GDO0 PA0
#define CC_GDO2 PA1

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);

static const char TELEMETRY_PACKET[] = "02,00001,00015,3.00,4.20,1,33";
static const uint32_t TX_PERIOD_MS = 1000;

uint8_t xorAscii(const char* data, size_t length) {
  uint8_t value = 0;
  for (size_t i = 0; i < length; ++i) {
    value ^= static_cast<uint8_t>(data[i]);
  }
  return value;
}

void setup() {
  Serial.begin(57600);
  delay(300);

  Serial.println(F("[Altair v6] STM32 + CC1101 static telemetry transmitter"));
  Serial.print(F("Packet: "));
  Serial.println(TELEMETRY_PACKET);
  Serial.print(F("Packet length: "));
  Serial.println(strlen(TELEMETRY_PACKET));

  // Контроль примера: первые 27 символов включают последнюю запятую,
  // последние два символа "33" являются передаваемой HEX-суммой.
  const uint8_t check = xorAscii(TELEMETRY_PACKET, 27);
  Serial.print(F("Calculated XOR: 0x"));
  if (check < 0x10) Serial.print('0');
  Serial.println(check, HEX);

  if (strlen(TELEMETRY_PACKET) != 29 || check != 0x33) {
    Serial.println(F("ERROR: static telemetry packet is inconsistent"));
    while (true) delay(1000);
  }

  Serial.print(F("[CC1101] Initializing 435.000 MHz ... "));

  // freq MHz, bit rate kbps, deviation kHz, RX BW kHz, power dBm, preamble bits
  int state = radio.begin(435.000f, 4.8f, 5.0f, 58.0f, 5, 16);

  if (state != RADIOLIB_ERR_NONE) {
    Serial.print(F("failed, code "));
    Serial.println(state);
    while (true) delay(1000);
  }

  // Явно фиксируем мощность, чтобы настройка была видна в коде.
  state = radio.setOutputPower(5);
  if (state != RADIOLIB_ERR_NONE) {
    Serial.print(F("setOutputPower failed, code "));
    Serial.println(state);
    while (true) delay(1000);
  }

  Serial.println(F("success"));
}

void loop() {
  Serial.print(F("TX: "));
  Serial.println(TELEMETRY_PACKET);

  const int state = radio.transmit(TELEMETRY_PACKET);

  if (state == RADIOLIB_ERR_NONE) {
    Serial.println(F("TX OK"));
  } else {
    Serial.print(F("TX ERROR: "));
    Serial.println(state);
  }

  radio.standby();
  delay(TX_PERIOD_MS);
}
