#include <RadioLib.h>

/*
 * ЦУП Альтаир v7 — статический передатчик STM32 + CC1101
 * Технопром 2026 · Миссия на Луну
 *
 * Подключение из рабочего варианта IntroSat:
 *   CS   -> PA2
 *   GDO0 -> PA0
 *   GDO2 -> PA1
 *   SPI  -> штатные SPI-выводы выбранной STM32-платы
 *
 * Пакет — ровно 29 ASCII-символов:
 *   02,00001,00015,3.00,4.20,1,33
 */

#define CC_CS   PA2
#define CC_GDO0 PA0
#define CC_GDO2 PA1

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);

static const char TELEMETRY_PACKET[] = "02,00001,00015,3.00,4.20,1,33";
static const uint32_t TX_PERIOD_MS = 1000;

uint8_t xorAscii(const char* data, size_t length) {
  uint8_t value = 0;
  for (size_t i = 0; i < length; ++i) value ^= static_cast<uint8_t>(data[i]);
  return value;
}

void setup() {
  Serial.begin(57600);
  delay(300);

  Serial.println(F("[Altair v7] STM32 + CC1101 static telemetry transmitter"));
  Serial.print(F("Packet: "));
  Serial.println(TELEMETRY_PACKET);
  Serial.print(F("Packet length: "));
  Serial.println(strlen(TELEMETRY_PACKET));

  const uint8_t check = xorAscii(TELEMETRY_PACKET, 27);
  Serial.print(F("Calculated XOR: 0x"));
  if (check < 0x10) Serial.print('0');
  Serial.println(check, HEX);

  if (strlen(TELEMETRY_PACKET) != 29 || check != 0x33) {
    Serial.println(F("ERROR: static telemetry packet is inconsistent"));
    while (true) delay(1000);
  }

  int state = radio.begin(435.000f, 4.8f, 5.0f, 203.0f, 5, 16);
  if (state != RADIOLIB_ERR_NONE) {
    Serial.print(F("CC1101 init failed, code "));
    Serial.println(state);
    while (true) delay(1000);
  }

  state = radio.setOOK(false);
  if (state == RADIOLIB_ERR_NONE) state = radio.setDataShaping(RADIOLIB_SHAPING_NONE);
  if (state == RADIOLIB_ERR_NONE) state = radio.setEncoding(RADIOLIB_ENCODING_NRZ);
  if (state == RADIOLIB_ERR_NONE) state = radio.setSyncWord(0x12, 0xAD, 0, false);
  if (state == RADIOLIB_ERR_NONE) state = radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);
  if (state == RADIOLIB_ERR_NONE) state = radio.setCrcFiltering(true);
  if (state == RADIOLIB_ERR_NONE) state = radio.setOutputPower(5);

  if (state != RADIOLIB_ERR_NONE) {
    Serial.print(F("CC1101 profile failed, code "));
    Serial.println(state);
    while (true) delay(1000);
  }

  Serial.println(F("CC1101 profile v7 ready: 435 MHz / 4.8 kbps / 2-FSK / BW 203 kHz"));
}

void loop() {
  Serial.print(F("TX: "));
  Serial.println(TELEMETRY_PACKET);

  const int state = radio.transmit(TELEMETRY_PACKET);
  if (state == RADIOLIB_ERR_NONE) Serial.println(F("TX OK"));
  else {
    Serial.print(F("TX ERROR: "));
    Serial.println(state);
  }

  radio.standby();
  delay(TX_PERIOD_MS);
}
