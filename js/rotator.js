"use strict";

/* ============================================================
   OpenMCC
   Open Mission Control Center

   Module: rotator.js
   Version: 0.1.0

   Отдельное Web Serial-соединение для двухосевой поворотки:
   - Arduino Uno №2;
   - CNC Shield V3;
   - NEMA 17 AZ;
   - NEMA 17 EL.
   ============================================================ */


(() => {

    const CONFIG = Object.freeze({

        version:
            "0.1.0",

        defaultBaudRate:
            115200,

        azimuthMinimum:
            0,

        azimuthMaximum:
            360,

        elevationMinimum:
            0,

        elevationMaximum:
            90,

        simulationUpdatePeriodMs:
            40,

        simulationSpeedDegreesPerSecond:
            18,

        lineEnding:
            "\n"

    });


    const state = {

        initialized:
            false,

        connected:
            false,

        connecting:
            false,

        disconnecting:
            false,

        simulation:
            false,

        port:
            null,

        reader:
            null,

        writer:
            null,

        readBuffer:
            "",

        currentAzimuth:
            0,

        currentElevation:
            0,

        targetAzimuth:
            0,

        targetElevation:
            0,

        motionState:
            "DISCONNECTED",

        homed:
            false,

        lastCommand:
            "---",

        simulationTimer:
            null,

        lastSimulationTime:
            0

    };


    const elements = {};


    function cacheElements() {

        elements.status =
            document.getElementById(
                "rotatorStatus"
            );

        elements.connectButton =
            document.getElementById(
                "rotatorConnectButton"
            );

        elements.baudRate =
            document.getElementById(
                "rotatorBaudRate"
            );

        elements.currentAzimuth =
            document.getElementById(
                "rotatorCurrentAz"
            );

        elements.currentElevation =
            document.getElementById(
                "rotatorCurrentEl"
            );

        elements.targetAzimuth =
            document.getElementById(
                "rotatorTargetAz"
            );

        elements.targetElevation =
            document.getElementById(
                "rotatorTargetEl"
            );

        elements.moveButton =
            document.getElementById(
                "rotatorMoveButton"
            );

        elements.stopButton =
            document.getElementById(
                "rotatorStopButton"
            );

        elements.homeButton =
            document.getElementById(
                "rotatorHomeButton"
            );

        elements.parkButton =
            document.getElementById(
                "rotatorParkButton"
            );

        elements.statusButton =
            document.getElementById(
                "rotatorStatusButton"
            );

        elements.motionState =
            document.getElementById(
                "rotatorMotionState"
            );

        elements.homingState =
            document.getElementById(
                "rotatorHomingState"
            );

        elements.lastCommand =
            document.getElementById(
                "rotatorLastCommand"
            );

        elements.simulationMode =
            document.getElementById(
                "rotatorSimulationMode"
            );

    }


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
                "ROTATOR",
                metadata
            );

            return;

        }

        console.log(
            `[OpenMCC Rotator] ${message}`
        );

    }


    function emitEvent(
        name,
        detail = null
    ) {

        window.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail
                }
            )
        );

    }


    function setStatus(
        text,
        type = "offline"
    ) {

        if (!elements.status) {

            return;

        }

        elements.status.textContent =
            text;

        elements.status.classList.remove(
            "offline",
            "online",
            "moving",
            "error"
        );

        elements.status.classList.add(
            type
        );

    }


    function setControlsEnabled(enabled) {

        const controls = [

            elements.moveButton,
            elements.stopButton,
            elements.homeButton,
            elements.parkButton,
            elements.statusButton,
            elements.targetAzimuth,
            elements.targetElevation

        ];

        controls.forEach(control => {

            if (control) {

                control.disabled =
                    !enabled;

            }

        });

    }


    function updateInterface() {

        if (elements.currentAzimuth) {

            elements.currentAzimuth.textContent =
                `${state.currentAzimuth.toFixed(1)}°`;

        }

        if (elements.currentElevation) {

            elements.currentElevation.textContent =
                `${state.currentElevation.toFixed(1)}°`;

        }

        if (elements.motionState) {

            elements.motionState.textContent =
                state.motionState;

        }

        if (elements.homingState) {

            elements.homingState.textContent =
                state.homed
                    ? "ОПРЕДЕЛЕНА"
                    : "НЕ ОПРЕДЕЛЕНА";

        }

        if (elements.lastCommand) {

            elements.lastCommand.textContent =
                state.lastCommand;

        }

        if (
            state.motionState === "MOVING" ||
            state.motionState === "HOMING"
        ) {

            setStatus(
                "ДВИЖЕНИЕ",
                "moving"
            );

        }
        else if (
            state.connected ||
            state.simulation
        ) {

            setStatus(
                state.simulation
                    ? "СИМУЛЯТОР"
                    : "ГОТОВ",
                "online"
            );

        }
        else {

            setStatus(
                "ОТКЛЮЧЕНО",
                "offline"
            );

        }

    }


    function validateAngles(
        azimuth,
        elevation
    ) {

        if (
            !Number.isFinite(azimuth) ||
            azimuth <
                CONFIG.azimuthMinimum ||
            azimuth >
                CONFIG.azimuthMaximum
        ) {

            throw new Error(
                `Азимут должен находиться в диапазоне ` +
                `${CONFIG.azimuthMinimum}...${CONFIG.azimuthMaximum}°`
            );

        }

        if (
            !Number.isFinite(elevation) ||
            elevation <
                CONFIG.elevationMinimum ||
            elevation >
                CONFIG.elevationMaximum
        ) {

            throw new Error(
                `Угол места должен находиться в диапазоне ` +
                `${CONFIG.elevationMinimum}...${CONFIG.elevationMaximum}°`
            );

        }

    }


    async function connect() {

        if (
            state.connected ||
            state.connecting
        ) {

            return;

        }

        if (state.simulation) {

            startSimulation();

            return;

        }

        if (!("serial" in navigator)) {

            throw new Error(
                "Web Serial API недоступен"
            );

        }

        state.connecting =
            true;

        elements.connectButton.disabled =
            true;

        elements.connectButton.textContent =
            "Выбор порта...";

        try {

            state.port =
                await navigator.serial.requestPort();

            const baudRate =
                Number(
                    elements.baudRate.value
                ) ||
                CONFIG.defaultBaudRate;

            await state.port.open({

                baudRate,

                dataBits:
                    8,

                stopBits:
                    1,

                parity:
                    "none",

                flowControl:
                    "none"

            });

            state.connected =
                true;

            state.motionState =
                "IDLE";

            elements.connectButton.textContent =
                "Отключить поворотку";

            elements.baudRate.disabled =
                true;

            setControlsEnabled(true);

            updateInterface();

            writeLog(
                `Поворотка подключена, ${baudRate} бод`,
                "success"
            );

            emitEvent(
                "openmcc:rotator-connected"
            );

            readLoop();

            await sendCommand(
                "$ROT,STATUS"
            );

        }
        catch (error) {

            if (
                error?.name !==
                "NotFoundError"
            ) {

                writeLog(
                    `Ошибка подключения поворотки: ${error.message}`,
                    "error"
                );

            }

            await cleanupPort();

        }
        finally {

            state.connecting =
                false;

            elements.connectButton.disabled =
                false;

            if (!state.connected) {

                elements.connectButton.textContent =
                    "Подключить поворотку";

            }

        }

    }


    async function disconnect() {

        if (state.simulation) {

            stopSimulation();

            return;

        }

        if (
            !state.connected &&
            !state.port
        ) {

            return;

        }

        state.disconnecting =
            true;

        try {

            state.connected =
                false;

            if (state.reader) {

                try {

                    await state.reader.cancel();

                }
                catch {

                    // Поток уже мог быть закрыт.
                }

                try {

                    state.reader.releaseLock();

                }
                catch {

                    // Блокировка могла быть снята ранее.
                }

                state.reader =
                    null;

            }

            if (state.port) {

                try {

                    await state.port.close();

                }
                catch {

                    // Порт мог быть закрыт физически.
                }

            }

        }
        finally {

            await cleanupPort();

            state.motionState =
                "DISCONNECTED";

            state.homed =
                false;

            elements.connectButton.textContent =
                "Подключить поворотку";

            elements.baudRate.disabled =
                false;

            setControlsEnabled(false);

            updateInterface();

            writeLog(
                "Поворотка отключена",
                "info"
            );

            emitEvent(
                "openmcc:rotator-disconnected"
            );

            state.disconnecting =
                false;

        }

    }


    async function cleanupPort() {

        state.port =
            null;

        state.reader =
            null;

        state.writer =
            null;

        state.readBuffer =
            "";

        state.connected =
            false;

    }


    async function toggleConnection() {

    const simulationIsRunning =
        state.simulationTimer !== null;

    if (
        state.connected ||
        simulationIsRunning
    ) {

        await disconnect();

    }
    else {

        await connect();

    }

}


    async function readLoop() {

        if (
            !state.port ||
            !state.port.readable
        ) {

            return;

        }

        const decoder =
            new TextDecoder();

        while (
            state.connected &&
            state.port?.readable
        ) {

            state.reader =
                state.port.readable.getReader();

            try {

                while (state.connected) {

                    const {
                        value,
                        done
                    } =
                        await state.reader.read();

                    if (done) {

                        break;

                    }

                    if (!value) {

                        continue;

                    }

                    state.readBuffer +=
                        decoder.decode(
                            value,
                            {
                                stream: true
                            }
                        );

                    processReadBuffer();

                }

            }
            catch (error) {

                if (state.connected) {

                    writeLog(
                        `Ошибка чтения поворотки: ${error.message}`,
                        "error"
                    );

                }

            }
            finally {

                try {

                    state.reader.releaseLock();

                }
                catch {

                    // Игнорируем.
                }

                state.reader =
                    null;

            }

            break;

        }

    }


    function processReadBuffer() {

        const lines =
            state.readBuffer.split(/\r?\n/);

        state.readBuffer =
            lines.pop() ?? "";

        lines.forEach(line => {

            const normalized =
                line.trim();

            if (normalized) {

                parseRotatorLine(
                    normalized
                );

            }

        });

    }


    function parseParameterList(text) {

        const parameters = {};

        text
            .split(",")
            .forEach(item => {

                const separator =
                    item.indexOf("=");

                if (separator < 1) {

                    return;

                }

                const key =
                    item
                        .slice(0, separator)
                        .trim()
                        .toUpperCase();

                const rawValue =
                    item
                        .slice(separator + 1)
                        .trim();

                const numericValue =
                    Number(rawValue);

                parameters[key] =
                    Number.isFinite(numericValue)
                        ? numericValue
                        : rawValue;

            });

        return parameters;

    }


    function parseRotatorLine(line) {

        const upperLine =
            line.toUpperCase();

        if (
            upperLine.startsWith(
                "$ROT,POS,"
            )
        ) {

            const values =
                parseParameterList(
                    line.slice(9)
                );

            if (
                Number.isFinite(
                    values.AZ
                )
            ) {

                state.currentAzimuth =
                    values.AZ;

            }

            if (
                Number.isFinite(
                    values.EL
                )
            ) {

                state.currentElevation =
                    values.EL;

            }

            updateInterface();

            emitEvent(
                "openmcc:rotator-position",
                {
                    azimuth:
                        state.currentAzimuth,

                    elevation:
                        state.currentElevation
                }
            );

            return;

        }


        if (
            upperLine.startsWith(
                "$ROT,STATE="
            )
        ) {

            state.motionState =
                line
                    .slice(11)
                    .trim()
                    .toUpperCase();

            updateInterface();

            return;

        }


        if (
            upperLine.startsWith(
                "$ROT,HOME="
            )
        ) {

            const value =
                line
                    .slice(10)
                    .trim()
                    .toUpperCase();

            state.homed =
                value === "OK" ||
                value === "1" ||
                value === "TRUE";

            updateInterface();

            return;

        }


        if (
            upperLine.startsWith(
                "$ROT,ACK"
            )
        ) {

            writeLog(
                `Подтверждение поворотки: ${line}`,
                "success"
            );

            return;

        }


        if (
            upperLine.startsWith(
                "$ROT,ERR"
            )
        ) {

            state.motionState =
                "ERROR";

            setStatus(
                "ОШИБКА",
                "error"
            );

            writeLog(
                `Ошибка поворотки: ${line}`,
                "error"
            );

            return;

        }


        writeLog(
            `Сообщение поворотки: ${line}`,
            "info"
        );

    }


    async function writeLine(line) {

        if (state.simulation) {

            processSimulationCommand(
                line
            );

            return;

        }

        if (
            !state.connected ||
            !state.port?.writable
        ) {

            throw new Error(
                "Поворотка не подключена"
            );

        }

        const encoder =
            new TextEncoder();

        const data =
            encoder.encode(
                line +
                CONFIG.lineEnding
            );

        const writer =
            state.port.writable.getWriter();

        state.writer =
            writer;

        try {

            await writer.write(data);

        }
        finally {

            writer.releaseLock();

            state.writer =
                null;

        }

    }


    async function sendCommand(line) {

        state.lastCommand =
            line;

        updateInterface();

        await writeLine(line);

        writeLog(
            `Передана команда: ${line}`,
            "command"
        );

    }


    async function moveToTarget() {

        const azimuth =
            Number(
                elements.targetAzimuth.value
            );

        const elevation =
            Number(
                elements.targetElevation.value
            );

        try {

            validateAngles(
                azimuth,
                elevation
            );

            state.targetAzimuth =
                azimuth;

            state.targetElevation =
                elevation;

            await sendCommand(
                `$ROT,SET,AZ=${azimuth.toFixed(2)},` +
                `EL=${elevation.toFixed(2)}`
            );

        }
        catch (error) {

            writeLog(
                error.message,
                "error"
            );

        }

    }


    async function emergencyStop() {

        await sendCommand(
            "$ROT,STOP"
        );

    }


    async function startHoming() {

        await sendCommand(
            "$ROT,HOME"
        );

    }


    async function park() {

        await sendCommand(
            "$ROT,PARK"
        );

    }


    async function requestStatus() {

        await sendCommand(
            "$ROT,STATUS"
        );

    }


    function processSimulationCommand(line) {

        const upperLine =
            line.toUpperCase();

        if (
            upperLine.startsWith(
                "$ROT,SET,"
            )
        ) {

            const values =
                parseParameterList(
                    line.slice(9)
                );

            state.targetAzimuth =
                Number(values.AZ);

            state.targetElevation =
                Number(values.EL);

            state.motionState =
                "MOVING";

        }
        else if (
            upperLine ===
            "$ROT,STOP"
        ) {

            state.targetAzimuth =
                state.currentAzimuth;

            state.targetElevation =
                state.currentElevation;

            state.motionState =
                "STOPPED";

        }
        else if (
            upperLine ===
            "$ROT,HOME"
        ) {

            state.targetAzimuth =
                0;

            state.targetElevation =
                0;

            state.motionState =
                "HOMING";

        }
        else if (
            upperLine ===
            "$ROT,PARK"
        ) {

            state.targetAzimuth =
                0;

            state.targetElevation =
                0;

            state.motionState =
                "MOVING";

        }
        else if (
            upperLine ===
            "$ROT,STATUS"
        ) {

            updateInterface();

        }

    }


    function approachValue(
        current,
        target,
        maximumChange
    ) {

        const difference =
            target - current;

        if (
            Math.abs(difference) <=
            maximumChange
        ) {

            return target;

        }

        return current +
            Math.sign(difference) *
            maximumChange;

    }


    function simulationStep() {

        const now =
            performance.now();

        const elapsedSeconds =
            Math.min(
                (
                    now -
                    state.lastSimulationTime
                ) / 1000,
                0.2
            );

        state.lastSimulationTime =
            now;

        if (
            state.motionState !== "MOVING" &&
            state.motionState !== "HOMING"
        ) {

            return;

        }

        const maximumChange =
            CONFIG
                .simulationSpeedDegreesPerSecond *
            elapsedSeconds;

        state.currentAzimuth =
            approachValue(
                state.currentAzimuth,
                state.targetAzimuth,
                maximumChange
            );

        state.currentElevation =
            approachValue(
                state.currentElevation,
                state.targetElevation,
                maximumChange
            );

        const reached =
            Math.abs(
                state.currentAzimuth -
                state.targetAzimuth
            ) < 0.001 &&
            Math.abs(
                state.currentElevation -
                state.targetElevation
            ) < 0.001;

        if (reached) {

            if (
                state.motionState ===
                "HOMING"
            ) {

                state.homed =
                    true;

            }

            state.motionState =
                "IDLE";

        }

        updateInterface();

    }


    function startSimulation() {

        if (state.simulationTimer !== null) {

            return;

        }

        state.simulation =
            true;

        state.motionState =
            "IDLE";

        state.lastSimulationTime =
            performance.now();

        state.simulationTimer =
            window.setInterval(
                simulationStep,
                CONFIG.simulationUpdatePeriodMs
            );

        elements.connectButton.textContent =
            "Отключить симулятор";

        elements.baudRate.disabled =
            true;

        setControlsEnabled(true);

        updateInterface();

        writeLog(
            "Симулятор поворотки запущен",
            "success"
        );

    }


    function stopSimulation() {

        if (state.simulationTimer !== null) {

            clearInterval(
                state.simulationTimer
            );

            state.simulationTimer =
                null;

        }

        state.simulation =
            false;

        state.motionState =
            "DISCONNECTED";

        state.homed =
            false;

        elements.connectButton.textContent =
            "Подключить поворотку";

        elements.baudRate.disabled =
            false;

        setControlsEnabled(false);

        updateInterface();

        writeLog(
            "Симулятор поворотки остановлен",
            "info"
        );

    }


    function registerEvents() {

        elements.connectButton
            ?.addEventListener(
                "click",
                toggleConnection
            );

        elements.moveButton
            ?.addEventListener(
                "click",
                moveToTarget
            );

        elements.stopButton
            ?.addEventListener(
                "click",
                emergencyStop
            );

        elements.homeButton
            ?.addEventListener(
                "click",
                startHoming
            );

        elements.parkButton
            ?.addEventListener(
                "click",
                park
            );

        elements.statusButton
            ?.addEventListener(
                "click",
                requestStatus
            );

        elements.simulationMode
            ?.addEventListener(
                "change",
                () => {

                    if (
                        state.connected ||
                        state.simulation
                    ) {

                        elements.simulationMode.checked =
                            state.simulation;

                        writeLog(
                            "Сначала отключите текущее соединение",
                            "warning"
                        );

                        return;

                    }

                    state.simulation =
                        elements.simulationMode.checked;

                }
            );

    }


    function initialize() {

        if (state.initialized) {

            return;

        }

        cacheElements();

        registerEvents();

        setControlsEnabled(false);

        updateInterface();

        state.initialized =
            true;

        writeLog(
            `Модуль поворотки v${CONFIG.version} загружен`,
            "success"
        );

    }


    window.OpenMCCRotator = Object.freeze({

        connect,

        disconnect,

        moveToTarget,

        emergencyStop,

        startHoming,

        park,

        requestStatus,

        parseRotatorLine,

        getState() {

            return {

                initialized:
                    state.initialized,

                connected:
                    state.connected,

                simulation:
                    state.simulation,

                currentAzimuth:
                    state.currentAzimuth,

                currentElevation:
                    state.currentElevation,

                targetAzimuth:
                    state.targetAzimuth,

                targetElevation:
                    state.targetElevation,

                motionState:
                    state.motionState,

                homed:
                    state.homed,

                lastCommand:
                    state.lastCommand

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