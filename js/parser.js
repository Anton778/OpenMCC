"use strict";

/* ============================================================
   ЦУП Альтаир — telemetry parser
   Release v6 / 0.6.0

   Primary v6 packet (29 ASCII characters):
   ID(2),PACKET(5),UPTIME(5),PANEL_POWER(4),VOLT(4),MODE(1),XOR(2)

   Example:
   02,00001,00015,3.00,4.20,1,33

   XOR is calculated over every character before the two HEX checksum
   characters, INCLUDING the final comma after MODE.
   ============================================================ */

(() => {
    const CONFIG = Object.freeze({
        version: "0.6.0",
        fixedPacketLength: 29,
        maximumBufferLength: 65536,
        maximumLineLength: 4096,
    });

    const KNOWN_PARAMETERS = Object.freeze({
        ID: Object.freeze({ type: "string" }),
        PACKET: Object.freeze({ type: "number" }),
        UPTIME: Object.freeze({ type: "number", unit: "s" }),
        PANEL_POWER: Object.freeze({ type: "number", unit: "W" }),
        VOLT: Object.freeze({ type: "number", unit: "V" }),
        MODE: Object.freeze({ type: "number" }),
        CHECKSUM: Object.freeze({ type: "string" }),
        CHECKSUM_OK: Object.freeze({ type: "number" }),
        RSSI: Object.freeze({ type: "number", unit: "dBm" }),
        SNR: Object.freeze({ type: "number", unit: "dB" }),
        LQI: Object.freeze({ type: "number" }),
        ANTENNA: Object.freeze({ type: "number" }),
        TEMP: Object.freeze({ type: "number", unit: "°C" }),
        LIGHT: Object.freeze({ type: "number" }),
        ERRORS: Object.freeze({ type: "number" }),
        ROLL: Object.freeze({ type: "number" }),
        PITCH: Object.freeze({ type: "number" }),
        YAW: Object.freeze({ type: "number" }),
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
        T: "TEMP", TEMPERATURE: "TEMP",
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
        if (/^(null|none|nan|---)$/i.test(text)) return null;
        const numeric = Number(text.replace(",", "."));
        if (!Number.isFinite(numeric)) {
            if (!definition) return text;
            throw new Error(`Параметр ${key} должен содержать число`);
        }
        return numeric;
    }

    function xorAscii(text) {
        let value = 0;
        for (let i = 0; i < text.length; i += 1) value ^= text.charCodeAt(i) & 0xFF;
        return value & 0xFF;
    }

    function toHex2(value) {
        return Number(value & 0xFF).toString(16).toUpperCase().padStart(2, "0");
    }

    function looksLikeFixedV6(line) {
        return /^[A-Za-z0-9]{2},\d{5},\d{5},\d\.\d{2},\d\.\d{2},[01],[0-9A-Fa-f]{2}$/.test(line);
    }

    function parseFixedV6(line) {
        if (line.length !== CONFIG.fixedPacketLength) {
            throw new Error(`Пакет v6 должен иметь 29 символов, получено ${line.length}`);
        }
        if (!looksLikeFixedV6(line)) {
            throw new Error("Пакет v6 не соответствует фиксированному формату");
        }

        const fields = line.split(",");
        const checksumReceived = fields[6].toUpperCase();
        const bodyWithFinalComma = line.slice(0, -2);
        const checksumCalculated = toHex2(xorAscii(bodyWithFinalComma));

        if (checksumReceived !== checksumCalculated) {
            throw new Error(`XOR не совпадает: принято ${checksumReceived}, рассчитано ${checksumCalculated}`);
        }

        return {
            ID: fields[0],
            PACKET: Number(fields[1]),
            UPTIME: Number(fields[2]),
            PANEL_POWER: Number(fields[3]),
            VOLT: Number(fields[4]),
            MODE: Number(fields[5]),
            CHECKSUM: checksumReceived,
            CHECKSUM_OK: 1,
            RAW_PACKET: line,
        };
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

    function parseTmLine(line) {
        const content = line.replace(/^\$TM[,]?/i, "").trim();
        if (content.includes("=")) return parseKeyValueItems(content);

        const values = content.split(",").map(value => value.trim());
        if (values.length >= 8) {
            return {
                ID: values[0], PACKET: Number(values[1]), UPTIME: Number(values[2]),
                LIGHT: Number(values[3]), VOLT: Number(values[4]), TEMP: Number(values[5]),
                MODE: Number(values[6]), ERRORS: Number(values[7]),
            };
        }
        if (values.length >= 6) {
            const packet = {
                ID: values[0], PACKET: Number(values[1]), UPTIME: Number(values[2]),
                VOLT: Number(values[3]), PANEL_POWER: Number(values[4]), TEMP: Number(values[5]),
            };
            if (values.length >= 7) packet.ANTENNA = Number(values[6]);
            return packet;
        }
        throw new Error("Неизвестный позиционный $TM пакет");
    }

    function parseJsonLine(line) {
        const source = JSON.parse(line);
        if (!source || Array.isArray(source) || typeof source !== "object") throw new Error("JSON должен быть объектом");
        const packet = {};
        Object.entries(source).forEach(([key, value]) => {
            const normalized = normalizeName(key);
            packet[normalized] = typeof value === "number" || value === null ? value : parseValue(normalized, value);
        });
        return packet;
    }

    function validatePacket(packet) {
        if (!packet || typeof packet !== "object" || !Object.keys(packet).length) throw new Error("Пустой пакет телеметрии");
        if (Object.hasOwn(packet, "MODE") && packet.MODE !== null && ![0, 1].includes(Number(packet.MODE))) {
            throw new Error("MODE должен быть 0 или 1");
        }
        if (Object.hasOwn(packet, "ANTENNA") && packet.ANTENNA !== null && ![0, 1].includes(Number(packet.ANTENNA))) {
            throw new Error("ANTENNA должен быть 0 или 1");
        }
    }

    function handleServiceLine(line) {
        const upper = line.toUpperCase();
        const service = [["$ACK", "openmcc:device-ack"], ["$ERR", "openmcc:device-error"], ["$INFO", "openmcc:device-info"]]
            .find(([prefix]) => upper.startsWith(prefix));
        if (!service) return false;
        const [prefix, eventName] = service;
        emit(eventName, { line, payload: line.slice(prefix.length).replace(/^,/, ""), timestamp: Date.now() });
        return true;
    }

    function parseLine(rawLine) {
        state.totalLines += 1;
        const line = normalizeLine(rawLine);
        state.lastRawLine = line;
        if (!line) { state.ignoredLines += 1; return null; }
        if (line.length > CONFIG.maximumLineLength) {
            state.errorCount += 1;
            emit("openmcc:telemetry-error", { message: "Строка телеметрии слишком длинная", rawLine: line, timestamp: Date.now() });
            return null;
        }

        emit("openmcc:raw-line", { line, timestamp: Date.now() });
        if (handleServiceLine(line)) return null;

        try {
            let packet;
            if (looksLikeFixedV6(line)) packet = parseFixedV6(line);
            else if (/^\$TM(?:,|$)/i.test(line)) packet = parseTmLine(line);
            else if (/^\$TEL(?:,|$)/i.test(line)) packet = parseKeyValueItems(line.replace(/^\$TEL[,]?/i, ""));
            else if (line.startsWith("{") && line.endsWith("}")) packet = parseJsonLine(line);
            else if (line.includes("=")) packet = parseKeyValueItems(line);
            else {
                state.ignoredLines += 1;
                emit("openmcc:unparsed-line", { line, timestamp: Date.now() });
                writeLog(`Нераспознанная RF-строка: ${line}`, "info");
                return null;
            }

            validatePacket(packet);
            state.parsedPackets += 1;
            state.lastPacket = Object.freeze({ ...packet });
            emit("openmcc:telemetry", { ...packet });
            return packet;
        } catch (error) {
            state.errorCount += 1;
            const detail = { message: `Ошибка телеметрии: ${error.message}`, rawLine: line, timestamp: Date.now() };
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
        Object.assign(state, { textBuffer: "", totalFragments: 0, totalLines: 0, parsedPackets: 0, ignoredLines: 0, errorCount: 0, lastRawLine: "", lastPacket: null });
    }

    function initialize() {
        if (state.initialized) return;
        state.initialized = true;
        writeLog(`Парсер телеметрии v${CONFIG.version} готов. Фиксированный пакет: 29 символов.`, "success");
        emit("openmcc:parser-ready", { version: CONFIG.version, fixedPacketLength: CONFIG.fixedPacketLength });
    }

    window.OpenMCCParser = Object.freeze({
        config: CONFIG,
        knownParameters: KNOWN_PARAMETERS,
        parseLine,
        parseFixedV6,
        xorAscii,
        pushText,
        flush,
        reset,
        getState() { return { ...state, bufferedCharacters: state.textBuffer.length }; },
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
