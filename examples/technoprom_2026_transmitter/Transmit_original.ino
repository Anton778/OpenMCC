#include <RadioLib.h>

#define CS PA2
#define GDO PA0
#define GDO2 PA1

CC1101 radio = new Module(CS, GDO, RADIOLIB_NC, GDO2);

void setup() {
  Serial.begin(57600);
  while (!Serial) { ; }

  Serial.print(F("[CC1101] Initializing ... "));

  // Выставляем точную частоту 433.52 МГц
  int state = radio.begin(434.00f);

  if (state == RADIOLIB_ERR_NONE) {
    Serial.println(F("success!"));

    // Поднимаем мощность до максимума (10 dBm)
    radio.setOutputPower(5);
  } else {
    Serial.print(F("failed, code "));
    Serial.println(state);
    while (true) { delay(10); }
  }
}

void loop() {
  // 1. Включаем несущую (фоним в эфир)
  Serial.println(F("Излучение Вкл (433.52 МГц)..."));
 // uint8_t data[] = { '3', '2', '1', '0', '4', '5', '6', '7'};
 String pack = "hth htbdr hsh tnhera h5trhga g5h53ed!";
  radio.transmit(pack);
//  delay(200);  // 2 секунды фоним

  // 2. Выключаем несущую (режим ожидания)
  Serial.println(F("Пауза (Молчим)..."));
  radio.standby();
  delay(200);  // 2 секунды молчим
}
