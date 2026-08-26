"use strict";

/* ============================================================
   ЦУП Альтаир — telemetry charts
   Release v5 / 0.5.0
   ============================================================ */

(() => {
    const CONFIG = Object.freeze({
        version: "0.5.0",
        maximumPoints: 120,
        tension: 0.24,
    });

    const PARAMETERS = Object.freeze({
        VOLT: Object.freeze({ title: "Напряжение аккумулятора", unit: "В", decimals: 2, canvasId: "chartVOLT", valueId: "chartValueVOLT" }),
        PANEL_POWER: Object.freeze({ title: "Мощность солнечных панелей", unit: "Вт", decimals: 3, canvasId: "chartPANEL_POWER", valueId: "chartValuePANEL_POWER" }),
        TEMP: Object.freeze({ title: "Температура", unit: "°C", decimals: 1, canvasId: "chartTEMP", valueId: "chartValueTEMP" }),
        RSSI: Object.freeze({ title: "RSSI", unit: "dBm", decimals: 1, canvasId: "chartRSSI", valueId: "chartValueRSSI" }),
        SNR: Object.freeze({ title: "SNR", unit: "dB", decimals: 1, canvasId: "chartSNR", valueId: "chartValueSNR" }),
    });

    const state = {
        initialized: false,
        paused: false,
        totalPackets: 0,
        charts: {},
    };

    const elements = {};

    function writeLog(message, type = "info", metadata = null) {
        if (window.OpenMCCLogger?.write) {
            window.OpenMCCLogger.write(message, type, "CHARTS", metadata);
        }
    }

    function timeLabel(timestamp) {
        return new Date(timestamp).toLocaleTimeString("ru-RU", {
            hour12: false,
            minute: "2-digit",
            second: "2-digit",
        });
    }

    function createOptions(parameter) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            normalized: true,
            parsing: true,
            interaction: { intersect: false, mode: "index" },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        label(context) {
                            const value = Number(context.parsed.y);
                            return `${parameter.title}: ${value.toFixed(parameter.decimals)} ${parameter.unit}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: "rgba(32, 53, 82, 0.30)" },
                    border: { color: "rgba(32, 53, 82, 0.70)" },
                    ticks: { color: "#71869f", maxTicksLimit: 8, font: { size: 9 } },
                },
                y: {
                    grace: "10%",
                    grid: { color: "rgba(32, 53, 82, 0.38)" },
                    border: { color: "rgba(32, 53, 82, 0.70)" },
                    ticks: {
                        color: "#71869f",
                        font: { size: 9 },
                        callback(value) { return Number(value).toFixed(parameter.decimals); },
                    },
                },
            },
        };
    }

    function createChart(key, parameter) {
        const canvas = document.getElementById(parameter.canvasId);
        if (!canvas) {
            writeLog(`Canvas ${parameter.canvasId} не найден`, "error");
            return null;
        }

        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 0, 190);
        gradient.addColorStop(0, "rgba(0, 217, 255, 0.24)");
        gradient.addColorStop(1, "rgba(0, 217, 255, 0.01)");

        return new Chart(context, {
            type: "line",
            data: {
                labels: [],
                datasets: [{
                    label: parameter.title,
                    data: [],
                    borderColor: "#00d9ff",
                    backgroundColor: gradient,
                    borderWidth: 1.6,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    tension: CONFIG.tension,
                    fill: true,
                }],
            },
            options: createOptions(parameter),
        });
    }

    function updateCurrentValue(key, numericValue) {
        const parameter = PARAMETERS[key];
        const element = document.getElementById(parameter.valueId);
        if (!element) return;
        element.textContent = `${numericValue.toFixed(parameter.decimals)} ${parameter.unit}`;
    }

    function appendValue(key, value, timestamp) {
        const chart = state.charts[key];
        if (!chart) return false;
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return false;

        chart.data.labels.push(timeLabel(timestamp));
        chart.data.datasets[0].data.push(numericValue);

        while (chart.data.labels.length > CONFIG.maximumPoints) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }

        chart.update("none");
        updateCurrentValue(key, numericValue);
        return true;
    }

    function setStatus(status) {
        if (!elements.status) return;
        elements.status.classList.remove("active", "paused");
        if (status === "active") {
            elements.status.textContent = "ПРИЁМ ДАННЫХ";
            elements.status.classList.add("active");
        } else if (status === "paused") {
            elements.status.textContent = "ПАУЗА";
            elements.status.classList.add("paused");
        } else {
            elements.status.textContent = "ОЖИДАНИЕ ДАННЫХ";
        }
    }

    function updateStatistics() {
        const lengths = Object.values(state.charts).map(chart => chart.data.labels.length);
        const count = lengths.length ? Math.max(...lengths) : 0;
        if (elements.pointCount) elements.pointCount.textContent = String(count);
        if (elements.timeWindow) elements.timeWindow.textContent = `${CONFIG.maximumPoints} отсчётов`;
        if (elements.recordingState) elements.recordingState.textContent = state.paused ? "ПАУЗА" : "ЗАПИСЬ";
    }

    function processTelemetry(telemetry) {
        if (state.paused || !telemetry || typeof telemetry !== "object") return;
        const timestamp = Date.now();
        let added = 0;
        Object.keys(PARAMETERS).forEach(key => {
            if (Object.hasOwn(telemetry, key) && appendValue(key, telemetry[key], timestamp)) added += 1;
        });
        if (added > 0) {
            state.totalPackets += 1;
            updateStatistics();
            setStatus("active");
        }
    }

    function togglePause() {
        state.paused = !state.paused;
        if (elements.pauseButton) elements.pauseButton.textContent = state.paused ? "Продолжить" : "Пауза";
        setStatus(state.paused ? "paused" : "active");
        updateStatistics();
        writeLog(state.paused ? "Графики поставлены на паузу" : "Графики продолжены", "info");
    }

    function clearCharts() {
        Object.values(state.charts).forEach(chart => {
            chart.data.labels.length = 0;
            chart.data.datasets[0].data.length = 0;
            chart.update("none");
        });
        Object.values(PARAMETERS).forEach(parameter => {
            const element = document.getElementById(parameter.valueId);
            if (element) element.textContent = "--";
        });
        state.totalPackets = 0;
        updateStatistics();
        setStatus(state.paused ? "paused" : "waiting");
        writeLog("Графики телеметрии очищены", "info");
    }

    function initialize() {
        if (state.initialized) return;
        if (typeof Chart === "undefined") {
            writeLog("Chart.js не загружен", "error");
            return;
        }

        elements.status = document.getElementById("chartStatus");
        elements.pauseButton = document.getElementById("pauseChartsButton");
        elements.clearButton = document.getElementById("clearChartsButton");
        elements.pointCount = document.getElementById("chartPointCount");
        elements.timeWindow = document.getElementById("chartTimeWindow");
        elements.recordingState = document.getElementById("chartRecordingState");

        Object.entries(PARAMETERS).forEach(([key, parameter]) => {
            const chart = createChart(key, parameter);
            if (chart) state.charts[key] = chart;
        });

        window.addEventListener("openmcc:telemetry", event => processTelemetry(event.detail));
        window.addEventListener("openmcc:serial-disconnected", () => { if (!state.paused) setStatus("waiting"); });
        elements.pauseButton?.addEventListener("click", togglePause);
        elements.clearButton?.addEventListener("click", clearCharts);

        updateStatistics();
        setStatus("waiting");
        state.initialized = true;
        writeLog(`Графики телеметрии v${CONFIG.version} готовы`, "success");
    }

    window.OpenMCCCharts = Object.freeze({
        config: CONFIG,
        processTelemetry,
        clear: clearCharts,
        getState() {
            return {
                initialized: state.initialized,
                paused: state.paused,
                totalPackets: state.totalPackets,
                chartKeys: Object.keys(state.charts),
            };
        },
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
