# Прошивки ЦУП Альтаир

Каталог содержит актуальные скетчи радиоканала v8. Все варианты используют одинаковый профиль CC1101 и совместимый последовательный протокол ЦУП Альтаир.

## Наземный ЦУП

| Плата | Скетч |
|---|---|
| ESP32-WROOM-32 | [`Altair_Ground_ESP32.ino`](ground_station/esp32/Altair_Ground_ESP32/Altair_Ground_ESP32.ino) |
| Arduino Uno | [`Altair_Ground_Arduino_Uno.ino`](ground_station/arduino_uno/Altair_Ground_Arduino_Uno/Altair_Ground_Arduino_Uno.ino) |
| Arduino Nano | [`Altair_Ground_Arduino_Nano.ino`](ground_station/arduino_nano/Altair_Ground_Arduino_Nano/Altair_Ground_Arduino_Nano.ino) |

Наземный скетч принимает телеметрию, передаёт её программе по USB со скоростью 115200 бод и отправляет команды спутнику через тот же CC1101.

## Спутник

| Плата | Скетч |
|---|---|
| STM32F103C8T6 / Blue Pill / IntroSat | [`Altair_Satellite_STM32.ino`](satellite/stm32/Altair_Satellite_STM32/Altair_Satellite_STM32.ino) |
| Arduino Nano | [`Altair_Satellite_Arduino_Nano.ino`](satellite/arduino_nano/Altair_Satellite_Arduino_Nano/Altair_Satellite_Arduino_Nano.ino) |
| Arduino Nano, только передатчик | [`Altair_Satellite_Arduino_Nano_Static_TX.ino`](satellite/arduino_nano_static_tx/Altair_Satellite_Arduino_Nano_Static_TX/Altair_Satellite_Arduino_Nano_Static_TX.ino) |

Бортовые скетчи передают телеметрию, принимают адресованные команды и поддерживают `PING`, `INFO`, `TM_START`, `TM_STOP`, `TM_PERIOD` и `USER`.

Упрощённый вариант `Static_TX` не включает приёмник и обработку команд. Он передаёт один статичный пакет `02,00001,00015,3.00,4.20,1,33` раз в секунду и предназначен для первичной проверки радиолинии.

## Общий радиопрофиль

| Параметр | Значение |
|---|---:|
| Частота | 435,000 МГц |
| Модуляция | 2-FSK |
| Скорость | 4,8 кбит/с |
| Девиация | 5 кГц |
| Полоса приёмника | 203 кГц |
| Слово синхронизации | `0x12AD` |
| Кодирование | NRZ |
| Длина пакета | переменная |
| Аппаратный CRC CC1101 | включён |
| Мощность тестового передатчика | 5 дБм |

## Необходимая библиотека

Для сборки в Arduino IDE установите библиотеку **RadioLib 7.7.1** через менеджер библиотек. В каждом каталоге также находится `platformio.ini` для автоматической проверочной сборки.

## Питание и логические уровни

CC1101 питается только от **3,3 В**.

ESP32 и STM32 работают с логикой 3,3 В и подключаются непосредственно. Классические Arduino Uno и Nano на ATmega328P используют уровни 5 В, поэтому линии от микроконтроллера к CC1101 (`SCK`, `MOSI`, `CSN`) должны проходить через преобразователь логических уровней.

## Поворотное устройство

Прошивка двухосевого поворотного устройства сохранена отдельно в каталоге [`rotator_arduino_uno`](rotator_arduino_uno). Она не относится к радиошлюзу и использует Arduino Uno как самостоятельный контроллер механики антенны.
