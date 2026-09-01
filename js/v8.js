"use strict";

const ALTAIR_V8 = Object.freeze({
    version: "0.8.0",
    displayVersion: "v8",
    frequencyMHz: 435.000,
    rxBandwidthKHz: 203,
    baudRate: 115200,
});

const V8_RADIO_DEFAULTS = Object.freeze({
    frequencyMHz: 435.000,
    powerDbm: 5,
    bandwidthKHz: 203,
});

const V8_RADIO_POWERS_DBM = Object.freeze([-30, -20, -15, -10, 0, 5, 7, 10]);
const V8_RADIO_BANDWIDTHS_KHZ = Object.freeze([
    58, 68, 81, 102, 116, 135, 162, 203,
    232, 270, 325, 406, 464, 541, 650, 812,
]);

const v8State = {
    packets: 0,
    errors: 0,
    rawLines: [],
    rawLimit: 600,
    idPacketCounts: new Map(),
    radio: { ...V8_RADIO_DEFAULTS },
    connection: {
        device: "не подключено",
        baud: "115200",
        port: "---",
    },
};

function v8Log(message, type = "info") {
    window.OpenMCCLogger?.write?.(message, type, "V8");
}

function loadV8Styles() {
    if (document.getElementById("altairV8Styles")) return;
    const link = document.createElement("link");
    link.id = "altairV8Styles";
    link.rel = "stylesheet";
    link.href = "css/v8.css";
    document.head.appendChild(link);
}

function installBranding() {
    document.title = "ЦУП Альтаир v8 — Миссия на Луну";

    const badge = document.querySelector(".buildBadge");
    if (badge) badge.textContent = "v8 · 0.8.0";

    const mark = document.querySelector(".altairLogo .logoMark");
    if (mark) {
        mark.classList.add("v8LogoMark");
        mark.innerHTML = '<img src="assets/altair-logo.png" alt="Альтаир">';
    }

    let favicon = document.querySelector('link[rel="icon"]');
    if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.appendChild(favicon);
    }
    favicon.href = "assets/altair-logo.png";

    const topActions = document.querySelector(".topActions");
    if (topActions && !document.getElementById("v8AboutButton")) {
        const button = document.createElement("button");
        button.type = "button";
        button.id = "v8AboutButton";
        button.className = "iconButton v8AboutButton";
        button.textContent = "i";
        button.title = "О программе";
        button.setAttribute("aria-label", "О программе");
        topActions.insertBefore(button, topActions.lastElementChild);
    }
}

function installFrequencyMetric() {
    if (document.querySelector(".v8FrequencyMetric")) return;
    const utc = document.querySelector(".topMetric.utc");
    if (!utc) return;

    const block = document.createElement("div");
    block.className = "topMetric v8FrequencyMetric";
    block.innerHTML = `
        <div class="caption">РАДИОКАНАЛ</div>
        <div id="v8FrequencyValue">${ALTAIR_V8.frequencyMHz.toFixed(3)} МГц · BW ${ALTAIR_V8.rxBandwidthKHz} кГц</div>
    `;
    utc.parentNode.insertBefore(block, utc);
}

function connectionSummaryText() {
    return {
        device: v8State.connection.device,
        baud: v8State.connection.baud,
        port: v8State.connection.port,
    };
}

function refreshConnectionSummary() {
    const summary = document.querySelector(".v8ConnectionSummary");
    if (!summary) return;
    const s = connectionSummaryText();
    summary.innerHTML = `
        <span>Устройство: <strong>${s.device}</strong></span>
        <span>Порт: <strong>${s.port}</strong></span>
        <span>Скорость: <strong>${s.baud}</strong></span>
        <span>RF: <strong>${v8State.radio.frequencyMHz.toFixed(3)} МГц · ${v8State.radio.powerDbm} дБм</strong></span>
    `;
}

function installCollapsibleConnection() {
    const panel = document.getElementById("serialPanel");
    const title = panel?.querySelector(".panelTitleRow");
    if (!panel || !title || title.querySelector(".v8PanelToggle")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "v8PanelToggle";
    button.textContent = "Свернуть";
    title.appendChild(button);

    const summary = document.createElement("div");
    summary.className = "v8ConnectionSummary";
    panel.insertBefore(summary, title.nextSibling);
    refreshConnectionSummary();

    button.addEventListener("click", () => {
        const collapsed = panel.classList.toggle("v8-collapsed");
        button.textContent = collapsed ? "Развернуть" : "Свернуть";
    });

    window.addEventListener("openmcc:serial-connected", event => {
        const detail = event.detail || {};
        v8State.connection.device = detail.effectiveProfile?.toUpperCase?.() || detail.portName || "ESP32";
        v8State.connection.port = detail.portName || "USB Serial";
        v8State.connection.baud = String(detail.baudRate || ALTAIR_V8.baudRate);
        refreshConnectionSummary();

        setTimeout(() => {
            panel.classList.add("v8-collapsed");
            button.textContent = "Развернуть";
        }, 700);
    });

    window.addEventListener("openmcc:serial-disconnected", () => {
        v8State.connection.device = "не подключено";
        v8State.connection.port = "---";
        refreshConnectionSummary();
        panel.classList.remove("v8-collapsed");
        button.textContent = "Свернуть";
    });
}

function resetTelemetryCards() {
    document.querySelectorAll("#telemetryPanel [data-telemetry]").forEach(card => {
        const key = card.dataset.telemetry;
        const value = card.querySelector(".value");
        if (!value) return;
        if (key === "ID") value.textContent = "---";
        else if (key === "ANTENNA") value.textContent = "Н/Д";
        else value.textContent = "--";
        card.classList.remove("antenna-open", "antenna-closed");
    });
}

function resetReceivedData() {
    v8State.packets = 0;
    v8State.errors = 0;
    const packetCounter = document.getElementById("packetCounter");
    const errorCounter = document.getElementById("crcCounter");
    if (packetCounter) packetCounter.textContent = "0";
    if (errorCounter) errorCounter.textContent = "0";

    resetTelemetryCards();
    window.OpenMCCCharts?.clear?.();
    window.OpenMCCParser?.reset?.();

    v8State.rawLines.length = 0;
    renderRawConsole();

    v8State.idPacketCounts.clear();
    renderSatelliteIdSummary();

    window.dispatchEvent(new CustomEvent("openmcc:v8-reset"));
    v8Log("Принятые данные, графики и счётчики сброшены.", "success");
}

function installResetButton() {
    const row = document.querySelector("#telemetryPanel .panelTitleRow");
    if (!row || document.getElementById("v8ResetDataButton")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "v8ResetDataButton";
    button.className = "v8ResetButton";
    button.textContent = "Сбросить принятые данные";
    button.title = "Очистить карточки, графики, счётчики и сырой COM-журнал";
    row.appendChild(button);
    button.addEventListener("click", resetReceivedData);
}

function rawClass(line) {
    if (/^TX>/i.test(line)) return "tx";
    if (/\$ERR/i.test(line)) return "err";
    if (/\$INFO|\$ACK/i.test(line)) return "info";
    return "rx";
}

function renderRawConsole() {
    const consoleEl = document.getElementById("rawSerialConsole");
    if (!consoleEl) return;
    consoleEl.innerHTML = v8State.rawLines
        .map(item => `<div class="${rawClass(item.text)}">${item.time} ${escapeHtml(item.text)}</div>`)
        .join("");
    if (document.getElementById("rawSerialAutoscroll")?.checked !== false) {
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function appendRaw(text) {
    const line = String(text ?? "").trim();
    if (!line) return;
    v8State.rawLines.push({
        time: new Date().toLocaleTimeString("ru-RU", { hour12: false }),
        text: line,
    });
    while (v8State.rawLines.length > v8State.rawLimit) v8State.rawLines.shift();
    renderRawConsole();
}

function installRawSerialPanel() {
    if (document.getElementById("rawSerialPanel")) return;
    const chartPanel = document.getElementById("chartPanel");
    const telemetryPanel = document.getElementById("telemetryPanel");
    const anchor = chartPanel || telemetryPanel;
    if (!anchor) return;

    const section = document.createElement("section");
    section.className = "panel wide";
    section.id = "rawSerialPanel";
    section.innerHTML = `
        <div class="panelTitleRow">
            <div>
                <span class="panelEyebrow">RAW COM / DEBUG</span>
                <h2>Сырые данные последовательного порта</h2>
            </div>
            <span class="panelState neutral">ДИАГНОСТИКА</span>
        </div>
        <p class="panelLead">Показывает строки ровно в том виде, в котором они приходят от ESP32, а также команды, отправленные из ЦУПа. Полезно для проверки реальной частоты поступления пакетов.</p>
        <div class="rawToolbar">
            <button type="button" id="rawSerialClear" class="chartToolbarButton">Очистить</button>
            <label><input type="checkbox" id="rawSerialAutoscroll" checked> автопрокрутка</label>
            <span>Буфер: последние ${v8State.rawLimit} строк</span>
        </div>
        <div id="rawSerialConsole" aria-live="polite"></div>
    `;
    anchor.parentNode.insertBefore(section, anchor.nextSibling);

    const nav = document.getElementById("quickNav");
    if (nav && !nav.querySelector('[data-scroll-target="rawSerialPanel"]')) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.scrollTarget = "rawSerialPanel";
        button.textContent = "COM";
        button.addEventListener("click", () => section.scrollIntoView({ behavior: "smooth", block: "start" }));
        nav.appendChild(button);
    }

    document.getElementById("rawSerialClear")?.addEventListener("click", () => {
        v8State.rawLines.length = 0;
        renderRawConsole();
    });

    window.addEventListener("openmcc:raw-line", event => appendRaw(event.detail?.line));
    window.addEventListener("openmcc:serial-write", event => appendRaw(`TX> ${String(event.detail?.text || "").trim()}`));
}


function renderSatelliteIdSummary() {
    const list = document.getElementById("v8SatelliteIdList");
    if (!list) return;

    if (v8State.idPacketCounts.size === 0) {
        list.innerHTML = '<div class="v8IdEmpty">Телеметрия ещё не принята</div>';
        return;
    }

    list.innerHTML = Array.from(v8State.idPacketCounts.entries())
        .map(([id, count]) => {
            const color = window.OpenMCCCharts?.colorForId?.(id) || "#7f9bb6";
            return `
                <div class="v8IdRow" style="--satellite-color:${color}">
                    <span class="v8IdSwatch" aria-hidden="true"></span>
                    <strong>ID ${escapeHtml(id)}</strong>
                    <span>${count.toLocaleString("ru-RU")} пак.</span>
                </div>
            `;
        })
        .join("");
}

function installSatelliteIdSummary() {
    const chartPanel = document.getElementById("chartPanel");
    const chartGrid = chartPanel?.querySelector(".chartGrid");
    if (!chartPanel || !chartGrid || document.getElementById("v8SatelliteIdSummary")) return;

    const layout = document.createElement("div");
    layout.className = "v8ChartsLayout";
    chartGrid.parentNode.insertBefore(layout, chartGrid);
    layout.appendChild(chartGrid);

    const summary = document.createElement("aside");
    summary.id = "v8SatelliteIdSummary";
    summary.className = "v8SatelliteIdSummary";
    summary.setAttribute("aria-label", "Принятые идентификаторы спутников");
    summary.innerHTML = `
        <div class="v8IdSummaryTitle">Принятые аппараты</div>
        <div class="v8IdSummaryCaption">ID и количество пакетов за текущий сеанс</div>
        <div id="v8SatelliteIdList" class="v8SatelliteIdList"></div>
    `;
    layout.appendChild(summary);

    window.addEventListener("openmcc:telemetry", event => {
        const id = String(event.detail?.ID ?? "UNKNOWN").trim() || "UNKNOWN";
        const count = v8State.idPacketCounts.get(id) || 0;
        v8State.idPacketCounts.set(id, count + 1);
        renderSatelliteIdSummary();
    });

    document.getElementById("clearChartsButton")?.addEventListener("click", () => {
        setTimeout(renderSatelliteIdSummary, 0);
    });

    renderSatelliteIdSummary();
}

function markUnavailablePanels() {
    const panels = ["rotatorPanel", "mapPanel"];

    panels.forEach(id => {
        const panel = document.getElementById(id);
        if (!panel) return;

        panel.classList.add("v8UnavailablePanel");
        panel.setAttribute("aria-disabled", "true");
        panel.querySelectorAll("button, input, select, textarea").forEach(control => {
            control.disabled = true;
        });

        const status = panel.querySelector(".panelState, .rotatorStatus");
        if (status) {
            status.textContent = "НЕ РЕАЛИЗОВАНО";
            status.className = "panelState neutral";
        }
    });
}

function getTargetId() {
    const raw = String(document.getElementById("v8CommandTarget")?.value || "ALL").trim().toUpperCase();
    return raw.replace(/[^A-Z0-9_\-]/g, "").slice(0, 16) || "ALL";
}

async function sendRf(name, params = {}) {
    if (!window.OpenMCCSerial?.getState?.().connected) {
        throw new Error("Сначала подключите ESP32 к ЦУПу");
    }

    const fields = [
        "$CMD",
        "RF",
        `TO=${getTargetId()}`,
        `NAME=${String(name).trim().toUpperCase()}`,
    ];

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value) !== "") {
            fields.push(`${String(key).toUpperCase()}=${String(value).replace(/[\r\n,]/g, " ")}`);
        }
    });

    const line = fields.join(",");
    await window.OpenMCCSerial.writeLine(line);

    const last = document.getElementById("lastCommandText");
    if (last) last.textContent = line;
    v8Log(`RF-команда передана шлюзу: ${line}`, "command");
    return line;
}

function setRadioSettingsStatus(text, state = "neutral") {
    const status = document.getElementById("v8RadioSettingsStatus");
    if (!status) return;
    status.textContent = text;
    status.className = `v8RadioSettingsStatus ${state}`;
}

function parseRadioProfile(payload) {
    const values = {};
    String(payload ?? "").split(",").forEach(field => {
        const index = field.indexOf("=");
        if (index < 1) return;
        values[field.slice(0, index).trim().toUpperCase()] = field.slice(index + 1).trim();
    });

    const frequencyMHz = Number(values.FREQ);
    const powerDbm = Number(values.POWER);
    const bandwidthKHz = Number(values.BW);

    if (
        !Number.isFinite(frequencyMHz) ||
        !V8_RADIO_POWERS_DBM.includes(powerDbm) ||
        !V8_RADIO_BANDWIDTHS_KHZ.includes(bandwidthKHz)
    ) {
        return null;
    }

    return { frequencyMHz, powerDbm, bandwidthKHz };
}

function renderRadioProfile(profile) {
    if (!profile) return;
    v8State.radio = { ...profile };

    const frequency = document.getElementById("v8RadioFrequency");
    const power = document.getElementById("v8RadioPower");
    const bandwidth = document.getElementById("v8RadioBandwidth");
    if (frequency) frequency.value = profile.frequencyMHz.toFixed(3);
    if (power) power.value = String(profile.powerDbm);
    if (bandwidth) bandwidth.value = String(profile.bandwidthKHz);

    const metric = document.getElementById("v8FrequencyValue");
    if (metric) {
        metric.textContent = `${profile.frequencyMHz.toFixed(3)} МГц · BW ${profile.bandwidthKHz} кГц`;
    }

    const aboutFrequency = document.getElementById("v8AboutFrequency");
    const aboutPower = document.getElementById("v8AboutPower");
    const aboutBandwidth = document.getElementById("v8AboutBandwidth");
    if (aboutFrequency) aboutFrequency.textContent = `${profile.frequencyMHz.toFixed(3)} МГц`;
    if (aboutPower) aboutPower.textContent = `${profile.powerDbm} дБм`;
    if (aboutBandwidth) aboutBandwidth.textContent = `${profile.bandwidthKHz} кГц`;

    refreshConnectionSummary();
}

async function sendGatewayLine(line) {
    if (!window.OpenMCCSerial?.getState?.().connected) {
        throw new Error("Сначала подключите ESP32 к ЦУПу");
    }

    await window.OpenMCCSerial.writeLine(line);
    const last = document.getElementById("lastCommandText");
    if (last) last.textContent = line;
    v8Log(`Команда радиошлюзу: ${line}`, "command");
    return line;
}

function installRadioSettings(panel, protocolNote) {
    if (!panel || document.getElementById("v8RadioSettings")) return;

    const group = document.createElement("div");
    group.id = "v8RadioSettings";
    group.className = "commandGroup v8RadioSettings";
    group.innerHTML = `
        <div class="v8RadioSettingsTitleRow">
            <div>
                <div class="commandGroupTitle">Рабочие параметры радиоканала</div>
                <div class="v8RadioSettingsCaption">Настройки наземного CC1101 для приёма телеметрии и передачи команд</div>
            </div>
            <span id="v8RadioSettingsStatus" class="v8RadioSettingsStatus neutral">НЕ ПОДКЛЮЧЕНО</span>
        </div>

        <div class="v8RadioSettingsGrid">
            <label class="v8RadioSettingField">
                <span>Частота, МГц</span>
                <input class="v8RadioControl" id="v8RadioFrequency" type="number" min="387" max="464" step="0.001" value="435.000" inputmode="decimal">
                <small>Допустимо: 387–464 МГц</small>
            </label>

            <label class="v8RadioSettingField">
                <span>Мощность TX, дБм</span>
                <select class="v8RadioControl" id="v8RadioPower">
                    ${V8_RADIO_POWERS_DBM.map(value => `<option value="${value}"${value === V8_RADIO_DEFAULTS.powerDbm ? " selected" : ""}>${value} дБм</option>`).join("")}
                </select>
                <small>Уровень мощности передаваемых команд</small>
            </label>

            <label class="v8RadioSettingField">
                <span>Полоса RX, кГц</span>
                <select class="v8RadioControl" id="v8RadioBandwidth">
                    ${V8_RADIO_BANDWIDTHS_KHZ.map(value => `<option value="${value}"${value === V8_RADIO_DEFAULTS.bandwidthKHz ? " selected" : ""}>${value} кГц</option>`).join("")}
                </select>
                <small>Полоса приёмника телеметрии</small>
            </label>
        </div>

        <div class="v8RadioSettingsActions">
            <button type="button" id="v8ApplyRadioSettings" class="commandButton commandPrimary v8RadioControl">Применить настройки</button>
            <button type="button" id="v8ResetRadioSettings" class="commandButton v8RadioControl">Сбросить к исходным</button>
        </div>

        <div class="v8RadioSettingsWarning">
            После изменения частоты бортовой передатчик должен быть настроен на ту же частоту. Исходный профиль: <strong>435,000 МГц · 5 дБм · 203 кГц</strong>.
        </div>
    `;

    if (protocolNote?.parentNode === panel) panel.insertBefore(group, protocolNote);
    else panel.appendChild(group);
    renderRadioProfile(v8State.radio);

    const frequency = document.getElementById("v8RadioFrequency");
    const power = document.getElementById("v8RadioPower");
    const bandwidth = document.getElementById("v8RadioBandwidth");
    const apply = document.getElementById("v8ApplyRadioSettings");
    const reset = document.getElementById("v8ResetRadioSettings");

    apply?.addEventListener("click", async () => {
        const profile = {
            frequencyMHz: Number(frequency?.value),
            powerDbm: Number(power?.value),
            bandwidthKHz: Number(bandwidth?.value),
        };

        if (
            !Number.isFinite(profile.frequencyMHz) ||
            profile.frequencyMHz < 387 ||
            profile.frequencyMHz > 464 ||
            !V8_RADIO_POWERS_DBM.includes(profile.powerDbm) ||
            !V8_RADIO_BANDWIDTHS_KHZ.includes(profile.bandwidthKHz)
        ) {
            setRadioSettingsStatus("ОШИБКА ЗНАЧЕНИЙ", "error");
            v8Log("Некорректные параметры радиоканала", "error");
            return;
        }

        setRadioSettingsStatus("ПРИМЕНЕНИЕ...", "pending");
        try {
            await sendGatewayLine(
                `$CMD,RADIO,SET,FREQ=${profile.frequencyMHz.toFixed(3)},POWER=${profile.powerDbm},BW=${profile.bandwidthKHz}`
            );
        } catch (error) {
            setRadioSettingsStatus("ОШИБКА ПЕРЕДАЧИ", "error");
            v8Log(error.message, "error");
        }
    });

    reset?.addEventListener("click", async () => {
        setRadioSettingsStatus("СБРОС...", "pending");
        try {
            await sendGatewayLine("$CMD,RADIO,RESET");
        } catch (error) {
            setRadioSettingsStatus("ОШИБКА ПЕРЕДАЧИ", "error");
            v8Log(error.message, "error");
        }
    });

    window.addEventListener("openmcc:device-info", event => {
        const payload = String(event.detail?.payload || "");
        if (!/^RADIO(?:_READY)?,/i.test(payload)) return;
        const profile = parseRadioProfile(payload);
        if (!profile) return;
        renderRadioProfile(profile);
        setRadioSettingsStatus("ПРОФИЛЬ ПОЛУЧЕН", "online");
    });

    window.addEventListener("openmcc:device-ack", event => {
        const payload = String(event.detail?.payload || "");
        if (!/^RADIO_CONFIG_(?:APPLIED|RESET),/i.test(payload)) return;
        const profile = parseRadioProfile(payload);
        if (profile) renderRadioProfile(profile);
        setRadioSettingsStatus(
            /^RADIO_CONFIG_RESET,/i.test(payload) ? "ИСХОДНЫЙ ПРОФИЛЬ" : "ПРИМЕНЕНО",
            "online"
        );
    });

    window.addEventListener("openmcc:device-error", event => {
        const payload = String(event.detail?.payload || "");
        if (!/RADIO_CONFIG|RF_RX_RESTART/i.test(payload)) return;
        setRadioSettingsStatus("ОШИБКА ESP32", "error");
    });

    window.addEventListener("openmcc:serial-connected", () => {
        setRadioSettingsStatus("ЗАПРОС ПРОФИЛЯ...", "pending");
        setTimeout(() => {
            sendGatewayLine("$CMD,RADIO_STATUS").catch(error => {
                setRadioSettingsStatus("НЕТ ОТВЕТА", "error");
                v8Log(error.message, "error");
            });
        }, 120);
    });

    window.addEventListener("openmcc:serial-disconnected", () => {
        setRadioSettingsStatus("НЕ ПОДКЛЮЧЕНО", "neutral");
    });
}

function installCommandTransmission() {
    const panel = document.getElementById("commandPanel");
    if (!panel || panel.dataset.v8tx === "1") return;
    panel.dataset.v8tx = "1";

    const firstGroup = panel.querySelector(".commandGroup");
    if (firstGroup) {
        const target = document.createElement("div");
        target.className = "v8CommandTarget";
        target.innerHTML = `
            <strong>Адресат команды</strong>
            <input id="v8CommandTarget" value="ALL" maxlength="16" spellcheck="false" aria-label="ID спутника">
        `;
        firstGroup.parentNode.insertBefore(target, firstGroup);
    }

    const note = document.createElement("div");
    note.className = "v8ProtocolNote";
    note.innerHTML = 'ЦУП передаёт в ESP32 <code>$CMD,RF,TO=&lt;ID&gt;,NAME=&lt;КОМАНДА&gt;</code>. Шлюз отправляет в эфир <code>$CMD,TO=&lt;ID&gt;,NAME=&lt;КОМАНДА&gt;</code>. <strong>ALL</strong> — широковещательный адрес.';
    panel.appendChild(note);

    const commandMap = {
        PING: ["PING", {}],
        INFO: ["INFO", {}],
        START: ["TM_START", {}],
        STOP: ["TM_STOP", {}],
    };

    panel.querySelectorAll("[data-command]").forEach(oldButton => {
        const button = oldButton.cloneNode(true);
        oldButton.replaceWith(button);
        button.addEventListener("click", async () => {
            try {
                const [name, params] = commandMap[button.dataset.command] || [button.dataset.command, {}];
                await sendRf(name, params);
            } catch (error) {
                v8Log(error.message, "error");
            }
        });
    });

    const oldRate = document.getElementById("applyTelemetryRate");
    if (oldRate) {
        const button = oldRate.cloneNode(true);
        oldRate.replaceWith(button);
        button.addEventListener("click", async () => {
            try {
                await sendRf("TM_PERIOD", { MS: document.getElementById("telemetryRate")?.value || 1000 });
            } catch (error) {
                v8Log(error.message, "error");
            }
        });
    }

    // Заменяем поле ввода, чтобы удалить старый обработчик,
    // который отправлял команду без обязательного префикса RF.
    const oldCustomInput = document.getElementById("customCommand");
    const customInput = oldCustomInput?.cloneNode(true) || null;
    if (oldCustomInput && customInput) oldCustomInput.replaceWith(customInput);

    const oldCustomButton = document.getElementById("sendCustomCommand");
    const customButton = oldCustomButton?.cloneNode(true) || null;
    if (oldCustomButton && customButton) oldCustomButton.replaceWith(customButton);

    const transmitCustomCommand = async () => {
        const text = String(customInput?.value || "").trim();
        if (!text) return;

        try {
            await sendRf("USER", { DATA: text });
            customInput.value = "";
        } catch (error) {
            v8Log(error.message, "error");
        }
    };

    customButton?.addEventListener("click", transmitCustomCommand);
    customInput?.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        transmitCustomCommand();
    });

    installRadioSettings(panel, note);

    const availability = document.getElementById("commandAvailability");
    const refresh = () => {
        const connected = Boolean(window.OpenMCCSerial?.getState?.().connected);

        if (availability) {
            availability.textContent = connected ? "ГОТОВ К ПЕРЕДАЧЕ" : "НЕДОСТУПЕН";
            availability.classList.toggle("offline", !connected);
            availability.classList.toggle("online", connected);
        }

        // ui.js хранит ссылки на исходные кнопки, а v8 заменяет их копиями.
        // Поэтому состояние фактически видимых элементов обновляется здесь.
        const controls = [
            ...panel.querySelectorAll("[data-command]"),
            document.getElementById("telemetryRate"),
            document.getElementById("applyTelemetryRate"),
            document.getElementById("customCommand"),
            document.getElementById("sendCustomCommand"),
            document.getElementById("v8CommandTarget"),
            ...panel.querySelectorAll(".v8RadioControl"),
        ].filter(Boolean);

        controls.forEach(control => {
            control.disabled = !connected;
        });
    };
    window.addEventListener("openmcc:serial-connected", refresh);
    window.addEventListener("openmcc:serial-disconnected", refresh);
    refresh();
}

function installAboutDialog() {
    if (document.getElementById("v8AboutDialog")) return;

    const dialog = document.createElement("div");
    dialog.id = "v8AboutDialog";
    dialog.innerHTML = `
        <div class="aboutCard" role="dialog" aria-modal="true" aria-labelledby="v8AboutTitle">
            <div class="aboutHeader">
                <img src="assets/altair-logo.png" alt="Логотип Альтаира">
                <div>
                    <h2 id="v8AboutTitle">ЦУП Альтаир</h2>
                    <div class="aboutSubtitle">Учебный центр управления полётами</div>
                </div>
                <button type="button" class="closeAbout" title="Закрыть" aria-label="Закрыть">×</button>
            </div>

            <div class="aboutMetaGrid">
                <div><span>Версия</span><strong>v8 · 0.8.0</strong></div>
                <div><span>Автор</span><strong>Антон Т.</strong></div>
            </div>

            <section class="aboutSection">
                <h3>Назначение</h3>
                <p>Программа предназначена для приёма и отображения телеметрии учебных космических аппаратов, анализа параметров радиолинии и передачи команд управления через радиошлюз ESP32 + CC1101.</p>
            </section>

            <section class="aboutSection">
                <h3>Основные функции</h3>
                <ul>
                    <li>приём телеметрии нескольких аппаратов с разделением по ID;</li>
                    <li>построение графиков и отображение RSSI, SNR и LQI;</li>
                    <li>просмотр исходных строк последовательного порта;</li>
                    <li>передача адресных и широковещательных команд по радиоканалу.</li>
                    <li>изменение частоты, мощности TX и полосы RX наземного CC1101.</li>
                </ul>
            </section>

            <section class="aboutSection">
                <h3>Рабочий радиопрофиль</h3>
                <div class="aboutSpecGrid">
                    <div><span>Частота</span><strong id="v8AboutFrequency">435.000 МГц</strong></div>
                    <div><span>Мощность TX</span><strong id="v8AboutPower">5 дБм</strong></div>
                    <div><span>Модуляция</span><strong>2-FSK</strong></div>
                    <div><span>Скорость</span><strong>4,8 кбит/с</strong></div>
                    <div><span>Полоса RX</span><strong id="v8AboutBandwidth">203 кГц</strong></div>
                    <div><span>Интерфейс USB</span><strong>115200 бод</strong></div>
                    <div><span>Аппаратный CRC</span><strong>включён</strong></div>
                </div>
            </section>

            <div class="aboutFootnote">Проект разработан для образовательной программы «Миссия на Луну» и профильной смены по спутникостроению на Технопроме-2026.</div>
        </div>
    `;
    document.body.appendChild(dialog);
    renderRadioProfile(v8State.radio);

    const close = () => dialog.classList.remove("open");
    document.getElementById("v8AboutButton")?.addEventListener("click", () => dialog.classList.add("open"));
    dialog.querySelector(".closeAbout")?.addEventListener("click", close);
    dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
}

function patchTelemetryPresentation() {
    const checksumCard = document.querySelector('[data-telemetry="CHECKSUM"]');
    if (checksumCard) {
        const label = checksumCard.querySelector(".label");
        const unit = checksumCard.querySelector(".unit");
        if (label) label.textContent = "Контрольная сумма (поле)";
        if (unit) unit.textContent = "принимается без проверки";
    }

    const antenna = document.getElementById("ANTENNA");
    if (antenna && (!antenna.textContent || /^-+$/.test(antenna.textContent.trim()))) {
        antenna.textContent = "Н/Д";
    }

    const note = document.querySelector(".altairPacketNote");
    if (note) {
        const strong = note.querySelector("strong");
        const code = note.querySelector("code");
        const span = note.querySelector("span");
        if (strong) strong.textContent = "Пакет v8:";
        if (code) code.textContent = "02,00001,00015,3.00,4.20,1,33";
        if (span) span.textContent = "Последнее поле сохраняется, но прикладная XOR-проверка отключена. Можно менять ID и значения без пересчёта XOR. Опционально перед CHECKSUM можно добавить ANTENNA (0/1). RSSI и SNR добавляются наземным шлюзом.";
    }

    const radioLead = document.querySelector("#radioPanel .panelLead");
    if (radioLead) {
        radioLead.innerHTML = 'Рабочий профиль v8: <strong>435.000 МГц · 4.8 kbps · 2-FSK · Δf 5 кГц · RX BW 203 кГц · RF TX включён</strong>.';
    }

    const projectEyebrow = document.querySelector("#projectPanel .panelEyebrow");
    if (projectEyebrow) projectEyebrow.textContent = "RELEASE V8";
}

function installV8Counters() {
    window.addEventListener("openmcc:telemetry", event => {
        v8State.packets += 1;
        const el = document.getElementById("packetCounter");
        if (el) el.textContent = v8State.packets.toLocaleString("ru-RU");

        const t = event.detail || {};
        if (Object.hasOwn(t, "CHECKSUM")) {
            const checksum = document.getElementById("CHECKSUM");
            if (checksum) checksum.textContent = `${String(t.CHECKSUM).toUpperCase()} · БЕЗ ПРОВЕРКИ`;
        }
        if (!Object.hasOwn(t, "ANTENNA")) {
            const antenna = document.getElementById("ANTENNA");
            if (antenna) antenna.textContent = "Н/Д";
        }
    });

    const countError = () => {
        v8State.errors += 1;
        const el = document.getElementById("crcCounter");
        if (el) el.textContent = v8State.errors.toLocaleString("ru-RU");
    };
    window.addEventListener("openmcc:telemetry-error", countError);
    window.addEventListener("openmcc:device-error", countError);
}

function initializeV8() {
    loadV8Styles();
    installBranding();
    installFrequencyMetric();
    installCollapsibleConnection();
    installResetButton();
    installRawSerialPanel();
    installSatelliteIdSummary();
    installCommandTransmission();
    installAboutDialog();
    patchTelemetryPresentation();
    markUnavailablePanels();
    installV8Counters();

    v8Log("ЦУП Альтаир v8 готов: 435.000 МГц, BW 203 кГц, multi-ID графики, RF TX, raw COM.", "success");
}

const v8Start = () => setTimeout(initializeV8, 300);
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", v8Start, { once: true });
} else {
    v8Start();
}
