"use strict";

/* ЦУП Альтаир v8 — permissive telemetry parser.
 * Прикладная контрольная сумма принимается как информационное поле и НЕ проверяется.
 */
(() => {
    const CONFIG = Object.freeze({
        version: "0.8.0",
        maximumBufferLength: 65536,
        maximumLineLength: 4096,
        checksumValidation: false,
    });

    const KNOWN_PARAMETERS = Object.freeze({
        ID: { type: "string" },
        PACKET: { type: "number" },
        UPTIME: { type: "number" },
        PANEL_POWER: { type: "number" },
        VOLT: { type: "number" },
        MODE: { type: "number" },
        ANTENNA: { type: "number" },
        CHECKSUM: { type: "string" },
        CHECKSUM_OK: { type: "number" },
        CHECKSUM_BYPASS: { type: "number" },
        RSSI: { type: "number" },
        SNR: { type: "number" },
        LQI: { type: "number" },
        TEMP: { type: "number" },
        LIGHT: { type: "number" },
        ERRORS: { type: "number" },
        ROLL: { type: "number" },
        PITCH: { type: "number" },
        YAW: { type: "number" },
    });

    const ALIASES = Object.freeze({
        SAT_ID: "ID", SATID: "ID", SPACECRAFT_ID: "ID",
        PKT: "PACKET", PKTS: "PACKET", SEQ: "PACKET", PACKET_COUNT: "PACKET",
        UP: "UPTIME", UPTIME_S: "UPTIME",
        PANEL: "PANEL_POWER", PANEL_PWR: "PANEL_POWER", SOLAR: "PANEL_POWER", SOLAR_POWER: "PANEL_POWER",
        VBAT: "VOLT", BAT: "VOLT", BATTERY: "VOLT", BATTERY_VOLTAGE: "VOLT",
        STATE: "MODE", OPERATING_MODE: "MODE",
        XOR: "CHECKSUM", CRC8: "CHECKSUM",
        ANT: "ANTENNA", ANTENNA_STATE: "ANTENNA", ANTENNA_DEPLOYED: "ANTENNA",
        T: "TEMP", TEMPERATURE: "TEMP", MCU_TEMP: "TEMP", CPU_TEMP: "TEMP",
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

    function log(message, type = "info", metadata = null) {
        window.OpenMCCLogger?.write?.(message, type, "PARSER", metadata);
    }

    function emit(name, detail = null) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function normalizeLine(line) {
        return String(line ?? "").replace(/\u0000/g, "").replace(/\r/g, "").trim();
    }

    function normalizeName(name) {
        const clean = String(name ?? "")
            .trim().replace(/^\$/, "").replace(/[\s\-]+/g, "_")
            .replace(/[^A-Za-z0-9_]/g, "").toUpperCase();
        return ALIASES[clean] || clean;
    }

    function parseValue(key, rawValue) {
        const definition = KNOWN_PARAMETERS[key];
        const text = String(rawValue ?? "").trim();
        if (definition?.type === "string") return text;
        if (/^(null|none|nan|---|н\/д)$/i.test(text)) return null;
        const numeric = Number(text.replace(",", "."));
        if (!Number.isFinite(numeric)) {
            if (!definition) return text;
            throw new Error(`Параметр ${key} должен содержать число`);
        }
        return numeric;
    }

    function parseKeyValueItems(text) {
        const packet = {};
        String(text).split(/[;,]/).map(item => item.trim()).filter(Boolean).forEach(item => {
            const index = item.indexOf("=");
            if (index < 1) return;
            const key = normalizeName(item.slice(0, index));
            packet[key] = parseValue(key, item.slice(index + 1));
        });
        return packet;
    }

    // Позиционный формат:
    // 7 полей: прежний пакет без температуры и ANTENNA;
    // 8 полей: новый пакет с MCU_TEMP либо прежний пакет с ANTENNA;
    // 9 полей: новый пакет с MCU_TEMP и ANTENNA.
    function parsePositionPacket(line) {
        const f = line.split(",").map(v => v.trim());
        if (![7, 8, 9].includes(f.length)) {
            throw new Error(`Ожидалось 7, 8 или 9 полей, получено ${f.length}`);
        }

        // MODE старого формата содержит ровно 0 или 1. Температура нового
        // статического пакета всегда записывается с одним десятичным знаком.
        const eighthFieldContainsTemperature =
            f.length === 8 && !/^(?:0|1)$/.test(f[5]);
        const hasTemperature = f.length === 9 || eighthFieldContainsTemperature;
        const hasAntenna =
            f.length === 9 || (f.length === 8 && !eighthFieldContainsTemperature);
        const modeIndex = hasTemperature ? 6 : 5;
        const antennaIndex = f.length === 9 ? 7 : (hasAntenna ? 6 : -1);
        const checksumIndex = f.length - 1;
        const packet = {
            ID: f[0],
            PACKET: Number(f[1]),
            UPTIME: Number(f[2]),
            PANEL_POWER: Number(f[3]),
            VOLT: Number(f[4]),
            ...(hasTemperature ? { TEMP: Number(f[5]) } : {}),
            MODE: Number(f[modeIndex]),
            CHECKSUM: f[checksumIndex],
            CHECKSUM_BYPASS: 1,
            RAW_PACKET: line,
        };
        if (hasAntenna) packet.ANTENNA = Number(f[antennaIndex]);
        return packet;
    }

    function parseTmLine(line) {
        const content = line.replace(/^\$TM[,]?/i, "").trim();
        if (content.includes("=")) return parseKeyValueItems(content);
        return parsePositionPacket(content);
    }

    function parseJsonLine(line) {
        const source = JSON.parse(line);
        if (!source || Array.isArray(source) || typeof source !== "object") {
            throw new Error("JSON должен быть объектом");
        }
        const packet = {};
        Object.entries(source).forEach(([key, value]) => {
            const normalized = normalizeName(key);
            packet[normalized] =
                typeof value === "number" || value === null
                    ? value
                    : parseValue(normalized, value);
        });
        return packet;
    }

    function validatePacket(packet) {
        if (!packet || typeof packet !== "object" || !Object.keys(packet).length) {
            throw new Error("Пустой пакет телеметрии");
        }
        if (Object.hasOwn(packet, "MODE") && packet.MODE !== null && ![0, 1].includes(Number(packet.MODE))) {
            throw new Error("MODE должен быть 0 или 1");
        }
        if (Object.hasOwn(packet, "ANTENNA") && packet.ANTENNA !== null && ![0, 1].includes(Number(packet.ANTENNA))) {
            packet.ANTENNA = null;
        }
    }

    function handleServiceLine(line) {
        const upper = line.toUpperCase();
        const service = [
            ["$ACK", "openmcc:device-ack"],
            ["$ERR", "openmcc:device-error"],
            ["$INFO", "openmcc:device-info"],
            ["$RAW", "openmcc:unparsed-line"],
        ].find(([prefix]) => upper.startsWith(prefix));
        if (!service) return false;
        const [prefix, eventName] = service;
        emit(eventName, {
            line,
            payload: line.slice(prefix.length).replace(/^,/, ""),
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
            emit("openmcc:telemetry-error", {
                message: "Строка телеметрии слишком длинная",
                rawLine: line,
                timestamp: Date.now(),
            });
            return null;
        }

        emit("openmcc:raw-line", { line, timestamp: Date.now() });
        if (handleServiceLine(line)) return null;

        try {
            let packet;

            if (/^\$TEL(?:,|$)/i.test(line)) {
                packet = parseKeyValueItems(line.replace(/^\$TEL[,]?/i, ""));
            } else if (/^\$TM(?:,|$)/i.test(line)) {
                packet = parseTmLine(line);
            } else if (line.startsWith("{") && line.endsWith("}")) {
                packet = parseJsonLine(line);
            } else if (line.includes("=")) {
                packet = parseKeyValueItems(line);
            } else if (line.includes(",")) {
                packet = parsePositionPacket(line);
            } else {
                state.ignoredLines += 1;
                emit("openmcc:unparsed-line", { line, timestamp: Date.now() });
                return null;
            }

            validatePacket(packet);

            // В v8 контрольная сумма намеренно не валидируется.
            if (Object.hasOwn(packet, "CHECKSUM")) {
                packet.CHECKSUM_BYPASS = 1;
                delete packet.CHECKSUM_OK;
            }

            state.parsedPackets += 1;
            state.lastPacket = Object.freeze({ ...packet });
            emit("openmcc:telemetry", { ...packet });
            return packet;
        } catch (error) {
            state.errorCount += 1;
            const detail = {
                message: `Ошибка телеметрии: ${error.message}`,
                rawLine: line,
                timestamp: Date.now(),
            };
            emit("openmcc:telemetry-error", detail);
            log(detail.message, "error", detail);
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
        }

        const lines = state.textBuffer.split(/\r?\n/);
        state.textBuffer = lines.pop() ?? "";
        return lines.map(parseLine).filter(Boolean);
    }

    function flush() {
        const tail = normalizeLine(state.textBuffer);
        state.textBuffer = "";
        return tail ? parseLine(tail) : null;
    }

    function reset() {
        Object.assign(state, {
            textBuffer: "",
            totalFragments: 0,
            totalLines: 0,
            parsedPackets: 0,
            ignoredLines: 0,
            errorCount: 0,
            lastRawLine: "",
            lastPacket: null,
        });
    }

    function initialize() {
        if (state.initialized) return;
        state.initialized = true;
        log("Парсер телеметрии v0.8.0 готов. Прикладная проверка XOR отключена.", "success");
        emit("openmcc:parser-ready", {
            version: CONFIG.version,
            checksumValidation: false,
        });
    }

    window.OpenMCCParser = Object.freeze({
        config: CONFIG,
        knownParameters: KNOWN_PARAMETERS,
        parseLine,
        parsePositionPacket,
        pushText,
        flush,
        reset,
        getState: () => ({ ...state, bufferedCharacters: state.textBuffer.length }),
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
