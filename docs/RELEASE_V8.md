# ЦУП Альтаир v8 / 0.8.0

Это первый релиз, подготовленный не только для стенда автора, а для передачи другим командам.

## Главное

- официальная прошивка ESP32 соответствует реально рабочему стендовому варианту;
- прикладная XOR-проверка отключена: изменение ID/полей больше не отправляет пакет в ошибки;
- рабочая частота **435.000 МГц** постоянно видна на главном экране;
- RX bandwidth наземного CC1101: **203 кГц**;
- панель подключения можно сворачивать, после соединения она сворачивается автоматически;
- добавлен сырой COM-терминал;
- добавлена кнопка полного сброса принятых данных;
- графики разделяются по ID спутников: каждый ID имеет собственную линию и цвет;
- добавлена передача RF-команд из ЦУПа;
- добавлено окно «О программе»;
- новый значок Альтаира используется в интерфейсе и Windows-сборке;
- README содержит фотографии реального ЦУПа и CubeSat;
- при публикации v8 старые GitHub Releases и их теги удаляются, чтобы осталась одна актуальная версия.

## ESP32 gateway

`Altair_Gateway_v8.ino`

Профиль:

```text
435.000 MHz
4.8 kbps
2-FSK
deviation 5 kHz
RX BW 203 kHz
sync 0x12AD
NRZ
variable packet
CC1101 CRC ON
application XOR validation OFF
USB 115200
RF TX ON
```

Базовый пакет:

```text
ID,PACKET,UPTIME,PANEL_POWER,VOLT,MODE,CHECKSUM
```

Расширенный пакет:

```text
ID,PACKET,UPTIME,PANEL_POWER,VOLT,MODE,ANTENNA,CHECKSUM
```

## Командный канал

USB:

```text
$CMD,RF,TO=02,NAME=PING
```

В эфир:

```text
$CMD,TO=02,NAME=PING
```

Поддерживаемые команды интерфейса: `PING`, `INFO`, `TM_START`, `TM_STOP`, `TM_PERIOD`, `USER`.

## Файлы релиза

- `CUP-Altair-Setup-0.8.0.exe`
- `Altair_Gateway_v8.ino`
- `CUP_Altair_v8_Manual.pdf`
- `CUP_Altair_v8_Manual.tex`
- `gateway-firmware.bin`
- `manifest.json`
