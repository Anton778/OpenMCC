"use strict";

/* OpenMCC integrated ESP32 flasher v0.4.0 */

const VERSION = "0.4.0";
const ESPTOOL_URL = "/node_modules/esptool-js/bundle.js";
const MANIFEST_URL = "/bundled_firmware/manifest.json";

const state = {
    ready: false,
    busy: false,
    flashed: false,
    esptool: null,
    manifest: null,
    transport: null,
    loader: null,
};

const el = {};

function projectLog(message, type = "info", metadata = null) {
    window.OpenMCCLogger?.write?.(message, type, "FLASHER", metadata);
}

function uiLog(message) {
    if (!el.log) return;
    const text = String(message ?? "").trimEnd();
    if (!text) return;
    const t = new Date().toISOString().slice(11, 23);
    el.log.textContent += `[${t}] ${text}\n`;
    el.log.scrollTop = el.log.scrollHeight;
}

function status(text, kind = "ready") {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.className = `flasherState ${kind}`;
}

function stage(text) {
    if (el.stage) el.stage.textContent = text;
}

function progress(value) {
    const p = Math.max(0, Math.min(100, Number(value) || 0));
    if (el.bar) el.bar.style.width = `${p}%`;
    if (el.percent) el.percent.textContent = `${Math.round(p)} %`;
}

function setBusy(value) {
    state.busy = Boolean(value);
    if (el.flash) el.flash.disabled = state.busy || !state.ready;
    if (el.reconnect) el.reconnect.disabled = state.busy || !state.flashed;
    if (el.baud) el.baud.disabled = state.busy;
}

function addCss() {
    if (document.querySelector("link[data-openmcc-flasher]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/flasher.css";
    link.dataset.openmccFlasher = "1";
    document.head.appendChild(link);
}

function addNav() {
    const nav = document.getElementById("quickNav");
    if (!nav || nav.querySelector('[data-scroll-target="firmwarePanel"]')) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.scrollTarget = "firmwarePanel";
    button.dataset.tip = "Прошивка штатного ESP32-WROOM-32 радиошлюза прямо из OpenMCC.";
    button.textContent = "Прошивка ESP32";
    button.addEventListener("click", () => document.getElementById("firmwarePanel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    const anchor = nav.querySelector('[data-scroll-target="radioPanel"]');
    if (anchor) anchor.insertAdjacentElement("afterend", button);
    else nav.appendChild(button);
}

function addHelp() {
    const body = document.querySelector("#helpDialog .helpDialogBody");
    if (!body || body.querySelector("[data-flasher-help]")) return;
    const section = document.createElement("section");
    section.dataset.flasherHelp = "1";
    section.innerHTML = `
        <h3>Прошивка ESP32</h3>
        <p>Desktop-версия OpenMCC содержит готовую прошивку радиошлюза. Подключите ESP32-WROOM-32 по USB, откройте «Прошивка ESP32» и нажмите «Прошить радиошлюз». После записи OpenMCC сверит MD5 каждой области Flash и перезагрузит плату.</p>`;
    body.appendChild(section);
}

function addPanel() {
    if (document.getElementById("firmwarePanel")) return;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "firmwarePanel";
    panel.innerHTML = `
        <div class="panelTitleRow">
            <div><span class="panelEyebrow">ESP32 FLASH TOOL</span><h2>Прошивка радиошлюза</h2></div>
            <span id="firmwareFlasherStatus" class="flasherState warning">ПОДГОТОВКА</span>
        </div>
        <p class="panelLead">Запись OpenMCC Radio Gateway в ESP32-WROOM-32 без Arduino IDE и PlatformIO на компьютере оператора.</p>
        <div class="flasherIntro">
            <div>
                <div class="flasherSummary">
                    <div><span>Целевая плата</span><strong>ESP32-WROOM-32</strong></div>
                    <div><span>Прошивка</span><strong id="firmwareVersion">загрузка…</strong></div>
                    <div><span>Комплект</span><strong id="firmwareImageState">проверка…</strong></div>
                    <div><span>Обнаруженный чип</span><strong id="firmwareDetectedChip">---</strong></div>
                </div>
                <div class="flasherProgressWrap">
                    <div class="flasherProgressHeader"><span class="flasherStageLabel">Ход операции</span><strong id="firmwareProgressValue">0 %</strong></div>
                    <div class="flasherProgressTrack"><div id="firmwareProgressBar" class="flasherProgressBar"></div></div>
                    <div id="firmwareStageText" class="flasherStageText">Подготовка прошивальщика…</div>
                </div>
            </div>
            <div class="flasherControls">
                <h3>Запись во Flash</h3>
                <div class="flasherControlGrid">
                    <label class="flasherField"><span>Скорость</span><select id="firmwareBaudRate" data-tip="При нестабильном USB-UART уменьшите скорость до 115200 бод.">
                        <option value="115200">115200 бод — совместимость</option>
                        <option value="460800" selected>460800 бод — рекомендуется</option>
                        <option value="921600">921600 бод — быстро</option>
                    </select></label>
                    <div class="flasherField"><span>Flash</span><strong style="padding:10px 0;color:#dcecff;font:650 12px Consolas,monospace">DIO · 40 MHz · 4 MB</strong></div>
                </div>
                <div class="flasherSafety"><strong>Без erase-all.</strong> Записываются только bootloader, partition table, boot_app0 и приложение; NVS целиком не стирается.</div>
                <div class="flasherActions">
                    <button type="button" id="firmwareFlashButton" class="flasherPrimary" disabled data-tip="Выберите именно ESP32-WROOM-32. Перед записью OpenMCC проверит семейство чипа.">Прошить радиошлюз</button>
                    <button type="button" id="firmwareReconnectButton" class="flasherSecondary" disabled data-tip="Подключить прошитую ESP32 к основному каналу OpenMCC и запросить состояние шлюза.">Подключить как шлюз</button>
                </div>
            </div>
        </div>
        <div class="flasherLogCard">
            <div class="flasherLogHeader"><div><span>Диагностика</span><strong>Журнал прошивальщика</strong></div><button type="button" id="firmwareClearLog">Очистить</button></div>
            <pre id="firmwareLog"></pre>
        </div>`;
    const radio = document.getElementById("radioPanel");
    if (radio) radio.insertAdjacentElement("afterend", panel);
    else document.getElementById("dashboard")?.appendChild(panel);
}

function cache() {
    el.status = document.getElementById("firmwareFlasherStatus");
    el.version = document.getElementById("firmwareVersion");
    el.image = document.getElementById("firmwareImageState");
    el.chip = document.getElementById("firmwareDetectedChip");
    el.percent = document.getElementById("firmwareProgressValue");
    el.bar = document.getElementById("firmwareProgressBar");
    el.stage = document.getElementById("firmwareStageText");
    el.baud = document.getElementById("firmwareBaudRate");
    el.flash = document.getElementById("firmwareFlashButton");
    el.reconnect = document.getElementById("firmwareReconnectButton");
    el.clear = document.getElementById("firmwareClearLog");
    el.log = document.getElementById("firmwareLog");
}

function updateProjectUi() {
    const badge = document.querySelector(".buildBadge");
    if (badge) badge.textContent = "v0.4 · LAB";

    const radio = document.getElementById("radioPanel");
    const stateBadge = radio?.querySelector(".panelState");
    if (stateBadge) {
        stateBadge.textContent = "ПО ГОТОВО · ЖДЁТ ЖЕЛЕЗО";
        stateBadge.classList.remove("planned");
        stateBadge.classList.add("neutral");
    }

    radio?.querySelectorAll(".radioHintGrid > div").forEach(row => {
        if (row.querySelector("span")?.textContent?.includes("Статус ПО")) {
            const strong = row.querySelector("strong");
            if (strong) strong.textContent = "Gateway v0.1.0 готов; требуется стендовая проверка";
        }
    });

    const grid = document.querySelector("#projectPanel .projectStatusGrid");
    if (grid && !grid.querySelector("[data-firmware-project-item]")) {
        const item = document.createElement("div");
        item.className = "projectItem test";
        item.dataset.firmwareProjectItem = "1";
        item.innerHTML = "<span>На проверку</span><strong>ESP32 gateway + прошивка прямо из OpenMCC</strong>";
        grid.appendChild(item);
    }
}

function validateManifest(m) {
    if (!m || String(m.targetChip).toUpperCase() !== "ESP32") throw new Error("Некорректный firmware manifest");
    if (!Array.isArray(m.images) || m.images.length !== 4) throw new Error("Комплект прошивки должен содержать 4 образа");
    for (const image of m.images) {
        if (!image.file || !Number.isFinite(Number(image.address))) throw new Error("Некорректный адрес образа Flash");
        if (!/^[0-9a-f]{32}$/i.test(String(image.md5 || ""))) throw new Error(`Нет MD5 для ${image.file}`);
    }
}

async function prepare() {
    if (!navigator.serial) throw new Error("Web Serial недоступен");
    status("ПОДГОТОВКА", "warning");
    stage("Загрузка Espressif esptool-js…");
    uiLog(`OpenMCC flasher v${VERSION}`);

    state.esptool = await import(ESPTOOL_URL);
    if (!state.esptool?.ESPLoader || !state.esptool?.Transport) throw new Error("Не удалось загрузить esptool-js");
    uiLog("Espressif esptool-js загружен.");

    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Встроенная прошивка отсутствует. Используйте официальный desktop installer OpenMCC v0.4+.");
    state.manifest = await response.json();
    validateManifest(state.manifest);

    el.version.textContent = `Gateway v${state.manifest.firmwareVersion}`;
    el.image.textContent = `${state.manifest.images.length} образа · ${state.manifest.buildLabel}`;
    state.ready = true;
    status("ГОТОВ", "ready");
    stage("Подключите ESP32-WROOM-32 и нажмите «Прошить радиошлюз». ");
    setBusy(false);

    for (const image of state.manifest.images) {
        uiLog(`${image.label}: 0x${Number(image.address).toString(16)} · ${image.size} B · ${image.md5}`);
    }
    projectLog("Встроенный ESP32 flasher готов", "success", { firmwareVersion: state.manifest.firmwareVersion });
}

async function loadImages() {
    const result = [];
    for (const image of state.manifest.images) {
        stage(`Чтение встроенного ${image.label}…`);
        const response = await fetch(`/bundled_firmware/${encodeURIComponent(image.file)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Файл ${image.file} отсутствует в установщике`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength !== Number(image.size)) throw new Error(`Размер ${image.file} не совпадает с manifest`);
        result.push({ ...image, address: Number(image.address), data });
    }
    return result;
}

function assertClassicEsp32(description) {
    const family = String(state.loader?.chip?.CHIP_NAME || "").toUpperCase();
    if (family !== "ESP32") {
        throw new Error(`Обнаружено семейство ${family || description || "UNKNOWN"}. Этот комплект разрешено писать только в классический ESP32 / ESP32-WROOM-32.`);
    }
}

async function closeTransport() {
    if (!state.transport) return;
    try { await state.transport.disconnect(); } catch {}
    state.transport = null;
    state.loader = null;
}

async function verify(images) {
    status("ПРОВЕРКА", "busy");
    uiLog("Проверка MD5 областей Flash…");
    for (let i = 0; i < images.length; i += 1) {
        const image = images[i];
        stage(`MD5: ${image.label}…`);
        const actual = String(await state.loader.flashMd5sum(image.address, image.data.byteLength)).toLowerCase();
        const expected = String(image.md5).toLowerCase();
        uiLog(`${image.label}: ${actual} ${actual === expected ? "OK" : "MISMATCH"}`);
        if (actual !== expected) throw new Error(`MD5 не совпал для ${image.label}`);
        progress(82 + ((i + 1) / images.length) * 13);
    }
}

async function flash() {
    if (!state.ready || state.busy) return;

    let port;
    try {
        /* Должно быть первым await после пользовательского клика. */
        port = await navigator.serial.requestPort();
    }
    catch (error) {
        if (error?.name === "NotFoundError") {
            uiLog("Выбор порта отменён.");
            return;
        }
        throw error;
    }

    setBusy(true);
    state.flashed = false;
    el.chip.textContent = "---";
    progress(0);
    status("ПОДКЛЮЧЕНИЕ", "busy");
    uiLog("--- Новая операция ---");

    try {
        const current = window.OpenMCCSerial?.getState?.();
        if (current?.connected || current?.connecting) {
            stage("Освобождение основного COM-порта…");
            uiLog("Основной Serial OpenMCC отключается перед прошивкой.");
            await window.OpenMCCSerial.disconnect("firmware-flasher");
        }

        const images = await loadImages();
        const baudrate = Number(el.baud.value) || 460800;
        state.transport = new state.esptool.Transport(port, false);
        state.loader = new state.esptool.ESPLoader({
            transport: state.transport,
            baudrate,
            debugLogging: false,
            terminal: {
                clean() {},
                writeLine(data) { uiLog(data); },
                write(data) { uiLog(data); },
            },
        });

        stage("Вход в ROM bootloader и определение чипа…");
        progress(3);
        const description = await state.loader.main();
        el.chip.textContent = description;
        uiLog(`Chip: ${description}; family: ${state.loader?.chip?.CHIP_NAME || "unknown"}`);
        assertClassicEsp32(description);

        status("ПРОШИВКА", "busy");
        stage("Запись Flash. Не отключайте USB…");
        progress(8);

        const totalBytes = images.reduce((sum, item) => sum + item.data.byteLength, 0);
        const offsets = images.map((_, i) => images.slice(0, i).reduce((sum, item) => sum + item.data.byteLength, 0));

        await state.loader.writeFlash({
            fileArray: images.map(item => ({ data: item.data, address: item.address })),
            flashMode: state.manifest.flashMode || "dio",
            flashFreq: state.manifest.flashFreq || "40m",
            flashSize: state.manifest.flashSize || "4MB",
            eraseAll: false,
            compress: true,
            reportProgress(fileIndex, written, total) {
                const item = images[fileIndex];
                if (!item) return;
                const part = total > 0 ? (written / total) * item.data.byteLength : written;
                const ratio = totalBytes > 0 ? (offsets[fileIndex] + Math.min(item.data.byteLength, part)) / totalBytes : 0;
                progress(8 + ratio * 72);
                stage(`Запись ${item.label}…`);
            },
        });

        progress(82);
        await verify(images);
        stage("Перезагрузка ESP32…");
        await state.loader.after("hard_reset");
        progress(100);

        state.flashed = true;
        status("ГОТОВО", "ready");
        stage(`Gateway v${state.manifest.firmwareVersion} записан и проверен.`);
        uiLog("Прошивка успешно завершена. ESP32 перезагружена.");
        projectLog("ESP32 radio gateway прошит из OpenMCC", "success", { firmwareVersion: state.manifest.firmwareVersion });
    }
    catch (error) {
        status("ОШИБКА", "error");
        stage("Операция не завершена. Проверьте журнал.");
        uiLog(`ОШИБКА: ${error?.message || error}`);
        uiLog("Если auto-reset не сработал: удерживайте BOOT → кратко EN/RESET → отпустите EN → отпустите BOOT → повторите.");
        projectLog(`Ошибка ESP32 flasher: ${error?.message || error}`, "error");
    }
    finally {
        await closeTransport();
        setBusy(false);
    }
}

async function reconnect() {
    if (state.busy) return;
    try {
        window.OpenMCCSerial.setDeviceProfile("esp32");
        window.OpenMCCSerial.setBaudRate(115200);
        document.getElementById("serialPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
        await window.OpenMCCSerial.connect();
        if (!window.OpenMCCSerial.getState().connected) return;
        uiLog("Gateway подключён к OpenMCC на 115200 бод.");
        await window.OpenMCCSerial.sendCommand("GATEWAY_INFO");
        await new Promise(resolve => setTimeout(resolve, 120));
        await window.OpenMCCSerial.sendCommand("RADIO_STATUS");
    }
    catch (error) {
        uiLog(`Ошибка подключения gateway: ${error?.message || error}`);
        projectLog(`Не удалось подключить прошитый gateway: ${error?.message || error}`, "error");
    }
}

function register() {
    el.flash.addEventListener("click", () => flash().catch(error => {
        status("ОШИБКА", "error");
        uiLog(`ОШИБКА: ${error?.message || error}`);
        setBusy(false);
    }));
    el.reconnect.addEventListener("click", reconnect);
    el.clear.addEventListener("click", () => { el.log.textContent = ""; });
}

async function init() {
    addCss();
    addPanel();
    addNav();
    addHelp();
    cache();
    updateProjectUi();
    register();
    setBusy(true);

    try {
        await prepare();
    }
    catch (error) {
        state.ready = false;
        status("НЕДОСТУПНО", "error");
        stage(error?.message || String(error));
        if (el.version) el.version.textContent = "недоступно";
        if (el.image) el.image.textContent = "нет firmware bundle";
        uiLog(`Flasher unavailable: ${error?.message || error}`);
        projectLog(`ESP32 flasher недоступен: ${error?.message || error}`, "warning");
        setBusy(false);
    }

    window.OpenMCCFlasher = Object.freeze({
        version: VERSION,
        flash,
        reconnect,
        getState: () => ({ ready: state.ready, busy: state.busy, flashed: state.flashed, firmwareVersion: state.manifest?.firmwareVersion || null }),
    });
}

init();
