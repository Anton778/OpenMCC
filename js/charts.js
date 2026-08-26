"use strict";

/* ЦУП Альтаир — telemetry charts, v6 / 0.6.0 */
(() => {
    const CONFIG = Object.freeze({ version: "0.6.0", maximumPoints: 120, tension: 0.24 });
    const PARAMETERS = Object.freeze({
        VOLT: { title: "Напряжение аккумулятора", unit: "В", decimals: 2, canvasId: "chartVOLT", valueId: "chartValueVOLT" },
        PANEL_POWER: { title: "Мощность солнечных панелей", unit: "Вт", decimals: 2, canvasId: "chartPANEL_POWER", valueId: "chartValuePANEL_POWER" },
        RSSI: { title: "RSSI", unit: "dBm", decimals: 1, canvasId: "chartRSSI", valueId: "chartValueRSSI" },
        SNR: { title: "SNR", unit: "dB", decimals: 1, canvasId: "chartSNR", valueId: "chartValueSNR" },
    });
    const state = { initialized: false, paused: false, totalPackets: 0, charts: {} };
    const elements = {};

    function log(message, type = "info") { window.OpenMCCLogger?.write?.(message, type, "CHARTS"); }
    function timeLabel(ts) { return new Date(ts).toLocaleTimeString("ru-RU", { hour12: false, minute: "2-digit", second: "2-digit" }); }

    function options(parameter) {
        return {
            responsive: true, maintainAspectRatio: false, animation: false, normalized: true, parsing: true,
            interaction: { intersect: false, mode: "index" },
            plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label(ctx) { return `${parameter.title}: ${Number(ctx.parsed.y).toFixed(parameter.decimals)} ${parameter.unit}`; } } } },
            scales: {
                x: { grid: { color: "rgba(32,53,82,.30)" }, border: { color: "rgba(32,53,82,.70)" }, ticks: { color: "#71869f", maxTicksLimit: 8, font: { size: 9 } } },
                y: { grace: "10%", grid: { color: "rgba(32,53,82,.38)" }, border: { color: "rgba(32,53,82,.70)" }, ticks: { color: "#71869f", font: { size: 9 }, callback(v) { return Number(v).toFixed(parameter.decimals); } } },
            },
        };
    }

    function createChart(key, parameter) {
        const canvas = document.getElementById(parameter.canvasId);
        if (!canvas) return null;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createLinearGradient(0, 0, 0, 190);
        gradient.addColorStop(0, "rgba(0,217,255,.24)");
        gradient.addColorStop(1, "rgba(0,217,255,.01)");
        return new Chart(ctx, { type: "line", data: { labels: [], datasets: [{ label: parameter.title, data: [], borderColor: "#00d9ff", backgroundColor: gradient, borderWidth: 1.6, pointRadius: 0, pointHoverRadius: 3, tension: CONFIG.tension, fill: true }] }, options: options(parameter) });
    }

    function append(key, value, ts) {
        const chart = state.charts[key];
        const numeric = Number(value);
        if (!chart || !Number.isFinite(numeric)) return false;
        chart.data.labels.push(timeLabel(ts));
        chart.data.datasets[0].data.push(numeric);
        while (chart.data.labels.length > CONFIG.maximumPoints) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
        chart.update("none");
        const parameter = PARAMETERS[key];
        const current = document.getElementById(parameter.valueId);
        if (current) current.textContent = `${numeric.toFixed(parameter.decimals)} ${parameter.unit}`;
        return true;
    }

    function setStatus(status) {
        if (!elements.status) return;
        elements.status.classList.remove("active", "paused");
        if (status === "active") { elements.status.textContent = "ПРИЁМ ДАННЫХ"; elements.status.classList.add("active"); }
        else if (status === "paused") { elements.status.textContent = "ПАУЗА"; elements.status.classList.add("paused"); }
        else elements.status.textContent = "ОЖИДАНИЕ ДАННЫХ";
    }

    function updateStats() {
        const lengths = Object.values(state.charts).map(c => c.data.labels.length);
        if (elements.pointCount) elements.pointCount.textContent = String(lengths.length ? Math.max(...lengths) : 0);
        if (elements.timeWindow) elements.timeWindow.textContent = `${CONFIG.maximumPoints} отсчётов`;
        if (elements.recordingState) elements.recordingState.textContent = state.paused ? "ПАУЗА" : "ЗАПИСЬ";
    }

    function processTelemetry(telemetry) {
        if (state.paused || !telemetry || typeof telemetry !== "object") return;
        const ts = Date.now();
        let added = 0;
        Object.keys(PARAMETERS).forEach(key => { if (Object.hasOwn(telemetry, key) && append(key, telemetry[key], ts)) added += 1; });
        if (added) { state.totalPackets += 1; updateStats(); setStatus("active"); }
    }

    function clearCharts() {
        Object.values(state.charts).forEach(chart => { chart.data.labels.length = 0; chart.data.datasets[0].data.length = 0; chart.update("none"); });
        Object.values(PARAMETERS).forEach(p => { const el = document.getElementById(p.valueId); if (el) el.textContent = "--"; });
        state.totalPackets = 0; updateStats(); setStatus(state.paused ? "paused" : "waiting");
    }

    function initialize() {
        if (state.initialized || typeof Chart === "undefined") return;
        elements.status = document.getElementById("chartStatus");
        elements.pauseButton = document.getElementById("pauseChartsButton");
        elements.clearButton = document.getElementById("clearChartsButton");
        elements.pointCount = document.getElementById("chartPointCount");
        elements.timeWindow = document.getElementById("chartTimeWindow");
        elements.recordingState = document.getElementById("chartRecordingState");
        Object.entries(PARAMETERS).forEach(([key, parameter]) => { const chart = createChart(key, parameter); if (chart) state.charts[key] = chart; });
        window.addEventListener("openmcc:telemetry", e => processTelemetry(e.detail));
        window.addEventListener("openmcc:serial-disconnected", () => { if (!state.paused) setStatus("waiting"); });
        elements.pauseButton?.addEventListener("click", () => { state.paused = !state.paused; elements.pauseButton.textContent = state.paused ? "Продолжить" : "Пауза"; setStatus(state.paused ? "paused" : "active"); updateStats(); });
        elements.clearButton?.addEventListener("click", clearCharts);
        updateStats(); setStatus("waiting"); state.initialized = true;
        log("Графики телеметрии v0.6.0 готовы", "success");
    }

    window.OpenMCCCharts = Object.freeze({ config: CONFIG, processTelemetry, clear: clearCharts, getState: () => ({ ...state, chartKeys: Object.keys(state.charts) }) });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})();
