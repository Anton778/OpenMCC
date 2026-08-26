#include <RadioLib.h>

/*
 * Технопром 2026 — Миссия на Луну
 * Пример передатчика, совместимый с ЦУП Альтаир v5.
 *
 * Основан на загруженном Transmit.ino:
 *   CS   = PA2
 *   GDO0 = PA0
 *   GDO2 = PA1
 *   CC1101 + RadioLib
 *
 * ВАЖНО:
 * Функции readBatteryVoltage(), readPanelPower(), readTemperature() и
 * readAntennaDeployed() пока содержат демонстрационные значения. Их нужно
 * заменить чтением фактических датчиков/состояния конкретного спутника.
 */

#define CS   PA2
#define GDO  PA0
#define GDO2 PA1

CC1101 radio = new Module(CS, GDO, RADIOLIB_NC, GDO2);

static const char SATELLITE_ID[] = "04";
static uint32_t packetCounter = 0;

float readBatteryVoltage() {
  // TODO: заменить реальным измерением напряжения аккумулятора.
  return 4.12f;
}

float readPanelPower() {
  // TODO: заменить расчётом мощности солнечных панелей, Вт.
  return 1.85f;
}

float readTemperature() {
  // TODO: заменить реальным датчиком температуры, °C.
  return 24.4f;
}

uint8_t readAntennaDeployed() {
  // 1 — рулеточная антенна раскрыта; 0 — антенна сложена.
  // TODO: заменить фактическим состоянием концевика/логики раскрытия.
  return 1;
}

String makeTelemetryPacket() {
  const uint32_t uptimeSeconds = millis() / 1000UL;
  const float batteryVoltage = readBatteryVoltage();
  const float panelPower = readPanelPower();
  const float temperature = readTemperature();
  const uint8_t antennaDeployed = readAntennaDeployed();

  /*
   * Рекомендуемый формат ЦУП Альтаир v5 — KEY=VALUE.
   * Он удобен тем, что новые поля можно добавлять без изменения порядка
   * существующих параметров, а ESP32-шлюз передаёт их в ЦУП без потерь.
   *
   * ANTENNA=1 — антенна раскрыта.
   * ANTENNA=0 — антенна сложена.
   */
  String packet = "$TM,ID=";
  packet += SATELLITE_ID;
  packet += ",PACKET=";
  packet += String(packetCounter);
  packet += ",UPTIME=";
  packet += String(uptimeSeconds);
  packet += ",VOLT=";
  packet += String(batteryVoltage, 2);
  packet += ",PANEL_POWER=";
  packet += String(panelPower, 3);
  packet += ",TEMP=";
  packet += String(temperature, 1);
  packet += ",ANTENNA=";
  packet += String(antennaDeployed);

  return packet;
}

void setup() {
  Serial.begin(57600);
  while (!Serial) { ; }

  Serial.print(F("[CC1101] Initializing ... "));

  // Совпадает с профилем «Технопром 2026» в ЦУП Альтаир.
  // RadioLib begin(434.00f) использует стандартные параметры:
  // 4.8 kbps, deviation 5 kHz, RX BW 58 kHz, 2-FSK profile.
  int state = radio.begin(434.00f);

  if (state == RADIOLIB_ERR_NONE) {
    Serial.println(F("success!"));
    radio.setOutputPower(5);  // 5 dBm
  } else {
    Serial.print(F("failed, code "));
    Serial.println(state);
    while (true) { delay(10); }
  }
}

void loop() {
  const String packet = makeTelemetryPacket();

  Serial.print(F("TX: "));
  Serial.println(packet);

  const int state = radio.transmit(packet);
  if (state == RADIOLIB_ERR_NONE) {
    packetCounter++;
  } else {
    Serial.print(F("TX error: "));
    Serial.println(state);
  }

  radio.standby();
  delay(1000);
}
