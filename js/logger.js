"use strict";

/* ============================================================
   OpenMCC
   Open Mission Control Center

   Module: logger.js
   Version: 0.1.0

   Назначение:
   - вывод сообщений в журнал событий;
   - хранение истории событий;
   - разделение сообщений по уровням важности;
   - ограничение количества записей;
   - экспорт журнала в текстовый файл;
   - формирование событий для других модулей OpenMCC.
   ============================================================ */


(() => {

    /* ========================================================
       КОНФИГУРАЦИЯ
       ======================================================== */

    const LOGGER_CONFIG = Object.freeze({

        version: "0.1.0",

        maximumEntries: 500,

        showMilliseconds: false,

        consoleOutput: true,

        defaultSource: "SYSTEM",

        storageEnabled: true,

        storageKey: "openmcc-event-log",

        maximumStoredEntries: 150

    });


    /* ========================================================
       УРОВНИ СООБЩЕНИЙ
       ======================================================== */

    const LOG_LEVELS = Object.freeze({

        info: Object.freeze({
            name: "INFO",
            className: "log-info"
        }),

        success: Object.freeze({
            name: "OK",
            className: "log-success"
        }),

        warning: Object.freeze({
            name: "WARN",
            className: "log-warning"
        }),

        error: Object.freeze({
            name: "ERROR",
            className: "log-error"
        }),

        command: Object.freeze({
            name: "CMD",
            className: "log-command"
        }),

        telemetry: Object.freeze({
            name: "TEL",
            className: "log-telemetry"
        })

    });


    /* ========================================================
       СОСТОЯНИЕ
       ======================================================== */

    const state = {

        initialized: false,

        sequenceNumber: 0,

        entries: [],

        eventLogElement: null

    };


    /* ========================================================
       СЛУЖЕБНЫЕ ФУНКЦИИ
       ======================================================== */

    /**
     * Возвращает описание уровня журнала.
     *
     * @param {string} type
     * @returns {{name: string, className: string}}
     */
    function getLevel(type) {

        const normalizedType =
            String(type || "info")
                .trim()
                .toLowerCase();

        return (
            LOG_LEVELS[normalizedType] ||
            LOG_LEVELS.info
        );

    }


    /**
     * Формирует время события по UTC.
     *
     * @param {Date} date
     * @returns {string}
     */
    function formatUtcTime(date) {

        const hours =
            String(date.getUTCHours())
                .padStart(2, "0");

        const minutes =
            String(date.getUTCMinutes())
                .padStart(2, "0");

        const seconds =
            String(date.getUTCSeconds())
                .padStart(2, "0");

        if (!LOGGER_CONFIG.showMilliseconds) {

            return `${hours}:${minutes}:${seconds}`;

        }

        const milliseconds =
            String(date.getUTCMilliseconds())
                .padStart(3, "0");

        return (
            `${hours}:${minutes}:${seconds}.${milliseconds}`
        );

    }


    /**
     * Формирует полную дату и время UTC.
     *
     * @param {Date} date
     * @returns {string}
     */
    function formatUtcDateTime(date) {

        const year =
            date.getUTCFullYear();

        const month =
            String(date.getUTCMonth() + 1)
                .padStart(2, "0");

        const day =
            String(date.getUTCDate())
                .padStart(2, "0");

        return (
            `${year}-${month}-${day}T` +
            `${formatUtcTime(date)}Z`
        );

    }


    /**
     * Нормализует текст сообщения.
     *
     * @param {*} message
     * @returns {string}
     */
    function normalizeMessage(message) {

        if (message instanceof Error) {

            return message.message;

        }

        if (
            typeof message === "object" &&
            message !== null
        ) {

            try {

                return JSON.stringify(message);

            }
            catch {

                return String(message);

            }

        }

        return String(message ?? "");

    }


    /**
     * Нормализует название источника.
     *
     * @param {string} source
     * @returns {string}
     */
    function normalizeSource(source) {

        const normalized =
            String(
                source ||
                LOGGER_CONFIG.defaultSource
            )
                .trim()
                .toUpperCase();

        return normalized.slice(0, 16);

    }


    /* ========================================================
       СОЗДАНИЕ ЗАПИСИ
       ======================================================== */

    /**
     * Создаёт объект записи журнала.
     *
     * @param {string} message
     * @param {string} type
     * @param {string} source
     * @param {Object|null} metadata
     *
     * @returns {Object}
     */
    function createEntry(
        message,
        type,
        source,
        metadata = null
    ) {

        const timestamp =
            new Date();

        const level =
            getLevel(type);

        state.sequenceNumber += 1;

        return Object.freeze({

            id:
                state.sequenceNumber,

            timestamp:
                timestamp.getTime(),

            utcTime:
                formatUtcTime(timestamp),

            utcDateTime:
                formatUtcDateTime(timestamp),

            type:
                String(type || "info")
                    .toLowerCase(),

            level:
                level.name,

            className:
                level.className,

            source:
                normalizeSource(source),

            message:
                normalizeMessage(message),

            metadata:
                metadata

        });

    }


    /* ========================================================
       ВЫВОД В DOM
       ======================================================== */

    /**
     * Создаёт HTML-элемент записи журнала.
     *
     * @param {Object} entry
     * @returns {HTMLDivElement}
     */
    function createEntryElement(entry) {

        const row =
            document.createElement("div");

        row.className =
            `log-entry ${entry.className}`;

        row.dataset.logId =
            String(entry.id);

        row.dataset.logType =
            entry.type;

        row.dataset.logSource =
            entry.source;


        const time =
            document.createElement("span");

        time.className =
            "log-time";

        time.textContent =
            entry.utcTime;


        const source =
            document.createElement("span");

        source.className =
            "log-source";

        source.textContent =
            entry.source;


        const level =
            document.createElement("span");

        level.className =
            "log-level";

        level.textContent =
            entry.level;


        const message =
            document.createElement("span");

        message.className =
            "log-message";

        message.textContent =
            entry.message;


        row.append(
            time,
            source,
            level,
            message
        );

        return row;

    }


    /**
     * Добавляет запись в визуальный журнал.
     *
     * @param {Object} entry
     */
    function appendEntryToInterface(entry) {

        if (!state.eventLogElement) {

            return;

        }

        const row =
            createEntryElement(entry);

        state.eventLogElement.appendChild(row);

        while (
            state.eventLogElement.children.length >
            LOGGER_CONFIG.maximumEntries
        ) {

            state.eventLogElement.firstElementChild
                ?.remove();

        }

        state.eventLogElement.scrollTop =
            state.eventLogElement.scrollHeight;

    }


    /* ========================================================
       ХРАНЕНИЕ ИСТОРИИ
       ======================================================== */

    /**
     * Ограничивает количество записей в памяти.
     */
    function trimHistory() {

        if (
            state.entries.length <=
            LOGGER_CONFIG.maximumEntries
        ) {

            return;

        }

        const excess =
            state.entries.length -
            LOGGER_CONFIG.maximumEntries;

        state.entries.splice(0, excess);

    }


    /**
     * Сохраняет часть журнала в localStorage.
     */
    function saveHistory() {

        if (
            !LOGGER_CONFIG.storageEnabled ||
            typeof localStorage === "undefined"
        ) {

            return;

        }

        try {

            const storedEntries =
                state.entries.slice(
                    -LOGGER_CONFIG.maximumStoredEntries
                );

            localStorage.setItem(
                LOGGER_CONFIG.storageKey,
                JSON.stringify(storedEntries)
            );

        }
        catch (error) {

            if (LOGGER_CONFIG.consoleOutput) {

                console.warn(
                    "OpenMCC Logger: журнал не сохранён",
                    error
                );

            }

        }

    }


    /**
     * Восстанавливает журнал предыдущего запуска.
     */
    function restoreHistory() {

        if (
            !LOGGER_CONFIG.storageEnabled ||
            typeof localStorage === "undefined"
        ) {

            return;

        }

        try {

            const rawData =
                localStorage.getItem(
                    LOGGER_CONFIG.storageKey
                );

            if (!rawData) {

                return;

            }

            const savedEntries =
                JSON.parse(rawData);

            if (!Array.isArray(savedEntries)) {

                return;

            }

            savedEntries.forEach(savedEntry => {

                const restoredEntry =
                    Object.freeze({

                        ...savedEntry,

                        className:
                            getLevel(savedEntry.type)
                                .className

                    });

                state.entries.push(
                    restoredEntry
                );

                appendEntryToInterface(
                    restoredEntry
                );

                state.sequenceNumber =
                    Math.max(
                        state.sequenceNumber,
                        Number(savedEntry.id) || 0
                    );

            });

        }
        catch (error) {

            console.warn(
                "OpenMCC Logger: история не восстановлена",
                error
            );

        }

    }


    /* ========================================================
       ВЫВОД В КОНСОЛЬ
       ======================================================== */

    /**
     * Дублирует сообщение в консоль браузера.
     *
     * @param {Object} entry
     */
    function writeToConsole(entry) {

        if (!LOGGER_CONFIG.consoleOutput) {

            return;

        }

        const prefix =
            `[${entry.utcTime} UTC]` +
            `[${entry.source}]` +
            `[${entry.level}]`;

        switch (entry.type) {

            case "error":

                console.error(
                    prefix,
                    entry.message,
                    entry.metadata || ""
                );

                break;


            case "warning":

                console.warn(
                    prefix,
                    entry.message,
                    entry.metadata || ""
                );

                break;


            case "success":

                console.info(
                    prefix,
                    entry.message,
                    entry.metadata || ""
                );

                break;


            default:

                console.log(
                    prefix,
                    entry.message,
                    entry.metadata || ""
                );

                break;

        }

    }


    /* ========================================================
       ОСНОВНАЯ ФУНКЦИЯ ЗАПИСИ
       ======================================================== */

    /**
     * Добавляет сообщение в журнал OpenMCC.
     *
     * Совместима с вызовом из app.js:
     *
     * OpenMCCLogger.write(
     *     "Соединение установлено",
     *     "success"
     * );
     *
     * @param {string|Error|Object} message
     * @param {string} type
     * @param {string} source
     * @param {Object|null} metadata
     *
     * @returns {Object}
     */
    function write(
        message,
        type = "info",
        source = LOGGER_CONFIG.defaultSource,
        metadata = null
    ) {

        const entry =
            createEntry(
                message,
                type,
                source,
                metadata
            );

        state.entries.push(entry);

        trimHistory();

        appendEntryToInterface(entry);

        writeToConsole(entry);

        saveHistory();

        window.dispatchEvent(
            new CustomEvent(
                "openmcc:log-entry",
                {
                    detail: entry
                }
            )
        );

        return entry;

    }


    /* ========================================================
       БЫСТРЫЕ МЕТОДЫ
       ======================================================== */

    function info(
        message,
        source = LOGGER_CONFIG.defaultSource,
        metadata = null
    ) {

        return write(
            message,
            "info",
            source,
            metadata
        );

    }


    function success(
        message,
        source = LOGGER_CONFIG.defaultSource,
        metadata = null
    ) {

        return write(
            message,
            "success",
            source,
            metadata
        );

    }


    function warning(
        message,
        source = LOGGER_CONFIG.defaultSource,
        metadata = null
    ) {

        return write(
            message,
            "warning",
            source,
            metadata
        );

    }


    function error(
        message,
        source = LOGGER_CONFIG.defaultSource,
        metadata = null
    ) {

        return write(
            message,
            "error",
            source,
            metadata
        );

    }


    function command(
        message,
        source = "COMMAND",
        metadata = null
    ) {

        return write(
            message,
            "command",
            source,
            metadata
        );

    }


    function telemetry(
        message,
        source = "TELEMETRY",
        metadata = null
    ) {

        return write(
            message,
            "telemetry",
            source,
            metadata
        );

    }


    /* ========================================================
       ОЧИСТКА ЖУРНАЛА
       ======================================================== */

    /**
     * Полностью очищает журнал.
     *
     * @param {boolean} writeNotification
     */
    function clear(writeNotification = true) {

        state.entries.length = 0;

        if (state.eventLogElement) {

            state.eventLogElement.innerHTML = "";

        }

        try {

            localStorage.removeItem(
                LOGGER_CONFIG.storageKey
            );

        }
        catch {

            // localStorage может быть недоступен.
        }

        window.dispatchEvent(
            new CustomEvent(
                "openmcc:log-cleared"
            )
        );

        if (writeNotification) {

            write(
                "Журнал событий очищен",
                "info",
                "LOGGER"
            );

        }

    }


    /* ========================================================
       ЭКСПОРТ ЖУРНАЛА
       ======================================================== */

    /**
     * Преобразует журнал в текст.
     *
     * @returns {string}
     */
    function createTextReport() {

        const header = [

            "OpenMCC Event Log",

            `Generated: ${
                formatUtcDateTime(new Date())
            }`,

            `Entries: ${state.entries.length}`,

            ""

        ];

        const rows =
            state.entries.map(entry => {

                return (
                    `${entry.utcDateTime}\t` +
                    `${entry.level}\t` +
                    `${entry.source}\t` +
                    `${entry.message}`
                );

            });

        return [
            ...header,
            ...rows
        ].join("\r\n");

    }


    /**
     * Скачивает журнал как текстовый файл.
     *
     * Вызвать из консоли можно так:
     *
     * OpenMCCLogger.exportText();
     */
    function exportText() {

        const report =
            createTextReport();

        const blob =
            new Blob(
                [report],
                {
                    type:
                        "text/plain;charset=utf-8"
                }
            );

        const url =
            URL.createObjectURL(blob);

        const date =
            new Date();

        const fileName =
            "OpenMCC_log_" +
            date.toISOString()
                .replaceAll(":", "-")
                .replace(/\.\d{3}Z$/, "Z") +
            ".txt";

        const anchor =
            document.createElement("a");

        anchor.href =
            url;

        anchor.download =
            fileName;

        document.body.appendChild(anchor);

        anchor.click();

        anchor.remove();

        URL.revokeObjectURL(url);

        write(
            `Журнал экспортирован: ${fileName}`,
            "success",
            "LOGGER"
        );

    }


    /* ========================================================
       ПОЛУЧЕНИЕ ИСТОРИИ
       ======================================================== */

    /**
     * Возвращает копию истории.
     *
     * @param {Object} filter
     * @returns {Object[]}
     */
    function getEntries(filter = {}) {

        let result =
            [...state.entries];

        if (filter.type) {

            const requiredType =
                String(filter.type)
                    .toLowerCase();

            result =
                result.filter(
                    entry =>
                        entry.type === requiredType
                );

        }

        if (filter.source) {

            const requiredSource =
                normalizeSource(filter.source);

            result =
                result.filter(
                    entry =>
                        entry.source === requiredSource
                );

        }

        if (
            Number.isInteger(filter.limit) &&
            filter.limit > 0
        ) {

            result =
                result.slice(-filter.limit);

        }

        return result.map(
            entry => ({
                ...entry
            })
        );

    }


    /* ========================================================
       ИНИЦИАЛИЗАЦИЯ
       ======================================================== */

    function initialize() {

        if (state.initialized) {

            return;

        }

        state.eventLogElement =
            document.getElementById("eventLog");

        if (!state.eventLogElement) {

            console.warn(
                "OpenMCC Logger: элемент #eventLog не найден"
            );

        }
        else {

            /*
             * Удаляем только стартовую статическую надпись
             * «OpenMCC запущен» из index.html.
             *
             * Сам HTML и остальные элементы не изменяются.
             */

            state.eventLogElement.innerHTML = "";

        }

        restoreHistory();

        state.initialized = true;

        console.info(
            `OpenMCC Logger v${LOGGER_CONFIG.version} загружен`
        );

        window.dispatchEvent(
            new CustomEvent(
                "openmcc:logger-ready"
            )
        );

    }


    /* ========================================================
       ПУБЛИЧНЫЙ API
       ======================================================== */

    window.OpenMCCLogger = Object.freeze({

        config:
            LOGGER_CONFIG,

        write,

        info,

        success,

        warning,

        error,

        command,

        telemetry,

        clear,

        exportText,

        createTextReport,

        getEntries,

        getState() {

            return {

                initialized:
                    state.initialized,

                sequenceNumber:
                    state.sequenceNumber,

                entriesCount:
                    state.entries.length

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