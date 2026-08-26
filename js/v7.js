"use strict";

/* ============================================================
   ЦУП Альтаир v7 / 0.7.1
   Финальная конфигурация Технопром 2026 — Миссия на Луну.
   ============================================================ */

const V7 = Object.freeze({
    version: "0.7.1",
    frequency: 435.000,
    bitRate: 4.8,
    deviation: 5,
    bandwidth: 203,
    power: 5,
    telemetryOrder: ["ID", "PACKET", "UPTIME", "PANEL_POWER", "VOLT", "MODE", "CHECKSUM", "ANTENNA", "RSSI", "SNR"],
});

function setText(selector, text) {
    const element = document.querySelector(selector);
    if (element) element.textContent = text;
}

function createTelemetryCard(key) {
    const definitions = {
        MODE: ["Режим работы спутника", "--", "1 — штатный · 0 — аварийный"],
        CHECKSUM: ["Контрольная сумма XOR", "--", "HEX · 2 символа"],
        ANTENNA: ["Раскрытие антенны", "Н/Д", "1 — раскрыта · 0 — сложена"],
    };
    const definition = definitions[key];
    if (!definition) return null;
    const card = document.createElement("div");
    card.className = `card telemetryCard telemetry-${key.toLowerCase()}`;
    card.dataset.telemetry = key;
    card.innerHTML = `<span class="label">${definition[0]}</span><span id="${key}" class="value telemetryTextValue">${definition[1]}</span><span class="unit">${definition[2]}</span>`;
    return card;
}

function fixTelemetryLayout() {
    const grid = document.querySelector("#telemetryPanel .altairTelemetryGrid");
    if (!grid) return;

    grid.querySelector('[data-telemetry="TEMP"]')?.remove();

    for (const key of ["MODE", "CHECKSUM", "ANTENNA"]) {
        if (!grid.querySelector(`[data-telemetry="${key}"]`)) {
            const card = createTelemetryCard(key);
            if (card) grid.appendChild(card);
        }
    }

    const antenna = document.getElementById("ANTENNA");
    if (antenna && (!antenna.textContent || /^-+$/.test(antenna.textContent.trim()))) antenna.textContent = "Н/Д";

    // ВАЖНО: RSSI и SNR всегда последние и идут после раскрытия антенны.
    V7.telemetryOrder.forEach(key => {
        const card = grid.querySelector(`[data-telemetry="${key}"]`);
        if (card) grid.appendChild(card);
    });

    const note = document.querySelector(".altairPacketNote");
    if (note) {
        const strong = note.querySelector("strong");
        const code = note.querySelector("code");
        const span = note.querySelector("span");
        if (strong) strong.textContent = "Пакет миссии v7 · 29 символов:";
        if (code) code.textContent = "02,00001,00015,3.00,4.20,1,33";
        if (span) span.textContent = "Порядок пакета: ID, PACKET, UPTIME, PANEL_POWER, VOLT, MODE, XOR. Состояние антенны в минимальном пакете отсутствует и отображается как «Н/Д». RSSI и SNR добавляются наземным CC1101-шлюзом и показаны последними.";
    }

    document.querySelectorAll("#chartPanel .chartCard").forEach(card => {
        if (card.querySelector("#chartTEMP")) card.remove();
    });
}

function saveV7Profile() {
    try {
        const key = "altair-v5-radio-settings";
        const settings = JSON.parse(localStorage.getItem(key) || "{}");
        settings.cc1101 = {
            ...(settings.cc1101 || {}),
            frequency: V7.frequency,
            power: V7.power,
            rate: V7.bitRate,
            modulation: "2FSK",
            bandwidth: String(V7.bandwidth),
            crc: true,
            cca: true,
        };
        localStorage.setItem(key, JSON.stringify(settings));
    } catch (_) {}
}

function applyV7RadioProfile() {
    const selector = document.getElementById("radioModuleType");
    if (selector && selector.value !== "cc1101") return;

    const values = {
        radioFrequency: V7.frequency.toFixed(3),
        radioTxPower: String(V7.power),
        radioDataRate: String(V7.bitRate),
        radioModulation: "2FSK",
        radioBandwidth: String(V7.bandwidth),
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.value = value;
    });
    const crc = document.getElementById("radioCrc");
    const cca = document.getElementById("radioCca");
    if (crc) crc.checked = true;
    if (cca) cca.checked = true;

    const preview = document.getElementById("radioCommandPreview");
    if (preview) preview.textContent = "$CMD,RADIO,TYPE=CC1101,FREQ=435.000,POWER=5,RATE=4.8,MOD=2FSK,BW=203,CRC=1,CCA=1";

    document.querySelectorAll("#radioControlContainer .radioMiniNote").forEach(note => {
        if (/МГц|BW|полос|профил/i.test(note.textContent || "")) {
            note.textContent = "Рабочий профиль v7: 435.000 МГц · 4.8 kbps · 2-FSK · девиация 5 кГц · широкая RX BW 203 кГц · 5 dBm.";
        }
    });

    const oldPreset = document.getElementById("radioTechnopromPreset");
    if (oldPreset && !oldPreset.dataset.v7patched) {
        const preset = oldPreset.cloneNode(true);
        preset.dataset.v7patched = "1";
        preset.textContent = "Применить рабочий профиль v7 · BW 203 кГц";
        oldPreset.replaceWith(preset);
        preset.addEventListener("click", () => {
            saveV7Profile();
            applyV7RadioProfile();
            ["radioFrequency", "radioTxPower", "radioDataRate", "radioModulation", "radioBandwidth"].forEach(id => {
                document.getElementById(id)?.dispatchEvent(new Event("change", { bubbles: true }));
            });
            window.OpenMCCLogger?.write?.("Выбран рабочий профиль v7: CC1101 435.000 МГц, RX BW 203 кГц", "success", "V7");
        });
    }
}

function fixBrandingAndHelp() {
    setText(".buildBadge", "v7 · 0.7.1");
    setText("#projectPanel .panelEyebrow", "RELEASE V7.1");
    const log = document.querySelector("#eventLog > div:first-child");
    if (log && /v5|v6|v7/i.test(log.textContent || "")) log.textContent = "ЦУП Альтаир v7.1 запущен.";

    const radioLead = document.querySelector("#radioPanel .panelLead");
    if (radioLead) radioLead.innerHTML = 'Рабочий профиль v7.1: <strong>435.000 МГц · 4.8 kbps · 2-FSK · Δf 5 кГц · широкая RX BW 203 кГц · 5 dBm</strong>.';

    const help = document.getElementById("helpDialog");
    if (help) {
        setText("#helpDialog .panelEyebrow", "ЦУП АЛЬТАИР · V7.1");
        const sections = help.querySelectorAll("section");
        if (sections[0]) sections[0].innerHTML = '<h3>Быстрый запуск v7.1</h3><p>Прошейте STM32 файлом <code>Transmit_v7_static.ino</code>, ESP32 — <code>Altair_Gateway_v7.ino</code> либо встроенной прошивкой v7.1. Закройте Serial Monitor, подключите ESP32 к ЦУПу на 115200 бод и включите передатчик.</p>';
        if (sections[1]) sections[1].innerHTML = '<h3>Телеметрия</h3><p>Карточки: ID, пакет, uptime, мощность панелей, напряжение, режим, XOR, раскрытие антенны, RSSI, SNR. RSSI и SNR находятся в самом конце. Пока поле антенны отсутствует в 29-символьном пакете, отображается «Н/Д».</p>';
        if (sections[2]) sections[2].innerHTML = '<h3>Радиоканал</h3><p>Рабочий стендовый профиль: 435.000 МГц, 4.8 kbps, 2-FSK, девиация 5 кГц, RX BW 203 кГц, sync 0x12AD, NRZ, variable packet length, CRC. В v7.1 встроенная прошивка использует тот же <code>radio.receive(packet)</code>, который был подтверждён на реальном стенде.</p>';
        if (sections[3]) sections[3].innerHTML = '<h3>Документация</h3><p>Полное руководство находится в <code>docs/CUP_Altair_v7_Manual.pdf</code>. На главной странице GitHub есть прямые ссылки на установщик и оба скетча.</p>';
    }
}

function keepAntennaUnknownWhenAbsent(event) {
    const data = event?.detail || {};
    if (Object.hasOwn(data, "ANTENNA") && (Number(data.ANTENNA) === 0 || Number(data.ANTENNA) === 1)) return;
    const antenna = document.getElementById("ANTENNA");
    if (antenna) antenna.textContent = "Н/Д";
}

function applyV7() {
    fixTelemetryLayout();
    fixBrandingAndHelp();
    saveV7Profile();
    applyV7RadioProfile();

    const selector = document.getElementById("radioModuleType");
    if (selector && !selector.dataset.v7watch) {
        selector.dataset.v7watch = "1";
        selector.addEventListener("change", () => setTimeout(applyV7RadioProfile, 100));
    }

    window.addEventListener("openmcc:telemetry", keepAntennaUnknownWhenAbsent);
    window.OpenMCCLogger?.write?.("ЦУП Альтаир v7.1: профиль 435 МГц / RX BW 203 кГц, проверенный blocking receive", "success", "V7");
}

const start = () => setTimeout(applyV7, 250);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
