"use strict";

/* ЦУП Альтаир v8.1 — компоновка рабочего экрана и сценарий первого запуска. */
(() => {
    const VERSION = "0.8.1";
    const GATEWAY_READY_KEY = "altair-v81-gateway-ready";
    const EXPECTED_IDS = Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(2, "0"));
    const seen = new Map();
    let gatewayReady = false;
    let dashboardObserver = null;
    let flasherObserver = null;

    function log(message, type = "info") {
        window.OpenMCCLogger?.write?.(message, type, "V8.1");
    }

    function safeStorageGet(key) {
        try { return localStorage.getItem(key); } catch { return null; }
    }

    function safeStorageSet(key, value) {
        try { localStorage.setItem(key, value); } catch {}
    }

    function normalizeId(value) {
        const raw = String(value ?? "").trim().toUpperCase();
        if (!raw) return "UNKNOWN";
        if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, "0");
        return raw.slice(0, 16);
    }

    function setBranding() {
        document.title = "ЦУП Альтаир v8.1 — Миссия на Луну";
        const badge = document.querySelector(".buildBadge");
        if (badge) badge.textContent = `v8 · ${VERSION}`;

        const aboutVersion = document.querySelector("#v8AboutDialog .aboutHeader div > div");
        if (aboutVersion && /версия/i.test(aboutVersion.textContent || "")) {
            aboutVersion.textContent = `Центр управления полётами · версия ${VERSION}`;
        }

        const eventLogFirst = document.querySelector("#eventLog > div:first-child");
        if (eventLogFirst && /ЦУП Альтаир v8/i.test(eventLogFirst.textContent || "")) {
            eventLogFirst.textContent = "ЦУП Альтаир v8.1 запущен.";
        }
    }

    function setGatewayReady(value, source = "manual") {
        gatewayReady = Boolean(value);
        if (gatewayReady) safeStorageSet(GATEWAY_READY_KEY, VERSION);

        const step = document.querySelector('[data-v81-step="flash"]');
        const state = document.getElementById("v81FlashState");
        const acknowledge = document.getElementById("v81AlreadyFlashed");
        if (step) step.classList.toggle("done", gatewayReady);
        if (state) state.textContent = gatewayReady ? "шлюз готов" : "требуется прошивка или подтверждение";
        if (acknowledge) acknowledge.textContent = gatewayReady ? "Подтверждено" : "Шлюз уже прошит";

        refreshConnectGate();
        if (gatewayReady && source !== "restore") log("Шлюз ESP32 отмечен как готовый к подключению.", "success");
    }

    function getConnected() {
        return Boolean(window.OpenMCCSerial?.getState?.().connected);
    }

    function refreshConnectGate() {
        const original = document.getElementById("connectButton");
        const shortcut = document.getElementById("v81ConnectShortcut");
        const status = document.getElementById("v81ConnectionStepState");
        const connected = getConnected();

        if (original) {
            original.disabled = !gatewayReady && !connected;
            original.title = gatewayReady || connected ? "" : "Сначала прошейте ESP32-шлюз или подтвердите, что он уже прошит.";
        }
        if (shortcut) {
            shortcut.disabled = !gatewayReady && !connected;
            shortcut.textContent = connected ? "Отключить" : "Подключить";
        }
        if (status) {
            if (connected) status.textContent = "соединение установлено";
            else status.textContent = gatewayReady ? "готово к подключению" : "ожидает шага 1";
        }

        const step = document.querySelector('[data-v81-step="connect"]');
        if (step) {
            step.classList.toggle("ready", gatewayReady && !connected);
            step.classList.toggle("done", connected);
        }
    }

    function installSetupFlow() {
        const dashboard = document.getElementById("dashboard");
        if (!dashboard) return null;

        let flow = document.getElementById("v81SetupFlow");
        if (!flow) {
            flow = document.createElement("section");
            flow.id = "v81SetupFlow";
            flow.className = "panel wide v81SetupFlow";
            flow.innerHTML = `
                <div class="v81SetupTitle">
                    <div><span class="panelEyebrow">БЫСТРЫЙ ЗАПУСК</span><strong>Подготовка шлюза ЦУП</strong></div>
                    <span>435.000 МГц · 2-FSK · 4.8 kbps · RX BW 203 кГц</span>
                </div>
                <div class="v81SetupSteps">
                    <div class="v81SetupStep" data-v81-step="flash">
                        <span class="v81StepNo">1</span>
                        <div class="v81StepText"><strong>Прошивка ESP32</strong><span id="v81FlashState">требуется прошивка или подтверждение</span></div>
                        <button type="button" id="v81OpenFlasher" class="v81StepButton primary">Открыть прошивальщик</button>
                        <button type="button" id="v81AlreadyFlashed" class="v81StepButton">Шлюз уже прошит</button>
                    </div>
                    <div class="v81SetupArrow" aria-hidden="true">→</div>
                    <div class="v81SetupStep" data-v81-step="connect">
                        <span class="v81StepNo">2</span>
                        <div class="v81StepText"><strong>Соединение с ЦУПом</strong><span id="v81ConnectionStepState">ожидает шага 1</span></div>
                        <button type="button" id="v81ConnectShortcut" class="v81StepButton primary" disabled>Подключить</button>
                        <button type="button" id="v81OpenSerialDetails" class="v81StepButton">Настройки COM</button>
                    </div>
                </div>`;
            dashboard.prepend(flow);

            document.getElementById("v81OpenFlasher")?.addEventListener("click", () => {
                const firmware = document.getElementById("firmwarePanel");
                if (!firmware) {
                    log("Панель прошивальщика ещё загружается. Повторите через секунду.", "warning");
                    return;
                }
                firmware.classList.remove("v81-utility-collapsed");
                const utilityToggle = firmware.querySelector(".v81UtilityToggle");
                if (utilityToggle) utilityToggle.textContent = "Свернуть";
                firmware.scrollIntoView({ behavior: "smooth", block: "start" });
            });

            document.getElementById("v81AlreadyFlashed")?.addEventListener("click", () => setGatewayReady(true, "manual"));
            document.getElementById("v81ConnectShortcut")?.addEventListener("click", () => {
                const button = document.getElementById("connectButton");
                if (button && !button.disabled) button.click();
            });
            document.getElementById("v81OpenSerialDetails")?.addEventListener("click", () => {
                const serial = document.getElementById("serialPanel");
                if (!serial) return;
                serial.classList.remove("v8-collapsed");
                const toggle = serial.querySelector(".v8PanelToggle");
                if (toggle) toggle.textContent = "Свернуть";
                serial.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        }

        const restored = safeStorageGet(GATEWAY_READY_KEY);
        if (restored === VERSION || restored === "0.8.0") setGatewayReady(true, "restore");
        else setGatewayReady(false, "restore");
        return flow;
    }

    function makeSerialCompact() {
        const serial = document.getElementById("serialPanel");
        if (!serial) return;
        serial.classList.add("v81SerialPanel");
        const eyebrow = serial.querySelector(".panelEyebrow");
        if (eyebrow) eyebrow.textContent = "ШАГ 2 · РАСШИРЕННЫЕ НАСТРОЙКИ";
        const h2 = serial.querySelector("h2");
        if (h2) h2.textContent = "Соединение / COM";
        if (!getConnected()) {
            serial.classList.add("v8-collapsed");
            const toggle = serial.querySelector(".v8PanelToggle");
            if (toggle) toggle.textContent = "Развернуть";
        }
        refreshConnectGate();
    }

    function compactFirmwarePanel() {
        const firmware = document.getElementById("firmwarePanel");
        if (!firmware) return;
        firmware.classList.add("v81FirmwarePanel");
        if (!firmware.dataset.v81Opened) firmware.classList.add("v81-utility-collapsed");
        const eyebrow = firmware.querySelector(".panelEyebrow");
        if (eyebrow) eyebrow.textContent = "ШАГ 1 · ESP32 FLASH";

        if (!firmware.querySelector(".v81UtilityToggle")) {
            const row = firmware.querySelector(".panelTitleRow");
            const button = document.createElement("button");
            button.type = "button";
            button.className = "v81UtilityToggle";
            button.textContent = firmware.classList.contains("v81-utility-collapsed") ? "Развернуть" : "Свернуть";
            row?.appendChild(button);
            button.addEventListener("click", () => {
                const collapsed = firmware.classList.toggle("v81-utility-collapsed");
                firmware.dataset.v81Opened = collapsed ? "" : "1";
                button.textContent = collapsed ? "Развернуть" : "Свернуть";
            });
        }
        watchFlasherSuccess();
    }

    function watchFlasherSuccess() {
        if (flasherObserver) return;
        const firmware = document.getElementById("firmwarePanel");
        if (!firmware) return;
        const inspect = () => {
            const reconnect = document.getElementById("firmwareReconnectButton");
            const status = document.getElementById("firmwareFlasherStatus");
            const text = String(status?.textContent || "").toUpperCase();
            if ((reconnect && !reconnect.disabled) || /ГОТОВ.*ПОДКЛЮЧ|УСПЕШ|ЗАПИС/.test(text)) setGatewayReady(true, "flasher");
        };
        flasherObserver = new MutationObserver(inspect);
        flasherObserver.observe(firmware, { subtree: true, childList: true, attributes: true, characterData: true });
        inspect();
    }

    function rosterEntry(id) {
        const list = document.getElementById("v81IdRosterList");
        if (!list) return null;
        let item = [...list.children].find(child => child.dataset.rosterId === id);
        if (item) return item;
        item = document.createElement("div");
        item.className = "v81RosterItem never";
        item.dataset.rosterId = id;
        item.innerHTML = `<span class="v81RosterDot"></span><strong>ID ${id}</strong><span class="v81RosterStatus">НЕТ СВЯЗИ</span><small>0 пак.</small>`;
        list.appendChild(item);
        return item;
    }

    function installIdRoster() {
        const panel = document.getElementById("chartPanel");
        const grid = panel?.querySelector(".altairChartGrid");
        if (!panel || !grid) return;

        let layout = panel.querySelector(".v81ChartsLayout");
        if (!layout) {
            layout = document.createElement("div");
            layout.className = "v81ChartsLayout";
            grid.parentNode.insertBefore(layout, grid);
            layout.appendChild(grid);
            const aside = document.createElement("aside");
            aside.id = "v81IdRoster";
            aside.innerHTML = `
                <div class="v81RosterHeader"><div><span class="panelEyebrow">SPACECRAFT IDS</span><strong>Связь по ID</strong></div><span id="v81RosterCount">0 / ${EXPECTED_IDS.length}</span></div>
                <p>Серый — связи ещё не было. Цвет — ID хотя бы раз принят. «ПЕРЕДАЁТ» означает пакет за последние 5 с.</p>
                <div id="v81IdRosterList"></div>`;
            layout.appendChild(aside);
        }
        EXPECTED_IDS.forEach(rosterEntry);
        updateRoster();
    }

    function recordId(telemetry) {
        if (!telemetry || typeof telemetry !== "object" || telemetry.ID === undefined) return;
        const id = normalizeId(telemetry.ID);
        const item = seen.get(id) || { count: 0, firstSeen: Date.now(), lastSeen: 0, color: null };
        item.count += 1;
        item.lastSeen = Date.now();
        item.color = window.OpenMCCCharts?.colorForId?.(id) || item.color || "#00d9ff";
        seen.set(id, item);
        rosterEntry(id);
        updateRoster();
    }

    function updateRoster() {
        const list = document.getElementById("v81IdRosterList");
        if (!list) return;
        const now = Date.now();
        list.querySelectorAll(".v81RosterItem").forEach(item => {
            const id = item.dataset.rosterId;
            const info = seen.get(id);
            const dot = item.querySelector(".v81RosterDot");
            const status = item.querySelector(".v81RosterStatus");
            const small = item.querySelector("small");
            item.classList.remove("never", "seen", "active");
            if (!info) {
                item.classList.add("never");
                if (dot) { dot.style.background = ""; dot.style.color = ""; }
                if (status) status.textContent = "НЕТ СВЯЗИ";
                if (small) small.textContent = "0 пак.";
                return;
            }
            const active = now - info.lastSeen <= 5000;
            item.classList.add("seen");
            if (active) item.classList.add("active");
            if (dot) { dot.style.background = info.color; dot.style.color = info.color; }
            if (status) status.textContent = active ? "ПЕРЕДАЁТ" : "БЫЛ НА СВЯЗИ";
            if (small) small.textContent = `${info.count} пак.`;
        });
        const expectedSeen = EXPECTED_IDS.filter(id => seen.has(id)).length;
        const extra = [...seen.keys()].filter(id => !EXPECTED_IDS.includes(id)).length;
        const count = document.getElementById("v81RosterCount");
        if (count) count.textContent = extra ? `${expectedSeen}/${EXPECTED_IDS.length} +${extra}` : `${expectedSeen} / ${EXPECTED_IDS.length}`;
    }

    function resetRoster() {
        seen.clear();
        const list = document.getElementById("v81IdRosterList");
        if (list) {
            list.innerHTML = "";
            EXPECTED_IDS.forEach(rosterEntry);
        }
        updateRoster();
    }

    function placeAfter(anchor, node) {
        if (!anchor || !node || anchor.nextElementSibling === node) return;
        anchor.insertAdjacentElement("afterend", node);
    }

    function placeBefore(anchor, node) {
        if (!anchor || !node || anchor.previousElementSibling === node) return;
        anchor.parentNode?.insertBefore(node, anchor);
    }

    function reorganizeDashboard() {
        const dashboard = document.getElementById("dashboard");
        if (!dashboard) return;
        const flow = installSetupFlow();
        const telemetry = document.getElementById("telemetryPanel");
        const charts = document.getElementById("chartPanel");
        const command = document.getElementById("commandPanel");
        const system = document.getElementById("systemPanel");
        const radio = document.getElementById("radioPanel");
        const firmware = document.getElementById("firmwarePanel");
        const serial = document.getElementById("serialPanel");
        const raw = document.getElementById("rawSerialPanel");
        const logPanel = document.getElementById("logPanel");

        placeAfter(flow, telemetry);
        placeAfter(telemetry, charts);
        placeAfter(charts, command);
        placeAfter(command, system);
        placeAfter(system, radio);
        placeAfter(radio, firmware);
        placeAfter(firmware, serial);
        placeBefore(logPanel, raw);

        makeSerialCompact();
        compactFirmwarePanel();
        installIdRoster();

        const serialNav = document.querySelector('#quickNav [data-scroll-target="serialPanel"]');
        if (serialNav) {
            serialNav.dataset.scrollTarget = "v81SetupFlow";
            serialNav.textContent = "Подготовка шлюза";
            serialNav.onclick = () => document.getElementById("v81SetupFlow")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    function installObservers() {
        const dashboard = document.getElementById("dashboard");
        if (!dashboard || dashboardObserver) return;
        let timer = null;
        dashboardObserver = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(reorganizeDashboard, 60);
        });
        dashboardObserver.observe(dashboard, { childList: true });
    }

    function installEvents() {
        window.addEventListener("openmcc:telemetry", event => recordId(event.detail));
        window.addEventListener("openmcc:v8-reset", resetRoster);
        window.addEventListener("openmcc:serial-connected", () => {
            refreshConnectGate();
            document.getElementById("serialPanel")?.classList.add("v8-collapsed");
        });
        window.addEventListener("openmcc:serial-disconnected", refreshConnectGate);
        setInterval(updateRoster, 1000);
    }

    function initialize() {
        setBranding();
        reorganizeDashboard();
        installObservers();
        installEvents();
        setTimeout(() => { setBranding(); reorganizeDashboard(); }, 900);
        log("Интерфейс v8.1 готов: прошивка → соединение, телеметрия и графики наверху, контроль ID активен.", "success");
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(initialize, 600), { once: true });
    else setTimeout(initialize, 600);
})();
