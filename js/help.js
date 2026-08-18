"use strict";

/* ============================================================
   OpenMCC v0.3
   Interface help, tooltips, quick navigation, radio setup UI
   and command presets.
   ============================================================ */

(() => {
    const HELP_VERSION = "0.3.0";
    const FIRST_RUN_KEY = "openmcc-help-v03-seen";
    const RADIO_KEY = "openmcc-radio-module";
    const RADIO_SETTINGS_PREFIX = "openmcc-radio-settings-";

    const tooltipDefinitions = [
        ["#connectButton", "Открывает системный выбор последовательного USB-порта. Для тестовой Arduino Uno используйте 115200 бод."],
        ["#deviceProfile", "Профиль помогает OpenMCC корректно подписать устройство. Для радиошлюза выбирайте ESP32."],
        ["#serialBaudRate", "Скорость обмена по USB. Демонстратор Arduino и будущий ESP32-шлюз рассчитаны на 115200 бод."],
        ["#packetCounter", "Число принятых телеметрических пакетов за текущий сеанс."],
        ["#crcCounter", "Счётчик ошибок/контрольных событий. Радиопакетный CRC будет реализован в прошивке ESP32-шлюза."],
        ["#telemetryPanel", "Здесь отображаются последние принятые значения TEMP, VOLT, CURR, RSSI и SNR."],
        ["#commandPanel", "Команды уходят в подключённое основное устройство. Позже это будет ESP32-радиошлюз, который передаст команду аппарату по радио."],
        ["[data-command='PING']", "Проверка канала команд. Демонстратор Arduino отвечает $ACK,PONG."],
        ["[data-command='INFO']", "Запрашивает сведения об устройстве и версии протокола."],
        ["[data-command='START']", "Разрешает периодическую передачу телеметрии на демонстраторе."],
        ["[data-command='STOP']", "Останавливает периодическую передачу телеметрии на демонстраторе."],
        ["#telemetryRate", "Выберите период между телеметрическими пакетами."],
        ["#applyTelemetryRate", "Отправляет устройству команду изменения периода телеметрии."],
        ["#customCommand", "Произвольная команда протокола OpenMCC. Используйте только команды, поддерживаемые подключённой прошивкой."],
        ["#commandPresetSelect", "Готовые безопасные примеры команд. Часть команд относится к будущей прошивке МКА и может вернуть UNKNOWN_COMMAND на демонстраторе."],
        ["#commandPresetSend", "Отправляет выбранную команду через тот же канал, что и обычный центр команд."],
        ["#rotatorConnectButton", "Открывает второй независимый последовательный порт для Arduino Uno поворотного устройства."],
        ["#rotatorSimulationMode", "Позволяет проверять весь интерфейс AZ/EL без собранного SatNOGS Rotator v3."],
        ["#rotatorTargetAz", "Целевой азимут антенны. В текущей логике допустим диапазон 0…360°."],
        ["#rotatorTargetEl", "Целевой угол места антенны. В текущей логике допустим диапазон 0…90°."],
        ["#rotatorMoveButton", "Передаёт команду $ROT,SET,AZ=…,EL=… в контроллер поворотки или симулятор."],
        ["#rotatorStopButton", "Останавливает движение. Для реальной механики нужна также отдельная аппаратная аварийная остановка."],
        ["#rotatorHomeButton", "Запускает поиск нулевого положения по концевым выключателям. Реальную механику пока не проверяли."],
        ["#rotatorParkButton", "Команда перевода антенны в заранее заданное парковочное положение."],
        ["#rotatorAutoMode", "Автоматическое сопровождение будет включено после реализации TLE/SGP4 и расчёта AZ/EL."],
        ["#radioPanel", "Настройка наземного радиошлюза ESP32-WROOM-32. Здесь можно выбрать CC1101 или E32-433T30D, посмотреть подключение и подготовить RF-конфигурацию."],
        ["#radioModuleType", "Выберите установленный радиомодуль. Параметры и схема подключения ниже перестроятся автоматически."],
        ["#radioApplyButton", "Сохраняет RF-настройки локально. Если ESP32 подключена, OpenMCC также отправит конфигурацию в шлюз; применение зависит от прошивки ESP32."],
        ["#radioReadButton", "Запрашивает текущую RF-конфигурацию у ESP32-шлюза. Команда заработает после реализации соответствующей прошивки."],
        ["#pauseChartsButton", "Замораживает добавление новых точек на графики без остановки самой телеметрии."],
        ["#clearChartsButton", "Очищает накопленные точки графиков текущего сеанса."],
        ["#satelliteViewport", "Условная 2U-модель CubeSat с фиксированными солнечными панелями и раскрытой рулеточной дипольной антенной."],
        ["#resetSatelliteView", "Возвращает камеру 3D-вида в исходное положение."],
        ["#toggleSatelliteRotation", "Включает или выключает демонстрационное автовращение модели."],
        ["#mapPanel", "Карта пока не реализована. Следующий крупный этап — TLE/SGP4, трасса орбиты, положение ЦУПа и автоматическое сопровождение."],
        ["#eventLog", "Журнал сохраняет ключевые события соединения, команд и ошибок."],
        ["#helpButton", "Открывает краткую встроенную инструкцию. Горячая клавиша: F1."],
    ];

    const radioProfiles = {
        unknown: {
            label: "CC1101 / E32",
            interfaceLabel: "SPI / UART",
            interfaceValue: "SPI или UART",
            powerValue: "Выберите модуль ниже",
            hint: "Модуль ещё не выбран. После выбора появятся схема подключения, диапазоны частоты, мощности и другие параметры.",
        },
        cc1101: {
            label: "CC1101",
            interfaceLabel: "SPI",
            interfaceValue: "SPI + GDO0/GDO2",
            powerValue: "3,3 В; логика 3,3 В",
            hint: "CC1101 — гибко настраиваемый Sub-1 GHz трансивер. Для 433/435 МГц используйте модуль и антенну, рассчитанные на этот диапазон.",
        },
        e32: {
            label: "E32-433T30D",
            interfaceLabel: "UART",
            interfaceValue: "UART + M0/M1/AUX",
            powerValue: "3,3–5,2 В; при 30 dBm до ~670 мА",
            hint: "E32-433T30D — UART LoRa-модуль до 30 dBm. Для 1 Вт предусмотрите отдельное питание с общей землёй и 3,3-вольтовыми логическими уровнями.",
        },
    };

    const commandPresets = [
        { label: "PING — проверка связи", command: "PING", params: null, note: "Безопасная проверка командного канала. Работает с демонстратором Arduino." },
        { label: "INFO — сведения об устройстве", command: "INFO", params: null, note: "Запрашивает тип устройства и версию протокола. Работает с демонстратором." },
        { label: "START — запустить телеметрию", command: "START", params: null, note: "Включает периодическую телеметрию на демонстраторе." },
        { label: "STOP — остановить телеметрию", command: "STOP", params: null, note: "Останавливает периодическую телеметрию на демонстраторе." },
        { label: "LED ON — включить индикатор", command: "LED", params: { VALUE: 1 }, note: "Включает встроенный LED демонстрационной Arduino." },
        { label: "LED OFF — выключить индикатор", command: "LED", params: { VALUE: 0 }, note: "Выключает встроенный LED демонстрационной Arduino." },
        { label: "RATE 1000 — телеметрия 1 раз/с", command: "RATE", params: { VALUE: 1000 }, note: "Устанавливает период телеметрии 1000 мс." },
        { label: "STATUS — запрос состояния МКА", command: "STATUS", params: null, note: "Зарезервированный пример для будущей бортовой прошивки. Демонстратор может ответить UNKNOWN_COMMAND." },
        { label: "POWER — запрос состояния питания", command: "POWER", params: null, note: "Зарезервированный пример для будущей бортовой прошивки." },
        { label: "RADIO_STATUS — состояние радиошлюза", command: "RADIO_STATUS", params: null, note: "Будет использоваться ESP32-шлюзом после реализации его прошивки." },
    ];

    let tooltipElement = null;
    let activeTooltipTarget = null;

    function loadEnhancedStyles() {
        if (document.querySelector("link[data-openmcc-v03]")) return;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "css/radio-controls.css";
        link.dataset.openmccV03 = "1";
        document.head.appendChild(link);
    }

    function updateBuildBadge() {
        const badge = document.querySelector(".buildBadge");
        if (badge) badge.textContent = "v0.3 · LAB";
    }

    function addTooltips() {
        tooltipDefinitions.forEach(([selector, text]) => {
            document.querySelectorAll(selector).forEach((element) => {
                if (!element.dataset.tip) element.dataset.tip = text;
                if (!element.getAttribute("aria-label") && ["BUTTON", "INPUT", "SELECT"].includes(element.tagName)) {
                    element.setAttribute("aria-label", text);
                }
            });
        });
    }

    function placeTooltip(target, pointerEvent = null) {
        if (!tooltipElement || !target) return;
        const text = target.dataset.tip;
        if (!text) return;
        tooltipElement.textContent = text;
        tooltipElement.setAttribute("aria-hidden", "false");
        tooltipElement.classList.add("visible");
        const padding = 12;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const tooltipRect = tooltipElement.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        let left = pointerEvent?.clientX ?? (targetRect.left + targetRect.width / 2);
        let top = pointerEvent?.clientY ?? targetRect.bottom;
        left += 14;
        top += 14;
        if (left + tooltipRect.width + padding > viewportWidth) left = Math.max(padding, viewportWidth - tooltipRect.width - padding);
        if (top + tooltipRect.height + padding > viewportHeight) top = Math.max(padding, (pointerEvent?.clientY ?? targetRect.top) - tooltipRect.height - 14);
        tooltipElement.style.left = `${left}px`;
        tooltipElement.style.top = `${top}px`;
    }

    function hideTooltip() {
        activeTooltipTarget = null;
        if (!tooltipElement) return;
        tooltipElement.classList.remove("visible");
        tooltipElement.setAttribute("aria-hidden", "true");
    }

    function initializeTooltipSystem() {
        tooltipElement = document.getElementById("openmccTooltip");
        if (!tooltipElement) return;
        document.addEventListener("pointerover", (event) => {
            const target = event.target.closest?.("[data-tip]");
            if (!target) return;
            activeTooltipTarget = target;
            placeTooltip(target, event);
        });
        document.addEventListener("pointermove", (event) => {
            if (activeTooltipTarget) placeTooltip(activeTooltipTarget, event);
        });
        document.addEventListener("pointerout", (event) => {
            if (!activeTooltipTarget) return;
            const nextTarget = event.relatedTarget;
            if (nextTarget && activeTooltipTarget.contains(nextTarget)) return;
            hideTooltip();
        });
        document.addEventListener("focusin", (event) => {
            const target = event.target.closest?.("[data-tip]");
            if (!target) return;
            activeTooltipTarget = target;
            placeTooltip(target);
        });
        document.addEventListener("focusout", hideTooltip);
        window.addEventListener("scroll", hideTooltip, { passive: true });
        window.addEventListener("resize", hideTooltip);
    }

    function initializeNavigation() {
        document.querySelectorAll("[data-scroll-target]").forEach((button) => {
            button.addEventListener("click", () => {
                document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });
    }

    function openHelp() {
        const dialog = document.getElementById("helpDialog");
        if (!dialog) return;
        if (typeof dialog.showModal === "function") {
            if (!dialog.open) dialog.showModal();
        } else dialog.setAttribute("open", "");
    }

    function closeHelp() {
        const dialog = document.getElementById("helpDialog");
        if (!dialog) return;
        if (typeof dialog.close === "function" && dialog.open) dialog.close();
        else dialog.removeAttribute("open");
    }

    function initializeHelpDialog() {
        document.querySelectorAll("[data-help-open]").forEach((button) => button.addEventListener("click", openHelp));
        document.querySelectorAll("[data-help-close]").forEach((button) => button.addEventListener("click", closeHelp));
        const dialog = document.getElementById("helpDialog");
        dialog?.addEventListener("click", (event) => { if (event.target === dialog) closeHelp(); });
        document.addEventListener("keydown", (event) => {
            if (event.key === "F1") {
                event.preventDefault();
                openHelp();
            }
        });
    }

    function updateRadioProfile(profileId) {
        const profile = radioProfiles[profileId] ?? radioProfiles.unknown;
        const moduleLabel = document.getElementById("radioModuleLabel");
        const interfaceLabel = document.getElementById("radioInterfaceLabel");
        const interfaceValue = document.getElementById("radioInterfaceValue");
        const powerValue = document.getElementById("radioPowerValue");
        const hint = document.getElementById("radioConfigHint");
        if (moduleLabel) moduleLabel.textContent = profile.label;
        if (interfaceLabel) interfaceLabel.textContent = profile.interfaceLabel;
        if (interfaceValue) interfaceValue.textContent = profile.interfaceValue;
        if (powerValue) powerValue.textContent = profile.powerValue;
        if (hint) hint.textContent = profile.hint;
        renderRadioControls(profileId);
    }

    function getRadioSettingsKey(profileId) {
        return `${RADIO_SETTINGS_PREFIX}${profileId}`;
    }

    function loadRadioSettings(profileId, defaults) {
        try {
            const parsed = JSON.parse(localStorage.getItem(getRadioSettingsKey(profileId)) || "null");
            return { ...defaults, ...(parsed && typeof parsed === "object" ? parsed : {}) };
        } catch {
            return { ...defaults };
        }
    }

    function saveRadioSettings(profileId, settings) {
        localStorage.setItem(getRadioSettingsKey(profileId), JSON.stringify(settings));
    }

    function radioPinTable(profileId) {
        const rows = profileId === "cc1101" ? [
            ["3V3", "VCC", "Питание 3,3 В"],
            ["GND", "GND", "Общая земля"],
            ["GPIO18", "SCK", "SPI clock"],
            ["GPIO23", "SI / MOSI", "ESP32 → CC1101"],
            ["GPIO19", "SO / MISO", "CC1101 → ESP32"],
            ["GPIO21", "CSn", "Chip Select"],
            ["GPIO4", "GDO0", "Прерывание / пакет"],
            ["GPIO27", "GDO2", "Доп. сигнал состояния"],
        ] : [
            ["Внешние 5 В ≥ 1 А", "VCC", "Питание; не от слабого 3V3 ESP32"],
            ["GND ESP32 + БП", "GND", "Общая земля обязательна"],
            ["GPIO17 / TX2", "RXD", "ESP32 → E32"],
            ["GPIO16 / RX2", "TXD", "E32 → ESP32"],
            ["GPIO25", "M0", "Выбор режима"],
            ["GPIO26", "M1", "Выбор режима"],
            ["GPIO27", "AUX", "Готовность / занятость"],
        ];
        return rows.map(([esp, radio, purpose]) => `<tr><td>${esp}</td><td>${radio}</td><td>${purpose}</td></tr>`).join("");
    }

    function cc1101Controls(settings) {
        return `
            <div class="radioControlGrid">
                <label><span>Частота, МГц</span><input id="radioFrequency" type="number" min="387" max="464" step="0.001" value="${settings.frequency}"></label>
                <label><span>Мощность TX</span><select id="radioTxPower">
                    ${[-30,-20,-15,-10,0,5,7,10,12].map(v => `<option value="${v}" ${Number(settings.power) === v ? "selected" : ""}>${v > 0 ? "+" : ""}${v} dBm</option>`).join("")}
                </select></label>
                <label><span>Скорость в эфире</span><select id="radioDataRate">
                    ${[1.2,2.4,4.8,9.6,38.4,100,250].map(v => `<option value="${v}" ${Number(settings.rate) === v ? "selected" : ""}>${v} kbps</option>`).join("")}
                </select></label>
                <label><span>Модуляция</span><select id="radioModulation">
                    ${["2-FSK","GFSK","4-FSK","MSK","OOK"].map(v => `<option value="${v}" ${settings.modulation === v ? "selected" : ""}>${v}</option>`).join("")}
                </select></label>
                <label><span>Полоса RX</span><select id="radioBandwidth">
                    ${["AUTO","58","102","203","406"].map(v => `<option value="${v}" ${String(settings.bandwidth) === v ? "selected" : ""}>${v === "AUTO" ? "Авто" : `${v} кГц`}</option>`).join("")}
                </select></label>
                <label class="radioCheck"><input id="radioCrc" type="checkbox" ${settings.crc ? "checked" : ""}><span>Аппаратный CRC</span></label>
                <label class="radioCheck"><input id="radioCca" type="checkbox" ${settings.cca ? "checked" : ""}><span>CCA перед передачей</span></label>
            </div>`;
    }

    function e32Controls(settings) {
        return `
            <div class="radioControlGrid">
                <label><span>Частота, МГц</span><input id="radioFrequency" type="number" min="410" max="441" step="1" value="${settings.frequency}"></label>
                <label><span>Мощность TX</span><select id="radioTxPower">
                    ${[21,24,27,30].map(v => `<option value="${v}" ${Number(settings.power) === v ? "selected" : ""}>${v} dBm${v === 30 ? " ≈ 1 Вт" : ""}</option>`).join("")}
                </select></label>
                <label><span>Скорость в эфире</span><select id="radioAirRate">
                    ${[2.4,4.8,9.6,19.2].map(v => `<option value="${v}" ${Number(settings.airRate) === v ? "selected" : ""}>${v} kbps</option>`).join("")}
                </select></label>
                <label><span>UART ESP32 ↔ E32</span><select id="radioUartRate">
                    ${[1200,2400,4800,9600,19200,38400,57600,115200].map(v => `<option value="${v}" ${Number(settings.uartRate) === v ? "selected" : ""}>${v} бод</option>`).join("")}
                </select></label>
                <label><span>Режим передачи</span><select id="radioE32Mode">
                    <option value="TRANSPARENT" ${settings.mode === "TRANSPARENT" ? "selected" : ""}>Прозрачный</option>
                    <option value="FIXED" ${settings.mode === "FIXED" ? "selected" : ""}>Фиксированная адресация</option>
                </select></label>
                <label class="radioCheck"><input id="radioFec" type="checkbox" ${settings.fec ? "checked" : ""}><span>FEC</span></label>
            </div>`;
    }

    function renderRadioControls(profileId) {
        const panel = document.getElementById("radioPanel");
        if (!panel) return;
        let container = document.getElementById("radioAdvancedControls");
        if (!container) {
            container = document.createElement("div");
            container.id = "radioAdvancedControls";
            const hint = document.getElementById("radioConfigHint");
            panel.insertBefore(container, hint || null);
        }
        if (profileId === "unknown") {
            container.innerHTML = `<div class="radioEmptyState"><strong>Выберите CC1101 или E32-433T30D</strong><span>После выбора здесь появятся подключение и параметры радиотракта.</span></div>`;
            return;
        }

        const defaults = profileId === "cc1101"
            ? { frequency: 435.0, power: 10, rate: 38.4, modulation: "GFSK", bandwidth: "AUTO", crc: true, cca: true }
            : { frequency: 433, power: 30, airRate: 2.4, uartRate: 9600, mode: "TRANSPARENT", fec: true };
        const settings = loadRadioSettings(profileId, defaults);

        container.innerHTML = `
            <details class="radioDetails" open>
                <summary>Подключение ${radioProfiles[profileId].label} к ESP32-WROOM-32</summary>
                <div class="radioDetailsBody">
                    <table class="radioPinTable"><thead><tr><th>ESP32 / питание</th><th>${radioProfiles[profileId].label}</th><th>Назначение</th></tr></thead><tbody>${radioPinTable(profileId)}</tbody></table>
                    <p class="radioSafetyNote">${profileId === "cc1101"
                        ? "CC1101 работает с логикой 3,3 В. Не подавайте на сигнальные выводы 5 В. Выбранная разводка GPIO является конфигурацией OpenMCC и может быть изменена в прошивке ESP32."
                        : "E32-433T30D при 30 dBm потребляет большой импульсный ток. Используйте отдельный стабилизированный источник питания с общей GND; сигнальные уровни рекомендуется держать 3,3 В."}</p>
                </div>
            </details>
            <div class="radioConfigCard">
                <div class="radioConfigHeader"><div><span>Параметры радиотракта</span><strong>${radioProfiles[profileId].label}</strong></div><span class="radioLocalBadge">СОХРАНЯЮТСЯ ЛОКАЛЬНО</span></div>
                ${profileId === "cc1101" ? cc1101Controls(settings) : e32Controls(settings)}
                <div class="radioCommandPreview"><span>Команда для ESP32</span><code id="radioCommandPreview">—</code></div>
                <div class="radioActionRow">
                    <button type="button" id="radioApplyButton" class="radioApplyButton">Сохранить / передать в шлюз</button>
                    <button type="button" id="radioReadButton" class="radioSecondaryButton">Запросить из шлюза</button>
                </div>
                <div id="radioApplyStatus" class="radioApplyStatus">Настройки ещё не передавались.</div>
                <div class="radioRegulatoryNote">Частоту и мощность выбирайте только в пределах разрешённых для вашей станции, диапазона и лицензии. Интерфейс OpenMCC не отменяет требования радиорегулирования.</div>
            </div>`;

        bindRadioControlEvents(profileId);
        addTooltips();
    }

    function collectRadioSettings(profileId) {
        const frequency = Number(document.getElementById("radioFrequency")?.value);
        const power = Number(document.getElementById("radioTxPower")?.value);
        if (profileId === "cc1101") {
            return {
                frequency,
                power,
                rate: Number(document.getElementById("radioDataRate")?.value),
                modulation: document.getElementById("radioModulation")?.value || "GFSK",
                bandwidth: document.getElementById("radioBandwidth")?.value || "AUTO",
                crc: Boolean(document.getElementById("radioCrc")?.checked),
                cca: Boolean(document.getElementById("radioCca")?.checked),
            };
        }
        return {
            frequency,
            power,
            airRate: Number(document.getElementById("radioAirRate")?.value),
            uartRate: Number(document.getElementById("radioUartRate")?.value),
            mode: document.getElementById("radioE32Mode")?.value || "TRANSPARENT",
            fec: Boolean(document.getElementById("radioFec")?.checked),
        };
    }

    function validateRadioSettings(profileId, settings) {
        const [minimum, maximum] = profileId === "cc1101" ? [387, 464] : [410, 441];
        if (!Number.isFinite(settings.frequency) || settings.frequency < minimum || settings.frequency > maximum) {
            throw new Error(`Частота должна быть в диапазоне ${minimum}…${maximum} МГц`);
        }
    }

    function buildRadioParameters(profileId, settings) {
        if (profileId === "cc1101") {
            return {
                TYPE: "CC1101",
                FREQ: settings.frequency.toFixed(3),
                POWER: settings.power,
                RATE: settings.rate,
                MOD: settings.modulation.replace("-", ""),
                BW: settings.bandwidth,
                CRC: settings.crc ? 1 : 0,
                CCA: settings.cca ? 1 : 0,
            };
        }
        return {
            TYPE: "E32",
            FREQ: settings.frequency.toFixed(0),
            POWER: settings.power,
            AIR: settings.airRate,
            UART: settings.uartRate,
            MODE: settings.mode,
            FEC: settings.fec ? 1 : 0,
        };
    }

    function previewRadioCommand(profileId) {
        const preview = document.getElementById("radioCommandPreview");
        if (!preview) return;
        try {
            const settings = collectRadioSettings(profileId);
            validateRadioSettings(profileId, settings);
            const params = buildRadioParameters(profileId, settings);
            preview.textContent = `$CMD,RADIO,${Object.entries(params).map(([key, value]) => `${key}=${value}`).join(",")}`;
        } catch (error) {
            preview.textContent = error.message;
        }
    }

    function setRadioStatus(text, type = "neutral") {
        const element = document.getElementById("radioApplyStatus");
        if (!element) return;
        element.textContent = text;
        element.dataset.state = type;
    }

    async function applyRadioSettings(profileId) {
        try {
            const settings = collectRadioSettings(profileId);
            validateRadioSettings(profileId, settings);
            saveRadioSettings(profileId, settings);
            previewRadioCommand(profileId);
            const serialState = window.OpenMCCSerial?.getState?.();
            if (!serialState?.connected) {
                setRadioStatus("Сохранено на этом компьютере. Подключите ESP32-шлюз, чтобы передать настройки в устройство.", "saved");
                window.OpenMCCLogger?.write?.("RF-настройки сохранены локально", "success", "RADIO", { profileId, settings });
                return;
            }
            const parameters = buildRadioParameters(profileId, settings);
            await window.OpenMCCUI.transmitCommand("RADIO", parameters);
            setRadioStatus("Конфигурация отправлена в ESP32. Фактическое применение требует прошивки радиошлюза v0.3+.", "sent");
        } catch (error) {
            setRadioStatus(`Ошибка: ${error.message}`, "error");
            window.OpenMCCLogger?.write?.(`RF-конфигурация не применена: ${error.message}`, "error", "RADIO");
        }
    }

    async function requestRadioSettings() {
        const serialState = window.OpenMCCSerial?.getState?.();
        if (!serialState?.connected) {
            setRadioStatus("Сначала подключите ESP32-шлюз через основной порт.", "error");
            return;
        }
        try {
            await window.OpenMCCUI.transmitCommand("RADIO_STATUS");
            setRadioStatus("Запрос RADIO_STATUS отправлен. Ответ появится после реализации прошивки ESP32-шлюза.", "sent");
        } catch (error) {
            setRadioStatus(`Запрос не отправлен: ${error.message}`, "error");
        }
    }

    function bindRadioControlEvents(profileId) {
        document.querySelectorAll("#radioAdvancedControls input, #radioAdvancedControls select").forEach((control) => {
            control.addEventListener("input", () => previewRadioCommand(profileId));
            control.addEventListener("change", () => previewRadioCommand(profileId));
        });
        document.getElementById("radioApplyButton")?.addEventListener("click", () => applyRadioSettings(profileId));
        document.getElementById("radioReadButton")?.addEventListener("click", requestRadioSettings);
        previewRadioCommand(profileId);
    }

    function initializeRadioPlanner() {
        const select = document.getElementById("radioModuleType");
        if (!select) return;
        const storedValue = localStorage.getItem(RADIO_KEY);
        if (storedValue && radioProfiles[storedValue]) select.value = storedValue;
        updateRadioProfile(select.value);
        select.addEventListener("change", () => {
            localStorage.setItem(RADIO_KEY, select.value);
            updateRadioProfile(select.value);
        });
    }

    function initializeCommandPresets() {
        const panel = document.getElementById("commandPanel");
        const lastCommand = document.querySelector("#commandPanel .lastCommand");
        if (!panel || document.getElementById("commandPresetSelect")) return;
        const group = document.createElement("div");
        group.className = "commandGroup commandPresetGroup";
        group.innerHTML = `
            <div class="commandGroupTitle">Готовые команды</div>
            <div class="commandPresetRow">
                <select id="commandPresetSelect" aria-label="Выберите готовую команду">
                    ${commandPresets.map((preset, index) => `<option value="${index}">${preset.label}</option>`).join("")}
                </select>
                <button type="button" id="commandPresetSend" class="commandButton commandPrimary">Отправить выбранную</button>
            </div>
            <div id="commandPresetNote" class="commandPresetNote"></div>`;
        panel.insertBefore(group, lastCommand || null);
        const select = document.getElementById("commandPresetSelect");
        const sendButton = document.getElementById("commandPresetSend");
        const note = document.getElementById("commandPresetNote");

        const updateNote = () => {
            const preset = commandPresets[Number(select?.value) || 0];
            if (note) note.textContent = preset.note;
        };
        const updateAvailability = () => {
            const connected = Boolean(window.OpenMCCSerial?.getState?.()?.connected);
            if (sendButton) sendButton.disabled = !connected;
        };

        select?.addEventListener("change", updateNote);
        sendButton?.addEventListener("click", async () => {
            const preset = commandPresets[Number(select?.value) || 0];
            try {
                await window.OpenMCCUI.transmitCommand(preset.command, preset.params);
            } catch {
                // transmitCommand already writes the error to the event log.
            }
        });
        window.addEventListener("openmcc:serial-connected", updateAvailability);
        window.addEventListener("openmcc:serial-disconnected", updateAvailability);
        updateNote();
        updateAvailability();
    }

    function showFirstRunToast() {
        if (localStorage.getItem(FIRST_RUN_KEY) === "1") return;
        const toast = document.createElement("div");
        toast.className = "openmccToast";
        toast.innerHTML = `<strong>OpenMCC v${HELP_VERSION}</strong>Добавлены схемы подключения и RF-настройки CC1101/E32, готовые команды и обновлённая 3D-модель CubeSat.<br><button type="button">Понятно</button>`;
        toast.querySelector("button")?.addEventListener("click", () => {
            localStorage.setItem(FIRST_RUN_KEY, "1");
            toast.remove();
        });
        document.body.appendChild(toast);
    }

    function initialize() {
        loadEnhancedStyles();
        updateBuildBadge();
        initializeRadioPlanner();
        initializeCommandPresets();
        addTooltips();
        initializeTooltipSystem();
        initializeNavigation();
        initializeHelpDialog();
        showFirstRunToast();
        window.dispatchEvent(new CustomEvent("openmcc:help-ready", { detail: { version: HELP_VERSION } }));
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
