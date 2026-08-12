"use strict";

/* ============================================================
   OpenMCC
   Open Mission Control Center

   Module: serial.js
   Version: 0.1.0

   Назначение:
   - подключение последовательного USB-устройства;
   - поддержка STM32, Arduino Uno, Arduino Nano и ESP32;
   - открытие последовательного порта;
   - непрерывное чтение телеметрии;
   - передача текста в parser.js;
   - отправка команд устройству;
   - обработка физического отключения USB;
   - определение устройства по USB VID/PID;
   - безопасное закрытие порта.
   ============================================================ */


(() => {

    /* ========================================================
       КОНФИГУРАЦИЯ
       ======================================================== */

    const SERIAL_CONFIG = Object.freeze({

        version:
            "0.1.0",

        defaultBaudRate:
            115200,

        dataBits:
            8,

        stopBits:
            1,

        parity:
            "none",

        bufferSize:
            16384,

        flowControl:
            "none",

        writeLineEnding:
            "\n",

        maximumCommandLength:
            4096

    });


    /* ========================================================
       ПРОФИЛИ УСТРОЙСТВ
       ======================================================== */

    const DEVICE_PROFILES = Object.freeze({

        auto: Object.freeze({

            id:
                "auto",

            name:
                "Автоматическое определение",

            shortName:
                "AUTO",

            defaultBaudRate:
                115200

        }),


        stm32: Object.freeze({

            id:
                "stm32",

            name:
                "STM32",

            shortName:
                "STM32",

            defaultBaudRate:
                115200

        }),


        "arduino-uno": Object.freeze({

            id:
                "arduino-uno",

            name:
                "Arduino Uno",

            shortName:
                "UNO",

            defaultBaudRate:
                115200

        }),


        "arduino-nano": Object.freeze({

            id:
                "arduino-nano",

            name:
                "Arduino Nano",

            shortName:
                "NANO",

            defaultBaudRate:
                115200

        }),


        esp32: Object.freeze({

            id:
                "esp32",

            name:
                "ESP32",

            shortName:
                "ESP32",

            defaultBaudRate:
                115200

        })

    });


    /* ========================================================
       ИЗВЕСТНЫЕ USB-ИДЕНТИФИКАТОРЫ
       ======================================================== */

    /*
     * Определение по VID/PID носит вспомогательный характер.
     *
     * Многие платы используют преобразователи CH340, CP210x
     * или FTDI. Один и тот же преобразователь может находиться
     * на Arduino, ESP32 или плате STM32, поэтому пользователь
     * всегда может выбрать профиль вручную.
     */

    const USB_VENDOR_NAMES = Object.freeze({

        0x0483:
            "STMicroelectronics",

        0x2341:
            "Arduino",

        0x2A03:
            "Arduino",

        0x303A:
            "Espressif",

        0x10C4:
            "Silicon Labs CP210x",

        0x1A86:
            "WCH CH340/CH341",

        0x0403:
            "FTDI",

        0x067B:
            "Prolific",

        0x239A:
            "Adafruit",

        0x1B4F:
            "SparkFun"

    });


    const USB_DEVICE_HINTS = Object.freeze([

        Object.freeze({

            usbVendorId:
                0x0483,

            profile:
                "stm32",

            description:
                "STM32 / STMicroelectronics"

        }),


        Object.freeze({

            usbVendorId:
                0x2341,

            profile:
                "arduino-uno",

            description:
                "Arduino"

        }),


        Object.freeze({

            usbVendorId:
                0x2A03,

            profile:
                "arduino-uno",

            description:
                "Arduino"

        }),


        Object.freeze({

            usbVendorId:
                0x303A,

            profile:
                "esp32",

            description:
                "ESP32 / Espressif"

        }),


        Object.freeze({

            usbVendorId:
                0x10C4,

            profile:
                "esp32",

            description:
                "USB-UART CP210x"

        }),


        Object.freeze({

            usbVendorId:
                0x1A86,

            profile:
                "unknown",

            description:
                "USB-UART CH340/CH341"

        }),


        Object.freeze({

            usbVendorId:
                0x0403,

            profile:
                "unknown",

            description:
                "USB-UART FTDI"

        })

    ]);


    /* ========================================================
       СОСТОЯНИЕ
       ======================================================== */

    const state = {

        initialized:
            false,

        supported:
            false,

        connecting:
            false,

        connected:
            false,

        disconnecting:
            false,

        readLoopActive:
            false,

        port:
            null,

        reader:
            null,

        writer:
            null,

        decoder:
            null,

        selectedProfile:
            "auto",

        detectedProfile:
            "unknown",

        baudRate:
            SERIAL_CONFIG.defaultBaudRate,

        usbVendorId:
            null,

        usbProductId:
            null,

        receivedBytes:
            0,

        transmittedBytes:
            0,

        receivedFragments:
            0,

        transmittedMessages:
            0,

        connectionStartedAt:
            null,

        lastReceiveTime:
            null,

        lastTransmitTime:
            null

    };


    /* ========================================================
       DOM-ЭЛЕМЕНТЫ
       ======================================================== */

    const elements = {

        connectButton:
            null,

        deviceProfile:
            null,

        serialBaudRate:
            null,

        baudRateDisplay:
            null

    };


    /* ========================================================
       ЖУРНАЛИРОВАНИЕ
       ======================================================== */

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
                "SERIAL",
                metadata
            );

            return;

        }

        const method =
            type === "error"
                ? "error"
                : type === "warning"
                    ? "warn"
                    : "log";

        console[method](
            `[OpenMCC Serial] ${message}`,
            metadata || ""
        );

    }


    /* ========================================================
       СОБЫТИЯ
       ======================================================== */

    function emitEvent(
        eventName,
        detail = null
    ) {

        window.dispatchEvent(
            new CustomEvent(
                eventName,
                {
                    detail
                }
            )
        );

    }


    /* ========================================================
       ПРОВЕРКА ПОДДЕРЖКИ
       ======================================================== */

    function isSupported() {

        return (
            typeof navigator !== "undefined" &&
            "serial" in navigator
        );

    }


    function assertSupported() {

        if (!isSupported()) {

            throw new Error(
                "Web Serial API не поддерживается этим браузером"
            );

        }

    }


    /* ========================================================
       РАБОТА С НАСТРОЙКАМИ
       ======================================================== */

    function getSelectedProfileId() {

        const selected =
            elements.deviceProfile?.value ||
            state.selectedProfile ||
            "auto";

        if (
            Object.hasOwn(
                DEVICE_PROFILES,
                selected
            )
        ) {

            return selected;

        }

        return "auto";

    }


    function getSelectedBaudRate() {

        const rawValue =
            elements.serialBaudRate?.value;

        const baudRate =
            Number(rawValue);

        if (
            Number.isInteger(baudRate) &&
            baudRate > 0
        ) {

            return baudRate;

        }

        return SERIAL_CONFIG.defaultBaudRate;

    }


    function setControlsDisabled(disabled) {

        if (elements.deviceProfile) {

            elements.deviceProfile.disabled =
                disabled;

        }

        if (elements.serialBaudRate) {

            elements.serialBaudRate.disabled =
                disabled;

        }

    }


    function setButtonBusy(
        busy,
        text = null
    ) {

        if (!elements.connectButton) {

            return;

        }

        elements.connectButton.classList.toggle(
            "busy",
            busy
        );

        elements.connectButton.disabled =
            busy;

        if (text !== null) {

            elements.connectButton.textContent =
                text;

        }

    }


    function updateBaudRateDisplay() {

        if (!elements.baudRateDisplay) {

            return;

        }

        elements.baudRateDisplay.textContent =
            state.baudRate.toLocaleString(
                "ru-RU"
            );

    }


    /* ========================================================
       USB-ИНФОРМАЦИЯ
       ======================================================== */

    function getPortInformation(port) {

        if (
            !port ||
            typeof port.getInfo !== "function"
        ) {

            return {

                usbVendorId:
                    null,

                usbProductId:
                    null

            };

        }

        try {

            const information =
                port.getInfo();

            return {

                usbVendorId:
                    Number.isInteger(
                        information.usbVendorId
                    )
                        ? information.usbVendorId
                        : null,

                usbProductId:
                    Number.isInteger(
                        information.usbProductId
                    )
                        ? information.usbProductId
                        : null

            };

        }
        catch {

            return {

                usbVendorId:
                    null,

                usbProductId:
                    null

            };

        }

    }


    function formatUsbIdentifier(value) {

        if (!Number.isInteger(value)) {

            return "----";

        }

        return value
            .toString(16)
            .toUpperCase()
            .padStart(4, "0");

    }


    function detectDeviceProfile(
        usbVendorId,
        usbProductId
    ) {

        const hint =
            USB_DEVICE_HINTS.find(item => {

                if (
                    item.usbVendorId !==
                    usbVendorId
                ) {

                    return false;

                }

                if (
                    item.usbProductId !== undefined &&
                    item.usbProductId !==
                    usbProductId
                ) {

                    return false;

                }

                return true;

            });

        if (!hint) {

            return {

                profileId:
                    "unknown",

                description:
                    "Неизвестное последовательное устройство"

            };

        }

        return {

            profileId:
                hint.profile,

            description:
                hint.description

        };

    }


    function getEffectiveDeviceProfile() {

        const selectedProfile =
            getSelectedProfileId();

        if (selectedProfile !== "auto") {

            return selectedProfile;

        }

        if (
            Object.hasOwn(
                DEVICE_PROFILES,
                state.detectedProfile
            )
        ) {

            return state.detectedProfile;

        }

        return "auto";

    }


    function createDeviceDisplayName() {

        const effectiveProfile =
            getEffectiveDeviceProfile();

        const profile =
            DEVICE_PROFILES[effectiveProfile];

        const vendorName =
            state.usbVendorId !== null
                ? USB_VENDOR_NAMES[
                    state.usbVendorId
                ]
                : null;

        const parts = [];

        if (
            profile &&
            effectiveProfile !== "auto"
        ) {

            parts.push(
                profile.name
            );

        }
        else if (vendorName) {

            parts.push(
                vendorName
            );

        }
        else {

            parts.push(
                "USB Serial"
            );

        }

        if (
            state.usbVendorId !== null ||
            state.usbProductId !== null
        ) {

            parts.push(
                `VID:${formatUsbIdentifier(
                    state.usbVendorId
                )}`
            );

            parts.push(
                `PID:${formatUsbIdentifier(
                    state.usbProductId
                )}`
            );

        }

        return parts.join(" · ");

    }


    /* ========================================================
       ВЫБОР ПОРТА
       ======================================================== */

    async function requestPort() {

        assertSupported();

        /*
         * Фильтр намеренно не используется.
         *
         * Arduino Nano, ESP32 и STM32 могут оснащаться
         * различными USB-UART-преобразователями. Жёсткая
         * фильтрация скрыла бы часть совместимых плат.
         */

        return navigator.serial.requestPort();

    }


    /* ========================================================
       ПОДКЛЮЧЕНИЕ
       ======================================================== */

    async function connect() {

        if (
            state.connected ||
            state.connecting
        ) {

            return;

        }

        assertSupported();

        if (!window.isSecureContext) {

            throw new Error(
                "Для Web Serial API требуется защищённый контекст или localhost"
            );

        }

        if (
            !window.OpenMCCParser ||
            typeof window.OpenMCCParser.pushText !==
                "function"
        ) {

            throw new Error(
                "Модуль parser.js не загружен"
            );

        }

        state.connecting =
            true;

        state.selectedProfile =
            getSelectedProfileId();

        state.baudRate =
            getSelectedBaudRate();

        setControlsDisabled(true);

        setButtonBusy(
            true,
            "Выбор последовательного порта..."
        );

        writeLog(
            "Открыто окно выбора последовательного устройства",
            "info"
        );

        try {

            const selectedPort =
                await requestPort();

            state.port =
                selectedPort;

            const portInformation =
                getPortInformation(
                    selectedPort
                );

            state.usbVendorId =
                portInformation.usbVendorId;

            state.usbProductId =
                portInformation.usbProductId;

            const detection =
                detectDeviceProfile(
                    state.usbVendorId,
                    state.usbProductId
                );

            state.detectedProfile =
                detection.profileId;

            writeLog(
                `Выбрано устройство: ${detection.description}`,
                "info",
                {
                    selectedProfile:
                        state.selectedProfile,

                    detectedProfile:
                        state.detectedProfile,

                    usbVendorId:
                        state.usbVendorId,

                    usbProductId:
                        state.usbProductId
                }
            );

            await selectedPort.open({

                baudRate:
                    state.baudRate,

                dataBits:
                    SERIAL_CONFIG.dataBits,

                stopBits:
                    SERIAL_CONFIG.stopBits,

                parity:
                    SERIAL_CONFIG.parity,

                bufferSize:
                    SERIAL_CONFIG.bufferSize,

                flowControl:
                    SERIAL_CONFIG.flowControl

            });

            state.connected =
                true;

            state.connectionStartedAt =
                Date.now();

            state.receivedBytes =
                0;

            state.transmittedBytes =
                0;

            state.receivedFragments =
                0;

            state.transmittedMessages =
                0;

            updateBaudRateDisplay();

            const deviceName =
                createDeviceDisplayName();

            writeLog(
                `Последовательный порт открыт: ${state.baudRate} бод`,
                "success",
                {
                    deviceName,

                    baudRate:
                        state.baudRate
                }
            );

            emitEvent(
                "openmcc:serial-connected",
                {

                    portName:
                        deviceName,

                    baudRate:
                        state.baudRate,

                    selectedProfile:
                        state.selectedProfile,

                    detectedProfile:
                        state.detectedProfile,

                    effectiveProfile:
                        getEffectiveDeviceProfile(),

                    usbVendorId:
                        state.usbVendorId,

                    usbProductId:
                        state.usbProductId

                }
            );

            setButtonBusy(
                false
            );

            startReadLoop();

        }
        catch (error) {

            await cleanupFailedConnection();

            if (
                error?.name ===
                "NotFoundError"
            ) {

                writeLog(
                    "Выбор последовательного порта отменён",
                    "warning"
                );

                return;

            }

            writeLog(
                `Не удалось подключить устройство: ${error.message}`,
                "error",
                {
                    errorName:
                        error?.name
                }
            );

            emitEvent(
                "openmcc:serial-error",
                {

                    operation:
                        "connect",

                    message:
                        error.message,

                    name:
                        error.name

                }
            );

            throw error;

        }
        finally {

            state.connecting =
                false;

            if (!state.connected) {

                setControlsDisabled(false);

                setButtonBusy(
                    false,
                    "Подключить устройство"
                );

            }

        }

    }


    /* ========================================================
       ЧТЕНИЕ ДАННЫХ
       ======================================================== */

    async function startReadLoop() {

        if (
            !state.port ||
            !state.port.readable ||
            state.readLoopActive
        ) {

            return;

        }

        state.readLoopActive =
            true;

        state.decoder =
            new TextDecoder(
                "utf-8",
                {
                    fatal: false
                }
            );

        writeLog(
            "Запущен приём телеметрии",
            "success"
        );

        try {

            while (
                state.connected &&
                state.port?.readable
            ) {

                state.reader =
                    state.port.readable.getReader();

                try {

                    while (state.connected) {

                        const result =
                            await state.reader.read();

                        if (result.done) {

                            break;

                        }

                        if (
                            !result.value ||
                            result.value.byteLength === 0
                        ) {

                            continue;

                        }

                        state.receivedBytes +=
                            result.value.byteLength;

                        state.receivedFragments +=
                            1;

                        state.lastReceiveTime =
                            Date.now();

                        const text =
                            state.decoder.decode(
                                result.value,
                                {
                                    stream: true
                                }
                            );

                        if (text !== "") {

                            window.OpenMCCParser.pushText(
                                text
                            );

                            emitEvent(
                                "openmcc:serial-data",
                                {

                                    text,

                                    byteLength:
                                        result.value.byteLength,

                                    totalBytes:
                                        state.receivedBytes,

                                    timestamp:
                                        state.lastReceiveTime

                                }
                            );

                        }

                    }

                }
                catch (error) {

                    if (
                        state.connected &&
                        error?.name !==
                            "NetworkError" &&
                        error?.name !==
                            "AbortError"
                    ) {

                        writeLog(
                            `Ошибка чтения последовательного порта: ${error.message}`,
                            "error"
                        );

                        emitEvent(
                            "openmcc:serial-error",
                            {

                                operation:
                                    "read",

                                message:
                                    error.message,

                                name:
                                    error.name

                            }
                        );

                    }

                }
                finally {

                    if (state.reader) {

                        try {

                            state.reader.releaseLock();

                        }
                        catch {

                            // Блокировка могла быть снята ранее.
                        }

                        state.reader =
                            null;

                    }

                }

                if (state.connected) {

                    break;

                }

            }

        }
        finally {

            state.readLoopActive =
                false;

            if (
                state.connected &&
                !state.disconnecting
            ) {

                writeLog(
                    "Поток последовательного порта завершён",
                    "warning"
                );

                await disconnect(
                    "read-stream-ended"
                );

            }

        }

    }


    /* ========================================================
       ОТПРАВКА ДАННЫХ
       ======================================================== */

    async function writeText(text) {

        if (
            !state.connected ||
            !state.port ||
            !state.port.writable
        ) {

            throw new Error(
                "Последовательное устройство не подключено"
            );

        }

        const message =
            String(text ?? "");

        if (message.length === 0) {

            return;

        }

        if (
            message.length >
            SERIAL_CONFIG.maximumCommandLength
        ) {

            throw new Error(
                "Команда превышает допустимую длину"
            );

        }

        const encoder =
            new TextEncoder();

        const data =
            encoder.encode(message);

        const writer =
            state.port.writable.getWriter();

        state.writer =
            writer;

        try {

            await writer.write(data);

            state.transmittedBytes +=
                data.byteLength;

            state.transmittedMessages +=
                1;

            state.lastTransmitTime =
                Date.now();

            emitEvent(
                "openmcc:serial-write",
                {

                    text:
                        message,

                    byteLength:
                        data.byteLength,

                    totalBytes:
                        state.transmittedBytes,

                    timestamp:
                        state.lastTransmitTime

                }
            );

        }
        finally {

            try {

                writer.releaseLock();

            }
            catch {

                // Блокировка могла быть снята ранее.
            }

            state.writer =
                null;

        }

    }


    async function writeLine(text) {

        const normalized =
            String(text ?? "")
                .replace(/[\r\n]+$/g, "");

        await writeText(
            normalized +
            SERIAL_CONFIG.writeLineEnding
        );

    }


    async function sendCommand(
        command,
        parameters = null
    ) {

        const commandName =
            String(command ?? "")
                .trim()
                .toUpperCase();

        if (!commandName) {

            throw new Error(
                "Не задано имя команды"
            );

        }

        let line =
            `$CMD,${commandName}`;

        if (
            parameters !== null &&
            parameters !== undefined
        ) {

            if (
                typeof parameters === "object" &&
                !Array.isArray(parameters)
            ) {

                const parameterText =
                    Object.entries(parameters)
                        .map(
                            ([key, value]) =>
                                `${String(key).toUpperCase()}=${value}`
                        )
                        .join(",");

                if (parameterText) {

                    line +=
                        `,${parameterText}`;

                }

            }
            else {

                line +=
                    `,VALUE=${parameters}`;

            }

        }

        await writeLine(line);

        writeLog(
            `Передана команда: ${line}`,
            "command"
        );

        return line;

    }


    /* ========================================================
       ОТКЛЮЧЕНИЕ
       ======================================================== */

    async function disconnect(
        reason = "user"
    ) {

        if (
            state.disconnecting ||
            (
                !state.connected &&
                !state.port
            )
        ) {

            return;

        }

        state.disconnecting =
            true;

        setButtonBusy(
            true,
            "Отключение..."
        );

        writeLog(
            "Закрытие последовательного соединения",
            "info",
            {
                reason
            }
        );

        try {

            state.connected =
                false;

            if (state.reader) {

                try {

                    await state.reader.cancel();

                }
                catch {

                    // Поток мог быть закрыт устройством.
                }

                try {

                    state.reader.releaseLock();

                }
                catch {

                    // Блокировка могла быть снята циклом чтения.
                }

                state.reader =
                    null;

            }

            if (state.writer) {

                try {

                    await state.writer.close();

                }
                catch {

                    // Поток записи мог быть уже закрыт.
                }

                try {

                    state.writer.releaseLock();

                }
                catch {

                    // Блокировка могла быть снята ранее.
                }

                state.writer =
                    null;

            }

            if (
                window.OpenMCCParser &&
                typeof window.OpenMCCParser.flush ===
                    "function"
            ) {

                window.OpenMCCParser.flush();

            }

            if (state.port) {

                try {

                    await state.port.close();

                }
                catch (error) {

                    if (
                        error?.name !==
                        "InvalidStateError"
                    ) {

                        writeLog(
                            `Порт закрыт с предупреждением: ${error.message}`,
                            "warning"
                        );

                    }

                }

            }

        }
        finally {

            const disconnectedDevice =
                createDeviceDisplayName();

            resetConnectionState();

            emitEvent(
                "openmcc:serial-disconnected",
                {

                    reason,

                    deviceName:
                        disconnectedDevice,

                    timestamp:
                        Date.now()

                }
            );

            writeLog(
                "Последовательное соединение закрыто",
                "success"
            );

            setControlsDisabled(false);

            setButtonBusy(
                false,
                "Подключить устройство"
            );

            state.disconnecting =
                false;

        }

    }


    async function cleanupFailedConnection() {

        if (state.reader) {

            try {

                await state.reader.cancel();

            }
            catch {

                // Игнорируем ошибку очистки.
            }

            try {

                state.reader.releaseLock();

            }
            catch {

                // Игнорируем ошибку очистки.
            }

        }

        if (state.port) {

            try {

                await state.port.close();

            }
            catch {

                // Порт мог не успеть открыться.
            }

        }

        resetConnectionState();

    }


    function resetConnectionState() {

        state.connected =
            false;

        state.connecting =
            false;

        state.readLoopActive =
            false;

        state.port =
            null;

        state.reader =
            null;

        state.writer =
            null;

        state.decoder =
            null;

        state.usbVendorId =
            null;

        state.usbProductId =
            null;

        state.detectedProfile =
            "unknown";

        state.connectionStartedAt =
            null;

        state.lastReceiveTime =
            null;

        state.lastTransmitTime =
            null;

    }


    /* ========================================================
       ПЕРЕКЛЮЧЕНИЕ СОЕДИНЕНИЯ
       ======================================================== */

    async function toggleConnection() {

        if (
            state.connecting ||
            state.disconnecting
        ) {

            return;

        }

        if (state.connected) {

            await disconnect(
                "user"
            );

        }
        else {

            await connect();

        }

    }


    /* ========================================================
       ФИЗИЧЕСКОЕ ОТКЛЮЧЕНИЕ USB
       ======================================================== */

    function handlePhysicalDisconnect(event) {

        if (
            !state.port ||
            event.target !== state.port
        ) {

            return;

        }

        writeLog(
            "Обнаружено физическое отключение USB-устройства",
            "warning"
        );

        disconnect(
            "physical-disconnect"
        ).catch(error => {

            writeLog(
                `Ошибка после отключения USB: ${error.message}`,
                "error"
            );

        });

    }


    function handlePhysicalConnect(event) {

        const information =
            getPortInformation(
                event.target
            );

        writeLog(
            "Обнаружено подключение последовательного USB-устройства",
            "info",
            information
        );

        emitEvent(
            "openmcc:serial-device-attached",
            information
        );

    }


    /* ========================================================
       НАСТРОЙКА ПРОФИЛЯ
       ======================================================== */

    function setDeviceProfile(
        profileId
    ) {

        if (
            state.connected ||
            state.connecting
        ) {

            throw new Error(
                "Нельзя менять профиль при активном соединении"
            );

        }

        if (
            !Object.hasOwn(
                DEVICE_PROFILES,
                profileId
            )
        ) {

            throw new Error(
                `Неизвестный профиль устройства: ${profileId}`
            );

        }

        state.selectedProfile =
            profileId;

        if (elements.deviceProfile) {

            elements.deviceProfile.value =
                profileId;

        }

        const profile =
            DEVICE_PROFILES[profileId];

        if (
            elements.serialBaudRate &&
            profile.defaultBaudRate
        ) {

            elements.serialBaudRate.value =
                String(
                    profile.defaultBaudRate
                );

        }

    }


    function setBaudRate(
        baudRate
    ) {

        if (
            state.connected ||
            state.connecting
        ) {

            throw new Error(
                "Нельзя менять скорость при активном соединении"
            );

        }

        const numericBaudRate =
            Number(baudRate);

        if (
            !Number.isInteger(numericBaudRate) ||
            numericBaudRate <= 0
        ) {

            throw new Error(
                "Указана некорректная скорость последовательного порта"
            );

        }

        state.baudRate =
            numericBaudRate;

        if (elements.serialBaudRate) {

            const optionExists =
                Array.from(
                    elements.serialBaudRate.options
                ).some(
                    option =>
                        Number(option.value) ===
                        numericBaudRate
                );

            if (!optionExists) {

                const option =
                    document.createElement("option");

                option.value =
                    String(numericBaudRate);

                option.textContent =
                    `${numericBaudRate} бод`;

                elements.serialBaudRate.appendChild(
                    option
                );

            }

            elements.serialBaudRate.value =
                String(numericBaudRate);

        }

    }


    /* ========================================================
       ИНИЦИАЛИЗАЦИЯ
       ======================================================== */

    function cacheElements() {

        elements.connectButton =
            document.getElementById(
                "connectButton"
            );

        elements.deviceProfile =
            document.getElementById(
                "deviceProfile"
            );

        elements.serialBaudRate =
            document.getElementById(
                "serialBaudRate"
            );

        elements.baudRateDisplay =
            document.getElementById(
                "baudRate"
            );

    }


    function registerInterfaceEvents() {

        if (elements.deviceProfile) {

    elements.deviceProfile.addEventListener(
        "change",
        () => {

            const profileId =
                getSelectedProfileId();

            state.selectedProfile =
                profileId;

            const profile =
                DEVICE_PROFILES[profileId];

            if (
                profile &&
                elements.serialBaudRate
            ) {

                elements.serialBaudRate.value =
                    String(
                        profile.defaultBaudRate
                    );

            }

            if (
                profile &&
                elements.connectButton &&
                !state.connected
            ) {

                elements.connectButton.textContent =
                    profileId === "auto"
                        ? "Подключить устройство"
                        : `Подключить ${profile.name}`;

            }

            writeLog(
                `Выбран профиль: ${profile.name}`,
                "info"
            );

        }
    );

}


        if (elements.serialBaudRate) {

            elements.serialBaudRate.addEventListener(
                "change",
                () => {

                    state.baudRate =
                        getSelectedBaudRate();

                    updateBaudRateDisplay();

                    writeLog(
                        `Установлена скорость: ${state.baudRate} бод`,
                        "info"
                    );

                }
            );

        }

    }


    function initialize() {

        if (state.initialized) {

            return;

        }

        cacheElements();

        state.supported =
            isSupported();

        state.selectedProfile =
            getSelectedProfileId();

        state.baudRate =
            getSelectedBaudRate();

        updateBaudRateDisplay();

        registerInterfaceEvents();

        if (state.supported) {

            navigator.serial.addEventListener(
                "connect",
                handlePhysicalConnect
            );

            navigator.serial.addEventListener(
                "disconnect",
                handlePhysicalDisconnect
            );

            writeLog(
                `Модуль последовательного порта v${SERIAL_CONFIG.version} готов`,
                "success"
            );

        }
        else {

            writeLog(
                "Web Serial API недоступен",
                "warning"
            );

        }

        state.initialized =
            true;

        emitEvent(
            "openmcc:serial-ready",
            {

                version:
                    SERIAL_CONFIG.version,

                supported:
                    state.supported

            }
        );

    }


    /* ========================================================
       ПУБЛИЧНЫЙ API
       ======================================================== */

    window.OpenMCCSerial = Object.freeze({

        config:
            SERIAL_CONFIG,

        deviceProfiles:
            DEVICE_PROFILES,

        connect,

        disconnect,

        toggleConnection,

        writeText,

        writeLine,

        sendCommand,

        setDeviceProfile,

        setBaudRate,

        isSupported,

        getState() {

            return {

                initialized:
                    state.initialized,

                supported:
                    state.supported,

                connecting:
                    state.connecting,

                connected:
                    state.connected,

                disconnecting:
                    state.disconnecting,

                readLoopActive:
                    state.readLoopActive,

                selectedProfile:
                    state.selectedProfile,

                detectedProfile:
                    state.detectedProfile,

                effectiveProfile:
                    getEffectiveDeviceProfile(),

                baudRate:
                    state.baudRate,

                usbVendorId:
                    state.usbVendorId,

                usbProductId:
                    state.usbProductId,

                receivedBytes:
                    state.receivedBytes,

                transmittedBytes:
                    state.transmittedBytes,

                receivedFragments:
                    state.receivedFragments,

                transmittedMessages:
                    state.transmittedMessages,

                connectionStartedAt:
                    state.connectionStartedAt,

                lastReceiveTime:
                    state.lastReceiveTime,

                lastTransmitTime:
                    state.lastTransmitTime

            };

        }

    });


    /* ========================================================
       ЗАПУСК
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