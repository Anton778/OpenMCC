"use strict";

/* ============================================================
   OpenMCC v0.2
   Interface help, tooltips, quick navigation and UI-only
   radio gateway planning controls.
   ============================================================ */

(() => {
    const HELP_VERSION = "0.2.0";
    const FIRST_RUN_KEY = "openmcc-help-v02-seen";
    const RADIO_KEY = "openmcc-radio-module";

    const tooltipDefinitions = [
        ["#connectButton", "Открывает системный выбор последовательного USB-порта. Для тестовой Arduino Uno используйте 115200 бод."],
        ["#deviceProfile", "Профиль помогает OpenMCC корректно подписать устройство. Если не уверены — оставьте автоматическое определение."],
        ["#serialBaudRate", "Скорость обмена по USB. Демонстратор Arduino и текущие прошивки OpenMCC используют 115200 бод."],
        ["#packetCounter", "Число принятых телеметрических пакетов за текущий сеанс."],
        ["#crcCounter", "Счётчик ошибок/контрольных событий. В текущем текстовом протоколе полноценный CRC радиопакета ещё не внедрён."],
        ["#telemetryPanel", "Здесь отображаются последние принятые значения TEMP, VOLT, CURR, RSSI и SNR."],
        ["#commandPanel", "Команды уходят в подключённое основное устройство. Сейчас это USB-плата; позже тем же интерфейсом будет управляться ESP32-радиошлюз."],
        ["[data-command='PING']", "Проверка канала команд. Демонстратор Arduino отвечает $ACK,PONG."],
        ["[data-command='INFO']", "Запрашивает сведения об устройстве и версии протокола."],
        ["[data-command='START']", "Разрешает периодическую передачу телеметрии на демонстраторе."],
        ["[data-command='STOP']", "Останавливает периодическую передачу телеметрии на демонстраторе."],
        ["#telemetryRate", "Выберите период между телеметрическими пакетами."],
        ["#applyTelemetryRate", "Отправляет устройству команду изменения периода телеметрии."],
        ["#customCommand", "Произвольная команда протокола OpenMCC. Используйте только команды, которые поддерживает подключённая прошивка."],
        ["#rotatorConnectButton", "Открывает второй независимый последовательный порт для Arduino Uno поворотного устройства."],
        ["#rotatorSimulationMode", "Позволяет проверять весь интерфейс AZ/EL без собранного SatNOGS Rotator v3."],
        ["#rotatorTargetAz", "Целевой азимут антенны. В текущей логике допустим диапазон 0…360°."],
        ["#rotatorTargetEl", "Целевой угол места антенны. В текущей логике допустим диапазон 0…90°."],
        ["#rotatorMoveButton", "Передаёт команду $ROT,SET,AZ=…,EL=… в контроллер поворотки или симулятор."],
        ["#rotatorStopButton", "Останавливает движение. Для реальной механики всё равно нужна отдельная аппаратная аварийная остановка."],
        ["#rotatorHomeButton", "Запускает поиск нулевого положения по концевым выключателям. Реальную механику пока не проверяли."],
        ["#rotatorParkButton", "Команда перевода антенны в заранее заданное парковочное положение."],
        ["#rotatorAutoMode", "Автоматическое сопровождение будет включено после реализации TLE/SGP4 и расчёта AZ/EL."],
        ["#radioPanel", "Планируемый наземный радиошлюз. Выбранная базовая плата — ESP32-WROOM-32; радиомодуль зависит от закупки."],
        ["#radioModuleType", "Выберите предполагаемый вариант радиомодуля. Это пока только настройка интерфейса и документации, не реальный драйвер."],
        ["#pauseChartsButton", "Замораживает добавление новых точек на графики без остановки самой телеметрии."],
        ["#clearChartsButton", "Очищает накопленные точки графиков текущего сеанса."],
        ["#satelliteViewport", "Процедурная 3D-модель CubeSat. При появлении ROLL/PITCH/YAW модель сможет отражать ориентацию аппарата."],
        ["#resetSatelliteView", "Возвращает камеру 3D-вида в исходное положение."],
        ["#toggleSatelliteRotation", "Включает или выключает демонстрационное автовращение модели."],
        ["#mapPanel", "Карта пока не реализована. Следующий крупный этап — TLE/SGP4, трасса орбиты, положение ЦУПа и автоматическое сопровождение."],
        ["#eventLog", "Журнал сохраняет ключевые события соединения, команд и ошибок. Он нужен для диагностики работы ЦУПа."],
        ["#helpButton", "Открывает краткую встроенную инструкцию. Горячая клавиша: F1."],
    ];

    const radioProfiles = {
        unknown: {
            label: "CC1101 / E32",
            interfaceLabel: "SPI / UART",
            interfaceValue: "SPI или UART",
            powerValue: "Уточнить после закупки",
            hint: "Модуль ещё не выбран. Архитектура OpenMCC специально оставлена независимой от конкретного радиомодуля.",
        },
        cc1101: {
            label: "CC1101",
            interfaceLabel: "SPI",
            interfaceValue: "SPI + GDO0/GDO2",
            powerValue: "3,3 В; логика 3,3 В",
            hint: "CC1101 подключается к ESP32-WROOM-32 по SPI. Драйвер радиоканала и пакетный CRC ещё предстоит реализовать.",
        },
        e32: {
            label: "E32-433T30D",
            interfaceLabel: "UART",
            interfaceValue: "UART + M0/M1/AUX",
            powerValue: "Отдельное питание модуля; общая GND",
            hint: "E32-433T30D подключается к ESP32-WROOM-32 по UART. Мощную версию не следует питать от слабого вывода 3,3 В отладочной платы.",
        },
    };

    let tooltipElement = null;
    let activeTooltipTarget = null;

    function addTooltips() {
        tooltipDefinitions.forEach(([selector, text]) => {
            document.querySelectorAll(selector).forEach((element) => {
                if (!element.dataset.tip) {
                    element.dataset.tip = text;
                }
                if (!element.getAttribute("aria-label") && ["BUTTON", "INPUT", "SELECT"].includes(element.tagName)) {
                    element.setAttribute("aria-label", text);
                }
            });
        });
    }

    function placeTooltip(target, pointerEvent = null) {
        if (!tooltipElement || !target) return;
        const text = target.dataset.tip;
        if (!text) return;

        tooltipElement.textContent = text;
        tooltipElement.setAttribute("aria-hidden", "false");
        tooltipElement.classList.add("visible");

        const padding = 12;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const tooltipRect = tooltipElement.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();

        let left = pointerEvent?.clientX ?? (targetRect.left + targetRect.width / 2);
        let top = pointerEvent?.clientY ?? targetRect.bottom;

        left += 14;
        top += 14;

        if (left + tooltipRect.width + padding > viewportWidth) {
            left = Math.max(padding, viewportWidth - tooltipRect.width - padding);
        }

        if (top + tooltipRect.height + padding > viewportHeight) {
            top = Math.max(padding, (pointerEvent?.clientY ?? targetRect.top) - tooltipRect.height - 14);
        }

        tooltipElement.style.left = `${left}px`;
        tooltipElement.style.top = `${top}px`;
    }

    function hideTooltip() {
        activeTooltipTarget = null;
        if (!tooltipElement) return;
        tooltipElement.classList.remove("visible");
        tooltipElement.setAttribute("aria-hidden", "true");
    }

    function initializeTooltipSystem() {
        tooltipElement = document.getElementById("openmccTooltip");
        if (!tooltipElement) return;

        document.addEventListener("pointerover", (event) => {
            const target = event.target.closest?.("[data-tip]");
            if (!target) return;
            activeTooltipTarget = target;
            placeTooltip(target, event);
        });

        document.addEventListener("pointermove", (event) => {
            if (activeTooltipTarget) placeTooltip(activeTooltipTarget, event);
        });

        document.addEventListener("pointerout", (event) => {
            if (!activeTooltipTarget) return;
            const nextTarget = event.relatedTarget;
            if (nextTarget && activeTooltipTarget.contains(nextTarget)) return;
            hideTooltip();
        });

        document.addEventListener("focusin", (event) => {
            const target = event.target.closest?.("[data-tip]");
            if (!target) return;
            activeTooltipTarget = target;
            placeTooltip(target);
        });

        document.addEventListener("focusout", hideTooltip);
        window.addEventListener("scroll", hideTooltip, { passive: true });
        window.addEventListener("resize", hideTooltip);
    }

    function initializeNavigation() {
        document.querySelectorAll("[data-scroll-target]").forEach((button) => {
            button.addEventListener("click", () => {
                const target = document.getElementById(button.dataset.scrollTarget);
                target?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });
    }

    function openHelp() {
        const dialog = document.getElementById("helpDialog");
        if (!dialog) return;
        if (typeof dialog.showModal === "function") {
            if (!dialog.open) dialog.showModal();
        } else {
            dialog.setAttribute("open", "");
        }
    }

    function closeHelp() {
        const dialog = document.getElementById("helpDialog");
        if (!dialog) return;
        if (typeof dialog.close === "function" && dialog.open) {
            dialog.close();
        } else {
            dialog.removeAttribute("open");
        }
    }

    function initializeHelpDialog() {
        document.querySelectorAll("[data-help-open]").forEach((button) => button.addEventListener("click", openHelp));
        document.querySelectorAll("[data-help-close]").forEach((button) => button.addEventListener("click", closeHelp));

        const dialog = document.getElementById("helpDialog");
        dialog?.addEventListener("click", (event) => {
            if (event.target === dialog) closeHelp();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "F1") {
                event.preventDefault();
                openHelp();
            }
        });
    }

    function updateRadioProfile(profileId) {
        const profile = radioProfiles[profileId] ?? radioProfiles.unknown;
        const moduleLabel = document.getElementById("radioModuleLabel");
        const interfaceLabel = document.getElementById("radioInterfaceLabel");
        const interfaceValue = document.getElementById("radioInterfaceValue");
        const powerValue = document.getElementById("radioPowerValue");
        const hint = document.getElementById("radioConfigHint");

        if (moduleLabel) moduleLabel.textContent = profile.label;
        if (interfaceLabel) interfaceLabel.textContent = profile.interfaceLabel;
        if (interfaceValue) interfaceValue.textContent = profile.interfaceValue;
        if (powerValue) powerValue.textContent = profile.powerValue;
        if (hint) hint.textContent = profile.hint;
    }

    function initializeRadioPlanner() {
        const select = document.getElementById("radioModuleType");
        if (!select) return;

        const storedValue = localStorage.getItem(RADIO_KEY);
        if (storedValue && radioProfiles[storedValue]) {
            select.value = storedValue;
        }

        updateRadioProfile(select.value);

        select.addEventListener("change", () => {
            localStorage.setItem(RADIO_KEY, select.value);
            updateRadioProfile(select.value);
        });
    }

    function showFirstRunToast() {
        if (localStorage.getItem(FIRST_RUN_KEY) === "1") return;

        const toast = document.createElement("div");
        toast.className = "openmccToast";
        toast.innerHTML = `
            <strong>OpenMCC v${HELP_VERSION}</strong>
            Интерфейс обновлён. Наведите курсор на элементы для подсказок или нажмите F1, чтобы открыть краткую инструкцию.
            <br><button type="button">Понятно</button>
        `;

        toast.querySelector("button")?.addEventListener("click", () => {
            localStorage.setItem(FIRST_RUN_KEY, "1");
            toast.remove();
        });

        document.body.appendChild(toast);
    }

    function initialize() {
        addTooltips();
        initializeTooltipSystem();
        initializeNavigation();
        initializeHelpDialog();
        initializeRadioPlanner();
        showFirstRunToast();

        window.dispatchEvent(new CustomEvent("openmcc:help-ready", {
            detail: { version: HELP_VERSION },
        }));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
