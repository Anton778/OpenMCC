# Прошивки ЦУП Альтаир

Каталог содержит актуальные скетчи радиоканала v8. Все варианты используют одинаковый профиль CC1101 и совместимый последовательный протокол ЦУП Альтаир.

## Наземный ЦУП

| Плата | Скетч |
|---|---|
| ESP32-WROOM-32 | [`Altair_Ground_ESP32.ino`](ground_station/esp32/Altair_Ground_ESP32/Altair_Ground_ESP32.ino) |
| Arduino Uno | [`Altair_Ground_Arduino_Uno.ino`](ground_station/arduino_uno/Altair_Ground_Arduino_Uno/Altair_Ground_Arduino_Uno.ino) |
| Arduino Nano | [`Altair_Ground_Arduino_Nano.ino`](ground_station/arduino_nano/Altair_Ground_Arduino_Nano/Altair_Ground_Arduino_Nano.ino) |

Наземный скетч принимает телеметрию, передаёт её программе по USB со скоростью 115200 бод и отправляет команды спутнику через тот же CC1101.

В прошивке ESP32 версии **8.3.1** приём CC1101 работает неблокирующим способом по прерыванию `GDO0`. Поэтому USB-команды обрабатываются постоянно и передача начинается сразу после нажатия кнопки в ЦУПе, без ожидания тайм-аута приёмника. В строку подтверждения `$ACK,RF_TX` добавлено поле `TX_MS` с фактической длительностью радиопередачи.

Частоту, мощность TX и полосу приёмника ЦУПа можно изменять из панели команд. Команда `$CMD,RADIO,RESET` возвращает исходные значения `435.000 МГц`, `5 дБм` и `203 кГц`. Настройки хранятся до перезапуска ESP32; после включения питания используется исходный профиль.

## Спутник: скетчи по возрастанию сложности

### Учебная последовательность

| Шаг | Единственное новое поведение | Скетч |
|---:|---|---|
| 01 | Весь пакет неизменяемый | [`Altair_Satellite_01_Static_Telemetry_TX.ino`](satellite/01_static_telemetry_tx/Altair_Satellite_01_Static_Telemetry_TX/Altair_Satellite_01_Static_Telemetry_TX.ino) |
| 02 | Увеличивается только поле `PACKET` | [`Altair_Satellite_02_Packet_Counter_TX.ino`](satellite/02_packet_counter_tx/Altair_Satellite_02_Packet_Counter_TX/Altair_Satellite_02_Packet_Counter_TX.ino) |
| 03 | Поле `UPTIME` показывает секунды после запуска | [`Altair_Satellite_03_Uptime_TX.ino`](satellite/03_uptime_tx/Altair_Satellite_03_Uptime_TX/Altair_Satellite_03_Uptime_TX.ino) |
| 04 | Поле `MCU_TEMP` измеряется внутренним каналом ATmega328P | [`Altair_Satellite_04_MCU_Temperature_TX.ino`](satellite/04_mcu_temperature_tx/Altair_Satellite_04_MCU_Temperature_TX/Altair_Satellite_04_MCU_Temperature_TX.ino) |

В шаге 01 одна и та же строка `02,00001,00015,1.00,4.20,31.6,1,07` передаётся сразу после запуска и затем раз в секунду.

В шаге 02 номер пакета последовательно изменяется от `00001` до `99999`. Остальные телеметрические параметры остаются постоянными.

В шаге 03 дополнительно изменяется `UPTIME`: поле содержит число секунд с момента включения Arduino Nano.

В шаге 04 поле `MCU_TEMP` заполняется по внутреннему температурному каналу ATmega328P. Это температура кристалла, а не воздуха; для приемлемой абсолютной точности требуется калибровочная поправка. Поле `CHECKSUM` пересчитывается автоматически. Приёмник и обработка команд во всех четырёх шагах отсутствуют.

Следующие учебные варианты будут добавляться как шаги 05, 06 и далее без изменения предыдущих примеров.

### Другие существующие бортовые скетчи

| Плата | Скетч |
|---|---|
| Arduino Nano, передатчик с измерением температуры | [`Altair_Satellite_Arduino_Nano_Static_TX.ino`](satellite/arduino_nano_static_tx/Altair_Satellite_Arduino_Nano_Static_TX/Altair_Satellite_Arduino_Nano_Static_TX.ino) |
| Arduino Nano, двусторонняя связь | [`Altair_Satellite_Arduino_Nano.ino`](satellite/arduino_nano/Altair_Satellite_Arduino_Nano/Altair_Satellite_Arduino_Nano.ino) |
| STM32F103C8T6 / Blue Pill / IntroSat, двусторонняя связь | [`Altair_Satellite_STM32.ino`](satellite/stm32/Altair_Satellite_STM32/Altair_Satellite_STM32.ino) |

Двусторонние скетчи передают телеметрию, принимают адресованные команды и поддерживают `PING`, `INFO`, `TM_START`, `TM_STOP`, `TM_PERIOD` и `USER`.

Вариант `Altair_Satellite_Arduino_Nano_Static_TX.ino` не включает приёмник, но измеряет температуру внутренним каналом ATmega328P и пересчитывает XOR-контрольную сумму для каждого пакета.

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
