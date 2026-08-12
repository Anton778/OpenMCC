"use strict";

import * as THREE from "three";

import {
    OrbitControls
} from "three/addons/controls/OrbitControls.js";


/* ============================================================
   OpenMCC
   Open Mission Control Center

   Module: satellite.js
   Version: 0.1.0

   Назначение:
   - отображение программной модели CubeSat;
   - управление камерой;
   - отображение ориентации;
   - обработка ROLL, PITCH и YAW;
   - автоматическое демонстрационное вращение.
   ============================================================ */


const SATELLITE_CONFIG = Object.freeze({

    version:
        "0.1.0",

    background:
        0x07101e,

    cameraDistance:
        7.2,

    autoRotationSpeed:
        0.25,

    orientationSmoothing:
        0.10

});


const state = {

    initialized:
        false,

    autoRotation:
        true,

    telemetryReceived:
        false,

    scene:
        null,

    camera:
        null,

    renderer:
        null,

    controls:
        null,

    satelliteRoot:
        null,

    clock:
        null,

    animationFrame:
        null,

    currentOrientation:
        {
            roll: 0,
            pitch: 0,
            yaw: 0
        },

    targetOrientation:
        {
            roll: 0,
            pitch: 0,
            yaw: 0
        }

};


const elements = {

    viewport:
        null,

    canvas:
        null,

    status:
        null,

    resetViewButton:
        null,

    autoRotationButton:
        null,

    roll:
        null,

    pitch:
        null,

    yaw:
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
            "SATELLITE",
            metadata
        );

        return;

    }

    console.log(
        `[OpenMCC Satellite] ${message}`
    );

}


function cacheElements() {

    elements.viewport =
        document.getElementById(
            "satelliteViewport"
        );

    elements.canvas =
        document.getElementById(
            "satelliteCanvas"
        );

    elements.status =
        document.getElementById(
            "satelliteStatus"
        );

    elements.resetViewButton =
        document.getElementById(
            "resetSatelliteView"
        );

    elements.autoRotationButton =
        document.getElementById(
            "toggleSatelliteRotation"
        );

    elements.roll =
        document.getElementById(
            "orientationRoll"
        );

    elements.pitch =
        document.getElementById(
            "orientationPitch"
        );

    elements.yaw =
        document.getElementById(
            "orientationYaw"
        );

}


function setStatus(
    text,
    type = "ready"
) {

    if (!elements.status) {

        return;

    }

    elements.status.textContent =
        text;

    elements.status.classList.remove(
        "ready",
        "error"
    );

    elements.status.classList.add(
        type
    );

}


function createScene() {

    state.scene =
        new THREE.Scene();

    state.scene.background =
        null;

    state.camera =
        new THREE.PerspectiveCamera(
            38,
            1,
            0.1,
            100
        );

    state.camera.position.set(
        5.4,
        3.8,
        SATELLITE_CONFIG.cameraDistance
    );


    state.renderer =
        new THREE.WebGLRenderer({

            canvas:
                elements.canvas,

            antialias:
                true,

            alpha:
                true,

            powerPreference:
                "high-performance"

        });

    state.renderer.setPixelRatio(
        Math.min(
            window.devicePixelRatio,
            2
        )
    );

    state.renderer.outputColorSpace =
        THREE.SRGBColorSpace;

    state.renderer.shadowMap.enabled =
        true;

    state.renderer.shadowMap.type =
        THREE.PCFSoftShadowMap;


    state.controls =
        new OrbitControls(
            state.camera,
            elements.canvas
        );

    state.controls.enableDamping =
        true;

    state.controls.dampingFactor =
        0.075;

    state.controls.enablePan =
        false;

    state.controls.minDistance =
        4.2;

    state.controls.maxDistance =
        13;

    state.controls.target.set(
        0,
        0,
        0
    );


    state.clock =
        new THREE.Clock();

}


function createLights() {

    const ambientLight =
        new THREE.HemisphereLight(
            0x94cfff,
            0x08101d,
            1.35
        );

    state.scene.add(
        ambientLight
    );


    const mainLight =
        new THREE.DirectionalLight(
            0xffffff,
            3.2
        );

    mainLight.position.set(
        5,
        7,
        8
    );

    mainLight.castShadow =
        true;

    state.scene.add(
        mainLight
    );


    const cyanLight =
        new THREE.PointLight(
            0x00d9ff,
            8,
            14
        );

    cyanLight.position.set(
        -4,
        1,
        3
    );

    state.scene.add(
        cyanLight
    );


    const rimLight =
        new THREE.DirectionalLight(
            0x315dff,
            1.7
        );

    rimLight.position.set(
        -5,
        2,
        -7
    );

    state.scene.add(
        rimLight
    );

}


function createMaterial(
    color,
    metalness = 0.5,
    roughness = 0.35
) {

    return new THREE.MeshStandardMaterial({

        color,

        metalness,

        roughness

    });

}


function createCubeSatBody() {

    const root =
        new THREE.Group();

    root.name =
        "CubeSatRoot";


    const frameMaterial =
        createMaterial(
            0xaeb9c8,
            0.82,
            0.24
        );


    const bodyMaterial =
        createMaterial(
            0x202c3c,
            0.55,
            0.34
        );


    const darkMaterial =
        createMaterial(
            0x09111d,
            0.68,
            0.28
        );


    const goldMaterial =
        createMaterial(
            0xd4a52f,
            0.72,
            0.28
        );


    const solarCellMaterial =
        new THREE.MeshStandardMaterial({

            color:
                0x123f79,

            emissive:
                0x041833,

            emissiveIntensity:
                0.75,

            metalness:
                0.45,

            roughness:
                0.28

        });


    const body =
        new THREE.Mesh(

            new THREE.BoxGeometry(
                1.75,
                2.75,
                1.75
            ),

            bodyMaterial

        );

    body.castShadow =
        true;

    body.receiveShadow =
        true;

    root.add(body);


    const railGeometry =
        new THREE.BoxGeometry(
            0.13,
            3.15,
            0.13
        );

    const railCoordinates = [

        [-0.94, -0.94],
        [-0.94, 0.94],
        [0.94, -0.94],
        [0.94, 0.94]

    ];

    railCoordinates.forEach(
        ([x, z]) => {

            const rail =
                new THREE.Mesh(
                    railGeometry,
                    frameMaterial
                );

            rail.position.set(
                x,
                0,
                z
            );

            rail.castShadow =
                true;

            root.add(rail);

        }
    );


    const endPlateGeometry =
        new THREE.BoxGeometry(
            1.98,
            0.12,
            1.98
        );

    [-1.48, 1.48].forEach(y => {

        const plate =
            new THREE.Mesh(
                endPlateGeometry,
                frameMaterial
            );

        plate.position.y =
            y;

        plate.castShadow =
            true;

        root.add(plate);

    });


    const frontPanel =
        new THREE.Mesh(

            new THREE.BoxGeometry(
                1.48,
                2.35,
                0.055
            ),

            darkMaterial

        );

    frontPanel.position.z =
        0.895;

    root.add(frontPanel);


    const sensor =
        new THREE.Mesh(

            new THREE.CylinderGeometry(
                0.22,
                0.22,
                0.12,
                32
            ),

            darkMaterial

        );

    sensor.rotation.x =
        Math.PI / 2;

    sensor.position.set(
        0,
        0.55,
        0.97
    );

    root.add(sensor);


    const sensorGlass =
        new THREE.Mesh(

            new THREE.CylinderGeometry(
                0.14,
                0.14,
                0.13,
                32
            ),

            new THREE.MeshStandardMaterial({

                color:
                    0x38b9ff,

                emissive:
                    0x0076a8,

                emissiveIntensity:
                    1.1,

                metalness:
                    0.15,

                roughness:
                    0.16

            })

        );

    sensorGlass.rotation.x =
        Math.PI / 2;

    sensorGlass.position.set(
        0,
        0.55,
        1.035
    );

    root.add(sensorGlass);


    for (let row = 0; row < 5; row++) {

        for (let column = 0; column < 3; column++) {

            const cell =
                new THREE.Mesh(

                    new THREE.BoxGeometry(
                        0.39,
                        0.31,
                        0.035
                    ),

                    solarCellMaterial

                );

            cell.position.set(
                -0.46 + column * 0.46,
                -0.82 + row * 0.40,
                0.94
            );

            root.add(cell);

        }

    }


    const antennaBase =
        new THREE.Mesh(

            new THREE.CylinderGeometry(
                0.18,
                0.24,
                0.16,
                24
            ),

            goldMaterial

        );

    antennaBase.position.y =
        1.62;

    root.add(antennaBase);


    const antenna =
        new THREE.Mesh(

            new THREE.CylinderGeometry(
                0.018,
                0.018,
                1.65,
                12
            ),

            goldMaterial

        );

    antenna.position.set(
        0.2,
        2.42,
        0
    );

    antenna.rotation.z =
        -0.10;

    root.add(antenna);


    const sidePanels =
        createSolarPanels(
            solarCellMaterial,
            frameMaterial
        );

    root.add(
        sidePanels
    );


    const axisHelper =
        new THREE.AxesHelper(
            2.7
        );

    axisHelper.material.transparent =
        true;

    axisHelper.material.opacity =
        0.8;

    root.add(
        axisHelper
    );


    root.rotation.set(
        0.25,
        -0.45,
        0.08
    );

    return root;

}


function createSolarPanels(
    solarMaterial,
    frameMaterial
) {

    const panelGroup =
        new THREE.Group();


    const panelGeometry =
        new THREE.BoxGeometry(
            2.15,
            1.32,
            0.075
        );


    [-1, 1].forEach(side => {

        const hinge =
            new THREE.Group();

        hinge.position.x =
            side * 1.04;


        const support =
            new THREE.Mesh(

                new THREE.BoxGeometry(
                    0.35,
                    0.16,
                    0.14
                ),

                frameMaterial

            );

        support.position.x =
            side * 0.16;

        hinge.add(support);


        const panel =
            new THREE.Mesh(
                panelGeometry,
                solarMaterial
            );

        panel.position.x =
            side * 1.24;

        panel.castShadow =
            true;

        hinge.add(panel);


        for (let row = 0; row < 3; row++) {

            for (let column = 0; column < 5; column++) {

                const separator =
                    new THREE.Mesh(

                        new THREE.BoxGeometry(
                            0.35,
                            0.32,
                            0.015
                        ),

                        new THREE.MeshStandardMaterial({

                            color:
                                0x1b65a6,

                            emissive:
                                0x061a36,

                            emissiveIntensity:
                                0.45,

                            metalness:
                                0.35,

                            roughness:
                                0.30

                        })

                    );

                separator.position.set(
                    side * (
                        0.48 +
                        column * 0.40
                    ),
                    -0.43 +
                    row * 0.43,
                    0.047
                );

                hinge.add(separator);

            }

        }


        panelGroup.add(
            hinge
        );

    });

    return panelGroup;

}


function createEnvironment() {

    const grid =
        new THREE.GridHelper(
            18,
            36,
            0x174567,
            0x10243a
        );

    grid.position.y =
        -2.25;

    grid.material.transparent =
        true;

    grid.material.opacity =
        0.28;

    state.scene.add(grid);


    const starsGeometry =
        new THREE.BufferGeometry();

    const starCount =
        280;

    const positions =
        new Float32Array(
            starCount * 3
        );

    for (
        let index = 0;
        index < positions.length;
        index += 3
    ) {

        positions[index] =
            (Math.random() - 0.5) * 18;

        positions[index + 1] =
            (Math.random() - 0.5) * 12;

        positions[index + 2] =
            -3 - Math.random() * 10;

    }

    starsGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(
            positions,
            3
        )
    );


    const stars =
        new THREE.Points(

            starsGeometry,

            new THREE.PointsMaterial({

                color:
                    0x7ecfff,

                size:
                    0.025,

                transparent:
                    true,

                opacity:
                    0.55

            })

        );

    state.scene.add(stars);

}


function resizeRenderer() {

    if (
        !elements.viewport ||
        !state.renderer ||
        !state.camera
    ) {

        return;

    }

    const width =
        elements.viewport.clientWidth;

    const height =
        elements.viewport.clientHeight;

    if (
        width <= 0 ||
        height <= 0
    ) {

        return;

    }

    state.renderer.setSize(
        width,
        height,
        false
    );

    state.camera.aspect =
        width / height;

    state.camera.updateProjectionMatrix();

}


function degreesToRadians(value) {

    return THREE.MathUtils.degToRad(
        Number(value) || 0
    );

}


function updateOrientationDisplay() {

    if (elements.roll) {

        elements.roll.textContent =
            `${state.targetOrientation.roll.toFixed(1)}°`;

    }

    if (elements.pitch) {

        elements.pitch.textContent =
            `${state.targetOrientation.pitch.toFixed(1)}°`;

    }

    if (elements.yaw) {

        elements.yaw.textContent =
            `${state.targetOrientation.yaw.toFixed(1)}°`;

    }

}


function processTelemetry(telemetry) {

    if (
        !telemetry ||
        typeof telemetry !== "object"
    ) {

        return;

    }

    let orientationUpdated =
        false;

    if (
        Number.isFinite(
            Number(telemetry.ROLL)
        )
    ) {

        state.targetOrientation.roll =
            Number(telemetry.ROLL);

        orientationUpdated =
            true;

    }

    if (
        Number.isFinite(
            Number(telemetry.PITCH)
        )
    ) {

        state.targetOrientation.pitch =
            Number(telemetry.PITCH);

        orientationUpdated =
            true;

    }

    if (
        Number.isFinite(
            Number(telemetry.YAW)
        )
    ) {

        state.targetOrientation.yaw =
            Number(telemetry.YAW);

        orientationUpdated =
            true;

    }

    if (orientationUpdated) {

        state.telemetryReceived =
            true;

        state.autoRotation =
            false;

        updateAutoRotationButton();

        updateOrientationDisplay();

    }

}


function interpolateAngle(
    current,
    target,
    coefficient
) {

    let difference =
        target - current;

    while (difference > 180) {

        difference -= 360;

    }

    while (difference < -180) {

        difference += 360;

    }

    return current +
        difference * coefficient;

}


function updateSatelliteRotation(
    deltaTime
) {

    if (!state.satelliteRoot) {

        return;

    }

    if (
        state.autoRotation &&
        !state.telemetryReceived
    ) {

        state.satelliteRoot.rotation.y +=
            deltaTime *
            SATELLITE_CONFIG.autoRotationSpeed;

        return;

    }

    state.currentOrientation.roll =
        interpolateAngle(
            state.currentOrientation.roll,
            state.targetOrientation.roll,
            SATELLITE_CONFIG.orientationSmoothing
        );

    state.currentOrientation.pitch =
        interpolateAngle(
            state.currentOrientation.pitch,
            state.targetOrientation.pitch,
            SATELLITE_CONFIG.orientationSmoothing
        );

    state.currentOrientation.yaw =
        interpolateAngle(
            state.currentOrientation.yaw,
            state.targetOrientation.yaw,
            SATELLITE_CONFIG.orientationSmoothing
        );

    state.satelliteRoot.rotation.set(

        degreesToRadians(
            state.currentOrientation.pitch
        ),

        degreesToRadians(
            state.currentOrientation.yaw
        ),

        degreesToRadians(
            state.currentOrientation.roll
        ),

        "YXZ"

    );

}


function animate() {

    state.animationFrame =
        requestAnimationFrame(
            animate
        );

    const deltaTime =
        Math.min(
            state.clock.getDelta(),
            0.05
        );

    updateSatelliteRotation(
        deltaTime
    );

    state.controls.update();

    state.renderer.render(
        state.scene,
        state.camera
    );

}


function resetCameraView() {

    state.camera.position.set(
        5.4,
        3.8,
        SATELLITE_CONFIG.cameraDistance
    );

    state.controls.target.set(
        0,
        0,
        0
    );

    state.controls.update();

    writeLog(
        "Положение 3D-камеры восстановлено",
        "info"
    );

}


function updateAutoRotationButton() {

    if (!elements.autoRotationButton) {

        return;

    }

    elements.autoRotationButton.textContent =
        state.autoRotation
            ? "Остановить вращение"
            : "Автовращение";

}


function toggleAutoRotation() {

    state.autoRotation =
        !state.autoRotation;

    if (state.autoRotation) {

        state.telemetryReceived =
            false;

    }

    updateAutoRotationButton();

    writeLog(
        state.autoRotation
            ? "Автоматическое вращение модели включено"
            : "Автоматическое вращение модели выключено",
        "info"
    );

}


function registerEvents() {

    window.addEventListener(
        "resize",
        resizeRenderer
    );


    window.addEventListener(
        "openmcc:telemetry",
        event => {

            processTelemetry(
                event.detail
            );

        }
    );


    elements.resetViewButton
        ?.addEventListener(
            "click",
            resetCameraView
        );


    elements.autoRotationButton
        ?.addEventListener(
            "click",
            toggleAutoRotation
        );


    const resizeObserver =
        new ResizeObserver(
            resizeRenderer
        );

    resizeObserver.observe(
        elements.viewport
    );

}


function initialize() {

    if (state.initialized) {

        return;

    }

    try {

        cacheElements();

        if (
            !elements.viewport ||
            !elements.canvas
        ) {

            throw new Error(
                "Контейнер 3D-модели не найден"
            );

        }

        createScene();

        createLights();

        state.satelliteRoot =
            createCubeSatBody();

        state.scene.add(
            state.satelliteRoot
        );

        createEnvironment();

        registerEvents();

        resizeRenderer();

        resetCameraView();

        updateAutoRotationButton();

        updateOrientationDisplay();

        state.initialized =
            true;

        setStatus(
            "ГОТОВ",
            "ready"
        );

        writeLog(
            `Модуль 3D-модели v${SATELLITE_CONFIG.version} загружен`,
            "success"
        );

        animate();

    }
    catch (error) {

        setStatus(
            "ОШИБКА",
            "error"
        );

        writeLog(
            `Ошибка инициализации 3D-модели: ${error.message}`,
            "error"
        );

        console.error(error);

    }

}


window.OpenMCCSatellite = Object.freeze({

    processTelemetry,

    resetCameraView,

    toggleAutoRotation,

    getState() {

        return {

            initialized:
                state.initialized,

            autoRotation:
                state.autoRotation,

            telemetryReceived:
                state.telemetryReceived,

            currentOrientation:
                {
                    ...state.currentOrientation
                },

            targetOrientation:
                {
                    ...state.targetOrientation
                }

        };

    }

});


initialize();