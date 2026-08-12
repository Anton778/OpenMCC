"use strict";

/* ============================================================
   OpenMCC
   Open Mission Control Center

   Module: app.js
   Version: 0.1.0
   Purpose:
   - application initialization;
   - UTC clock;
   - Web Serial API capability check;
   - connection button handling;
   - interface state management;
   - demonstration telemetry mode;
   - coordination of OpenMCC modules.
   ============================================================ */


(() => {

    /* ========================================================
       APPLICATION CONFIGURATION
       ======================================================== */

    const APP_CONFIG = Object.freeze({

        name: "OpenMCC",

        fullName: "Open Mission Control Center",

        version: "0.1.0",

        missionName: "CubeSat-1",

        baudRate: 115200,

        clockUpdatePeriodMs: 250,

        telemetryTimeoutMs: 3000,

        demoUpdatePeriodMs: 1000

    });


    /* ========================================================
       APPLICATION STATE
       ======================================================== */

    const state = {

        initialized: false,

        connected: false,

        demoMode: false,

        telemetryActive: false,

        packetCount: 0,

        crcErrorCount: 0,

        lastTelemetryTime: 0,

        clockTimer: null,

        telemetryWatchdogTimer: null,

        demoTimer: null

    };


    /* ========================================================
       DOM ELEMENT CACHE
       ======================================================== */

    const elements = {};


    /**
     * Finds and stores all required interface elements.
     */
    function cacheElements() {

        elements.missionName =
            document.getElementById("missionName");

        elements.utcClock =
            document.getElementById("utcClock");

        elements.connectionState =
            document.getElementById("connectionState");

        elements.connectButton =
            document.getElementById("connectButton");

        elements.serialPort =
            document.getElementById("serialPort");

        elements.baudRate =
            document.getElementById("baudRate");

        elements.packetCounter =
            document.getElementById("packetCounter");

        elements.crcCounter =
            document.getElementById("crcCounter");

        elements.eventLog =
            document.getElementById("eventLog");

        elements.telemetryStatus =
            document.querySelector(
                "#systemPanel li:nth-child(4) span"
            );

        elements.telemetry = {

            TEMP: document.getElementById("TEMP"),

            VOLT: document.getElementById("VOLT"),

            CURR: document.getElementById("CURR"),

            RSSI: document.getElementById("RSSI"),

            SNR: document.getElementById("SNR")

        };

    }


    /* ========================================================
       EVENT LOG
       ======================================================== */

    /**
     * Adds a message to the event log.
     *
     * If logger.js is connected later, its implementation
     * will be used automatically.
     *
     * @param {string} message
     * @param {"info"|"success"|"warning"|"error"} type
     */
    function writeLog(message, type = "info") {

        if (
            window.OpenMCCLogger &&
            typeof window.OpenMCCLogger.write === "function"
        ) {

            window.OpenMCCLogger.write(message, type);

            return;

        }

        if (!elements.eventLog) {

            console.log(`[${type.toUpperCase()}] ${message}`);

            return;

        }

        const row =
            document.createElement("div");

        const time =
            new Date().toLocaleTimeString(
                "ru-RU",
                {
                    hour12: false
                }
            );

        row.className =
            `log-entry log-${type}`;

        row.textContent =
            `${time}  ${message}`;

        elements.eventLog.appendChild(row);

        elements.eventLog.scrollTop =
            elements.eventLog.scrollHeight;

    }


    /* ========================================================
       UTC CLOCK
       ======================================================== */

    /**
     * Returns UTC time in HH:MM:SS format.
     *
     * @returns {string}
     */
    function getUtcTimeString() {

        const now =
            new Date();

        const hours =
            String(now.getUTCHours()).padStart(2, "0");

        const minutes =
            String(now.getUTCMinutes()).padStart(2, "0");

        const seconds =
            String(now.getUTCSeconds()).padStart(2, "0");

        return `${hours}:${minutes}:${seconds}`;

    }


    /**
     * Updates the UTC clock in the header.
     */
    function updateUtcClock() {

        if (!elements.utcClock) {

            return;

        }

        elements.utcClock.textContent =
            getUtcTimeString();

    }


    /**
     * Starts continuous UTC clock updating.
     */
    function startUtcClock() {

        updateUtcClock();

        if (state.clockTimer !== null) {

            clearInterval(state.clockTimer);

        }

        state.clockTimer =
            window.setInterval(
                updateUtcClock,
                APP_CONFIG.clockUpdatePeriodMs
            );

    }


    /* ========================================================
       CONNECTION STATE
       ======================================================== */

    /**
     * Updates the connection state shown in the header.
     *
     * @param {boolean} connected
     * @param {string} label
     */
    function setConnectionState(
        connected,
        label = connected ? "ONLINE" : "OFFLINE"
    ) {

        state.connected =
            connected;

        if (elements.connectionState) {

            elements.connectionState.innerHTML = "";

            const led =
                document.createElement("span");

            led.className =
                connected
                    ? "onlineLed"
                    : "offlineLed";

            const text =
                document.createElement("span");

            text.textContent =
                label;

            elements.connectionState.append(
                led,
                text
            );

        }

        if (elements.connectButton) {

            elements.connectButton.textContent =
                connected
                    ? "Отключить устройство"
                    : "Подключить устройство";

            elements.connectButton.classList.toggle(
                "connected",
                connected
            );

        }

    }


    /**
     * Updates the serial port name.
     *
     * Web Serial API does not always provide the Windows COM
     * number to the browser. Therefore a technical designation
     * may be displayed instead.
     *
     * @param {string} portName
     */
    function setPortName(portName) {

        if (elements.serialPort) {

            elements.serialPort.textContent =
                portName || "---";

        }

    }


    /* ========================================================
       SYSTEM STATUS
       ======================================================== */

    /**
     * Changes the telemetry subsystem status.
     *
     * @param {"waiting"|"active"|"lost"|"error"} status
     */
    function setTelemetryStatus(status) {

        if (!elements.telemetryStatus) {

            return;

        }

        elements.telemetryStatus.classList.remove(
            "ok",
            "warn",
            "error"
        );

        switch (status) {

            case "active":

                elements.telemetryStatus.classList.add("ok");

                elements.telemetryStatus.textContent =
                    "●";

                state.telemetryActive =
                    true;

                break;


            case "lost":

                elements.telemetryStatus.classList.add("warn");

                elements.telemetryStatus.textContent =
                    "●";

                state.telemetryActive =
                    false;

                break;


            case "error":

                elements.telemetryStatus.classList.add("error");

                elements.telemetryStatus.textContent =
                    "●";

                state.telemetryActive =
                    false;

                break;


            case "waiting":

            default:

                elements.telemetryStatus.classList.add("warn");

                elements.telemetryStatus.textContent =
                    "○";

                state.telemetryActive =
                    false;

                break;

        }

    }


    /* ========================================================
       TELEMETRY DISPLAY
       ======================================================== */

    const telemetryFormatters = {

        TEMP(value) {

            return `${Number(value).toFixed(1)} °C`;

        },

        VOLT(value) {

            return `${Number(value).toFixed(2)} В`;

        },

        CURR(value) {

            return `${Math.round(Number(value))} мА`;

        },

        RSSI(value) {

            return `${Math.round(Number(value))} dBm`;

        },

        SNR(value) {

            return `${Number(value).toFixed(1)} dB`;

        }

    };


    /**
     * Updates one telemetry value.
     *
     * @param {string} key
     * @param {number|string} value
     */
    function updateTelemetryValue(key, value) {

        const normalizedKey =
            String(key).trim().toUpperCase();

        const target =
            elements.telemetry[normalizedKey];

        if (!target) {

            return;

        }

        const numericValue =
            Number(value);

        if (!Number.isFinite(numericValue)) {

            writeLog(
                `Некорректное значение ${normalizedKey}: ${value}`,
                "warning"
            );

            return;

        }

        const formatter =
            telemetryFormatters[normalizedKey];

        target.textContent =
            formatter
                ? formatter(numericValue)
                : String(numericValue);

        target.classList.remove(
            "telemetry-updated"
        );

        void target.offsetWidth;

        target.classList.add(
            "telemetry-updated"
        );

    }


    /**
     * Processes one telemetry object.
     *
     * Example:
     * {
     *     TEMP: 23.4,
     *     VOLT: 5.01,
     *     CURR: 182,
     *     RSSI: -81,
     *     SNR: 9.6
     * }
     *
     * @param {Object<string, number|string>} telemetry
     */
    function processTelemetry(telemetry) {

        if (
            telemetry === null ||
            typeof telemetry !== "object"
        ) {

            return;

        }

        Object.entries(telemetry).forEach(
            ([key, value]) => {

                updateTelemetryValue(key, value);

            }
        );

        state.packetCount += 1;

        state.lastTelemetryTime =
            Date.now();

        updateCounters();

        setTelemetryStatus("active");

    }


    /**
     * Updates packet and CRC counters.
     */
    function updateCounters() {

        if (elements.packetCounter) {

            elements.packetCounter.textContent =
                state.packetCount.toLocaleString("ru-RU");

        }

        if (elements.crcCounter) {

            elements.crcCounter.textContent =
                state.crcErrorCount.toLocaleString("ru-RU");

        }

    }


    /**
     * Registers a CRC or parser error.
     */
    function registerTelemetryError() {

        state.crcErrorCount += 1;

        updateCounters();

    }


    /* ========================================================
       TELEMETRY WATCHDOG
       ======================================================== */

    /**
     * Detects loss of telemetry flow.
     */
    function checkTelemetryTimeout() {

        if (!state.connected) {

            return;

        }

        if (state.lastTelemetryTime === 0) {

            return;

        }

        const elapsed =
            Date.now() - state.lastTelemetryTime;

        if (
            elapsed > APP_CONFIG.telemetryTimeoutMs &&
            state.telemetryActive
        ) {

            setTelemetryStatus("lost");

            writeLog(
                "Поток телеметрии прерван",
                "warning"
            );

        }

    }


    /**
     * Starts the telemetry watchdog.
     */
    function startTelemetryWatchdog() {

        if (state.telemetryWatchdogTimer !== null) {

            clearInterval(
                state.telemetryWatchdogTimer
            );

        }

        state.telemetryWatchdogTimer =
            window.setInterval(
                checkTelemetryTimeout,
                500
            );

    }


    /* ========================================================
       DEMONSTRATION MODE
       ======================================================== */

    /**
     * Generates realistic demonstration telemetry.
     *
     * Demonstration mode is useful before STM32 firmware
     * and serial communication are ready.
     *
     * @returns {Object<string, number>}
     */
    function createDemoTelemetry() {

        const time =
            Date.now() / 1000;

        return {

            TEMP:
                23.5 +
                1.2 * Math.sin(time / 11) +
                randomDeviation(0.08),

            VOLT:
                5.02 +
                0.03 * Math.sin(time / 7) +
                randomDeviation(0.005),

            CURR:
                180 +
                14 * Math.sin(time / 5) +
                randomDeviation(2.5),

            RSSI:
                -79 +
                4 * Math.sin(time / 9) +
                randomDeviation(0.8),

            SNR:
                9.5 +
                1.1 * Math.sin(time / 8) +
                randomDeviation(0.2)

        };

    }


    /**
     * Returns random deviation around zero.
     *
     * @param {number} amplitude
     * @returns {number}
     */
    function randomDeviation(amplitude) {

        return (
            Math.random() * 2 - 1
        ) * amplitude;

    }


    /**
     * Starts demonstration telemetry.
     */
    function startDemoMode() {

        if (state.demoMode) {

            return;

        }

        state.demoMode =
            true;

        setConnectionState(
            true,
            "DEMO"
        );

        setPortName(
            "Симулятор"
        );

        writeLog(
            "Включён демонстрационный режим",
            "success"
        );

        processTelemetry(
            createDemoTelemetry()
        );

        state.demoTimer =
            window.setInterval(
                () => {

                    processTelemetry(
                        createDemoTelemetry()
                    );

                },
                APP_CONFIG.demoUpdatePeriodMs
            );

    }


    /**
     * Stops demonstration telemetry.
     */
    function stopDemoMode() {

        if (!state.demoMode) {

            return;

        }

        state.demoMode =
            false;

        if (state.demoTimer !== null) {

            clearInterval(
                state.demoTimer
            );

            state.demoTimer =
                null;

        }

        setConnectionState(false);

        setPortName("---");

        setTelemetryStatus("waiting");

        writeLog(
            "Демонстрационный режим отключён",
            "info"
        );

    }


    /* ========================================================
       SERIAL CONNECTION
       ======================================================== */

    /**
     * Checks whether Web Serial API is supported.
     *
     * @returns {boolean}
     */
    function isWebSerialSupported() {

        return (
            "serial" in navigator
        );

    }


    /**
     * Handles connection button click.
     */
    async function handleConnectButtonClick() {

        if (state.demoMode) {

            stopDemoMode();

            return;

        }

        if (
            window.OpenMCCSerial &&
            typeof window.OpenMCCSerial.toggleConnection ===
                "function"
        ) {

            try {

                await window.OpenMCCSerial.toggleConnection();

            }
            catch (error) {

                writeLog(
                    `Ошибка соединения: ${error.message}`,
                    "error"
                );

                setConnectionState(false);

            }

            return;

        }

        if (!isWebSerialSupported()) {

            writeLog(
                "Web Serial API не поддерживается этим браузером",
                "error"
            );

            writeLog(
                "Откройте OpenMCC в Google Chrome или Microsoft Edge",
                "warning"
            );

            return;

        }

        writeLog(
            "Модуль serial.js ещё не подключён",
            "warning"
        );

        writeLog(
            "Для проверки интерфейса включён демонстрационный режим",
            "info"
        );

        startDemoMode();

    }


    /* ========================================================
       MODULE EVENTS
       ======================================================== */

    /**
     * Registers events generated by serial.js.
     */
    function registerModuleEvents() {

        window.addEventListener(
            "openmcc:serial-connected",
            event => {

                const detail =
                    event.detail || {};

                state.demoMode =
                    false;

                setConnectionState(
                    true,
                    "ONLINE"
                );

                setPortName(
                    detail.portName || "USB Serial"
                );

                writeLog(
                     "Соединение с последовательным устройством установлено",
                     "success"
                );

                setTelemetryStatus("waiting");

            }
        );


        window.addEventListener(
            "openmcc:serial-disconnected",
            () => {

                setConnectionState(false);

                setPortName("---");

                setTelemetryStatus("waiting");

                state.lastTelemetryTime =
                    0;

                writeLog(
                    "Соединение с последовательным устройством закрыто",
                    "info"
                );

            }
        );


        window.addEventListener(
            "openmcc:telemetry",
            event => {

                processTelemetry(
                    event.detail
                );

            }
        );


        window.addEventListener(
            "openmcc:telemetry-error",
            event => {

                registerTelemetryError();

                const message =
                    event.detail?.message ||
                    "Ошибка обработки телеметрии";

                writeLog(
                    message,
                    "error"
                );

            }
        );

    }


    /* ========================================================
       USER INTERFACE EVENTS
       ======================================================== */

    /**
     * Registers DOM event handlers.
     */
    function registerInterfaceEvents() {

        if (elements.connectButton) {

            elements.connectButton.addEventListener(
                "click",
                handleConnectButtonClick
            );

        }


        document.addEventListener(
            "keydown",
            event => {

                /*
                 * Ctrl + Shift + D:
                 * enable or disable demonstration mode.
                 */

                if (
                    event.ctrlKey &&
                    event.shiftKey &&
                    event.code === "KeyD"
                ) {

                    event.preventDefault();

                    if (state.demoMode) {

                        stopDemoMode();

                    }
                    else if (!state.connected) {

                        startDemoMode();

                    }

                }

            }
        );


        window.addEventListener(
            "beforeunload",
            () => {

                stopDemoMode();

            }
        );

    }


    /* ========================================================
       INITIAL INTERFACE STATE
       ======================================================== */

    /**
     * Sets the initial content of all interface elements.
     */
    function initializeInterface() {

        if (elements.missionName) {

            elements.missionName.textContent =
                APP_CONFIG.missionName;

        }

        if (elements.baudRate) {

            elements.baudRate.textContent =
                APP_CONFIG.baudRate.toLocaleString("ru-RU");

        }

        setConnectionState(false);

        setPortName("---");

        setTelemetryStatus("waiting");

        updateCounters();

    }


    /**
     * Checks the browser environment.
     */
    function checkEnvironment() {

        if (isWebSerialSupported()) {

            writeLog(
                "Web Serial API доступен",
                "success"
            );

        }
        else {

            writeLog(
                "Web Serial API недоступен в текущем браузере",
                "warning"
            );

        }

        if (!window.isSecureContext) {

            writeLog(
                "Страница открыта вне защищённого контекста",
                "warning"
            );

            writeLog(
                "Для подключения к COM-порту может потребоваться локальный веб-сервер",
                "warning"
            );

        }

    }


    /* ========================================================
       APPLICATION START
       ======================================================== */

    /**
     * Initializes OpenMCC.
     */
    function initialize() {

        if (state.initialized) {

            return;

        }

        cacheElements();

        initializeInterface();

        registerInterfaceEvents();

        registerModuleEvents();

        startUtcClock();

        startTelemetryWatchdog();

        state.initialized =
            true;

        writeLog(
            `${APP_CONFIG.name} v${APP_CONFIG.version} запущен`,
            "success"
        );

        writeLog(
            `Миссия: ${APP_CONFIG.missionName}`,
            "info"
        );

        checkEnvironment();

        writeLog(
            "Ожидание подключения наземного оборудования",
            "info"
        );

    }


    /* ========================================================
       PUBLIC APPLICATION API
       ======================================================== */

    window.OpenMCC = Object.freeze({

        config:
            APP_CONFIG,

        getState() {

            return {
                ...state
            };

        },

        processTelemetry,

        updateTelemetryValue,

        writeLog,

        setConnectionState,

        setPortName,

        setTelemetryStatus,

        startDemoMode,

        stopDemoMode,

        registerTelemetryError

    });


    /* ========================================================
       DOM READY
       ======================================================== */

    if (document.readyState === "loading") {

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );

    }
    else {

        initialize();

    }

})();