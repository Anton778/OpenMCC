"use strict";

/* ЦУП Альтаир — telemetry charts v8 / 0.8.0
 * Каждый ID спутника получает отдельную линию и цвет.
 */
(() => {
    const CONFIG = Object.freeze({
        version: "0.8.0",
        maximumPoints: 180,
        tension: 0.18,
    });

    const PARAMETERS = Object.freeze({
        VOLT: { title: "Напряжение аккумулятора", unit: "В", decimals: 2, canvasId: "chartVOLT", valueId: "chartValueVOLT" },
        TEMP: { title: "Температура бортового компьютера", unit: "°C", decimals: 1, canvasId: "chartTEMP", valueId: "chartValueTEMP" },
        PANEL_POWER: { title: "Мощность солнечных панелей", unit: "Вт", decimals: 2, canvasId: "chartPANEL_POWER", valueId: "chartValuePANEL_POWER" },
        RSSI: { title: "RSSI", unit: "dBm", decimals: 1, canvasId: "chartRSSI", valueId: "chartValueRSSI" },
        SNR: { title: "SNR", unit: "dB", decimals: 1, canvasId: "chartSNR", valueId: "chartValueSNR" },
    });

    const COLORS = Object.freeze([
        "#00d9ff", "#ffb703", "#fb7185", "#34d399", "#a78bfa",
        "#f97316", "#60a5fa", "#f472b6", "#a3e635", "#facc15",
        "#2dd4bf", "#c084fc",
    ]);

    const state = {
        initialized: false,
        paused: false,
        totalPackets: 0,
        charts: {},
        idColors: new Map(),
        ids: [],
    };

    const elements = {};

    function log(message, type = "info") {
        window.OpenMCCLogger?.write?.(message, type, "CHARTS");
    }

    function normalizeId(value) {
        const text = String(value ?? "UNKNOWN").trim();
        return text || "UNKNOWN";
    }

    function colorForId(id) {
        if (!state.idColors.has(id)) {
            const index = state.idColors.size % COLORS.length;
            state.idColors.set(id, COLORS[index]);
            state.ids.push(id);
        }
        return state.idColors.get(id);
    }

    function timeLabel(ts) {
        return new Date(ts).toLocaleTimeString("ru-RU", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }

    function chartOptions(parameter) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            normalized: true,
            interaction: { intersect: false, mode: "nearest" },
            plugins: {
                legend: {
                    display: true,
                    position: "bottom",
                    labels: {
                        color: "#9db0c7",
                        boxWidth: 12,
                        boxHeight: 2,
                        usePointStyle: true,
                        pointStyle: "line",
                        font: { size: 10 },
                    },
                },
                tooltip: {
                    displayColors: true,
                    callbacks: {
                        label(ctx) {
                            if (ctx.parsed.y === null || ctx.parsed.y === undefined) return "";
                            return `${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(parameter.decimals)} ${parameter.unit}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: "rgba(32,53,82,.30)" },
                    border: { color: "rgba(32,53,82,.70)" },
                    ticks: { color: "#71869f", maxTicksLimit: 9, font: { size: 9 } },
                },
                y: {
                    grace: "10%",
                    grid: { color: "rgba(32,53,82,.38)" },
                    border: { color: "rgba(32,53,82,.70)" },
                    ticks: {
                        color: "#71869f",
                        font: { size: 9 },
                        callback(v) { return Number(v).toFixed(parameter.decimals); },
                    },
                },
            },
        };
    }

    function createChart(parameter) {
        const canvas = document.getElementById(parameter.canvasId);
        if (!canvas) return null;
        return new Chart(canvas.getContext("2d"), {
            type: "line",
            data: { labels: [], datasets: [] },
            options: chartOptions(parameter),
        });
    }

    function datasetFor(chart, id) {
        let dataset = chart.data.datasets.find(item => item.altairId === id);
        if (dataset) return dataset;
        const color = colorForId(id);
        dataset = {
            altairId: id,
            label: `ID ${id}`,
            data: Array(chart.data.labels.length).fill(null),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 1.8,
            pointRadius: 2.7,
            pointHoverRadius: 5,
            pointBorderWidth: 1,
            pointBackgroundColor: color,
            pointBorderColor: color,
            tension: CONFIG.tension,
            fill: false,
            showLine: true,
            spanGaps: true,
        };
        chart.data.datasets.push(dataset);
        return dataset;
    }

    function trimChart(chart) {
        while (chart.data.labels.length > CONFIG.maximumPoints) {
            chart.data.labels.shift();
            chart.data.datasets.forEach(dataset => dataset.data.shift());
        }
    }

    function appendSample(key, value, id, timestamp) {
        const chart = state.charts[key];
        const numeric = Number(value);
        if (!chart || !Number.isFinite(numeric)) return false;
        const label = timeLabel(timestamp);
        chart.data.labels.push(label);
        chart.data.datasets.forEach(dataset => dataset.data.push(null));
        const dataset = datasetFor(chart, id);
        while (dataset.data.length < chart.data.labels.length) dataset.data.push(null);
        dataset.data[dataset.data.length - 1] = numeric;
        trimChart(chart);
        chart.update("none");
        const parameter = PARAMETERS[key];
        const current = document.getElementById(parameter.valueId);
        if (current) {
            current.textContent = `ID ${id}: ${numeric.toFixed(parameter.decimals)} ${parameter.unit}`;
            current.style.color = colorForId(id);
        }
        return true;
    }

    function setStatus(status) {
        if (!elements.status) return;
        elements.status.classList.remove("active", "paused");
        if (status === "active") {
            elements.status.textContent = `ПРИЁМ · ${state.ids.length || 1} ID`;
            elements.status.classList.add("active");
        } else if (status === "paused") {
            elements.status.textContent = "ПАУЗА";
            elements.status.classList.add("paused");
        } else {
            elements.status.textContent = "ОЖИДАНИЕ ДАННЫХ";
        }
    }

    function updateStats() {
        const lengths = Object.values(state.charts).map(c => c.data.labels.length);
        if (elements.pointCount) elements.pointCount.textContent = String(lengths.length ? Math.max(...lengths) : 0);
        if (elements.timeWindow) elements.timeWindow.textContent = `${CONFIG.maximumPoints} общих отсчётов`;
        if (elements.recordingState) elements.recordingState.textContent = state.paused ? "ПАУЗА" : "ЗАПИСЬ";
    }

    function processTelemetry(telemetry) {
        if (state.paused || !telemetry || typeof telemetry !== "object") return;
        const id = normalizeId(telemetry.ID);
        colorForId(id);
        const ts = Date.now();
        let added = 0;
        Object.keys(PARAMETERS).forEach(key => {
            if (Object.hasOwn(telemetry, key) && appendSample(key, telemetry[key], id, ts)) added += 1;
        });
        if (added) {
            state.totalPackets += 1;
            updateStats();
            setStatus("active");
        }
    }

    function clearCharts() {
        Object.values(state.charts).forEach(chart => {
            chart.data.labels.length = 0;
            chart.data.datasets.length = 0;
            chart.update("none");
        });
        Object.values(PARAMETERS).forEach(parameter => {
            const el = document.getElementById(parameter.valueId);
            if (el) {
                el.textContent = "--";
                el.style.color = "";
            }
        });
        state.totalPackets = 0;
        state.idColors.clear();
        state.ids.length = 0;
        updateStats();
        setStatus(state.paused ? "paused" : "waiting");
    }

    function initialize() {
        if (state.initialized || typeof Chart === "undefined") return;
        elements.status = document.getElementById("chartStatus");
        elements.pauseButton = document.getElementById("pauseChartsButton");
        elements.clearButton = document.getElementById("clearChartsButton");
        elements.pointCount = document.getElementById("chartPointCount");
        elements.timeWindow = document.getElementById("chartTimeWindow");
        elements.recordingState = document.getElementById("chartRecordingState");
        Object.entries(PARAMETERS).forEach(([key, parameter]) => {
            const chart = createChart(parameter);
            if (chart) state.charts[key] = chart;
        });
        window.addEventListener("openmcc:telemetry", event => processTelemetry(event.detail));
        window.addEventListener("openmcc:serial-disconnected", () => { if (!state.paused) setStatus("waiting"); });
        elements.pauseButton?.addEventListener("click", () => {
            state.paused = !state.paused;
            elements.pauseButton.textContent = state.paused ? "Продолжить" : "Пауза";
            setStatus(state.paused ? "paused" : "active");
            updateStats();
        });
        elements.clearButton?.addEventListener("click", clearCharts);
        updateStats();
        setStatus("waiting");
        state.initialized = true;
        log("Графики v0.8.0 готовы: отдельная линия для каждого ID спутника.", "success");
    }

    window.OpenMCCCharts = Object.freeze({
        config: CONFIG,
        processTelemetry,
        clear: clearCharts,
        colorForId,
        getState: () => ({
            initialized: state.initialized,
            paused: state.paused,
            totalPackets: state.totalPackets,
            ids: [...state.ids],
            chartKeys: Object.keys(state.charts),
        }),
    });

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
