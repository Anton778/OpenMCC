# OpenMCC Rotator — Arduino Uno

Прошивка контроллера двухосевой поворотки OpenMCC:

```text
firmware/rotator_arduino_uno/OpenMCC_Rotator_Uno/OpenMCC_Rotator_Uno.ino
```

Целевая конфигурация:

- Arduino Uno;
- CNC Shield V3;
- два драйвера шаговых двигателей;
- два NEMA17: AZ и EL;
- два концевых выключателя нулевого положения;
- механика SatNOGS Rotator v3 или совместимая AZ/EL.

## Подключение к CNC Shield V3

| Функция | Arduino Uno | CNC Shield |
|---|---:|---|
| AZ STEP | D2 | X.STEP |
| EL STEP | D3 | Y.STEP |
| AZ DIR | D5 | X.DIR |
| EL DIR | D6 | Y.DIR |
| ENABLE | D8 | ENABLE |
| AZ HOME | D9 | X- endstop |
| EL HOME | D10 | Y- endstop |

Концевики в текущей конфигурации подключаются между входом и GND и используют `INPUT_PULLUP`.

## Протокол OpenMCC

Скорость: `115200 бод`.

Команды:

```text
$ROT,SET,AZ=120.00,EL=35.00
$ROT,STOP
$ROT,HOME
$ROT,PARK
$ROT,STATUS
$ROT,INFO
```

Ответы:

```text
$ROT,ACK,...
$ROT,POS,AZ=...,EL=...
$ROT,STATE=IDLE
$ROT,HOME=OK
$ROT,ERR,...
```

## Перед первой проверкой механики

Прошивка намеренно содержит коэффициенты передачи `AZ_GEAR_RATIO = 1.0` и `EL_GEAR_RATIO = 1.0`. Это безопасные значения-заглушки для стендовой проверки электроники. После сборки поворотки необходимо измерить фактическое передаточное отношение и заменить эти значения в `.ino`.

Также требуется проверить:

1. микрошаг драйверов и значение `MICROSTEPS`;
2. направления вращения `AZ_DIRECTION_INVERTED` и `EL_DIRECTION_INVERTED`;
3. полярность концевиков;
4. ток драйверов;
5. скорость движения.

До выполнения калибровки нельзя считать отображаемые углы механически точными.
