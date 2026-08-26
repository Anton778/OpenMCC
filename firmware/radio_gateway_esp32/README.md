# ЦУП Альтаир Radio Gateway — ESP32-WROOM-32

Версия прошивки: **0.2.0**  
Целевая плата: `ESP32-WROOM-32 / esp32dev`  
Сценарий: **Технопром 2026 — Миссия на Луну**

## Назначение

ESP32 соединяет desktop-приложение ЦУП Альтаир с радиомодулем:

```text
ЦУП Альтаир
     │ USB, 115200 бод
     ▼
ESP32-WROOM-32
     │
     ├── SPI  → CC1101
     │      или
     └── UART → E32-433T30D
                  │
                  ▼
                 МКА
```

CC1101 и E32 являются альтернативными вариантами. GPIO27 используется как GDO2 для CC1101 либо AUX для E32.

## CC1101 — подключение

| CC1101 | ESP32-WROOM-32 | Назначение |
|---|---|---|
| VCC | 3V3 | питание 3,3 В |
| GND | GND | общая земля |
| SCK | GPIO18 | SPI clock |
| SO/MISO | GPIO19 | CC1101 → ESP32 |
| SI/MOSI | GPIO23 | ESP32 → CC1101 |
| CSn | GPIO21 | Chip Select |
| GDO0 | GPIO4 | событие RX/TX |
| GDO2 | GPIO27 | дополнительный GDO |

## Профиль Технопром 2026

Загруженный передатчик фактически выполняет:

```cpp
radio.begin(434.00f);
radio.setOutputPower(5);
```

Поэтому стартовая конфигурация gateway v0.2.0:

```text
Frequency:     434.000 MHz
Bit rate:      4.8 kbps
Modulation:    2-FSK
Deviation:     5 kHz
RX bandwidth:  58 kHz
TX power:      5 dBm
CRC:           enabled
CCA:           enabled
```

Параметры можно менять из RF-панели ЦУП Альтаир командой:

```text
$CMD,RADIO,TYPE=CC1101,FREQ=434.000,POWER=5,RATE=4.8,MOD=2FSK,BW=58,CRC=1,CCA=1
```

## Телеметрия v5

Рекомендуемый бортовой пакет:

```text
$TM,<ID>,<PACKET>,<UPTIME>,<VOLT>,<PANEL_POWER>,<TEMP>
```

Например:

```text
$TM,04,427,1864,4.12,1.850,24.4
```

После приёма CC1101 шлюз преобразует его в:

```text
$TEL,ID=04,PACKET=427,UPTIME=1864,VOLT=4.12,PANEL_POWER=1.850,TEMP=24.4,RSSI=-76.5,SNR=18.2,LQI=103
```

Также шлюз принимает `$TEL,KEY=VALUE,...` и legacy IntroSat `$TM`.

Если в эфире пришла произвольная текстовая строка, как в исходном `Transmit.ino`, она не выдаётся за телеметрию. Вместо этого формируется диагностическое сообщение:

```text
$INFO,RF_RAW,TYPE=CC1101,RSSI=...,SNR=...,LQI=...,TEXT=...
```

Это позволяет проверить сам радиоканал ещё до готовности датчиков аппарата.

## RSSI, LQI и SNR

`RSSI` и `LQI` считываются из CC1101 через RadioLib.

CC1101 не имеет отдельного готового значения SNR пакета. Поэтому `SNR` в gateway v0.2.0 является диагностической оценкой:

```text
SNR_est = RSSI_packet - RSSI_noise_floor
```

Шумовой фон оценивается по RSSI свободного канала и сглаживается. Это полезно для стенда и наведения антенны, но требует аппаратной калибровки для точных измерений.

## E32-433T30D

| E32 | ESP32-WROOM-32 |
|---|---|
| TXD | GPIO16 / RX2 |
| RXD | GPIO17 / TX2 |
| M0 | GPIO25 |
| M1 | GPIO26 |
| AUX | GPIO27 |
| GND | GND |

Для 30 dBm используйте отдельный подходящий источник питания и общую землю с ESP32.

Команда настройки:

```text
$CMD,RADIO,TYPE=E32,FREQ=433,POWER=30,AIR=2.4,UART=9600,MODE=TRANSPARENT,FEC=1
```

## Команды шлюза

```text
$CMD,GATEWAY_PING
$CMD,GATEWAY_INFO
$CMD,RADIO_STATUS
$CMD,RADIO_OFF
$CMD,RADIO,...
```

Другие строки `$CMD,...` рассматриваются как команды аппарату и пересылаются в эфир.

## Сборка

```bash
pio run -d firmware/radio_gateway_esp32
```

Зависимость:

```text
jgromes/RadioLib@7.7.1
```

## Прошивка из ЦУП Альтаир

Оператору не обязательно устанавливать PlatformIO. Windows-релиз содержит готовые бинарные образы и позволяет прошить ESP32 через панель **«Прошивка ESP32»**.

Записываются:

```text
0x1000   bootloader
0x8000   partition table
0xE000   boot_app0
0x10000  application
```

После записи приложение выполняет MD5-проверку каждой области.

## Статус

Исходный код должен пройти CI-компиляцию перед слиянием релиза v5. Реальный CC1101/E32 и конкретную ESP32 необходимо дополнительно проверить на стенде.
