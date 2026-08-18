# Changelog

## v0.2.0 — Windows desktop packaging

- добавлен desktop-host на Electron;
- OpenMCC запускается как обычное Windows-приложение без Python и браузерной вкладки;
- сохранена работа существующего Web Serial API через Electron;
- добавлен нативный выбор последовательного порта;
- добавлена сборка NSIS x64 установщика `OpenMCC-Setup-<version>.exe`;
- добавлена автоматическая сборка Windows installer через GitHub Actions;
- добавлена автоматическая публикация установщика в GitHub Release при теге `v*`;
- добавлена документация `docs/DESKTOP_APP.md`;
- добавлен `.gitignore` для `node_modules/` и результатов сборки.

## v0.2 — Interface and documentation overhaul

- переработана компоновка интерфейса без изменения основных модулей телеметрии;
- добавлена быстрая навигация по панелям;
- добавлены контекстные подсказки;
- добавлена встроенная справка по `F1` и кнопке `?`;
- добавлена панель планируемого радиошлюза ESP32-WROOM-32;
- добавлена панель текущего статуса проекта;
- вместо `Coming soon` карта теперь явно показывает запланированный блок TLE/SGP4;
- добавлены техническая документация и roadmap;
- добавлен Windows-скрипт быстрого запуска.

## v0.1

- Web Serial;
- парсер телеметрии;
- журнал;
- команды;
- Chart.js;
- Three.js CubeSat;
- AZ/EL rotator interface;
- rotator simulator;
- Arduino Uno/Nano telemetry demo.
