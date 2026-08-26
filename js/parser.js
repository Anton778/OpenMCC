"use strict";

/* ============================================================
   ЦУП Альтаир — telemetry parser
   Release v5 / 0.5.0

   Supported telemetry formats:
   1) $TM,<ID>,<PACKET>,<UPTIME>,<VOLT>,<PANEL_POWER>,<TEMP>[,<ANTENNA>][*XX]
   2) $TM,ID=...,PACKET=...,UPTIME=...,VOLT=...,PANEL_POWER=...,TEMP=...,ANTENNA=...
   3) $TEL,ID=...,VOLT=...,PANEL_POWER=...,PACKET=...,UPTIME=...,TEMP=...,ANTENNA=...
   4) legacy $TM packet used in earlier IntroSat experiments
   5) JSON and bare KEY=VALUE lists

   ANTENNA:
   1 — бортовая антенна раскрыта;
   0 — бортовая антенна сложена.
   ============================================================ */

(() => {
    const CONFIG = Object.freeze({
        version: "0.5.0",
        maximumBufferLength: 65536,
        maximumLineLength: 4096,
        emitRawLineEvents: true,
    });

    const KNOWN_PARAMETERS = Object.freeze({
        ID: Object.freeze({ type: "string" }),
        VOLT: Object.freeze({ type: "number", unit: "V" }),
        PANEL_POWER: Object.freeze({ type: "number", unit: "W" }),
        PACKET: Object.freeze({ type: "number" }),
        UPTIME: Object.freeze({ type: "number", unit: "s" }),
        ANTENNA: Object.freeze({ type: "number" }),
        TEMP: Object.freeze({ type: "number", unit: "°C" }),
        RSSI: Object.freeze({ type: "number", unit: "dBm" }),
        SNR: Object.freeze({ type: "number", unit: "dB" }),
        LQI: Object.freeze({ type: "number" }),
        LIGHT: Object.freeze({ type: "number" }),
        MODE: Object.freeze({ type: "number" }),
        ERRORS: Object.freeze({ type: "number" }),
        CHECKSUM: Object.freeze({ type: "string" }),
        ROLL: Object.freeze({ type: "number" }),
        PITCH: Object.freeze({ type: "number" }),
        YAW: Object.freeze({ type: "number" }),
    });

    const ALIASES = Object.freeze({
        SAT_ID: "ID",
        SATID: "ID",
        SPACECRAFT_ID: "ID",
        VBAT: "VOLT",
        BAT: "VOLT",
        BATTERY: "VOLT",
        BATTERY_VOLTAGE: "VOLT",
        PANEL: "PANEL_POWER",
        PANEL_PWR: "PANEL_POWER",
        SOLAR: "PANEL_POWER",
        SOLAR_POWER: "PANEL_POWER",
        POWER_PANEL: "PANEL_POWER",
        PKT: "PACKET",
        PKTS: "PACKET",
        SEQ: "PACKET",
        COUNTER: "PACKET",
        PACKET_COUNT: "PACKET",
        UP: "UPTIME",
        UPTIME_S: "UPTIME",
        ANT: "ANTENNA",
        ANTENNA_STATE: "ANTENNA",
        ANTENNA_DEPLOYED: "ANTENNA",
        DEPLOY: "ANTENNA",
        DEPLOYED: "ANTENNA",
        T: "TEMP",
        TEMPERATURE: "TEMP",
    });

    const state = {
        initialized: false,
        textBuffer: "",
        totalFragments: 0,
        totalLines: 0,
        parsedPackets: 0,
        ignoredLines: 0,
        errorCount: 0,
        lastRawLine: "",
        lastPacket: null,
    };

    function writeLog(message, type = "info", metadata = null) {
        if (window.OpenMCCLogger?.write) {
            window.OpenMCCLogger.write(message, type, "PARSER", metadata);
        }
    }

    function emit(name, detail = null) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function normalizeLine(line) {
        return String(line ?? "")
            .replace(/\u0000/g, "")
            .replace(/\r/g, "")
            .trim();
    }

    function normalizeName(name) {
        const clean = String(name ?? "")
            .trim()
            .replace(/^\$/, "")
            .replace(/[\s\-]+/g, "_")
            .replace(/[^A-Za-z0-9_]/g, "")
            .toUpperCase();
        return ALIASES[clean] || clean;
    }

    function parseGenericValue(rawValue) {
        const text = String(rawValue ?? "").trim();
        if (text === "") return "";
        if (/^(null|none|nan|---)$/i.test(text)) return null;
        const numericText = text.includes(",") && !text.includes(".") ? text.replace(",", ".") : text;
        const numeric = Number(numericText);
        return Number.isFinite(numeric) ? numeric : text;
    }

    function parseValue(key, rawValue) {
        const definition = KNOWN_PARAMETERS[key];
        if (!definition) return parseGenericValue(rawValue);
        if (definition.type === "string") return String(rawValue ?? "").trim();
        const value = Number(String(rawValue ?? "").trim().replace(",", "."));
        if (!Number.isFinite(value)) {
            if (/^(null|none|nan|---)$/i.test(String(rawValue ?? "").trim())) return null;
            throw new Error(`Параметр ${key} должен содержать число`);
        }
        return value;
    }

    function splitChecksum(line) {
        const match = String(line).match(/^(.*)\*([0-9A-Fa-f]{1,8})\s*$/);
        if (!match) return { body: String(line), checksum: null };
        return { body: match[1], checksum: match[2].toUpperCase() };
    }

    function parseKeyValueItems(text) {
        const packet = {};
        String(text)
            .split(/[;,]/)
            .map(item => item.trim())
            .filter(Boolean)
            .forEach(item => {
                const index = item.indexOf("=");
                if (index < 1) return;
                const key = normalizeName(item.slice(0, index));
                if (!key) return;
                packet[key] = parseValue(key, item.slice(index + 1));
            });
        return packet;
    }

    function parseCanonicalTm(values) {
        if (values.length < 6) throw new Error("Пакет $TM v5 содержит недостаточно полей");
        const packet = {
            ID: String(values[0]).trim(),
            PACKET: parseValue("PACKET", values[1]),
            UPTIME: parseValue("UPTIME", values[2]),
            VOLT: parseValue("VOLT", values[3]),
            PANEL_POWER: parseValue("PANEL_POWER", values[4]),
            TEMP: parseValue("TEMP", values[5]),
        };
        if (values.length >= 7 && String(values[6]).trim() !== "") {
            packet.ANTENNA = parseValue("ANTENNA", values[6]);
        }
        return packet;
    }

    function parseLegacyTm(values) {
        /*
         * Earlier IntroSat experiments used:
         * $TM,ID,PACKET,UPTIME,LIGHT,VOLT,TEMP,MODE,ERRORS*XX
         *
         * There is no safe conversion from LIGHT to panel power without a
         * calibration coefficient, therefore LIGHT is preserved separately.
         */
        if (values.length < 8) throw new Error("Старый пакет $TM содержит недостаточно полей");
        return {
            ID: String(values[0]).trim(),
            PACKET: parseValue("PACKET", values[1]),
            UPTIME: parseValue("UPTIME", values[2]),
            LIGHT: parseValue("LIGHT", values[3]),
            VOLT: parseValue("VOLT", values[4]),
            TEMP: parseValue("TEMP", values[5]),
            MODE: parseValue("MODE", values[6]),
            ERRORS: parseValue("ERRORS", values[7]),
        };
    }

    function parseTmLine(line) {
        const { body, checksum } = splitChecksum(line);
        const afterPrefix = body.replace(/^\$TM[,]?/i, "").trim();

        let packet;
        if (afterPrefix.includes("=")) {
            packet = parseKeyValueItems(afterPrefix);
        } else {
            const values = afterPrefix.split(",").map(value => value.trim());
            packet = values.length >= 8 ? parseLegacyTm(values) : parseCanonicalTm(values);
        }

        if (checksum) packet.CHECKSUM = checksum;
        return packet;
    }

    function parseTelLine(line) {
        const { body, checksum } = splitChecksum(line);
        const afterPrefix = body.replace(/^\$TEL[,]?/i, "").trim();
        const packet = parseKeyValueItems(afterPrefix);
        if (checksum) packet.CHECKSUM = checksum;
        return packet;
    }

    function parseJsonLine(line) {
        const source = JSON.parse(line);
        if (!source || Array.isArray(source) || typeof source !== "object") {
            throw new Error("JSON-телеметрия должна быть объектом");
        }
        const packet = {};
        Object.entries(source).forEach(([rawKey, rawValue]) => {
            const key = normalizeName(rawKey);
            if (!key) return;
            packet[key] = typeof rawValue === "number" || rawValue === null
                ? rawValue
                : parseValue(key, rawValue);
        });
        return packet;
    }

    function validatePacket(packet) {
        if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
            throw new Error("Некорректный объект телеметрии");
        }
        if (Object.keys(packet).length === 0) {
            throw new Error("Пакет телеметрии пуст");
        }
        if (Object.hasOwn(packet, "ANTENNA") && packet.ANTENNA !== null) {
            const stateValue = Number(packet.ANTENNA);
            if (stateValue !== 0 && stateValue !== 1) {
                throw new Error("ANTENNA должен быть 0 (сложена) или 1 (раскрыта)");
            }
            packet.ANTENNA = stateValue;
        }
    }

    function handleServiceLine(line) {
        const upper = line.toUpperCase();
        const service = [
            ["$ACK", "openmcc:device-ack"],
            ["$ERR", "openmcc:device-error"],
            ["$INFO", "openmcc:device-info"],
        ].find(([prefix]) => upper.startsWith(prefix));

        if (!service) return false;
        const [prefix, eventName] = service;
        emit(eventName, {
            line,
            payload: line.replace(new RegExp(`^\\${prefix}[,]?`, "i"), ""),
            timestamp: Date.now(),
        });
        return true;
    }

    function parseLine(rawLine) {
        state.totalLines += 1;
        const line = normalizeLine(rawLine);
        state.lastRawLine = line;
        if (!line) {
            state.ignoredLines += 1;
            return null;
        }
        if (line.length > CONFIG.maximumLineLength) {
            state.errorCount += 1;
            emit("openmcc:telemetry-error", { message: "Строка телеметрии слишком длинная", rawLine: line, timestamp: Date.now() });
            return null;
        }

        if (CONFIG.emitRawLineEvents) emit("openmcc:raw-line", { line, timestamp: Date.now() });
        if (handleServiceLine(line)) return null;

        try {
            let packet = null;
            if (/^\$TM(?:,|$)/i.test(line)) {
                packet = parseTmLine(line);
            } else if (/^\$TEL(?:,|$)/i.test(line)) {
                packet = parseTelLine(line);
            } else if (line.startsWith("{") && line.endsWith("}")) {
                packet = parseJsonLine(line);
            } else if (line.includes("=")) {
                packet = parseKeyValueItems(line);
            } else {
                /*
                 * The uploaded Transmit.ino currently sends a test text string.
                 * Do not count it as a parser error: expose it for diagnostics.
                 */
                state.ignoredLines += 1;
                emit("openmcc:unparsed-line", { line, timestamp: Date.now() });
                writeLog(`Получена тестовая/неформатированная строка: ${line}`, "info");
                return null;
            }

            validatePacket(packet);
            state.parsedPackets += 1;
            state.lastPacket = Object.freeze({ ...packet });
            emit("openmcc:telemetry", { ...packet });
            return packet;
        } catch (error) {
            state.errorCount += 1;
            const detail = {
                message: `Ошибка разбора телеметрии: ${error.message}`,
                rawLine: line,
                timestamp: Date.now(),
            };
            emit("openmcc:telemetry-error", detail);
            writeLog(detail.message, "error", detail);
            return null;
        }
    }

    function pushText(fragment) {
        const text = String(fragment ?? "");
        if (!text) return [];
        state.totalFragments += 1;
        state.textBuffer += text;

        if (state.textBuffer.length > CONFIG.maximumBufferLength) {
            state.textBuffer = state.textBuffer.slice(-CONFIG.maximumBufferLength);
            state.errorCount += 1;
            emit("openmcc:telemetry-error", {
                message: "Буфер телеметрии был переполнен и усечён",
                timestamp: Date.now(),
            });
        }

        const lines = state.textBuffer.split(/\r?\n/);
        state.textBuffer = lines.pop() ?? "";
        const packets = [];
        lines.forEach(line => {
            const packet = parseLine(line);
            if (packet) packets.push(packet);
        });
        return packets;
    }

    function flush() {
        const tail = normalizeLine(state.textBuffer);
        state.textBuffer = "";
        return tail ? parseLine(tail) : null;
    }

    function reset() {
        state.textBuffer = "";
        state.totalFragments = 0;
        state.totalLines = 0;
        state.parsedPackets = 0;
        state.ignoredLines = 0;
        state.errorCount = 0;
        state.lastRawLine = "";
        state.lastPacket = null;
    }

    function initialize() {
        if (state.initialized) return;
        state.initialized = true;
        writeLog(`Парсер телеметрии v${CONFIG.version} готов`, "success");
        emit("openmcc:parser-ready", { version: CONFIG.version });
    }

    window.OpenMCCParser = Object.freeze({
        config: CONFIG,
        knownParameters: KNOWN_PARAMETERS,
        parseLine,
        pushText,
        flush,
        reset,
        getState() {
            return {
                initialized: state.initialized,
                totalFragments: state.totalFragments,
                totalLines: state.totalLines,
                parsedPackets: state.parsedPackets,
                ignoredLines: state.ignoredLines,
                errorCount: state.errorCount,
                lastRawLine: state.lastRawLine,
                lastPacket: state.lastPacket,
                bufferedCharacters: state.textBuffer.length,
            };
        },
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
