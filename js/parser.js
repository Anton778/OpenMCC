"use strict";

/* ============================================================
   OpenMCC
   Open Mission Control Center

   Module: parser.js
   Version: 0.1.0

   Назначение:
   - разбор строк телеметрии;
   - проверка названий параметров;
   - преобразование числовых значений;
   - поддержка нескольких текстовых форматов;
   - накопление неполных фрагментов из последовательного порта;
   - формирование событий openmcc:telemetry;
   - регистрация ошибок разбора.
   ============================================================ */


(() => {

    /* ========================================================
       КОНФИГУРАЦИЯ
       ======================================================== */

    const PARSER_CONFIG = Object.freeze({

        version:
            "0.1.0",

        maximumBufferLength:
            65536,

        maximumLineLength:
            4096,

        maximumParametersPerPacket:
            128,

        allowUnknownParameters:
            true,

        allowEmptyLines:
            true,

        convertBooleanValues:
            true,

        convertNullValues:
            true,

        decimalCommaSupport:
            true,

        emitRawLineEvents:
            true,

        telemetryPrefix:
            "$TEL",

        commentPrefixes:
            Object.freeze([
                "#",
                "//",
                ";"
            ])

    });


    /* ========================================================
       ИЗВЕСТНЫЕ ТЕЛЕМЕТРИЧЕСКИЕ ПАРАМЕТРЫ
       ======================================================== */

    /*
     * Этот список не ограничивает протокол.
     * При allowUnknownParameters = true STM32 может передавать
     * любые дополнительные параметры.
     */

    const KNOWN_PARAMETERS = Object.freeze({

        TEMP: Object.freeze({
            type: "number",
            unit: "°C"
        }),

        VOLT: Object.freeze({
            type: "number",
            unit: "V"
        }),

        CURR: Object.freeze({
            type: "number",
            unit: "mA"
        }),

        RSSI: Object.freeze({
            type: "number",
            unit: "dBm"
        }),

        SNR: Object.freeze({
            type: "number",
            unit: "dB"
        }),

        ROLL: Object.freeze({
            type: "number",
            unit: "deg"
        }),

        PITCH: Object.freeze({
            type: "number",
            unit: "deg"
        }),

        YAW: Object.freeze({
            type: "number",
            unit: "deg"
        }),

        LAT: Object.freeze({
            type: "number",
            unit: "deg"
        }),

        LON: Object.freeze({
            type: "number",
            unit: "deg"
        }),

        ALT: Object.freeze({
            type: "number",
            unit: "m"
        }),

        SPEED: Object.freeze({
            type: "number",
            unit: "m/s"
        }),

        POWER: Object.freeze({
            type: "boolean"
        }),

        TX: Object.freeze({
            type: "boolean"
        }),

        RX: Object.freeze({
            type: "boolean"
        }),

        CRC: Object.freeze({
            type: "number"
        }),

        TIME: Object.freeze({
            type: "string"
        })

    });


    /* ========================================================
       СОСТОЯНИЕ
       ======================================================== */

    const state = {

        initialized:
            false,

        textBuffer:
            "",

        totalFragments:
            0,

        totalLines:
            0,

        parsedPackets:
            0,

        parsedParameters:
            0,

        ignoredLines:
            0,

        errorCount:
            0,

        lastRawLine:
            "",

        lastPacket:
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
                "PARSER",
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
            `[OpenMCC Parser] ${message}`,
            metadata || ""
        );

    }


    /* ========================================================
       СОБЫТИЯ
       ======================================================== */

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


    function emitParserError(
        message,
        rawLine = "",
        error = null
    ) {

        state.errorCount += 1;

        const detail = {

            message:
                String(message),

            rawLine:
                String(rawLine),

            error:
                error instanceof Error
                    ? error.message
                    : error,

            timestamp:
                Date.now()

        };

        emitEvent(
            "openmcc:telemetry-error",
            detail
        );

        writeLog(
            message,
            "error",
            detail
        );

    }


    /* ========================================================
       НОРМАЛИЗАЦИЯ СТРОК
       ======================================================== */

    function normalizeLine(line) {

        return String(line ?? "")
            .replace(/\u0000/g, "")
            .replace(/\r/g, "")
            .trim();

    }


    function isCommentLine(line) {

        return PARSER_CONFIG.commentPrefixes.some(
            prefix => line.startsWith(prefix)
        );

    }


    function normalizeParameterName(name) {

        return String(name ?? "")
            .trim()
            .replace(/^\$/, "")
            .replace(/[\s\-]+/g, "_")
            .replace(/[^A-Za-z0-9_]/g, "")
            .toUpperCase();

    }


    /* ========================================================
       ПРЕОБРАЗОВАНИЕ ЗНАЧЕНИЙ
       ======================================================== */

    function normalizeNumericString(value) {

        let result =
            String(value ?? "").trim();

        if (
            PARSER_CONFIG.decimalCommaSupport &&
            result.includes(",") &&
            !result.includes(".")
        ) {

            result =
                result.replace(",", ".");

        }

        return result;

    }


    function parseBoolean(value) {

        const normalized =
            String(value ?? "")
                .trim()
                .toLowerCase();

        const trueValues = new Set([
            "1",
            "true",
            "on",
            "yes",
            "ok",
            "active",
            "enabled"
        ]);

        const falseValues = new Set([
            "0",
            "false",
            "off",
            "no",
            "fail",
            "inactive",
            "disabled"
        ]);

        if (trueValues.has(normalized)) {

            return true;

        }

        if (falseValues.has(normalized)) {

            return false;

        }

        return null;

    }


    function parseGenericValue(rawValue) {

        const trimmedValue =
            String(rawValue ?? "").trim();

        if (trimmedValue === "") {

            return "";

        }

        if (PARSER_CONFIG.convertNullValues) {

            const normalized =
                trimmedValue.toLowerCase();

            if (
                normalized === "null" ||
                normalized === "none" ||
                normalized === "nan" ||
                normalized === "---"
            ) {

                return null;

            }

        }

        if (PARSER_CONFIG.convertBooleanValues) {

            const booleanValue =
                parseBoolean(trimmedValue);

            if (booleanValue !== null) {

                return booleanValue;

            }

        }

        const numericString =
            normalizeNumericString(trimmedValue);

        const numericValue =
            Number(numericString);

        if (
            numericString !== "" &&
            Number.isFinite(numericValue)
        ) {

            return numericValue;

        }

        return trimmedValue;

    }


    function parseValueForParameter(
        parameterName,
        rawValue
    ) {

        const definition =
            KNOWN_PARAMETERS[parameterName];

        if (!definition) {

            return parseGenericValue(rawValue);

        }

        switch (definition.type) {

            case "number": {

                const numericValue =
                    Number(
                        normalizeNumericString(rawValue)
                    );

                if (!Number.isFinite(numericValue)) {

                    throw new Error(
                        `Параметр ${parameterName} должен содержать число`
                    );

                }

                return numericValue;

            }


            case "boolean": {

                const booleanValue =
                    parseBoolean(rawValue);

                if (booleanValue === null) {

                    throw new Error(
                        `Параметр ${parameterName} должен содержать логическое значение`
                    );

                }

                return booleanValue;

            }


            case "string":
            default:

                return String(rawValue ?? "").trim();

        }

    }


    /* ========================================================
       РАЗБОР ПАРЫ KEY=VALUE
       ======================================================== */

    function parseKeyValuePair(
        pair,
        rawLine
    ) {

        const separatorIndex =
            pair.indexOf("=");

        if (separatorIndex < 1) {

            throw new Error(
                `В элементе отсутствует разделитель "=": ${pair}`
            );

        }

        const rawKey =
            pair.slice(0, separatorIndex);

        const rawValue =
            pair.slice(separatorIndex + 1);

        const key =
            normalizeParameterName(rawKey);

        if (!key) {

            throw new Error(
                "Получено пустое имя параметра"
            );

        }

        if (
            !PARSER_CONFIG.allowUnknownParameters &&
            !Object.hasOwn(
                KNOWN_PARAMETERS,
                key
            )
        ) {

            throw new Error(
                `Неизвестный параметр: ${key}`
            );

        }

        const value =
            parseValueForParameter(
                key,
                rawValue
            );

        return {
            key,
            value,
            rawValue,
            rawLine
        };

    }


    /* ========================================================
       РАЗДЕЛЕНИЕ ПАКЕТА
       ======================================================== */

    function splitPacketItems(line) {

        /*
         * В основном формате запятая разделяет параметры:
         *
         * $TEL,TEMP=23.4,VOLT=5.01
         *
         * Точка с запятой также допускается:
         *
         * TEMP=23.4;VOLT=5.01
         */

        return line
            .split(/[;,]/)
            .map(item => item.trim())
            .filter(Boolean);

    }


    /* ========================================================
       ПОДДЕРЖИВАЕМЫЕ ФОРМАТЫ
       ======================================================== */

    /*
     * Формат 1:
     *
     * TEMP=23.4
     */


    function parseSingleParameterLine(line) {

        const parsedPair =
            parseKeyValuePair(
                line,
                line
            );

        return {
            [parsedPair.key]:
                parsedPair.value
        };

    }


    /*
     * Формат 2:
     *
     * $TEL,TEMP=23.4,VOLT=5.01,CURR=180
     *
     * или:
     *
     * TEMP=23.4;VOLT=5.01;CURR=180
     */


    function parseMultiParameterLine(line) {

        let normalizedPacket =
            line.trim();

        if (
            normalizedPacket
                .toUpperCase()
                .startsWith(
                    PARSER_CONFIG.telemetryPrefix
                )
        ) {

            normalizedPacket =
                normalizedPacket.slice(
                    PARSER_CONFIG.telemetryPrefix.length
                );

            normalizedPacket =
                normalizedPacket.replace(
                    /^[,;:\s]+/,
                    ""
                );

        }

        const items =
            splitPacketItems(normalizedPacket);

        if (
            items.length >
            PARSER_CONFIG.maximumParametersPerPacket
        ) {

            throw new Error(
                "Превышено максимально допустимое число параметров в пакете"
            );

        }

        const packet = {};

        for (const item of items) {

            const parsedPair =
                parseKeyValuePair(
                    item,
                    line
                );

            packet[parsedPair.key] =
                parsedPair.value;

        }

        return packet;

    }


    /*
     * Формат 3 — JSON:
     *
     * {"TEMP":23.4,"VOLT":5.01}
     */


    function parseJsonLine(line) {

        const parsed =
            JSON.parse(line);

        if (
            parsed === null ||
            Array.isArray(parsed) ||
            typeof parsed !== "object"
        ) {

            throw new Error(
                "JSON-пакет должен быть объектом"
            );

        }

        const packet = {};

        const entries =
            Object.entries(parsed);

        if (
            entries.length >
            PARSER_CONFIG.maximumParametersPerPacket
        ) {

            throw new Error(
                "Превышено максимально допустимое число параметров"
            );

        }

        for (
            const [rawKey, rawValue]
            of entries
        ) {

            const key =
                normalizeParameterName(rawKey);

            if (!key) {

                continue;

            }

            if (
                !PARSER_CONFIG.allowUnknownParameters &&
                !Object.hasOwn(
                    KNOWN_PARAMETERS,
                    key
                )
            ) {

                continue;

            }

            if (
                typeof rawValue === "number" ||
                typeof rawValue === "boolean" ||
                rawValue === null
            ) {

                packet[key] =
                    rawValue;

            }
            else {

                packet[key] =
                    parseValueForParameter(
                        key,
                        rawValue
                    );

            }

        }

        return packet;

    }


    /* ========================================================
       ОПРЕДЕЛЕНИЕ ФОРМАТА
       ======================================================== */

    function detectFormat(line) {

        const trimmed =
            line.trim();

        if (
            trimmed.startsWith("{") &&
            trimmed.endsWith("}")
        ) {

            return "json";

        }

        const upperLine =
            trimmed.toUpperCase();

        if (
            upperLine.startsWith(
                PARSER_CONFIG.telemetryPrefix
            )
        ) {

            return "multi";

        }

        const equalsCount =
            (trimmed.match(/=/g) || []).length;

        if (
            equalsCount > 1 ||
            trimmed.includes(";")
        ) {

            return "multi";

        }

        if (equalsCount === 1) {

            return "single";

        }

        return "unknown";

    }


    /* ========================================================
       ПРОВЕРКА ПАКЕТА
       ======================================================== */

    function validatePacket(packet) {

        if (
            packet === null ||
            typeof packet !== "object" ||
            Array.isArray(packet)
        ) {

            throw new Error(
                "Результат разбора не является объектом телеметрии"
            );

        }

        const keys =
            Object.keys(packet);

        if (keys.length === 0) {

            throw new Error(
                "Пакет телеметрии не содержит параметров"
            );

        }

        if (
            keys.length >
            PARSER_CONFIG.maximumParametersPerPacket
        ) {

            throw new Error(
                "Пакет содержит слишком много параметров"
            );

        }

        return true;

    }


    /* ========================================================
       ОСНОВНОЙ РАЗБОР ОДНОЙ СТРОКИ
       ======================================================== */

    function parseLine(rawLine) {

        state.totalLines += 1;

        const line =
            normalizeLine(rawLine);

        state.lastRawLine =
            line;

        if (line === "") {

            if (PARSER_CONFIG.allowEmptyLines) {

                state.ignoredLines += 1;

                return null;

            }

            emitParserError(
                "Получена пустая строка",
                rawLine
            );

            return null;

        }

        if (isCommentLine(line)) {

            state.ignoredLines += 1;

            return null;

        }

        if (
            line.length >
            PARSER_CONFIG.maximumLineLength
        ) {

            emitParserError(
                "Превышена допустимая длина строки телеметрии",
                line
            );

            return null;

        }

        if (PARSER_CONFIG.emitRawLineEvents) {

            emitEvent(
                "openmcc:raw-line",
                {
                    line,
                    timestamp:
                        Date.now()
                }
            );

        }

/*
 * Служебные сообщения устройства не являются телеметрией.
 */

const upperLine =
    line.toUpperCase();


if (upperLine.startsWith("$ACK")) {

    emitEvent(
        "openmcc:device-ack",
        {
            line,
            payload:
                line.replace(
                    /^\$ACK[,]?/i,
                    ""
                ),

            timestamp:
                Date.now()
        }
    );

    return null;

}


if (upperLine.startsWith("$ERR")) {

    emitEvent(
        "openmcc:device-error",
        {
            line,
            payload:
                line.replace(
                    /^\$ERR[,]?/i,
                    ""
                ),

            timestamp:
                Date.now()
        }
    );

    return null;

}


if (upperLine.startsWith("$INFO")) {

    emitEvent(
        "openmcc:device-info",
        {
            line,
            payload:
                line.replace(
                    /^\$INFO[,]?/i,
                    ""
                ),

            timestamp:
                Date.now()
        }
    );

    return null;

}




        try {

            const format =
                detectFormat(line);

            let packet;

            switch (format) {

                case "json":

                    packet =
                        parseJsonLine(line);

                    break;


                case "multi":

                    packet =
                        parseMultiParameterLine(line);

                    break;


                case "single":

                    packet =
                        parseSingleParameterLine(line);

                    break;


                default:

                    throw new Error(
                        "Не удалось определить формат строки телеметрии"
                    );

            }

            validatePacket(packet);

            state.parsedPackets += 1;

            state.parsedParameters +=
                Object.keys(packet).length;

            state.lastPacket =
                Object.freeze({
                    ...packet
                });

            emitEvent(
                "openmcc:telemetry",
                {
                    ...packet
                }
            );

            emitEvent(
                "openmcc:packet-parsed",
                {
                    packet:
                        {
                            ...packet
                        },

                    format,

                    rawLine:
                        line,

                    timestamp:
                        Date.now()
                }
            );

            return {
                ...packet
            };

        }
        catch (error) {

            emitParserError(
                error.message,
                line,
                error
            );

            return null;

        }

    }


    /* ========================================================
       ПРИЁМ ПОТОКА ТЕКСТА
       ======================================================== */

    /**
     * Принимает очередной текстовый фрагмент от serial.js.
     *
     * Фрагмент может содержать:
     * - одну полную строку;
     * - несколько строк;
     * - только часть строки.
     *
     * @param {string} chunk
     * @returns {Object[]}
     */
    function pushText(chunk) {

        if (
            chunk === null ||
            chunk === undefined
        ) {

            return [];

        }

        const text =
            String(chunk);

        if (text === "") {

            return [];

        }

        state.totalFragments += 1;

        state.textBuffer +=
            text;

        if (
            state.textBuffer.length >
            PARSER_CONFIG.maximumBufferLength
        ) {

            state.textBuffer = "";

            emitParserError(
                "Буфер парсера переполнен и был очищен"
            );

            return [];

        }

        const lines =
            state.textBuffer.split(/\r?\n/);

        /*
         * Последний элемент может быть неполной строкой.
         * Сохраняем его до поступления следующего фрагмента.
         */

        state.textBuffer =
            lines.pop() ?? "";

        const parsedPackets = [];

        for (const line of lines) {

            const packet =
                parseLine(line);

            if (packet !== null) {

                parsedPackets.push(packet);

            }

        }

        return parsedPackets;

    }


    /**
     * Принудительно обрабатывает содержимое буфера.
     *
     * Обычно вызывается перед закрытием последовательного порта.
     *
     * @returns {Object|null}
     */
    function flush() {

        const remaining =
            state.textBuffer;

        state.textBuffer =
            "";

        if (!remaining.trim()) {

            return null;

        }

        return parseLine(remaining);

    }


    /**
     * Очищает внутренний буфер без разбора.
     */
    function clearBuffer() {

        state.textBuffer =
            "";

    }


    /* ========================================================
       ТЕСТИРОВАНИЕ
       ======================================================== */

    function runSelfTest() {

        const testCases = [

            {
                input:
                    "TEMP=23.5",

                expected:
                    {
                        TEMP: 23.5
                    }
            },

            {
                input:
                    "$TEL,TEMP=23.5,VOLT=5.02,CURR=181",

                expected:
                    {
                        TEMP: 23.5,
                        VOLT: 5.02,
                        CURR: 181
                    }
            },

            {
                input:
                    "RSSI=-81;SNR=9.6",

                expected:
                    {
                        RSSI: -81,
                        SNR: 9.6
                    }
            },

            {
                input:
                    '{"ROLL":12.5,"PITCH":-3.2,"YAW":174}',

                expected:
                    {
                        ROLL: 12.5,
                        PITCH: -3.2,
                        YAW: 174
                    }
            }

        ];

        const results = [];

        for (const testCase of testCases) {

            const format =
                detectFormat(testCase.input);

            let actual;

            switch (format) {

                case "json":

                    actual =
                        parseJsonLine(testCase.input);

                    break;

                case "multi":

                    actual =
                        parseMultiParameterLine(
                            testCase.input
                        );

                    break;

                case "single":

                    actual =
                        parseSingleParameterLine(
                            testCase.input
                        );

                    break;

                default:

                    actual =
                        null;

            }

            const passed =
                JSON.stringify(actual) ===
                JSON.stringify(testCase.expected);

            results.push({

                input:
                    testCase.input,

                expected:
                    testCase.expected,

                actual,

                passed

            });

        }

        const allPassed =
            results.every(
                result => result.passed
            );

        writeLog(
            allPassed
                ? "Самотестирование парсера выполнено успешно"
                : "При самотестировании парсера обнаружены ошибки",
            allPassed
                ? "success"
                : "error",
            {
                results
            }
        );

        return {
            passed:
                allPassed,

            results
        };

    }


    /* ========================================================
       ИНИЦИАЛИЗАЦИЯ
       ======================================================== */

    function initialize() {

        if (state.initialized) {

            return;

        }

        state.initialized =
            true;

        writeLog(
            `Парсер телеметрии v${PARSER_CONFIG.version} загружен`,
            "success"
        );

        emitEvent(
            "openmcc:parser-ready",
            {
                version:
                    PARSER_CONFIG.version
            }
        );

    }


    /* ========================================================
       ПУБЛИЧНЫЙ API
       ======================================================== */

    window.OpenMCCParser = Object.freeze({

        config:
            PARSER_CONFIG,

        knownParameters:
            KNOWN_PARAMETERS,

        pushText,

        parseLine,

        flush,

        clearBuffer,

        runSelfTest,

        getState() {

            return {

                initialized:
                    state.initialized,

                bufferLength:
                    state.textBuffer.length,

                totalFragments:
                    state.totalFragments,

                totalLines:
                    state.totalLines,

                parsedPackets:
                    state.parsedPackets,

                parsedParameters:
                    state.parsedParameters,

                ignoredLines:
                    state.ignoredLines,

                errorCount:
                    state.errorCount,

                lastRawLine:
                    state.lastRawLine,

                lastPacket:
                    state.lastPacket
                        ? {
                            ...state.lastPacket
                        }
                        : null

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