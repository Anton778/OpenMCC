"use strict";

/* ЦУП Альтаир v8 — финальная нормализация интерфейса после legacy-модулей. */
(() => {
    const RADIO_SETTINGS_KEY = "altair-v5-radio-settings";
    const PROFILE = Object.freeze({
        frequency: 435.000,
        power: 5,
        rate: 4.8,
        modulation: "2FSK",
        bandwidth: "203",
        crc: true,
        cca: true,
    });

    function saveProfile() {
        try {
            const saved = JSON.parse(localStorage.getItem(RADIO_SETTINGS_KEY) || "{}");
            saved.cc1101 = { ...(saved.cc1101 || {}), ...PROFILE };
            localStorage.setItem(RADIO_SETTINGS_KEY, JSON.stringify(saved));
        } catch {
            // localStorage может быть недоступен; это не мешает работе ЦУПа.
        }
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = String(value);
        el.disabled = true;
    }

    function enforceRadioProfile() {
        const selector = document.getElementById("radioModuleType");
        if (selector && selector.value !== "cc1101") return;

        setValue("radioFrequency", "435.000");
        setValue("radioTxPower", "5");
        setValue("radioDataRate", "4.8");
        setValue("radioModulation", "2FSK");
        setValue("radioBandwidth", "203");

        const crc = document.getElementById("radioCrc");
        const cca = document.getElementById("radioCca");
        if (crc) { crc.checked = true; crc.disabled = true; }
        if (cca) { cca.checked = true; cca.disabled = true; }

        const preset = document.getElementById("radioTechnopromPreset");
        if (preset) preset.hidden = true;

        const apply = document.getElementById("radioApplyButton");
        if (apply) {
            apply.disabled = true;
            apply.textContent = "Рабочий профиль v8 зафиксирован";
            apply.title = "435.000 МГц · 4.8 kbps · 2-FSK · Δf 5 кГц · RX BW 203 кГц";
        }

        const preview = document.getElementById("radioCommandPreview");
        if (preview) preview.textContent = "$CMD,RADIO_STATUS";

        const title = document.querySelector("#radioControlContainer .radioConfigTitleRow strong");
        if (title) title.textContent = "Альтаир v8 · проверенный стендовый профиль";

        const lead = document.querySelector("#radioPanel .panelLead");
        if (lead) {
            lead.innerHTML = 'Рабочий профиль v8: <strong>435.000 МГц · 4.8 kbps · 2-FSK · Δf 5 кГц · RX BW 203 кГц · RF TX включён</strong>. Профиль наземного CC1101 зафиксирован для воспроизводимой работы.';
        }

        saveProfile();
    }

    function normalizeTelemetryOrder() {
        const grid = document.querySelector("#telemetryPanel .altairTelemetryGrid");
        if (!grid) return;

        const order = [
            "ID",
            "PACKET",
            "UPTIME",
            "PANEL_POWER",
            "VOLT",
            "MODE",
            "CHECKSUM",
            "ANTENNA",
            "RSSI",
            "SNR",
        ];

        order.forEach(key => {
            const card = grid.querySelector(`[data-telemetry="${key}"]`);
            if (card) grid.appendChild(card);
        });
    }

    function cleanLegacyUi() {
        const badge = document.querySelector(".buildBadge");
        if (badge) badge.textContent = "v8 · 0.8.1";

        const projectEyebrow = document.querySelector("#projectPanel .panelEyebrow");
        if (projectEyebrow) projectEyebrow.textContent = "RELEASE V8";

        const projectHelp = document.querySelector("#projectPanel [data-help-open]");
        if (projectHelp) projectHelp.textContent = "Что умеет v8?";

        const projectItems = document.querySelectorAll("#projectPanel .projectItem strong");
        const projectTexts = [
            "Телеметрия v8: ID / PACKET / UPTIME / PANEL / VOLT / MODE / CHECKSUM / ANTENNA / RSSI / SNR",
            "Графики VOLT / PANEL / RSSI / SNR с отдельными линиями для каждого ID",
            "ESP32 + CC1101: приём, передача RF-команд и встроенная прошивка",
            "Командный канал, RAW COM и полный сброс принятых данных",
            "Arduino Uno поворотки + симулятор AZ/EL",
            "Рабочий профиль 435.000 МГц · 4.8 kbps · 2-FSK · RX BW 203 кГц",
            "Проверка механики поворотки и конкретных бортовых обработчиков команд",
            "Автосопровождение по орбите / TLE / SGP4",
        ];
        projectItems.forEach((item, index) => {
            if (projectTexts[index]) item.textContent = projectTexts[index];
        });

        const eventLogFirst = document.querySelector("#eventLog > div:first-child");
        if (eventLogFirst && /v5/i.test(eventLogFirst.textContent || "")) {
            eventLogFirst.textContent = "ЦУП Альтаир v8.1 запущен.";
        }

        document.querySelectorAll(".commandPresetGroup").forEach(group => group.remove());

        const help = document.getElementById("helpDialog");
        if (help) {
            const eyebrow = help.querySelector(".panelEyebrow");
            if (eyebrow) eyebrow.textContent = "ЦУП АЛЬТАИР · V8";

            const sections = help.querySelectorAll("section");
            if (sections[0]) {
                sections[0].innerHTML = '<h3>ЦУП Альтаир v8.1</h3><p>Сначала подготовьте ESP32-радиошлюз, затем подключите его на 115200 бод. Рабочий радиоканал: <strong>435.000 МГц</strong>, 4.8 kbps, 2-FSK, девиация 5 кГц, RX BW 203 кГц.</p>';
            }
            if (sections[1]) {
                sections[1].innerHTML = '<h3>Телеметрия v8</h3><p>Принимаются позиционные пакеты с 7 полями и расширенные пакеты с полем <code>ANTENNA</code>. Поле контрольной суммы сохраняется, но прикладная XOR-проверка отключена: изменение ID не приводит к отбрасыванию пакета.</p>';
            }
            if (sections[2]) {
                sections[2].innerHTML = '<h3>Радиоканал и команды</h3><p>Аппаратный CRC CC1101 включён. Шлюз поддерживает передачу команд с ЦУПа. Для диагностики используйте панель RAW COM, где видны все строки от ESP32 в реальном времени.</p>';
            }
            if (sections[3]) {
                sections[3].innerHTML = '<h3>Документация</h3><p>Полное руководство входит в релиз как <code>CUP_Altair_v8_Manual.pdf</code> и хранится в репозитории в формате LaTeX.</p>';
            }
        }

        normalizeTelemetryOrder();
    }

    function apply() {
        cleanLegacyUi();
        enforceRadioProfile();
        normalizeTelemetryOrder();
    }

    function initialize() {
        apply();
        setTimeout(apply, 250);
        setTimeout(apply, 800);
        const selector = document.getElementById("radioModuleType");
        selector?.addEventListener("change", () => setTimeout(apply, 80));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(initialize, 450), { once: true });
    } else {
        setTimeout(initialize, 450);
    }
})();

import("/js/v8.1-ui.js").catch(error => console.error("Altair v8.1 UI runtime failed", error));
