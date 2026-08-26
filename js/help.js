"use strict";

/* ============================================================
   ЦУП Альтаир — help, radio controls and command presets
   Release v5 / 0.5.0
   ============================================================ */

(() => {
    const VERSION = "0.5.0";
    const FIRST_RUN_KEY = "altair-v5-help-seen";
    const RADIO_MODULE_KEY = "altair-v5-radio-module";
    const RADIO_SETTINGS_KEY = "altair-v5-radio-settings";

    const tooltipDefinitions = [
        ["#connectButton", "Подключает основной USB-порт. Для радиошлюза ESP32 используйте 115200 бод."],
        ["#telemetryPanel", "Главная телеметрия миссии: ID, аккумулятор, мощность панелей, пакеты, uptime, температура, RSSI и SNR."],
        ["#chartPanel", "Графики строятся сразу под телеметрией для аккумулятора, солнечных панелей, температуры, RSSI и SNR."],
        ["#radioModuleType", "Выбор радиомодуля наземного шлюза. Для текущего Transmit.ino нужен CC1101."],
        ["#rotatorSimulationMode", "Позволяет проверять AZ/EL без собранной механики."],
        ["#firmwareFlashButton", "Прошивает ESP32-WROOM-32 встроенной прошивкой радиошлюза без Arduino IDE."],
        ["#eventLog", "Здесь видны сообщения устройства, ошибки, ответы команд и тестовые RF-строки."],
        ["#helpButton", "Открывает эту справку. Горячая клавиша F1."],
    ];

    const commandPresets = [
        { label: "PING — проверить канал", command: "PING", params: null, note: "Простая проверка командного канала." },
        { label: "GATEWAY_INFO — сведения об ESP32", command: "GATEWAY_INFO", params: null, note: "Запрашивает версию радиошлюза." },
        { label: "RADIO_STATUS — параметры радиоканала", command: "RADIO_STATUS", params: null, note: "Показывает выбранный модуль, частоту, мощность и режимы." },
        { label: "START — включить телеметрию", command: "START", params: null, note: "Команда аппарату на запуск периодической телеметрии, если поддерживается бортовой прошивкой." },
        { label: "STOP — остановить телеметрию", command: "STOP", params: null, note: "Команда аппарату на остановку периодической телеметрии." },
        { label: "STATUS — состояние аппарата", command: "STATUS", params: null, note: "Рекомендуемая команда общего состояния МКА." },
        { label: "POWER — питание аппарата", command: "POWER", params: null, note: "Рекомендуемая команда запроса подсистемы питания." },
        { label: "PANEL_STATUS — солнечные панели", command: "PANEL_STATUS", params: null, note: "Заготовка команды для состояния солнечных панелей." },
    ];

    const radioProfiles = Object.freeze({
        cc1101: {
            label: "CC1101",
            interfaceLabel: "SPI",
            interfaceValue: "SPI + GDO0/GDO2",
            powerValue: "3,3 В; логика 3,3 В",
            wiring: [
                ["VCC", "3V3", "Питание только 3,3 В"],
                ["GND", "GND", "Общая земля"],
                ["SCK", "GPIO18", "SPI SCK"],
                ["SO / MISO", "GPIO19", "SPI MISO"],
                ["SI / MOSI", "GPIO23", "SPI MOSI"],
                ["CSn", "GPIO21", "Chip Select"],
                ["GDO0", "GPIO4", "Прерывание RX/TX"],
                ["GDO2", "GPIO27", "Дополнительный GDO"],
            ],
        },
        e32: {
            label: "E32-433T30D",
            interfaceLabel: "UART",
            interfaceValue: "UART + M0/M1/AUX",
            powerValue: "Отдельное питание; общая земля с ESP32",
            wiring: [
                ["TXD", "GPIO16 / RX2", "Данные E32 → ESP32"],
                ["RXD", "GPIO17 / TX2", "Данные ESP32 → E32"],
                ["M0", "GPIO25", "Выбор режима"],
                ["M1", "GPIO26", "Выбор режима"],
                ["AUX", "GPIO27", "Готовность модуля"],
                ["GND", "GND", "Общая земля"],
                ["VCC", "отдельный БП", "Для 30 dBm не питать от слабого выхода ESP32"],
            ],
        },
        unknown: {
            label: "Не выбран",
            interfaceLabel: "—",
            interfaceValue: "—",
            powerValue: "—",
            wiring: [],
        },
    });

    let tooltipElement = null;
    let activeTooltipTarget = null;

    function writeLog(message, type = "info", metadata = null) {
        if (window.OpenMCCLogger?.write) window.OpenMCCLogger.write(message, type, "HELP", metadata);
    }

    function updateBadge() {
        const badge = document.querySelector(".buildBadge");
        if (badge) badge.textContent = "v5 · 0.5.0";
    }

    function initializeNavigation() {
        document.querySelectorAll("[data-scroll-target]").forEach(button => {
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
        } else {
            dialog.setAttribute("open", "");
        }
    }

    function closeHelp() {
        const dialog = document.getElementById("helpDialog");
        if (!dialog) return;
        if (typeof dialog.close === "function" && dialog.open) dialog.close();
        else dialog.removeAttribute("open");
    }

    function initializeHelpDialog() {
        document.querySelectorAll("[data-help-open]").forEach(button => button.addEventListener("click", openHelp));
        document.querySelectorAll("[data-help-close]").forEach(button => button.addEventListener("click", closeHelp));
        document.addEventListener("keydown", event => {
            if (event.key === "F1") {
                event.preventDefault();
                openHelp();
            }
            if (event.key === "Escape") closeHelp();
        });
    }

    function addTooltips() {
        tooltipDefinitions.forEach(([selector, text]) => {
            document.querySelectorAll(selector).forEach(element => {
                if (!element.dataset.tip) element.dataset.tip = text;
            });
        });
    }

    function placeTooltip(target, pointerEvent = null) {
        if (!tooltipElement || !target?.dataset?.tip) return;
        tooltipElement.textContent = target.dataset.tip;
        tooltipElement.setAttribute("aria-hidden", "false");
        tooltipElement.classList.add("visible");
        const rect = tooltipElement.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const padding = 12;
        let left = (pointerEvent?.clientX ?? targetRect.left) + 14;
        let top = (pointerEvent?.clientY ?? targetRect.bottom) + 14;
        if (left + rect.width + padding > innerWidth) left = Math.max(padding, innerWidth - rect.width - padding);
        if (top + rect.height + padding > innerHeight) top = Math.max(padding, targetRect.top - rect.height - 14);
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
        document.addEventListener("pointerover", event => {
            const target = event.target.closest?.("[data-tip]");
            if (!target) return;
            activeTooltipTarget = target;
            placeTooltip(target, event);
        });
        document.addEventListener("pointermove", event => { if (activeTooltipTarget) placeTooltip(activeTooltipTarget, event); });
        document.addEventListener("pointerout", hideTooltip);
        document.addEventListener("focusin", event => {
            const target = event.target.closest?.("[data-tip]");
            if (!target) return;
            activeTooltipTarget = target;
            placeTooltip(target);
        });
        document.addEventListener("focusout", hideTooltip);
        window.addEventListener("scroll", hideTooltip, { passive: true });
    }

    function injectCommandPresets() {
        const panel = document.getElementById("commandPanel");
        if (!panel || document.getElementById("commandPresetSelect")) return;
        const last = panel.querySelector(".lastCommand");
        const group = document.createElement("div");
        group.className = "commandGroup commandPresetGroup";
        group.innerHTML = `
            <div class="commandGroupTitle">Готовые команды</div>
            <label class="commandField">
                <span>Выберите пример</span>
                <select id="commandPresetSelect"></select>
            </label>
            <div id="commandPresetNote" class="radioMiniNote"></div>
            <button type="button" id="commandPresetSend" class="commandButton commandWide">Передать выбранную команду</button>
        `;
        if (last) panel.insertBefore(group, last);
        else panel.appendChild(group);

        const select = group.querySelector("#commandPresetSelect");
        const note = group.querySelector("#commandPresetNote");
        commandPresets.forEach((preset, index) => {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = preset.label;
            select.appendChild(option);
        });

        const updateNote = () => {
            const preset = commandPresets[Number(select.value) || 0];
            note.textContent = preset?.note || "";
        };
        select.addEventListener("change", updateNote);
        updateNote();

        group.querySelector("#commandPresetSend")?.addEventListener("click", async () => {
            const preset = commandPresets[Number(select.value) || 0];
            if (!preset) return;
            try {
                await window.OpenMCCUI?.transmitCommand?.(preset.command, preset.params);
            } catch (error) {
                writeLog(`Не удалось передать готовую команду: ${error.message}`, "error");
            }
        });
    }

    function loadRadioSettings() {
        const defaults = {
            cc1101: { frequency: 434.000, power: 5, rate: 4.8, modulation: "2FSK", bandwidth: "58", crc: true, cca: true },
            e32: { frequency: 433, power: 30, airRate: 2.4, uartRate: 9600, mode: "TRANSPARENT", fec: true },
        };
        try {
            const saved = JSON.parse(localStorage.getItem(RADIO_SETTINGS_KEY) || "{}");
            return {
                cc1101: { ...defaults.cc1101, ...(saved.cc1101 || {}) },
                e32: { ...defaults.e32, ...(saved.e32 || {}) },
            };
        } catch {
            return defaults;
        }
    }

    function saveRadioSettings(allSettings) {
        localStorage.setItem(RADIO_SETTINGS_KEY, JSON.stringify(allSettings));
    }

    function updateRadioSummary(moduleType) {
        const profile = radioProfiles[moduleType] || radioProfiles.unknown;
        const label = document.getElementById("radioModuleLabel");
        const interfaceLabel = document.getElementById("radioInterfaceLabel");
        const interfaceValue = document.getElementById("radioInterfaceValue");
        const powerValue = document.getElementById("radioPowerValue");
        if (label) label.textContent = profile.label;
        if (interfaceLabel) interfaceLabel.textContent = profile.interfaceLabel;
        if (interfaceValue) interfaceValue.textContent = profile.interfaceValue;
        if (powerValue) powerValue.textContent = profile.powerValue;
    }

    function wiringTable(profile) {
        if (!profile.wiring.length) return "";
        return `
            <details class="radioDetails" open>
                <summary>Как подключить ${profile.label} к ESP32-WROOM-32</summary>
                <div class="radioDetailsBody">
                    <table class="radioWiringTable">
                        <thead><tr><th>${profile.label}</th><th>ESP32-WROOM-32</th><th>Назначение</th></tr></thead>
                        <tbody>${profile.wiring.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td></tr>`).join("")}</tbody>
                    </table>
                </div>
            </details>
        `;
    }

    function renderCc1101Controls(settings) {
        return `
            <div class="radioConfigSection">
                <div class="radioConfigTitleRow">
                    <div><span>Профиль CC1101</span><strong>Технопром 2026 / Transmit.ino</strong></div>
                    <button type="button" id="radioTechnopromPreset" class="smallButton">Применить профиль Технопром 2026</button>
                </div>
                <div class="radioControlGrid">
                    <label><span>Частота, МГц</span><input id="radioFrequency" type="number" min="387" max="464" step="0.001" value="${Number(settings.frequency).toFixed(3)}"></label>
                    <label><span>Мощность TX</span><select id="radioTxPower">${[-30,-20,-15,-10,0,5,7,10].map(v => `<option value="${v}" ${Number(settings.power) === v ? "selected" : ""}>${v > 0 ? "+" : ""}${v} dBm</option>`).join("")}</select></label>
                    <label><span>Скорость в эфире</span><select id="radioDataRate">${[1.2,2.4,4.8,9.6,38.4,100,250].map(v => `<option value="${v}" ${Number(settings.rate) === v ? "selected" : ""}>${v} kbps</option>`).join("")}</select></label>
                    <label><span>Модуляция</span><select id="radioModulation">${["2FSK","GFSK","4FSK","OOK"].map(v => `<option value="${v}" ${settings.modulation === v ? "selected" : ""}>${v === "2FSK" ? "2-FSK" : v === "4FSK" ? "4-FSK" : v}</option>`).join("")}</select></label>
                    <label><span>Полоса RX, кГц</span><select id="radioBandwidth">${["AUTO",58,68,81,102,116,135,162,203,232,270,325,406,464,541,650,812].map(v => `<option value="${v}" ${String(settings.bandwidth) === String(v) ? "selected" : ""}>${v}</option>`).join("")}</select></label>
                    <div class="radioStaticField"><span>Девиация</span><strong>5 кГц для профиля 4.8 kbps</strong></div>
                    <label class="radioCheck"><input id="radioCrc" type="checkbox" ${settings.crc ? "checked" : ""}><span>CRC CC1101</span></label>
                    <label class="radioCheck"><input id="radioCca" type="checkbox" ${settings.cca ? "checked" : ""}><span>CCA перед передачей</span></label>
                </div>
                <div class="radioMiniNote">Загруженный Transmit.ino вызывает <code>radio.begin(434.00f)</code>. Для RadioLib 7.7.1 это означает 434.000 МГц, 4.8 kbps, девиацию 5 кГц, RX BW 58 кГц и стандартный 2-FSK-профиль. Мощность передатчика в скетче затем установлена 5 dBm.</div>
            </div>
        `;
    }

    function renderE32Controls(settings) {
        return `
            <div class="radioConfigSection">
                <div class="radioConfigTitleRow"><div><span>Профиль E32</span><strong>E32-433T30D</strong></div></div>
                <div class="radioControlGrid">
                    <label><span>Частота, МГц</span><input id="radioFrequency" type="number" min="410" max="441" step="1" value="${settings.frequency}"></label>
                    <label><span>Мощность TX</span><select id="radioTxPower">${[21,24,27,30].map(v => `<option value="${v}" ${Number(settings.power) === v ? "selected" : ""}>${v} dBm</option>`).join("")}</select></label>
                    <label><span>Скорость в эфире</span><select id="radioAirRate">${[2.4,4.8,9.6,19.2].map(v => `<option value="${v}" ${Number(settings.airRate) === v ? "selected" : ""}>${v} kbps</option>`).join("")}</select></label>
                    <label><span>UART</span><select id="radioUartRate">${[1200,2400,4800,9600,19200,38400,57600,115200].map(v => `<option value="${v}" ${Number(settings.uartRate) === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
                    <label><span>Режим</span><select id="radioE32Mode"><option value="TRANSPARENT" ${settings.mode === "TRANSPARENT" ? "selected" : ""}>Transparent</option><option value="FIXED" ${settings.mode === "FIXED" ? "selected" : ""}>Fixed</option></select></label>
                    <label class="radioCheck"><input id="radioFec" type="checkbox" ${settings.fec ? "checked" : ""}><span>FEC</span></label>
                </div>
            </div>
        `;
    }

    function readCurrentSettings(moduleType, allSettings) {
        if (moduleType === "cc1101") {
            return {
                frequency: Number(document.getElementById("radioFrequency")?.value || 434),
                power: Number(document.getElementById("radioTxPower")?.value || 5),
                rate: Number(document.getElementById("radioDataRate")?.value || 4.8),
                modulation: String(document.getElementById("radioModulation")?.value || "2FSK"),
                bandwidth: String(document.getElementById("radioBandwidth")?.value || "58"),
                crc: Boolean(document.getElementById("radioCrc")?.checked),
                cca: Boolean(document.getElementById("radioCca")?.checked),
            };
        }
        if (moduleType === "e32") {
            return {
                frequency: Number(document.getElementById("radioFrequency")?.value || 433),
                power: Number(document.getElementById("radioTxPower")?.value || 30),
                airRate: Number(document.getElementById("radioAirRate")?.value || 2.4),
                uartRate: Number(document.getElementById("radioUartRate")?.value || 9600),
                mode: String(document.getElementById("radioE32Mode")?.value || "TRANSPARENT"),
                fec: Boolean(document.getElementById("radioFec")?.checked),
            };
        }
        return allSettings[moduleType];
    }

    function buildRadioCommand(moduleType, settings) {
        if (moduleType === "cc1101") {
            return `$CMD,RADIO,TYPE=CC1101,FREQ=${Number(settings.frequency).toFixed(3)},POWER=${settings.power},RATE=${settings.rate},MOD=${settings.modulation},BW=${settings.bandwidth},CRC=${settings.crc ? 1 : 0},CCA=${settings.cca ? 1 : 0}`;
        }
        if (moduleType === "e32") {
            return `$CMD,RADIO,TYPE=E32,FREQ=${settings.frequency},POWER=${settings.power},AIR=${settings.airRate},UART=${settings.uartRate},MODE=${settings.mode},FEC=${settings.fec ? 1 : 0}`;
        }
        return "";
    }

    function renderRadioControls(moduleType) {
        const container = document.getElementById("radioControlContainer");
        if (!container) return;
        const profile = radioProfiles[moduleType] || radioProfiles.unknown;
        const allSettings = loadRadioSettings();
        const settings = allSettings[moduleType];

        updateRadioSummary(moduleType);
        if (moduleType === "unknown") {
            container.innerHTML = `<div class="radioEmptyState"><strong>Радиомодуль не выбран</strong><span>Выберите CC1101 или E32-433T30D.</span></div>`;
            return;
        }

        container.innerHTML = `
            ${wiringTable(profile)}
            ${moduleType === "cc1101" ? renderCc1101Controls(settings) : renderE32Controls(settings)}
            <div class="radioActionRow">
                <button type="button" id="radioApplyButton" class="primaryAction">Сохранить / передать в шлюз</button>
                <button type="button" id="radioReadButton" class="commandButton">Запросить состояние шлюза</button>
            </div>
            <div class="radioCommandPreview"><span>Команда</span><code id="radioCommandPreview">---</code></div>
        `;

        function refreshPreview() {
            const current = readCurrentSettings(moduleType, allSettings);
            const preview = document.getElementById("radioCommandPreview");
            if (preview) preview.textContent = buildRadioCommand(moduleType, current);
        }
        container.querySelectorAll("input,select").forEach(control => control.addEventListener("change", refreshPreview));
        refreshPreview();

        document.getElementById("radioTechnopromPreset")?.addEventListener("click", () => {
            const preset = { frequency: 434.000, power: 5, rate: 4.8, modulation: "2FSK", bandwidth: "58", crc: true, cca: true };
            allSettings.cc1101 = preset;
            saveRadioSettings(allSettings);
            renderRadioControls("cc1101");
            writeLog("Выбран профиль CC1101 Технопром 2026", "success", preset);
        });

        document.getElementById("radioApplyButton")?.addEventListener("click", async () => {
            const current = readCurrentSettings(moduleType, allSettings);
            allSettings[moduleType] = current;
            saveRadioSettings(allSettings);
            const command = buildRadioCommand(moduleType, current);
            const preview = document.getElementById("radioCommandPreview");
            if (preview) preview.textContent = command;

            const serialState = window.OpenMCCSerial?.getState?.();
            if (!serialState?.connected) {
                writeLog("RF-настройки сохранены локально; ESP32 пока не подключена", "warning", current);
                return;
            }
            try {
                await window.OpenMCCSerial.writeLine(command);
                writeLog(`RF-настройки переданы в шлюз: ${command}`, "command");
            } catch (error) {
                writeLog(`Не удалось передать RF-настройки: ${error.message}`, "error");
            }
        });

        document.getElementById("radioReadButton")?.addEventListener("click", async () => {
            try {
                await window.OpenMCCSerial?.writeLine?.("$CMD,RADIO_STATUS");
            } catch (error) {
                writeLog(`Не удалось запросить RADIO_STATUS: ${error.message}`, "error");
            }
        });

        addTooltips();
    }

    function initializeRadioUi() {
        const selector = document.getElementById("radioModuleType");
        if (!selector) return;
        let selected = localStorage.getItem(RADIO_MODULE_KEY) || selector.value || "cc1101";
        if (!radioProfiles[selected]) selected = "cc1101";
        selector.value = selected;
        renderRadioControls(selected);
        selector.addEventListener("change", () => {
            localStorage.setItem(RADIO_MODULE_KEY, selector.value);
            renderRadioControls(selector.value);
        });
    }

    function maybeShowFirstRunHelp() {
        if (localStorage.getItem(FIRST_RUN_KEY)) return;
        localStorage.setItem(FIRST_RUN_KEY, "1");
        window.setTimeout(openHelp, 500);
    }

    function initialize() {
        updateBadge();
        initializeNavigation();
        initializeHelpDialog();
        initializeTooltipSystem();
        injectCommandPresets();
        initializeRadioUi();
        addTooltips();
        maybeShowFirstRunHelp();
        writeLog(`Интерфейс подсказок v${VERSION} готов`, "success");
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
