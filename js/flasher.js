"use strict";

/* ============================================================
   OpenMCC — integrated ESP32 radio-gateway flasher
   Version 0.4.0

   Desktop-only module. It is injected by Electron after OpenMCC loads.
   Uses Espressif esptool-js over Web Serial.
   ============================================================ */

const FLASHER_VERSION = "0.4.0";
const ESPTOOL_MODULE_URL = "/node_modules/esptool-js/bundle.js";
const MANIFEST_URL = "/bundled_firmware/manifest.json";

const state = {
    initialized: false,
    busy: false,
    ready: false,
    esptool: null,
    manifest: null,
    port: null,
    transport: null,
    loader: null,
    detectedChip: "---",
    flashedSuccessfully: false,
};

const elements = {};

function writeProjectLog(message, type = "info", metadata = null) {
    if (window.OpenMCCLogger?.write) {
        window.OpenMCCLogger.write(message, type, "FLASHER", metadata);
    }
}

function appendFirmwareLog(message) {
    const line = String(message ?? "").trimEnd();
    if (!line) return;

    if (elements.log) {
        const timestamp = new Date().toISOString().slice(11, 23);
        elements.log.textContent += `[${timestamp}] ${line}\n`;
        elements.log.scrollTop = elements.log.scrollHeight;
    }
}

function clearFirmwareLog() {
    if (elements.log) elements.log.textContent = "";
}

function setStatus(text, kind = "ready") {
    if (!elements.status) return;
    elements.status.textContent = text;
    elements.status.className = `flasherState ${kind}`;
}

function setStage(text) {
    if (elements.stage) elements.stage.textContent = text;
}

function setProgress(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (elements.progressBar) elements.progressBar.style.width = `${value}%`;
    if (elements.progressValue) elements.progressValue.textContent = `${Math.round(value)} %`;
}

function setDetectedChip(name) {
    state.detectedChip = name || "---";
    if (elements.detectedChip) elements.detectedChip.textContent = state.detectedChip;
}

function setBusy(busy) {
    state.busy = Boolean(busy);
    if (elements.flashButton) elements.flashButton.disabled = state.busy || !state.ready;
    if (elements.reconnectButton) elements.reconnectButton.disabled = state.busy || !state.flashedSuccessfully;
    if (elements.baudRate) elements.baudRate.disabled = state.busy;
}

function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function injectStyles() {
    if (document.querySelector("link[data-openmcc-flasher]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/flasher.css";
    link.dataset.openmccFlasher = "1";
    document.head.appendChild(link);
}

function injectNavigationButton() {
    const nav = document.getElementById("quickNav");
    if (!nav || nav.querySelector('[data-scroll-target="firmwarePanel"]')) return;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.scrollTarget = "firmwarePanel";
    button.textContent = "Прошивка ESP32";
    button.dataset.tip = "Встроенная прошивка радиошлюза ESP32-WROOM-32 без Arduino IDE.";
    button.addEventListener("click", () => {
        document.getElementById("firmwarePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const radioButton = nav.querySelector('[data-scroll-target="radioPanel"]');
    if (radioButton) radioButton.insertAdjacentElement("afterend", button);
    else nav.appendChild(button);
}

function injectHelpSection() {
    const body = document.querySelector("#helpDialog .helpDialogBody");
    if (!body || body.querySelector("[data-flasher-help]")) return;

    const section = document.createElement("section");
    section.dataset.flasherHelp = "1";
    section.innerHTML = `
        <h3>Прошивка радиошлюза ESP32</h3>
        <p>В desktop-версии OpenMCC можно прошить ESP32-WROOM-32 без Arduino IDE. Подключите плату по USB, откройте раздел «Прошивка ESP32» и нажмите «Прошить радиошлюз». OpenMCC проверит тип чипа, запишет встроенную прошивку, сверит MD5 каждого записанного образа и перезагрузит плату.</p>
    `;
    body.appendChild(section);
}

function injectPanel() {
    if (document.getElementById("firmwarePanel")) return;

    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "firmwarePanel";
    panel.innerHTML = `
        <div class="panelTitleRow">
            <div>
                <span class="panelEyebrow">ESP32 FLASH TOOL</span>
                <h2>Прошивка радиошлюза</h2>
            </div>
            <span id="firmwareFlasherStatus" class="flasherState warning">ПОДГОТОВКА</span>
        </div>

        <p class="panelLead">Прошивка ESP32-WROOM-32 прямо из OpenMCC. Arduino IDE и PlatformIO на компьютере оператора не требуются.</p>

        <div class="flasherIntro">
            <div>
                <div class="flasherSummary">
                    <div><span>Целевая плата</span><strong id="firmwareTargetBoard">ESP32-WROOM-32</strong></div>
                    <div><span>Прошивка</span><strong id="firmwareVersion">загрузка…</strong></div>
                    <div><span>Встроенный образ</span><strong id="firmwareImageState">проверка…</strong></div>
                    <div><span>Обнаруженный чип</span><strong id="firmwareDetectedChip">---</strong></div>
                </div>

                <div class="flasherProgressWrap">
                    <div class="flasherProgressHeader">
                        <span class="flasherStageLabel">Ход операции</span>
                        <strong id="firmwareProgressValue">0 %</strong>
                    </div>
                    <div class="flasherProgressTrack" aria-label="Прогресс прошивки">
                        <div id="firmwareProgressBar" class="flasherProgressBar"></div>
                    </div>
                    <div id="firmwareStageText" class="flasherStageText">Подготовка встроенного прошивальщика…</div>
                </div>
            </div>

            <div class="flasherControls">
                <h3>Запись во Flash</h3>
                <div class="flasherControlGrid">
                    <label class="flasherField">
                        <span>Скорость прошивки</span>
                        <select id="firmwareBaudRate" data-tip="Если на 921600 бод возникают ошибки, выберите 460800 или 115200 бод.">
                            <option value="115200">115200 бод — максимально совместимо</option>
                            <option value="460800" selected>460800 бод — рекомендуется</option>
                            <option value="921600">921600 бод — быстро</option>
                        </select>
                    </label>
                    <div class="flasherField">
                        <span>Режим Flash</span>
                        <strong style="padding:10px 0;color:#dcecff;font:650 12px Consolas,monospace">DIO · 40 MHz · 4 MB</strong>
                    </div>
                </div>

                <div class="flasherSafety">
                    <strong>Без полного стирания.</strong> OpenMCC записывает только загрузчик, таблицу разделов, boot_app0 и приложение. NVS с сохранёнными RF-настройками специально не стирается целиком.
                </div>

                <div class="flasherActions">
                    <button type="button" id="firmwareFlashButton" class="flasherPrimary" disabled data-tip="Выберите ESP32-WROOM-32 в системном окне. OpenMCC автоматически переведёт совместимую плату в загрузчик и прошьёт её.">Прошить радиошлюз</button>
                    <button type="button" id="firmwareReconnectButton" class="flasherSecondary" disabled data-tip="После успешной прошивки подключает ESP32 к основному порту OpenMCC на 115200 бод и запрашивает сведения шлюза.">Подключить как шлюз</button>
                </div>
            </div>
        </div>

        <div class="flasherLogCard">
            <div class="flasherLogHeader">
                <div><span>Диагностика</span><strong>Журнал прошивальщика</strong></div>
                <button type="button" id="firmwareClearLog">Очистить</button>
            </div>
            <pre id="firmwareLog"></pre>
        </div>
    `;

    const radioPanel = document.getElementById("radioPanel");
    if (radioPanel) radioPanel.insertAdjacentElement("afterend", panel);
    else document.getElementById("dashboard")?.appendChild(panel);
}

function cacheElements() {
    elements.status = document.getElementById("firmwareFlasherStatus");
    elements.version = document.getElementById("firmwareVersion");
    elements.imageState = document.getElementById("firmwareImageState");
    elements.detectedChip = document.getElementById("firmwareDetectedChip");
    elements.progressBar = document.getElementById("firmwareProgressBar");
    elements.progressValue = document.getElementById("firmwareProgressValue");
    elements.stage = document.getElementById("firmwareStageText");
    elements.baudRate = document.getElementById("firmwareBaudRate");
    elements.flashButton = document.getElementById("firmwareFlashButton");
    elements.reconnectButton = document.getElementById("firmwareReconnectButton");
    elements.clearLogButton = document.getElementById("firmwareClearLog");
    elements.log = document.getElementById("firmwareLog");
}

function validateManifest(manifest) {
    if (!manifest || typeof manifest !== "object") throw new Error("Манифест прошивки повреждён");
    if (String(manifest.targetChip).toUpperCase() !== "ESP32") throw new Error("Манифест предназначен не для ESP32");
    if (!Array.isArray(manifest.images) || manifest.images.length < 3) throw new Error("В манифесте отсутствуют образы Flash");

    for (const image of manifest.images) {
        if (!image.file || !Number.isFinite(Number(image.address))) throw new Error("Некорректная запись образа в манифесте");
        if (!/^[0-9a-f]{32}$/i.test(String(image.md5 || ""))) throw new Error(`Для ${image.file} отсутствует контрольная сумма MD5`);
    }
}

async function prepareResources() {
    setStatus("ПОДГОТОВКА", "warning");
    setStage("Загрузка esptool-js и встроенной прошивки…");
    appendFirmwareLog(`OpenMCC flasher v${FLASHER_VERSION}`);

    if (!navigator.serial) throw new Error("Web Serial API недоступен в этой сборке OpenMCC");

    state.esptool = await import(ESPTOOL_MODULE_URL);
    if (!state.esptool?.ESPLoader || !state.esptool?.Transport) throw new Error("esptool-js загружен некорректно");
    appendFirmwareLog("Espressif esptool-js загружен.");

    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Встроенный комплект прошивки не найден. Установите desktop-релиз OpenMCC v0.4 или новее.");

    const manifest = await response.json();
    validateManifest(manifest);
    state.manifest = manifest;

    if (elements.version) elements.version.textContent = `Gateway v${manifest.firmwareVersion}`;
    if (elements.imageState) elements.imageState.textContent = `${manifest.images.length} образа · ${manifest.buildLabel || "bundled"}`;

    state.ready = true;
    setStatus("ГОТОВ", "ready");
    setStage("Подключите ESP32-WROOM-32 по USB и нажмите «Прошить радиошлюз».");
    setBusy(false);

    appendFirmwareLog(`Встроенная прошивка: ${manifest.firmwareVersion}`);
    manifest.images.forEach(image => appendFirmwareLog(`  ${image.label || image.file}: 0x${Number(image.address).toString(16)} · ${formatBytes(image.size)}`));
    writeProjectLog("Встроенный прошивальщик ESP32 готов", "success", { firmwareVersion: manifest.firmwareVersion });
}

async function loadFirmwareImages() {
    const result = [];

    for (const image of state.manifest.images) {
        setStage(`Загрузка встроенного образа: ${image.label || image.file}`);
        const response = await fetch(`/bundled_firmware/${encodeURIComponent(image.file)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Не найден встроенный файл ${image.file}`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (Number(image.size) && data.byteLength !== Number(image.size)) {
            throw new Error(`Размер ${image.file} не совпадает с манифестом`);
        }
        result.push({ ...image, data, address: Number(image.address) });
    }

    return result;
}

function ensureClassicEsp32(chipName) {
    const normalized = String(chipName || "").trim().toUpperCase();
    if (normalized !== "ESP32") {
        throw new Error(`Обнаружен ${chipName || "неизвестный чип"}. Этот комплект предназначен только для классического ESP32 / ESP32-WROOM-32.`);
    }
}

async function closeTransport() {
    if (!state.transport) return;
    try {
        await state.transport.disconnect();
    }
    catch {
        // После hard reset порт может уже считаться закрытым.
    }
    state.transport = null;
    state.loader = null;
    state.port = null;
}

async function verifyImages(images) {
    setStatus("ПРОВЕРКА", "busy");
    appendFirmwareLog("Проверка записанных областей Flash по MD5…");

    for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const expected = String(image.md5).toLowerCase();
        setStage(`Проверка ${image.label || image.file}…`);
        const actual = String(await state.loader.flashMd5sum(image.address, image.data.byteLength)).toLowerCase();
        appendFirmwareLog(`${image.label || image.file}: expected ${expected}, flash ${actual}`);
        if (actual !== expected) throw new Error(`MD5 не совпал для ${image.label || image.file}`);
        setProgress(82 + ((index + 1) / images.length) * 13);
    }

    appendFirmwareLog("Контрольные суммы всех областей совпали.");
}

async function flashFirmware() {
    if (state.busy || !state.ready) return;

    let selectedPort;
    try {
        /* requestPort вызывается первым: Web Serial требует пользовательский жест. */
        selectedPort = await navigator.serial.requestPort();
    }
    catch (error) {
        if (error?.name === "NotFoundError") {
            appendFirmwareLog("Выбор последовательного порта отменён.");
            return;
        }
        throw error;
    }

    setBusy(true);
    state.flashedSuccessfully = false;
    setDetectedChip("---");
    setProgress(0);
    setStatus("ПОДКЛЮЧЕНИЕ", "busy");
    setStage("Освобождение последовательного порта…");
    appendFirmwareLog("--- Новая операция прошивки ---");

    try {
        const serialState = window.OpenMCCSerial?.getState?.();
        if (serialState?.connected || serialState?.connecting) {
            appendFirmwareLog("Основной порт OpenMCC занят — отключаю его перед прошивкой.");
            await window.OpenMCCSerial.disconnect("firmware-flasher");
        }

        const images = await loadFirmwareImages();
        const baudrate = Number(elements.baudRate?.value) || 460800;

        state.port = selectedPort;
        state.transport = new state.esptool.Transport(selectedPort, false);

        const terminal = {
            clean() {},
            writeLine(data) { appendFirmwareLog(data); },
            write(data) { appendFirmwareLog(data); },
        };

        state.loader = new state.esptool.ESPLoader({
            transport: state.transport,
            baudrate,
            terminal,
            debugLogging: false,
        });

        setStage("Вход в загрузчик ESP32 и определение чипа…");
        setProgress(3);
        const chipName = await state.loader.main();
        setDetectedChip(chipName);
        appendFirmwareLog(`Обнаружен чип: ${chipName}`);
        ensureClassicEsp32(chipName);

        setStatus("ПРОШИВКА", "busy");
        setStage("Запись встроенной прошивки. Не отключайте USB…");
        setProgress(8);

        const totalBytes = images.reduce((sum, image) => sum + image.data.byteLength, 0);
        const completedBefore = images.map((_, index) => images.slice(0, index).reduce((sum, image) => sum + image.data.byteLength, 0));

        await state.loader.writeFlash({
            fileArray: images.map(image => ({ data: image.data, address: image.address })),
            flashMode: state.manifest.flashMode || "dio",
            flashFreq: state.manifest.flashFreq || "40m",
            flashSize: state.manifest.flashSize || "4MB",
            eraseAll: false,
            compress: true,
            reportProgress(fileIndex, written, total) {
                const base = completedBefore[fileIndex] || 0;
                const currentFile = images[fileIndex];
                const effectiveWritten = total > 0 && currentFile
                    ? Math.min(currentFile.data.byteLength, (written / total) * currentFile.data.byteLength)
                    : written;
                const ratio = totalBytes > 0 ? (base + effectiveWritten) / totalBytes : 0;
                setProgress(8 + ratio * 72);
                if (currentFile) setStage(`Запись ${currentFile.label || currentFile.file}…`);
            },
        });

        setProgress(82);
        await verifyImages(images);

        setStage("Перезагрузка ESP32…");
        await state.loader.after("hard_reset");
        setProgress(100);

        state.flashedSuccessfully = true;
        setStatus("ГОТОВО", "ready");
        setStage(`Радиошлюз v${state.manifest.firmwareVersion} записан и проверен. Теперь можно подключить его к OpenMCC.`);
        appendFirmwareLog("Прошивка завершена успешно. ESP32 перезагружена.");
        writeProjectLog("ESP32 radio gateway успешно прошит из OpenMCC", "success", { firmwareVersion: state.manifest.firmwareVersion });
    }
    catch (error) {
        setStatus("ОШИБКА", "error");
        setStage("Прошивка не завершена. См. журнал ниже.");
        appendFirmwareLog(`ОШИБКА: ${error?.message || error}`);
        appendFirmwareLog("Если ESP32 не входит в загрузчик автоматически: удерживайте BOOT, кратко нажмите EN/RESET, отпустите EN, затем BOOT и повторите прошивку.");
        writeProjectLog(`Ошибка прошивки ESP32: ${error?.message || error}`, "error");
    }
    finally {
        await closeTransport();
        setBusy(false);
    }
}

async function reconnectGateway() {
    if (state.busy) return;

    try {
        window.OpenMCCSerial?.setDeviceProfile?.("esp32");
        window.OpenMCCSerial?.setBaudRate?.(115200);
        document.getElementById("serialPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });

        await window.OpenMCCSerial.connect();
        const serialState = window.OpenMCCSerial.getState();
        if (!serialState.connected) return;

        appendFirmwareLog("ESP32 подключена к основному каналу OpenMCC на 115200 бод.");
        await window.OpenMCCSerial.sendCommand("GATEWAY_INFO");
        await new Promise(resolve => setTimeout(resolve, 120));
        await window.OpenMCCSerial.sendCommand("RADIO_STATUS");
    }
    catch (error) {
        appendFirmwareLog(`Не удалось подключить шлюз: ${error?.message || error}`);
        writeProjectLog(`Не удалось подключить прошитый шлюз: ${error?.message || error}`, "error");
    }
}

function updateExistingProjectUi() {
    const badge = document.querySelector(".buildBadge");
    if (badge) badge.textContent = "v0.4 · LAB";

    const radioPanel = document.getElementById("radioPanel");
    const radioState = radioPanel?.querySelector(".panelState");
    if (radioState) {
        radioState.textContent = "ПО ГОТОВО · ЖДЁТ ЖЕЛЕЗО";
        radioState.classList.remove("planned");
        radioState.classList.add("neutral");
    }

    const statusRows = radioPanel?.querySelectorAll(".radioHintGrid > div");
    statusRows?.forEach(row => {
        if (row.querySelector("span")?.textContent?.includes("Статус ПО")) {
            const strong = row.querySelector("strong");
            if (strong) strong.textContent = "Шлюз v0.1.0 готов; требуется стендовая проверка";
        }
    });

    const projectGrid = document.querySelector("#projectPanel .projectStatusGrid");
    if (projectGrid && !projectGrid.querySelector("[data-firmware-project-item]")) {
        const item = document.createElement("div");
        item.className = "projectItem test";
        item.dataset.firmwareProjectItem = "1";
        item.innerHTML = "<span>На проверку</span><strong>ESP32 radio gateway + встроенный прошивальщик</strong>";
        projectGrid.appendChild(item);
    }
}

function registerEvents() {
    elements.flashButton?.addEventListener("click", () => {
        flashFirmware().catch(error => {
            setStatus("ОШИБКА", "error");
            appendFirmwareLog(`ОШИБКА: ${error?.message || error}`);
            setBusy(false);
        });
    });
    elements.reconnectButton?.addEventListener("click", reconnectGateway);
    elements.clearLogButton?.addEventListener("click", clearFirmwareLog);
}

async function initialize() {
    if (state.initialized) return;
    state.initialized = true;

    injectStyles();
    injectPanel();
    injectNavigationButton();
    injectHelpSection();
    cacheElements();
    updateExistingProjectUi();
    registerEvents();
    setBusy(true);

    try {
        await prepareResources();
    }
    catch (error) {
        state.ready = false;
        setStatus("НЕДОСТУПНО", "error");
        setStage(error?.message || String(error));
        if (elements.version) elements.version.textContent = "недоступно";
        if (elements.imageState) elements.imageState.textContent = "нет комплекта";
        appendFirmwareLog(`Прошивальщик недоступен: ${error?.message || error}`);
        writeProjectLog(`Встроенный прошивальщик недоступен: ${error?.message || error}`, "warning");
        setBusy(false);
    }

    window.OpenMCCFlasher = Object.freeze({
        version: FLASHER_VERSION,
        flashFirmware,
        reconnectGateway,
        getState() {
            return {
                ready: state.ready,
                busy: state.busy,
                firmwareVersion: state.manifest?.firmwareVersion || null,
                detectedChip: state.detectedChip,
                flashedSuccessfully: state.flashedSuccessfully,
            };
        },
    });
}

initialize();
