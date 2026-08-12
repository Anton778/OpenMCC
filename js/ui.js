"use strict";

/* ============================================================
   OpenMCC
   Open Mission Control Center

   Module: ui.js
   Version: 0.1.0

   Назначение:
   - работа панели команд;
   - отправка команд подключённому устройству;
   - блокировка органов управления при отсутствии связи;
   - отображение ответов ACK, ERR и INFO;
   - поддержка STM32, Arduino Uno, Arduino Nano и ESP32.
   ============================================================ */


(() => {

    const UI_CONFIG = Object.freeze({

        version:
            "0.1.0",

        commandFlashDurationMs:
            600

    });


    const state = {

        initialized:
            false,

        connected:
            false,

        commandInProgress:
            false,

        lastCommand:
            null,

        commandsSent:
            0

    };


    const elements = {

        commandPanel:
            null,

        commandAvailability:
            null,

        commandButtons:
            [],

        telemetryRate:
            null,

        applyTelemetryRate:
            null,

        customCommand:
            null,

        sendCustomCommand:
            null,

        lastCommandText:
            null

    };


    function writeLog(
        message,
        type = "info",
        metadata = null
    ) {

        if (
            window.OpenMCCLogger &&
            typeof window.OpenMCCLogger.write === "function"
        ) {

            window.OpenMCCLogger.write(
                message,
                type,
                "COMMAND",
                metadata
            );

            return;

        }

        console.log(
            `[OpenMCC UI] ${message}`,
            metadata || ""
        );

    }


    function cacheElements() {

        elements.commandPanel =
            document.getElementById(
                "commandPanel"
            );

        elements.commandAvailability =
            document.getElementById(
                "commandAvailability"
            );

        elements.commandButtons =
            Array.from(
                document.querySelectorAll(
                    "[data-command]"
                )
            );

        elements.telemetryRate =
            document.getElementById(
                "telemetryRate"
            );

        elements.applyTelemetryRate =
            document.getElementById(
                "applyTelemetryRate"
            );

        elements.customCommand =
            document.getElementById(
                "customCommand"
            );

        elements.sendCustomCommand =
            document.getElementById(
                "sendCustomCommand"
            );

        elements.lastCommandText =
            document.getElementById(
                "lastCommandText"
            );

    }


    function setCommandPanelAvailable(
        available
    ) {

        state.connected =
            Boolean(available);

        if (elements.commandAvailability) {

            elements.commandAvailability.textContent =
                available
                    ? "ГОТОВ"
                    : "НЕДОСТУПЕН";

            elements.commandAvailability.classList.toggle(
                "online",
                available
            );

            elements.commandAvailability.classList.toggle(
                "offline",
                !available
            );

        }

        const disabled =
            !available ||
            state.commandInProgress;

        elements.commandButtons.forEach(
            button => {

                button.disabled =
                    disabled;

            }
        );

        if (elements.telemetryRate) {

            elements.telemetryRate.disabled =
                disabled;

        }

        if (elements.applyTelemetryRate) {

            elements.applyTelemetryRate.disabled =
                disabled;

        }

        if (elements.customCommand) {

            elements.customCommand.disabled =
                disabled;

        }

        if (elements.sendCustomCommand) {

            elements.sendCustomCommand.disabled =
                disabled;

        }

    }


    function setCommandInProgress(
        inProgress
    ) {

        state.commandInProgress =
            Boolean(inProgress);

        setCommandPanelAvailable(
            state.connected
        );

    }


    function normalizeCustomCommand(value) {

        return String(value ?? "")
            .trim()
            .replace(/^\$CMD[,]?/i, "")
            .replace(/[\r\n]+/g, "")
            .toUpperCase();

    }


    function showLastCommand(
        commandText
    ) {

        state.lastCommand =
            commandText;

        if (!elements.lastCommandText) {

            return;

        }

        elements.lastCommandText.textContent =
            commandText;

        elements.lastCommandText.classList.remove(
            "command-transmitted"
        );

        void elements.lastCommandText.offsetWidth;

        elements.lastCommandText.classList.add(
            "command-transmitted"
        );

    }


    async function transmitCommand(
        command,
        parameters = null
    ) {

        if (
            !window.OpenMCCSerial ||
            typeof window.OpenMCCSerial.sendCommand !==
                "function"
        ) {

            throw new Error(
                "Модуль serial.js недоступен"
            );

        }

        const serialState =
            window.OpenMCCSerial.getState();

        if (!serialState.connected) {

            throw new Error(
                "Последовательное устройство не подключено"
            );

        }

        setCommandInProgress(true);

        try {

            const transmittedLine =
                await window.OpenMCCSerial.sendCommand(
                    command,
                    parameters
                );

            state.commandsSent += 1;

            showLastCommand(
                transmittedLine
            );

            window.dispatchEvent(
                new CustomEvent(
                    "openmcc:command-sent",
                    {
                        detail: {

                            command,

                            parameters,

                            transmittedLine,

                            sequenceNumber:
                                state.commandsSent,

                            timestamp:
                                Date.now()

                        }
                    }
                )
            );

            return transmittedLine;

        }
        catch (error) {

            writeLog(
                `Команда не передана: ${error.message}`,
                "error"
            );

            throw error;

        }
        finally {

            setCommandInProgress(false);

        }

    }


    async function handleCommandButton(
        button
    ) {

        const command =
            button.dataset.command;

        const value =
            button.dataset.value;

        try {

            if (
                value !== undefined
            ) {

                await transmitCommand(
                    command,
                    {
                        VALUE:
                            value
                    }
                );

            }
            else {

                await transmitCommand(
                    command
                );

            }

            button.classList.remove(
                "command-transmitted"
            );

            void button.offsetWidth;

            button.classList.add(
                "command-transmitted"
            );

        }
        catch {

            // Ошибка уже зарегистрирована transmitCommand().
        }

    }


    async function applyTelemetryPeriod() {

        const period =
            Number(
                elements.telemetryRate?.value
            );

        if (
            !Number.isInteger(period) ||
            period < 100
        ) {

            writeLog(
                "Задан некорректный период телеметрии",
                "error"
            );

            return;

        }

        try {

            await transmitCommand(
                "RATE",
                {
                    VALUE:
                        period
                }
            );

        }
        catch {

            // Ошибка уже зарегистрирована.
        }

    }


    async function sendCustomCommand() {

        const commandText =
            normalizeCustomCommand(
                elements.customCommand?.value
            );

        if (!commandText) {

            writeLog(
                "Поле произвольной команды не заполнено",
                "warning"
            );

            elements.customCommand?.focus();

            return;

        }

        try {

            /*
             * Пользователь может написать:
             *
             * RESET
             * CAMERA,VALUE=1
             *
             * writeLine используется, чтобы сохранить
             * введённую структуру параметров.
             */

            const line =
                `$CMD,${commandText}`;

            await window.OpenMCCSerial.writeLine(
                line
            );

            state.commandsSent += 1;

            showLastCommand(line);

            writeLog(
                `Передана команда: ${line}`,
                "command"
            );

            if (elements.customCommand) {

                elements.customCommand.value =
                    "";

            }

        }
        catch (error) {

            writeLog(
                `Произвольная команда не передана: ${error.message}`,
                "error"
            );

        }

    }


    function registerInterfaceEvents() {

        elements.commandButtons.forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        handleCommandButton(
                            button
                        );

                    }
                );

            }
        );


        elements.applyTelemetryRate?.addEventListener(
            "click",
            applyTelemetryPeriod
        );


        elements.sendCustomCommand?.addEventListener(
            "click",
            sendCustomCommand
        );


        elements.customCommand?.addEventListener(
            "keydown",
            event => {

                if (event.key === "Enter") {

                    event.preventDefault();

                    sendCustomCommand();

                }

            }
        );

    }


    function registerApplicationEvents() {

        window.addEventListener(
            "openmcc:serial-connected",
            () => {

                setCommandPanelAvailable(true);

                writeLog(
                    "Панель команд активирована",
                    "success"
                );

            }
        );


        window.addEventListener(
            "openmcc:serial-disconnected",
            () => {

                setCommandPanelAvailable(false);

                writeLog(
                    "Панель команд отключена",
                    "info"
                );

            }
        );


        window.addEventListener(
            "openmcc:device-ack",
            event => {

                const payload =
                    event.detail?.payload ||
                    "ACK";

                writeLog(
                    `Подтверждение устройства: ${payload}`,
                    "success",
                    event.detail
                );

            }
        );


        window.addEventListener(
            "openmcc:device-error",
            event => {

                const payload =
                    event.detail?.payload ||
                    "UNKNOWN_ERROR";

                writeLog(
                    `Ошибка устройства: ${payload}`,
                    "error",
                    event.detail
                );

            }
        );


        window.addEventListener(
            "openmcc:device-info",
            event => {

                const payload =
                    event.detail?.payload ||
                    "Нет данных";

                writeLog(
                    `Информация устройства: ${payload}`,
                    "info",
                    event.detail
                );

            }
        );

    }


    function synchronizeInitialState() {

        const serialState =
            window.OpenMCCSerial?.getState?.();

        setCommandPanelAvailable(
            Boolean(
                serialState?.connected
            )
        );

    }


    function initialize() {

        if (state.initialized) {

            return;

        }

        cacheElements();

        registerInterfaceEvents();

        registerApplicationEvents();

        synchronizeInitialState();

        state.initialized =
            true;

        writeLog(
            `Модуль интерфейса v${UI_CONFIG.version} загружен`,
            "success"
        );

    }


    window.OpenMCCUI = Object.freeze({

        transmitCommand,

        setCommandPanelAvailable,

        getState() {

            return {

                initialized:
                    state.initialized,

                connected:
                    state.connected,

                commandInProgress:
                    state.commandInProgress,

                lastCommand:
                    state.lastCommand,

                commandsSent:
                    state.commandsSent

            };

        }

    });


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