"use strict";

/* ============================================================
   ЦУП Альтаир — application coordinator
   Release v5 / 0.5.0
   ============================================================ */

(() => {
    const APP_CONFIG = Object.freeze({
        name: "ЦУП Альтаир",
        fullName: "Центр управления полётами",
        version: "0.5.0",
        missionName: "Миссия на Луну",
        baudRate: 115200,
        clockUpdatePeriodMs: 250,
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

    const elements = {};

    const TELEMETRY_FIELDS = Object.freeze([
        "ID",
        "VOLT",
        "PANEL_POWER",
        "PACKET",
        "UPTIME",
        "ANTENNA",
        "TEMP",
        "RSSI",
        "SNR",
    ]);

    const telemetryFormatters = Object.freeze({
        ID(value) {
            return String(value ?? "---");
        },
        VOLT(value) {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric.toFixed(2) : "--";
        },
        PANEL_POWER(value) {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric.toFixed(3) : "--";
        },
        PACKET(value) {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)).toLocaleString("ru-RU") : "--";
        },
        UPTIME(value) {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)).toLocaleString("ru-RU") : "--";
        },
        ANTENNA(value) {
            const numeric = Number(value);
            if (numeric === 1) return "1 · РАСКРЫТА";
            if (numeric === 0) return "0 · СЛОЖЕНА";
            return "--";
        },
        TEMP(value) {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric.toFixed(1) : "--";
        },
        RSSI(value) {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric.toFixed(1) : "--";
        },
        SNR(value) {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric.toFixed(1) : "--";
        },
    });

    function writeLog(message, type = "info", metadata = null) {
        if (window.OpenMCCLogger?.write) {
            window.OpenMCCLogger.write(message, type, "APP", metadata);
            return;
        }
        console.log(`[ЦУП Альтаир] ${message}`, metadata || "");
    }

    function ensureAntennaTelemetryCard() {
        const grid = document.querySelector("#telemetryPanel .altairTelemetryGrid");
        if (!grid || document.getElementById("ANTENNA")) return;

        const card = document.createElement("div");
        card.className = "card telemetryCard telemetryAntenna";
        card.dataset.telemetry = "ANTENNA";
        card.dataset.tip = "Состояние раскрытия бортовой рулеточной антенны: 1 — раскрыта, 0 — сложена.";
        card.innerHTML = `
            <span class="label">Раскрытие антенны</span>
            <span id="ANTENNA" class="value telemetryTextValue">--</span>
            <span class="unit">1 — раскрыта · 0 — сложена</span>`;

        const temperatureCard = grid.querySelector('[data-telemetry="TEMP"]');
        if (temperatureCard) grid.insertBefore(card, temperatureCard);
        else grid.appendChild(card);

        const packetCode = document.querySelector(".altairPacketNote code");
        if (packetCode) {
            packetCode.textContent = "$TM,ID=<ID>,PACKET=<N>,UPTIME=<s>,VOLT=<V>,PANEL_POWER=<W>,TEMP=<°C>,ANTENNA=<0|1>";
        }

        const packetText = document.querySelector(".altairPacketNote span");
        if (packetText) {
            packetText.textContent = "ANTENNA: 1 — антенна раскрыта, 0 — сложена. RSSI и оценка SNR добавляются наземным CC1101-приёмником. Позиционный $TM и формат $TEL,KEY=VALUE,... также поддерживаются.";
        }
    }

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
        elements.telemetry = {};
        TELEMETRY_FIELDS.forEach(key => {
            elements.telemetry[key] = document.getElementById(key);
        });
    }

    function setIndicator(element, status) {
        if (!element) return;
        element.classList.remove("ok", "warn", "error");
        if (status === "ok") {
            element.classList.add("ok");
            element.textContent = "●";
        } else if (status === "error") {
            element.classList.add("error");
            element.textContent = "●";
        } else {
            element.classList.add("warn");
            element.textContent = "○";
        }
    }

    function updateUtcClock() {
        if (!elements.utcClock) return;
        const now = new Date();
        elements.utcClock.textContent = [
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds(),
        ].map(value => String(value).padStart(2, "0")).join(":");
    }

    function startUtcClock() {
        updateUtcClock();
        if (state.clockTimer !== null) clearInterval(state.clockTimer);
        state.clockTimer = window.setInterval(updateUtcClock, APP_CONFIG.clockUpdatePeriodMs);
    }

    function setConnectionState(connected, label = connected ? "ONLINE" : "OFFLINE") {
        state.connected = Boolean(connected);

        if (elements.connectionState) {
            elements.connectionState.innerHTML = "";
            const led = document.createElement("span");
            led.className = connected ? "onlineLed" : "offlineLed";
            const text = document.createElement("span");
            text.textContent = label;
            elements.connectionState.append(led, text);
        }

        if (elements.connectButton) {
            elements.connectButton.textContent = connected ? "Отключить устройство" : "Подключить устройство";
            elements.connectButton.classList.toggle("connected", connected);
        }

        setIndicator(elements.portStatus, connected ? "ok" : "warn");
        if (!connected) setIndicator(elements.gatewayStatus, "warn");
    }

    function setPortName(portName) {
        if (elements.serialPort) elements.serialPort.textContent = portName || "---";
    }

    function setTelemetryStatus(status) {
        state.telemetryActive = status === "active";
        setIndicator(
            elements.telemetryStatus,
            status === "active" ? "ok" : status === "error" ? "error" : "warn",
        );
    }

    function animateTelemetryTarget(target) {
        target.classList.remove("telemetry-updated");
        void target.offsetWidth;
        target.classList.add("telemetry-updated");
    }

    function updateAntennaAppearance(target, value) {
        const card = target?.closest?.(".telemetryCard");
        if (!card) return;
        card.classList.remove("antenna-open", "antenna-closed", "antenna-unknown");
        const numeric = Number(value);
        if (numeric === 1) card.classList.add("antenna-open");
        else if (numeric === 0) card.classList.add("antenna-closed");
        else card.classList.add("antenna-unknown");
    }

    function updateTelemetryValue(key, value) {
        const normalizedKey = String(key ?? "").trim().toUpperCase();
        const target = elements.telemetry[normalizedKey];
        if (!target) return;

        const formatter = telemetryFormatters[normalizedKey];
        target.textContent = formatter ? formatter(value) : String(value ?? "--");
        if (normalizedKey === "ANTENNA") updateAntennaAppearance(target, value);
        animateTelemetryTarget(target);
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

        if (displayed === 0) return;

        state.packetCount += 1;
        state.lastTelemetryTime = Date.now();
        if (elements.packetCounter) elements.packetCounter.textContent = state.packetCount.toLocaleString("ru-RU");
        setTelemetryStatus("active");

        if (Object.hasOwn(telemetry, "RSSI") || Object.hasOwn(telemetry, "LQI")) {
            setIndicator(elements.gatewayStatus, "ok");
        }
    }

    function registerTelemetryError(event) {
        state.errorCount += 1;
        if (elements.crcCounter) elements.crcCounter.textContent = state.errorCount.toLocaleString("ru-RU");
        if (event?.detail?.message) writeLog(event.detail.message, "warning", event.detail);
    }

    function checkTelemetryTimeout() {
        if (!state.connected || !state.lastTelemetryTime || !state.telemetryActive) return;
        if (Date.now() - state.lastTelemetryTime > APP_CONFIG.telemetryTimeoutMs) {
            setTelemetryStatus("lost");
            writeLog("Поток телеметрии прерван", "warning");
        }
    }

    function startWatchdog() {
        if (state.watchdogTimer !== null) clearInterval(state.watchdogTimer);
        state.watchdogTimer = window.setInterval(checkTelemetryTimeout, 500);
    }

    function randomDeviation(amplitude) {
        return (Math.random() * 2 - 1) * amplitude;
    }

    function createDemoTelemetry() {
        const t = Date.now() / 1000;
        return {
            ID: "ALT-04",
            VOLT: 4.12 + 0.035 * Math.sin(t / 9) + randomDeviation(0.004),
            PANEL_POWER: Math.max(0, 1.85 + 0.28 * Math.sin(t / 7) + randomDeviation(0.02)),
            PACKET: state.packetCount + 1,
            UPTIME: Math.floor(t) % 100000,
            ANTENNA: 1,
            TEMP: 24.4 + 1.1 * Math.sin(t / 12) + randomDeviation(0.06),
            RSSI: -76 + 4 * Math.sin(t / 8) + randomDeviation(0.6),
            SNR: 16 + 2 * Math.sin(t / 10) + randomDeviation(0.3),
        };
    }

    function startDemoMode() {
        if (state.demoMode) return;
        state.demoMode = true;
        setConnectionState(true, "DEMO");
        setPortName("Симулятор миссии");
        processTelemetry(createDemoTelemetry());
        state.demoTimer = window.setInterval(() => processTelemetry(createDemoTelemetry()), APP_CONFIG.demoUpdatePeriodMs);
        writeLog("Включён демонстрационный режим телеметрии v5", "success");
    }

    function stopDemoMode() {
        if (!state.demoMode) return;
        state.demoMode = false;
        if (state.demoTimer !== null) clearInterval(state.demoTimer);
        state.demoTimer = null;
        setConnectionState(false);
        setPortName("---");
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
            return;
        }

        writeLog("Последовательный модуль недоступен. Включён демонстрационный режим.", "warning");
        startDemoMode();
    }

    function registerEvents() {
        elements.connectButton?.addEventListener("click", handleConnectButtonClick);

        window.addEventListener("openmcc:serial-connected", event => {
            state.demoMode = false;
            const detail = event.detail || {};
            setConnectionState(true, "ONLINE");
            setPortName(detail.portName || "USB Serial");
            if (elements.baudRate && detail.baudRate) elements.baudRate.textContent = String(detail.baudRate);
            setTelemetryStatus("waiting");
            writeLog("Основное последовательное соединение установлено", "success", detail);
        });

        window.addEventListener("openmcc:serial-disconnected", () => {
            setConnectionState(false);
            setPortName("---");
            setTelemetryStatus("waiting");
            state.lastTelemetryTime = 0;
            writeLog("Основное последовательное соединение закрыто", "info");
        });

        window.addEventListener("openmcc:telemetry", event => processTelemetry(event.detail));
        window.addEventListener("openmcc:telemetry-error", registerTelemetryError);

        window.addEventListener("openmcc:device-info", event => {
            const payload = String(event.detail?.payload || "");
            if (/GATEWAY|RADIO_READY|RADIO,TYPE=/i.test(payload)) setIndicator(elements.gatewayStatus, "ok");
        });
    }

    function initialize() {
        if (state.initialized) return;
        ensureAntennaTelemetryCard();
        cacheElements();
        if (elements.missionName) elements.missionName.textContent = APP_CONFIG.missionName;
        startUtcClock();
        startWatchdog();
        registerEvents();
        setConnectionState(Boolean(window.OpenMCCSerial?.getState?.().connected));
        setTelemetryStatus("waiting");
        state.initialized = true;
        writeLog(`ЦУП Альтаир v${APP_CONFIG.version} готов. Технопром 2026 — Миссия на Луну.`, "success");
    }

    window.OpenMCCApp = Object.freeze({
        config: APP_CONFIG,
        processTelemetry,
        startDemoMode,
        stopDemoMode,
        getState() {
            return { ...state };
        },
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
