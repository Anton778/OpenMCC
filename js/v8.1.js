"use strict";

/* ЦУП Альтаир v8.0.1 — UX/flow patch */
(() => {
    const VERSION = "0.8.1";
    const expectedDefault = ["01","02","03","04","05","06","07","08","09","10"];
    const seen = new Map();

    function loadStyles() {
        if (document.getElementById("altairV81Styles")) return;
        const link = document.createElement("link");
        link.id = "altairV81Styles";
        link.rel = "stylesheet";
        link.href = "css/v8.1.css";
        document.head.appendChild(link);
    }

    function setVersion() {
        document.querySelectorAll(".buildBadge").forEach(el => el.textContent = `v8 · ${VERSION}`);
        const about = document.getElementById("v8AboutDialog");
        if (about) {
            about.querySelectorAll("p,code,strong,span").forEach(el => {
                if (el.children.length) return;
                el.textContent = (el.textContent || "").replace(/0\.8\.0/g, VERSION);
            });
        }
    }

    function setConnectionLocked(locked) {
        const button = document.getElementById("connectButton");
        const notice = document.getElementById("v81ConnectionGateNote");
        if (button) {
            button.disabled = Boolean(locked);
            button.title = locked ? "Сначала выполните шаг 1: прошейте шлюз или подтвердите, что он уже прошит." : "";
        }
        if (notice) notice.hidden = !locked;
    }

    function firmwareConfirmed(source = "manual") {
        const flow = document.getElementById("v81SetupFlow");
        flow?.classList.add("firmware-confirmed");
        setConnectionLocked(false);
        const firmware = document.getElementById("firmwarePanel");
        const serial = document.getElementById("serialPanel");
        firmware?.classList.add("v81-step-collapsed");
        serial?.classList.remove("v8-collapsed");
        const toggle = document.getElementById("v81FirmwareToggle");
        if (toggle) toggle.textContent = "Развернуть";
        const state = document.getElementById("v81FirmwareStepState");
        if (state) state.textContent = source === "flash" ? "ПРОШИТО" : "ПОДТВЕРЖДЕНО";
        setTimeout(() => serial?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    }

    function installSetupFlow() {
        const dashboard = document.getElementById("dashboard");
        const firmware = document.getElementById("firmwarePanel");
        const serial = document.getElementById("serialPanel");
        const telemetry = document.getElementById("telemetryPanel");
        if (!dashboard || !firmware || !serial || !telemetry) return false;

        let flow = document.getElementById("v81SetupFlow");
        if (!flow) {
            flow = document.createElement("section");
            flow.id = "v81SetupFlow";
            flow.className = "v81SetupFlow";
            dashboard.insertBefore(flow, telemetry);
        }
        if (firmware.parentElement !== flow) flow.appendChild(firmware);
        if (serial.parentElement !== flow) flow.appendChild(serial);
        if (telemetry.previousElementSibling !== flow) flow.insertAdjacentElement("afterend", telemetry);

        firmware.classList.add("v81SetupStep", "v81FirmwareStep");
        serial.classList.add("v81SetupStep", "v81ConnectionStep");

        if (!firmware.querySelector(".v81StepLabel")) {
            const label = document.createElement("div");
            label.className = "v81StepLabel";
            label.innerHTML = '<span>1</span><strong>Прошивка шлюза ЦУП</strong><em id="v81FirmwareStepState">ОБЯЗАТЕЛЬНЫЙ ШАГ</em>';
            firmware.insertBefore(label, firmware.firstChild);
        }
        if (!serial.querySelector(".v81StepLabel")) {
            const label = document.createElement("div");
            label.className = "v81StepLabel";
            label.innerHTML = '<span>2</span><strong>Соединение с ЦУПом</strong><em>ESP32 · 115200 бод</em>';
            serial.insertBefore(label, serial.firstChild);
        }

        if (!document.getElementById("v81FirmwareToggle")) {
            const title = firmware.querySelector(".panelTitleRow");
            const button = document.createElement("button");
            button.id = "v81FirmwareToggle";
            button.type = "button";
            button.className = "v8PanelToggle";
            button.textContent = "Свернуть";
            title?.appendChild(button);
            button.addEventListener("click", () => {
                const collapsed = firmware.classList.toggle("v81-step-collapsed");
                button.textContent = collapsed ? "Развернуть" : "Свернуть";
            });
        }

        if (!document.getElementById("v81ExistingGatewayButton")) {
            const actions = firmware.querySelector(".flasherActions") || firmware;
            const button = document.createElement("button");
            button.id = "v81ExistingGatewayButton";
            button.type = "button";
            button.className = "flasherSecondary v81ExistingGatewayButton";
            button.textContent = "Шлюз уже прошит v8 — перейти к подключению";
            button.title = "Используйте только если на ESP32 уже загружен Altair Gateway v8 с RX BW 203 кГц.";
            actions.appendChild(button);
            button.addEventListener("click", () => firmwareConfirmed("manual"));
        }

        if (!document.getElementById("v81ConnectionGateNote")) {
            const note = document.createElement("div");
            note.id = "v81ConnectionGateNote";
            note.className = "v81ConnectionGateNote";
            note.textContent = "Сначала выполните шаг 1: прошейте ESP32 или подтвердите, что шлюз v8 уже прошит.";
            const connect = document.getElementById("connectButton");
            connect?.insertAdjacentElement("beforebegin", note);
        }

        if (!flow.dataset.ready) {
            flow.dataset.ready = "1";
            setConnectionLocked(true);
            serial.classList.add("v8-collapsed");

            const status = document.getElementById("firmwareFlasherStatus");
            if (status) {
                const observer = new MutationObserver(() => {
                    if ((status.textContent || "").trim().toUpperCase() === "ГОТОВО") firmwareConfirmed("flash");
                });
                observer.observe(status, { childList: true, subtree: true, characterData: true });
            }

            window.addEventListener("openmcc:serial-connected", () => serial.classList.add("v8-collapsed"));
        }
        return true;
    }

    function installRawConsolePlacement() {
        const dashboard = document.getElementById("dashboard");
        const raw = document.getElementById("rawSerialPanel");
        if (!dashboard || !raw) return false;
        const log = document.getElementById("logPanel");
        if (log) log.insertAdjacentElement("afterend", raw);
        else dashboard.appendChild(raw);

        if (!document.getElementById("v81RawToggle")) {
            const title = raw.querySelector(".panelTitleRow");
            const button = document.createElement("button");
            button.id = "v81RawToggle";
            button.type = "button";
            button.className = "v8PanelToggle";
            button.textContent = "Показать";
            title?.appendChild(button);
            raw.classList.add("v81-raw-collapsed");
            button.addEventListener("click", () => {
                const collapsed = raw.classList.toggle("v81-raw-collapsed");
                button.textContent = collapsed ? "Показать" : "Скрыть";
            });
        }
        return true;
    }

    function expectedIds() {
        const input = document.getElementById("v81ExpectedIds");
        const raw = String(input?.value || expectedDefault.join(","));
        return [...new Set(raw.split(/[\s,;]+/).map(v => v.trim()).filter(Boolean))];
    }

    function rosterEntries() {
        const ids = expectedIds();
        for (const id of seen.keys()) if (!ids.includes(id)) ids.push(id);
        return ids;
    }

    function renderRoster() {
        const list = document.getElementById("v81IdList");
        if (!list) return;
        list.innerHTML = rosterEntries().map(id => {
            const item = seen.get(id);
            const online = Boolean(item?.lastSeen);
            const color = online ? item.color : "#51657c";
            const last = online ? new Date(item.lastSeen).toLocaleTimeString("ru-RU", {hour12:false}) : "—";
            const cmd = item?.commandSent ? '<span class="v81CmdBadge">CMD</span>' : '';
            return `<div class="v81IdRow ${online ? "online" : "offline"}">
                <span class="v81IdDot" style="background:${color};box-shadow:${online ? `0 0 10px ${color}` : "none"}"></span>
                <strong>ID ${id}</strong>
                <span>${online ? `${item.count} пак.` : "нет связи"}</span>
                <time>${last}</time>${cmd}
            </div>`;
        }).join("");
        const total = document.getElementById("v81SeenCount");
        if (total) total.textContent = String([...seen.values()].filter(v => v.lastSeen).length);
    }

    function installIdRoster() {
        const panel = document.getElementById("chartPanel");
        const grid = panel?.querySelector(".altairChartGrid");
        if (!panel || !grid) return false;
        if (!document.getElementById("v81ChartsBody")) {
            const body = document.createElement("div");
            body.id = "v81ChartsBody";
            body.className = "v81ChartsBody";
            grid.parentNode.insertBefore(body, grid);
            body.appendChild(grid);

            const aside = document.createElement("aside");
            aside.id = "v81IdRoster";
            aside.className = "v81IdRoster";
            aside.innerHTML = `
                <div class="v81RosterTitle"><div><span>СПУТНИКИ</span><strong>Кто выходил на связь</strong></div><b id="v81SeenCount">0</b></div>
                <label class="v81ExpectedField"><span>Ожидаемые ID</span><input id="v81ExpectedIds" value="${expectedDefault.join(",")}" spellcheck="false"></label>
                <div id="v81IdList"></div>
                <p>Цвет ID совпадает с линией на графиках. <b>CMD</b> означает, что с ЦУПа на этот ID уже отправлялась команда.</p>`;
            body.appendChild(aside);
            document.getElementById("v81ExpectedIds")?.addEventListener("change", renderRoster);
            renderRoster();
        }

        if (!panel.dataset.v81roster) {
            panel.dataset.v81roster = "1";
            window.addEventListener("openmcc:telemetry", event => {
                const id = String(event.detail?.ID ?? "").trim();
                if (!id) return;
                const previous = seen.get(id) || { count: 0, commandSent: false };
                previous.count += 1;
                previous.lastSeen = Date.now();
                previous.color = window.OpenMCCCharts?.colorForId?.(id) || "#00d9ff";
                seen.set(id, previous);
                renderRoster();
            });
            window.addEventListener("openmcc:serial-write", event => {
                const text = String(event.detail?.text || "");
                const match = text.match(/\$CMD,RF,TO=([^,\r\n]+)/i);
                if (!match) return;
                const id = match[1].trim();
                if (id.toUpperCase() === "ALL") return;
                const previous = seen.get(id) || { count: 0, lastSeen: 0, color: window.OpenMCCCharts?.colorForId?.(id) || "#00d9ff" };
                previous.commandSent = true;
                seen.set(id, previous);
                renderRoster();
            });
            window.addEventListener("openmcc:v8-reset", () => {
                seen.clear();
                renderRoster();
            });
        }
        return true;
    }

    function reorderMainPanels() {
        const flow = document.getElementById("v81SetupFlow");
        const telemetry = document.getElementById("telemetryPanel");
        const charts = document.getElementById("chartPanel");
        if (!flow || !telemetry || !charts) return;
        flow.insertAdjacentElement("afterend", telemetry);
        telemetry.insertAdjacentElement("afterend", charts);
    }

    function initialize() {
        loadStyles();
        setVersion();
        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;
            const a = installSetupFlow();
            const b = installRawConsolePlacement();
            const c = installIdRoster();
            if (a) reorderMainPanels();
            setVersion();
            if ((a && b && c) || attempts > 60) clearInterval(timer);
        }, 150);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
