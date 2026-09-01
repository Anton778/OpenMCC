"use strict";

/* ============================================================
   ЦУП Альтаир — application coordinator
   Release v8 / 0.8.0
   ============================================================ */

(() => {
    const APP_CONFIG = Object.freeze({
        name: "ЦУП Альтаир",
        fullName: "Центр управления полётами",
        version: "0.8.0",
        missionName: "Миссия на Луну",
        baudRate: 115200,
        telemetryTimeoutMs: 3500,
        demoUpdatePeriodMs: 1000,
    });

    const state = {
        initialized: false,
        connected: false,
        demoMode: false,
        telemetryActive: false,
        packetCount: 0,
        errorCount: 0,
        lastTelemetryTime: 0,
        clockTimer: null,
        watchdogTimer: null,
        demoTimer: null,
    };

    const elements = { telemetry: {} };
    const TELEMETRY_FIELDS = Object.freeze([
        "ID", "PACKET", "UPTIME", "PANEL_POWER", "VOLT", "MODE", "CHECKSUM", "ANTENNA", "RSSI", "SNR",
    ]);

    function writeLog(message, type = "info", metadata = null) {
        if (window.OpenMCCLogger?.write) window.OpenMCCLogger.write(message, type, "APP", metadata);
        else console.log(`[ЦУП Альтаир] ${message}`, metadata || "");
    }

    function ensureTelemetryLayout() {
        const grid = document.querySelector("#telemetryPanel .altairTelemetryGrid");
        if (!grid) return;

        const tempCard = grid.querySelector('[data-telemetry="TEMP"]');
        if (tempCard) {
            tempCard.dataset.telemetry = "MODE";
            tempCard.classList.add("telemetryMode");
            const label = tempCard.querySelector(".label");
            const value = tempCard.querySelector(".value");
            const unit = tempCard.querySelector(".unit");
            if (label) label.textContent = "Режим работы спутника";
            if (value) {
                value.id = "MODE";
                value.textContent = "--";
                value.classList.add("telemetryTextValue");
            }
            if (unit) unit.textContent = "1 — штатный · 0 — аварийный";
        }

        if (!document.getElementById("CHECKSUM")) {
            const card = document.createElement("div");
            card.className = "card telemetryCard telemetryChecksum";
            card.dataset.telemetry = "CHECKSUM";
            card.dataset.tip = "Поле контрольной суммы принимается и отображается. В v8 прикладная XOR-проверка отключена.";
            card.innerHTML = '<span class="label">Контрольная сумма (поле)</span><span id="CHECKSUM" class="value telemetryTextValue">--</span><span class="unit">принимается без проверки</span>';
            const rssiCard = grid.querySelector('[data-telemetry="RSSI"]');
            if (rssiCard) grid.insertBefore(card, rssiCard);
            else grid.appendChild(card);
        }

        if (!document.getElementById("ANTENNA")) {
            const card = document.createElement("div");
            card.className = "card telemetryCard telemetryAntenna antenna-unknown";
            card.dataset.telemetry = "ANTENNA";
            card.dataset.tip = "Опциональное поле: 1 — антенна раскрыта, 0 — сложена. Если поле отсутствует, отображается Н/Д.";
            card.innerHTML = '<span class="label">Раскрытие антенны</span><span id="ANTENNA" class="value telemetryTextValue">Н/Д</span><span class="unit">1 — раскрыта · 0 — сложена</span>';
            grid.appendChild(card);
        }

        const note = document.querySelector(".altairPacketNote");
        if (note) {
            const strong = note.querySelector("strong");
            const code = note.querySelector("code");
            const span = note.querySelector("span");
            if (strong) strong.textContent = "Пакет v8:";
            if (code) code.textContent = "02,00001,00015,3.00,4.20,1,33";
            if (span) span.textContent = "Порядок: ID, PACKET, UPTIME, PANEL_POWER, VOLT, MODE, CHECKSUM. Опционально перед CHECKSUM добавляется ANTENNA. Поле CHECKSUM не валидируется; RSSI/SNR добавляет наземный CC1101-шлюз.";
        }

        document.querySelectorAll("#chartPanel .chartCard").forEach(card => {
            if (card.querySelector("#chartTEMP")) card.remove();
        });
    }

    const telemetryFormatters = Object.freeze({
        ID: value => String(value ?? "---").padStart(2, "0"),
        PACKET: value => Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))).padStart(5, "0") : "--",
        UPTIME: value => Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))).padStart(5, "0") : "--",
        PANEL_POWER: value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "--",
        VOLT: value => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "--",
        MODE(value) {
            const numeric = Number(value);
            return numeric === 1 ? "1 · ШТАТНЫЙ" : numeric === 0 ? "0 · АВАРИЙНЫЙ" : "--";
        },
        CHECKSUM(value) {
            return String(value ?? "--").toUpperCase();
        },
        ANTENNA(value) {
            const numeric = Number(value);
            return numeric === 1 ? "1 · РАСКРЫТА" : numeric === 0 ? "0 · СЛОЖЕНА" : "Н/Д";
        },
        RSSI: value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "--",
        SNR: value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "--",
    });

    function cacheElements() {
        elements.missionName = document.getElementById("missionName");
        elements.utcClock = document.getElementById("utcClock");
        elements.connectionState = document.getElementById("connectionState");
        elements.connectButton = document.getElementById("connectButton");
        elements.serialPort = document.getElementById("serialPort");
        elements.baudRate = document.getElementById("baudRate");
        elements.packetCounter = document.getElementById("packetCounter");
        elements.crcCounter = document.getElementById("crcCounter");
        elements.telemetryStatus = document.querySelector("#systemPanel li:nth-child(4) span");
        elements.portStatus = document.querySelector("#systemPanel li:nth-child(2) span");
        elements.gatewayStatus = document.querySelector("#systemPanel li:nth-child(3) span");
        TELEMETRY_FIELDS.forEach(key => {
            elements.telemetry[key] = document.getElementById(key);
        });
    }

    function setIndicator(element, status) {
        if (!element) return;
        element.classList.remove("ok", "warn", "error");
        element.classList.add(status === "ok" ? "ok" : status === "error" ? "error" : "warn");
        element.textContent = status === "ok" || status === "error" ? "●" : "○";
    }

    function updateUtcClock() {
        if (!elements.utcClock) return;
        const now = new Date();
        elements.utcClock.textContent = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
            .map(value => String(value).padStart(2, "0"))
            .join(":");
    }

    function setConnectionState(connected, label = connected ? "ONLINE" : "OFFLINE") {
        state.connected = Boolean(connected);
        if (elements.connectionState) {
            elements.connectionState.innerHTML = `<span class="${connected ? "onlineLed" : "offlineLed"}"></span><span>${label}</span>`;
        }
        if (elements.connectButton) {
            elements.connectButton.textContent = connected ? "Отключить устройство" : "Подключить устройство";
            elements.connectButton.classList.toggle("connected", connected);
        }
        setIndicator(elements.portStatus, connected ? "ok" : "warn");
        if (!connected) setIndicator(elements.gatewayStatus, "warn");
    }

    function setTelemetryStatus(status) {
        state.telemetryActive = status === "active";
        setIndicator(elements.telemetryStatus, status === "active" ? "ok" : status === "error" ? "error" : "warn");
    }

    function incrementErrorCounter(message = null, metadata = null) {
        state.errorCount += 1;
        if (elements.crcCounter) elements.crcCounter.textContent = state.errorCount.toLocaleString("ru-RU");
        if (message) writeLog(message, "warning", metadata);
    }

    function updateCardAppearance(key, target, value) {
        const card = target?.closest?.(".telemetryCard");
        if (!card) return;
        if (key === "MODE") {
            card.classList.toggle("antenna-open", Number(value) === 1);
            card.classList.toggle("antenna-closed", Number(value) === 0);
        }
        if (key === "ANTENNA") {
            card.classList.toggle("antenna-open", Number(value) === 1);
            card.classList.toggle("antenna-closed", Number(value) === 0);
            card.classList.toggle("antenna-unknown", ![0, 1].includes(Number(value)));
        }
    }

    function updateTelemetryValue(key, value) {
        const target = elements.telemetry[key];
        if (!target) return;
        target.textContent = telemetryFormatters[key] ? telemetryFormatters[key](value) : String(value ?? "--");
        updateCardAppearance(key, target, value);
        target.classList.remove("telemetry-updated");
        void target.offsetWidth;
        target.classList.add("telemetry-updated");
    }

    function processTelemetry(telemetry) {
        if (!telemetry || typeof telemetry !== "object") return;
        let displayed = 0;
        TELEMETRY_FIELDS.forEach(key => {
            if (Object.hasOwn(telemetry, key)) {
                updateTelemetryValue(key, telemetry[key]);
                displayed += 1;
            }
        });
        if (!displayed) return;

        if (Object.hasOwn(telemetry, "CHECKSUM") && elements.telemetry.CHECKSUM) {
            elements.telemetry.CHECKSUM.textContent = `${String(telemetry.CHECKSUM).toUpperCase()} · БЕЗ ПРОВЕРКИ`;
        }
        if (!Object.hasOwn(telemetry, "ANTENNA") && elements.telemetry.ANTENNA) {
            elements.telemetry.ANTENNA.textContent = "Н/Д";
        }

        state.packetCount += 1;
        state.lastTelemetryTime = Date.now();
        if (elements.packetCounter) elements.packetCounter.textContent = state.packetCount.toLocaleString("ru-RU");
        setTelemetryStatus("active");
        if (Object.hasOwn(telemetry, "RSSI") || Object.hasOwn(telemetry, "LQI")) {
            setIndicator(elements.gatewayStatus, "ok");
        }
    }

    function createDemoTelemetry() {
        return {
            ID: "02",
            PACKET: 1,
            UPTIME: 15,
            PANEL_POWER: 3.00,
            VOLT: 4.20,
            MODE: 1,
            CHECKSUM: "33",
            CHECKSUM_BYPASS: 1,
            ANTENNA: 1,
            RSSI: -76.0,
            SNR: 16.0,
        };
    }

    function startDemoMode() {
        if (state.demoMode) return;
        state.demoMode = true;
        setConnectionState(true, "DEMO");
        if (elements.serialPort) elements.serialPort.textContent = "Симулятор v8";
        processTelemetry(createDemoTelemetry());
        state.demoTimer = setInterval(() => processTelemetry(createDemoTelemetry()), APP_CONFIG.demoUpdatePeriodMs);
        writeLog("Включён демонстрационный режим телеметрии v8", "success");
    }

    function stopDemoMode() {
        if (!state.demoMode) return;
        state.demoMode = false;
        clearInterval(state.demoTimer);
        state.demoTimer = null;
        setConnectionState(false);
        if (elements.serialPort) elements.serialPort.textContent = "---";
        setTelemetryStatus("waiting");
    }

    async function handleConnectButtonClick() {
        if (state.demoMode) {
            stopDemoMode();
            return;
        }
        if (window.OpenMCCSerial?.toggleConnection) {
            try {
                await window.OpenMCCSerial.toggleConnection();
            } catch (error) {
                writeLog(`Ошибка соединения: ${error.message}`, "error");
                setConnectionState(false);
            }
        } else {
            startDemoMode();
        }
    }

    function registerEvents() {
        elements.connectButton?.addEventListener("click", handleConnectButtonClick);

        window.addEventListener("openmcc:serial-connected", event => {
            state.demoMode = false;
            const detail = event.detail || {};
            setConnectionState(true, "ONLINE");
            if (elements.serialPort) elements.serialPort.textContent = detail.portName || "USB Serial";
            if (elements.baudRate && detail.baudRate) elements.baudRate.textContent = String(detail.baudRate);
            setTelemetryStatus("waiting");
        });

        window.addEventListener("openmcc:serial-disconnected", () => {
            setConnectionState(false);
            if (elements.serialPort) elements.serialPort.textContent = "---";
            setTelemetryStatus("waiting");
            state.lastTelemetryTime = 0;
        });

        window.addEventListener("openmcc:telemetry", event => processTelemetry(event.detail));

        window.addEventListener("openmcc:telemetry-error", event => {
            incrementErrorCounter(event.detail?.message || "Ошибка телеметрии", event.detail);
            setTelemetryStatus("error");
        });

        window.addEventListener("openmcc:device-error", event => {
            const payload = String(event.detail?.payload || event.detail?.line || "Ошибка устройства");
            incrementErrorCounter(payload, event.detail);
            if (/RADIO_RX_CRC/i.test(payload)) setTelemetryStatus("error");
        });

        window.addEventListener("openmcc:device-info", event => {
            if (/GATEWAY|RADIO_READY|RADIO,TYPE=/i.test(String(event.detail?.payload || ""))) {
                setIndicator(elements.gatewayStatus, "ok");
            }
        });

        window.addEventListener("openmcc:v8-reset", () => {
            state.packetCount = 0;
            state.errorCount = 0;
            state.lastTelemetryTime = 0;
            setTelemetryStatus("waiting");
        });
    }

    function initialize() {
        if (state.initialized) return;
        ensureTelemetryLayout();
        cacheElements();
        if (elements.missionName) elements.missionName.textContent = APP_CONFIG.missionName;
        updateUtcClock();
        state.clockTimer = setInterval(updateUtcClock, 250);
        state.watchdogTimer = setInterval(() => {
            if (state.connected && state.lastTelemetryTime && state.telemetryActive && Date.now() - state.lastTelemetryTime > APP_CONFIG.telemetryTimeoutMs) {
                setTelemetryStatus("lost");
            }
        }, 500);
        registerEvents();
        setConnectionState(Boolean(window.OpenMCCSerial?.getState?.().connected));
        setTelemetryStatus("waiting");
        state.initialized = true;
        writeLog("ЦУП Альтаир v0.8.0 готов. Радиопрофиль 435.000 МГц, RX BW 203 кГц.", "success");
    }

    window.OpenMCCApp = Object.freeze({
        config: APP_CONFIG,
        processTelemetry,
        startDemoMode,
        stopDemoMode,
        getState: () => ({ ...state }),
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
