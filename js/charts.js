"use strict";

/* ============================================================
   OpenMCC
   Open Mission Control Center

   Module: charts.js
   Version: 0.1.0

   Назначение:
   - построение графиков телеметрии;
   - обновление графиков в реальном времени;
   - хранение ограниченного количества точек;
   - пауза отображения;
   - очистка буфера;
   - поддержка демонстрационных и реальных данных.
   ============================================================ */


(() => {

    const CHART_CONFIG = Object.freeze({

        version:
            "0.1.0",

        maximumPoints:
            120,

        animationDuration:
            0,

        tension:
            0.25,

        pointRadius:
            0,

        borderWidth:
            1.6

    });


    const PARAMETER_CONFIG = Object.freeze({

        TEMP: Object.freeze({

            title:
                "Температура",

            unit:
                "°C",

            decimals:
                1,

            canvasId:
                "chartTEMP",

            valueId:
                "chartValueTEMP"

        }),


        VOLT: Object.freeze({

            title:
                "Напряжение",

            unit:
                "В",

            decimals:
                2,

            canvasId:
                "chartVOLT",

            valueId:
                "chartValueVOLT"

        }),


        CURR: Object.freeze({

            title:
                "Ток",

            unit:
                "мА",

            decimals:
                0,

            canvasId:
                "chartCURR",

            valueId:
                "chartValueCURR"

        }),


        RSSI: Object.freeze({

            title:
                "RSSI",

            unit:
                "dBm",

            decimals:
                0,

            canvasId:
                "chartRSSI",

            valueId:
                "chartValueRSSI"

        }),


        SNR: Object.freeze({

            title:
                "SNR",

            unit:
                "dB",

            decimals:
                1,

            canvasId:
                "chartSNR",

            valueId:
                "chartValueSNR"

        })

    });


    const state = {

        initialized:
            false,

        paused:
            false,

        totalPackets:
            0,

        charts:
            {},

        latestValues:
            {},

        startTime:
            Date.now()

    };


    const elements = {

        chartStatus:
            null,

        pauseButton:
            null,

        clearButton:
            null,

        pointCount:
            null,

        timeWindow:
            null,

        recordingState:
            null

    };


    function writeLog(
        message,
        type = "info",
        metadata = null
    ) {

        if (
            window.OpenMCCLogger &&
            typeof window.OpenMCCLogger.write === "function"
        ) {

            window.OpenMCCLogger.write(
                message,
                type,
                "CHARTS",
                metadata
            );

            return;

        }

        console.log(
            `[OpenMCC Charts] ${message}`
        );

    }


    function formatTimeLabel(date) {

        return date.toLocaleTimeString(
            "ru-RU",
            {
                hour12:
                    false,

                minute:
                    "2-digit",

                second:
                    "2-digit"
            }
        );

    }


    function createChartOptions(parameter) {

        return {

            responsive:
                true,

            maintainAspectRatio:
                false,

            animation:
                {
                    duration:
                        CHART_CONFIG.animationDuration
                },

            normalized:
                 true,

            parsing:
                 true,

            interaction:
                 {
                    intersect:
                        false,

                    mode:
                        "index"
                },

            plugins:
                {

                    legend:
                        {
                            display:
                                false
                        },

                    tooltip:
                        {

                            backgroundColor:
                                "rgba(7, 11, 22, 0.95)",

                            borderColor:
                                "rgba(0, 217, 255, 0.35)",

                            borderWidth:
                                1,

                            titleColor:
                                "#91a4bd",

                            bodyColor:
                                "#eaf4ff",

                            displayColors:
                                false,

                            callbacks:
                                {

                                    label(context) {

                                        const value =
                                            context.parsed.y;

                                        return (
                                            `${parameter.title}: ` +
                                            `${Number(value).toFixed(
                                                parameter.decimals
                                            )} ${parameter.unit}`
                                        );

                                    }

                                }

                        }

                },

            scales:
                {

                    x:
                        {

                            grid:
                                {
                                    color:
                                        "rgba(32, 53, 82, 0.30)"
                                },

                            border:
                                {
                                    color:
                                        "rgba(32, 53, 82, 0.70)"
                                },

                            ticks:
                                {

                                    color:
                                        "#71869f",

                                    maxTicksLimit:
                                        8,

                                    font:
                                        {
                                            size:
                                                9
                                        }

                                }

                        },

                    y:
                        {

                            grace:
                                "10%",

                            grid:
                                {
                                    color:
                                        "rgba(32, 53, 82, 0.38)"
                                },

                            border:
                                {
                                    color:
                                        "rgba(32, 53, 82, 0.70)"
                                },

                            ticks:
                                {

                                    color:
                                        "#71869f",

                                    font:
                                        {
                                            size:
                                                9
                                        },

                                    callback(value) {

                                        return Number(value)
                                            .toFixed(
                                                parameter.decimals
                                            );

                                    }

                                }

                        }

                }

        };

    }


    function createChart(
        key,
        parameter
    ) {

        const canvas =
            document.getElementById(
                parameter.canvasId
            );

        if (!canvas) {

            writeLog(
                `Canvas ${parameter.canvasId} не найден`,
                "error"
            );

            return null;

        }

        const context =
            canvas.getContext("2d");

        const gradient =
            context.createLinearGradient(
                0,
                0,
                0,
                190
            );

        gradient.addColorStop(
            0,
            "rgba(0, 217, 255, 0.26)"
        );

        gradient.addColorStop(
            1,
            "rgba(0, 217, 255, 0.01)"
        );

        return new Chart(
            context,
            {

                type:
                    "line",

                data:
                    {

                        labels:
                            [],

                        datasets:
                            [

                                {

                                    label:
                                        parameter.title,

                                    data:
                                        [],

                                    borderColor:
                                        "#00d9ff",

                                    backgroundColor:
                                        gradient,

                                    borderWidth:
                                        CHART_CONFIG.borderWidth,

                                    pointRadius:
                                        CHART_CONFIG.pointRadius,

                                    pointHoverRadius:
                                        3,

                                    tension:
                                        CHART_CONFIG.tension,

                                    fill:
                                        true

                                }

                            ]

                    },

                options:
                    createChartOptions(
                        parameter
                    )

            }
        );

    }


    function updateCurrentValue(
        key,
        value
    ) {

        const parameter =
            PARAMETER_CONFIG[key];

        const element =
            document.getElementById(
                parameter.valueId
            );

        if (!element) {

            return;

        }

        element.textContent =
            `${value.toFixed(
                parameter.decimals
            )} ${parameter.unit}`;

    }


    function appendValue(
        key,
        value,
        timestamp
    ) {

        const chart =
            state.charts[key];

        if (!chart) {

            return;

        }

        const numericValue =
            Number(value);

        if (!Number.isFinite(numericValue)) {

            return;

        }

        const label =
            formatTimeLabel(
                new Date(timestamp)
            );

        chart.data.labels.push(
            label
        );

        chart.data.datasets[0].data.push(
            numericValue
        );

        while (
            chart.data.labels.length >
            CHART_CONFIG.maximumPoints
        ) {

            chart.data.labels.shift();

            chart.data.datasets[0].data.shift();

        }

        chart.update("none");

        state.latestValues[key] =
            numericValue;

        updateCurrentValue(
            key,
            numericValue
        );

    }


    function processTelemetry(
        telemetry
    ) {

        if (
            state.paused ||
            !telemetry ||
            typeof telemetry !== "object"
        ) {

            return;

        }

        const timestamp =
            Date.now();

        let valuesAdded =
            0;

        Object.keys(
            PARAMETER_CONFIG
        ).forEach(key => {

            if (
                Object.hasOwn(
                    telemetry,
                    key
                )
            ) {

                appendValue(
                    key,
                    telemetry[key],
                    timestamp
                );

                valuesAdded += 1;

            }

        });

        if (valuesAdded > 0) {

            state.totalPackets += 1;

            updateStatistics();

            setStatus(
                "active"
            );

        }

    }


    function updateStatistics() {

        const lengths =
            Object.values(
                state.charts
            )
                .map(chart => {

                    return chart.data.labels.length;

                });

        const pointCount =
            lengths.length > 0
                ? Math.max(...lengths)
                : 0;

        if (elements.pointCount) {

            elements.pointCount.textContent =
                String(pointCount);

        }

        if (elements.timeWindow) {

            elements.timeWindow.textContent =
                `${CHART_CONFIG.maximumPoints} отсчётов`;

        }

        if (elements.recordingState) {

            elements.recordingState.textContent =
                state.paused
                    ? "ПАУЗА"
                    : "ЗАПИСЬ";

        }

    }


    function setStatus(status) {

        if (!elements.chartStatus) {

            return;

        }

        elements.chartStatus.classList.remove(
            "active",
            "paused"
        );

        switch (status) {

            case "active":

                elements.chartStatus.textContent =
                    "ПРИЁМ ДАННЫХ";

                elements.chartStatus.classList.add(
                    "active"
                );

                break;


            case "paused":

                elements.chartStatus.textContent =
                    "ПАУЗА";

                elements.chartStatus.classList.add(
                    "paused"
                );

                break;


            default:

                elements.chartStatus.textContent =
                    "ОЖИДАНИЕ ДАННЫХ";

                break;

        }

    }


    function togglePause() {

        state.paused =
            !state.paused;

        if (elements.pauseButton) {

            elements.pauseButton.textContent =
                state.paused
                    ? "Продолжить"
                    : "Пауза";

        }

        setStatus(
            state.paused
                ? "paused"
                : "active"
        );

        updateStatistics();

        writeLog(
            state.paused
                ? "Обновление графиков приостановлено"
                : "Обновление графиков продолжено",
            "info"
        );

    }


    function clearCharts() {

        Object.values(
            state.charts
        ).forEach(chart => {

            chart.data.labels.length =
                0;

            chart.data.datasets[0].data.length =
                0;

            chart.update("none");

        });

        Object.keys(
            PARAMETER_CONFIG
        ).forEach(key => {

            const parameter =
                PARAMETER_CONFIG[key];

            const element =
                document.getElementById(
                    parameter.valueId
                );

            if (element) {

                element.textContent =
                    "--";

            }

        });

        state.latestValues =
            {};

        state.totalPackets =
            0;

        state.startTime =
            Date.now();

        updateStatistics();

        setStatus(
            state.paused
                ? "paused"
                : "waiting"
        );

        writeLog(
            "Графики телеметрии очищены",
            "info"
        );

    }


    function cacheElements() {

        elements.chartStatus =
            document.getElementById(
                "chartStatus"
            );

        elements.pauseButton =
            document.getElementById(
                "pauseChartsButton"
            );

        elements.clearButton =
            document.getElementById(
                "clearChartsButton"
            );

        elements.pointCount =
            document.getElementById(
                "chartPointCount"
            );

        elements.timeWindow =
            document.getElementById(
                "chartTimeWindow"
            );

        elements.recordingState =
            document.getElementById(
                "chartRecordingState"
            );

    }


    function registerEvents() {

        window.addEventListener(
            "openmcc:telemetry",
            event => {

                processTelemetry(
                    event.detail
                );

            }
        );


        window.addEventListener(
            "openmcc:serial-disconnected",
            () => {

                if (!state.paused) {

                    setStatus(
                        "waiting"
                    );

                }

            }
        );


        elements.pauseButton?.addEventListener(
            "click",
            togglePause
        );


        elements.clearButton?.addEventListener(
            "click",
            clearCharts
        );

    }


    function initialize() {

        if (state.initialized) {

            return;

        }

        if (
            typeof Chart ===
            "undefined"
        ) {

            writeLog(
                "Библиотека Chart.js не загружена",
                "error"
            );

            return;

        }

        cacheElements();

        Object.entries(
            PARAMETER_CONFIG
        ).forEach(
            ([key, parameter]) => {

                const chart =
                    createChart(
                        key,
                        parameter
                    );

                if (chart) {

                    state.charts[key] =
                        chart;

                }

            }
        );

        registerEvents();

        updateStatistics();

        setStatus(
            "waiting"
        );

        state.initialized =
            true;

        writeLog(
            `Модуль графиков v${CHART_CONFIG.version} загружен`,
            "success"
        );

    }


    window.OpenMCCCharts = Object.freeze({

        processTelemetry,

        clearCharts,

        togglePause,

        getState() {

            return {

                initialized:
                    state.initialized,

                paused:
                    state.paused,

                totalPackets:
                    state.totalPackets,

                latestValues:
                    {
                        ...state.latestValues
                    },

                chartCount:
                    Object.keys(
                        state.charts
                    ).length

            };

        }

    });


    if (document.readyState === "loading") {

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );

    }
    else {

        initialize();

    }

})();