#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>

/*
 * ЦУП Альтаир v8 — простой передатчик Arduino Nano + CC1101.
 *
 * Скетч выполняет только одну задачу: передаёт заранее заданный
 * статичный пакет телеметрии один раз в секунду.
 * Приём команд и переключение CC1101 в режим приёма отсутствуют.
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
 * ВАЖНО: классический Arduino Nano работает с уровнями 5 В.
 * Линии SCK, MOSI и CSN необходимо подключать через преобразователь
 * уровней 5 В ↔ 3,3 В. Питать CC1101 от 5 В нельзя.
 */

#define CC_CS    10
#define CC_GDO0  2
#define CC_GDO2  3

// Пакет можно изменить непосредственно в этой строке.
// Формат: ID,PACKET,UPTIME,PANEL_POWER,VOLT,MODE,CHECKSUM.
static const char TELEMETRY_PACKET[] = "02,00001,00015,3.00,4.20,1,33";

static const uint32_t TRANSMISSION_PERIOD_MS = 1000UL;

static const float RF_FREQ_MHZ = 435.000f;
static const float RF_BITRATE_KBPS = 4.8f;
static const float RF_DEVIATION_KHZ = 5.0f;
static const float RF_BW_KHZ = 203.0f;
static const int8_t RF_POWER_DBM = 5;
static const uint16_t RF_PREAMBLE_BITS = 16;

CC1101 radio = new Module(CC_CS, CC_GDO0, RADIOLIB_NC, CC_GDO2);

// Настраивает CC1101 в соответствии с единым радиопрофилем проекта.
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
  if (state == RADIOLIB_ERR_NONE) {
    state = radio.variablePacketLengthMode(RADIOLIB_CC1101_MAX_PACKET_LENGTH);
  }
  if (state == RADIOLIB_ERR_NONE) state = radio.setCrcFiltering(true);

  return state;
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

  Serial.println(F("Простой передатчик Arduino Nano + CC1101 готов"));
  Serial.println(F("Профиль: 435,000 МГц / 4,8 кбит/с / 2-FSK / BW 203 кГц"));
}

void loop() {
  Serial.print(F("Телеметрия TX: "));
  Serial.println(TELEMETRY_PACKET);

  const int state = radio.transmit(TELEMETRY_PACKET);
  radio.standby();

  if (state == RADIOLIB_ERR_NONE) {
    Serial.println(F("Пакет успешно передан"));
  } else {
    Serial.print(F("Ошибка передачи CC1101, код "));
    Serial.println(state);
  }

  delay(TRANSMISSION_PERIOD_MS);
}
