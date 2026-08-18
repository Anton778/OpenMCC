"use strict";

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* ============================================================
   OpenMCC — CubeSat 3D view
   Version 0.3.0
   Generic educational 2U CubeSat with fixed body solar panels
   and a deployed tape-measure dipole antenna.
   ============================================================ */

const SATELLITE_CONFIG = Object.freeze({
    version: "0.3.0",
    cameraDistance: 7.8,
    autoRotationSpeed: 0.22,
    orientationSmoothing: 0.10,
});

const state = {
    initialized: false,
    autoRotation: true,
    telemetryReceived: false,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    satelliteRoot: null,
    clock: null,
    animationFrame: null,
    currentOrientation: { roll: 0, pitch: 0, yaw: 0 },
    targetOrientation: { roll: 0, pitch: 0, yaw: 0 },
};

const elements = {};

function writeLog(message, type = "info", metadata = null) {
    if (window.OpenMCCLogger?.write) {
        window.OpenMCCLogger.write(message, type, "SATELLITE", metadata);
        return;
    }
    console.log(`[OpenMCC Satellite] ${message}`);
}

function cacheElements() {
    elements.viewport = document.getElementById("satelliteViewport");
    elements.canvas = document.getElementById("satelliteCanvas");
    elements.status = document.getElementById("satelliteStatus");
    elements.resetViewButton = document.getElementById("resetSatelliteView");
    elements.autoRotationButton = document.getElementById("toggleSatelliteRotation");
    elements.roll = document.getElementById("orientationRoll");
    elements.pitch = document.getElementById("orientationPitch");
    elements.yaw = document.getElementById("orientationYaw");
}

function setStatus(text, type = "ready") {
    if (!elements.status) return;
    elements.status.textContent = text;
    elements.status.classList.remove("ready", "error");
    elements.status.classList.add(type);
}

function standardMaterial(color, metalness = 0.5, roughness = 0.35) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function box(size, material, position = [0, 0, 0]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function createScene() {
    state.scene = new THREE.Scene();
    state.camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
    state.camera.position.set(5.5, 3.9, SATELLITE_CONFIG.cameraDistance);

    state.renderer = new THREE.WebGLRenderer({
        canvas: elements.canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
    });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    state.controls = new OrbitControls(state.camera, elements.canvas);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.075;
    state.controls.enablePan = false;
    state.controls.minDistance = 4.8;
    state.controls.maxDistance = 15;
    state.controls.target.set(0, 0, 0);
    state.clock = new THREE.Clock();
}

function createLights() {
    state.scene.add(new THREE.HemisphereLight(0xa9d8ff, 0x07101b, 1.45));

    const main = new THREE.DirectionalLight(0xffffff, 3.5);
    main.position.set(5, 7, 8);
    main.castShadow = true;
    state.scene.add(main);

    const fill = new THREE.PointLight(0x00d9ff, 6, 15);
    fill.position.set(-4, 1, 4);
    state.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x315dff, 1.8);
    rim.position.set(-5, 3, -7);
    state.scene.add(rim);
}

function addSolarCellsToZFace(root, z, cellMaterial, frameMaterial) {
    const panel = box([1.52, 2.62, 0.055], frameMaterial, [0, 0, z]);
    root.add(panel);

    for (let row = 0; row < 6; row++) {
        for (let column = 0; column < 3; column++) {
            const cell = box(
                [0.42, 0.34, 0.035],
                cellMaterial,
                [-0.48 + column * 0.48, -1.02 + row * 0.41, z + Math.sign(z) * 0.047]
            );
            root.add(cell);
        }
    }
}

function addSolarCellsToXFace(root, x, cellMaterial, frameMaterial) {
    const panel = box([0.055, 2.62, 1.52], frameMaterial, [x, 0, 0]);
    root.add(panel);

    for (let row = 0; row < 6; row++) {
        for (let column = 0; column < 3; column++) {
            const cell = box(
                [0.035, 0.34, 0.42],
                cellMaterial,
                [x + Math.sign(x) * 0.047, -1.02 + row * 0.41, -0.48 + column * 0.48]
            );
            root.add(cell);
        }
    }
}

function addCornerFasteners(root, y, frameMaterial) {
    const geometry = new THREE.CylinderGeometry(0.045, 0.045, 0.025, 16);
    [[-0.72,-0.72],[-0.72,0.72],[0.72,-0.72],[0.72,0.72]].forEach(([x,z]) => {
        const screw = new THREE.Mesh(geometry, frameMaterial);
        screw.position.set(x, y, z);
        root.add(screw);
    });
}

function createTapeDipole(root, springMaterial, darkMaterial, frameMaterial) {
    const topY = 1.69;

    const deployer = box([0.72, 0.22, 0.54], darkMaterial, [0, topY, 0.12]);
    root.add(deployer);

    const cover = box([0.62, 0.035, 0.44], frameMaterial, [0, topY + 0.13, 0.12]);
    root.add(cover);

    const slotMaterial = standardMaterial(0x02050a, 0.15, 0.65);
    root.add(box([0.055, 0.09, 0.18], slotMaterial, [0.37, topY, 0.12]));
    root.add(box([0.055, 0.09, 0.18], slotMaterial, [-0.37, topY, 0.12]));

    const armLength = 1.72;
    const armThickness = 0.025;
    const armWidth = 0.105;
    const right = box([armLength, armThickness, armWidth], springMaterial, [0.38 + armLength / 2, topY + 0.015, 0.12]);
    const left = box([armLength, armThickness, armWidth], springMaterial, [-0.38 - armLength / 2, topY + 0.015, 0.12]);
    right.rotation.z = 0.015;
    left.rotation.z = -0.015;
    root.add(right, left);

    const feedMaterial = standardMaterial(0xc99c36, 0.78, 0.25);
    const feedGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.08, 20);
    const feedRight = new THREE.Mesh(feedGeometry, feedMaterial);
    const feedLeft = new THREE.Mesh(feedGeometry, feedMaterial);
    feedRight.position.set(0.40, topY + 0.02, 0.12);
    feedLeft.position.set(-0.40, topY + 0.02, 0.12);
    feedRight.rotation.z = Math.PI / 2;
    feedLeft.rotation.z = Math.PI / 2;
    root.add(feedRight, feedLeft);
}

function createCubeSatBody() {
    const root = new THREE.Group();
    root.name = "CubeSat2UTapeDipole";

    const frameMaterial = standardMaterial(0xb8c2cd, 0.84, 0.22);
    const bodyMaterial = standardMaterial(0x151e2a, 0.58, 0.36);
    const panelFrameMaterial = standardMaterial(0x0a111b, 0.55, 0.34);
    const darkMaterial = standardMaterial(0x070c13, 0.68, 0.30);
    const springMaterial = standardMaterial(0xb7ad83, 0.72, 0.25);
    const solarCellMaterial = new THREE.MeshStandardMaterial({
        color: 0x0c3b73,
        emissive: 0x03162c,
        emissiveIntensity: 0.75,
        metalness: 0.42,
        roughness: 0.26,
    });

    const body = box([1.78, 3.0, 1.78], bodyMaterial);
    root.add(body);

    const railGeometry = new THREE.BoxGeometry(0.12, 3.36, 0.12);
    [[-0.94,-0.94],[-0.94,0.94],[0.94,-0.94],[0.94,0.94]].forEach(([x,z]) => {
        const rail = new THREE.Mesh(railGeometry, frameMaterial);
        rail.position.set(x, 0, z);
        rail.castShadow = true;
        root.add(rail);
    });

    root.add(box([2.00, 0.11, 2.00], frameMaterial, [0, -1.56, 0]));
    root.add(box([2.00, 0.11, 2.00], frameMaterial, [0, 1.56, 0]));
    addCornerFasteners(root, -1.625, frameMaterial);
    addCornerFasteners(root, 1.625, frameMaterial);

    addSolarCellsToZFace(root, 0.905, solarCellMaterial, panelFrameMaterial);
    addSolarCellsToZFace(root, -0.905, solarCellMaterial, panelFrameMaterial);
    addSolarCellsToXFace(root, 0.905, solarCellMaterial, panelFrameMaterial);
    addSolarCellsToXFace(root, -0.905, solarCellMaterial, panelFrameMaterial);

    const cameraBody = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.13, 28), darkMaterial);
    cameraBody.rotation.x = Math.PI / 2;
    cameraBody.position.set(0, 0.46, 0.99);
    root.add(cameraBody);

    const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.14, 28),
        new THREE.MeshStandardMaterial({ color: 0x3fbfff, emissive: 0x006e9f, emissiveIntensity: 0.9, metalness: 0.12, roughness: 0.12 })
    );
    glass.rotation.x = Math.PI / 2;
    glass.position.set(0, 0.46, 1.055);
    root.add(glass);

    createTapeDipole(root, springMaterial, darkMaterial, frameMaterial);

    const axisHelper = new THREE.AxesHelper(2.45);
    axisHelper.material.transparent = true;
    axisHelper.material.opacity = 0.62;
    root.add(axisHelper);

    root.rotation.set(0.22, -0.45, 0.07);
    return root;
}

function createEnvironment() {
    const grid = new THREE.GridHelper(18, 36, 0x174567, 0x10243a);
    grid.position.y = -2.45;
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    state.scene.add(grid);

    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 320;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] = (Math.random() - 0.5) * 20;
        positions[i + 1] = (Math.random() - 0.5) * 14;
        positions[i + 2] = -3 - Math.random() * 12;
    }
    starsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    state.scene.add(new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0x7ecfff, size: 0.025, transparent: true, opacity: 0.52 })));
}

function resizeRenderer() {
    if (!elements.viewport || !state.renderer || !state.camera) return;
    const width = elements.viewport.clientWidth;
    const height = elements.viewport.clientHeight;
    if (width <= 0 || height <= 0) return;
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
}

function degreesToRadians(value) {
    return THREE.MathUtils.degToRad(Number(value) || 0);
}

function updateOrientationDisplay() {
    if (elements.roll) elements.roll.textContent = `${state.targetOrientation.roll.toFixed(1)}°`;
    if (elements.pitch) elements.pitch.textContent = `${state.targetOrientation.pitch.toFixed(1)}°`;
    if (elements.yaw) elements.yaw.textContent = `${state.targetOrientation.yaw.toFixed(1)}°`;
}

function processTelemetry(telemetry) {
    if (!telemetry || typeof telemetry !== "object") return;
    let updated = false;
    for (const [key, property] of [["ROLL","roll"],["PITCH","pitch"],["YAW","yaw"]]) {
        if (Number.isFinite(Number(telemetry[key]))) {
            state.targetOrientation[property] = Number(telemetry[key]);
            updated = true;
        }
    }
    if (updated) {
        state.telemetryReceived = true;
        state.autoRotation = false;
        updateAutoRotationButton();
        updateOrientationDisplay();
    }
}

function interpolateAngle(current, target, coefficient) {
    let difference = target - current;
    while (difference > 180) difference -= 360;
    while (difference < -180) difference += 360;
    return current + difference * coefficient;
}

function updateSatelliteRotation(deltaTime) {
    if (!state.satelliteRoot) return;
    if (state.autoRotation && !state.telemetryReceived) {
        state.satelliteRoot.rotation.y += deltaTime * SATELLITE_CONFIG.autoRotationSpeed;
        return;
    }

    state.currentOrientation.roll = interpolateAngle(state.currentOrientation.roll, state.targetOrientation.roll, SATELLITE_CONFIG.orientationSmoothing);
    state.currentOrientation.pitch = interpolateAngle(state.currentOrientation.pitch, state.targetOrientation.pitch, SATELLITE_CONFIG.orientationSmoothing);
    state.currentOrientation.yaw = interpolateAngle(state.currentOrientation.yaw, state.targetOrientation.yaw, SATELLITE_CONFIG.orientationSmoothing);

    state.satelliteRoot.rotation.set(
        degreesToRadians(state.currentOrientation.pitch),
        degreesToRadians(state.currentOrientation.yaw),
        degreesToRadians(state.currentOrientation.roll),
        "YXZ"
    );
}

function animate() {
    state.animationFrame = requestAnimationFrame(animate);
    const deltaTime = Math.min(state.clock.getDelta(), 0.05);
    updateSatelliteRotation(deltaTime);
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
}

function resetCameraView() {
    state.camera.position.set(5.5, 3.9, SATELLITE_CONFIG.cameraDistance);
    state.controls.target.set(0, 0, 0);
    state.controls.update();
    writeLog("Положение 3D-камеры восстановлено", "info");
}

function updateAutoRotationButton() {
    if (!elements.autoRotationButton) return;
    elements.autoRotationButton.textContent = state.autoRotation ? "Остановить вращение" : "Автовращение";
}

function toggleAutoRotation() {
    state.autoRotation = !state.autoRotation;
    if (state.autoRotation) state.telemetryReceived = false;
    updateAutoRotationButton();
    writeLog(state.autoRotation ? "Автоматическое вращение модели включено" : "Автоматическое вращение модели выключено", "info");
}

function registerEvents() {
    window.addEventListener("resize", resizeRenderer);
    window.addEventListener("openmcc:telemetry", (event) => processTelemetry(event.detail));
    elements.resetViewButton?.addEventListener("click", resetCameraView);
    elements.autoRotationButton?.addEventListener("click", toggleAutoRotation);
    const resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(elements.viewport);
}

function initialize() {
    if (state.initialized) return;
    try {
        cacheElements();
        if (!elements.viewport || !elements.canvas) throw new Error("Контейнер 3D-модели не найден");
        createScene();
        createLights();
        state.satelliteRoot = createCubeSatBody();
        state.scene.add(state.satelliteRoot);
        createEnvironment();
        registerEvents();
        resizeRenderer();
        resetCameraView();
        updateAutoRotationButton();
        updateOrientationDisplay();
        state.initialized = true;
        setStatus("2U · DIPOLE", "ready");
        writeLog(`3D-модель CubeSat v${SATELLITE_CONFIG.version}: fixed solar panels + tape-measure dipole`, "success");
        animate();
    } catch (error) {
        setStatus("ОШИБКА", "error");
        writeLog(`Ошибка инициализации 3D-модели: ${error.message}`, "error");
        console.error(error);
    }
}

window.OpenMCCSatellite = Object.freeze({
    processTelemetry,
    resetCameraView,
    toggleAutoRotation,
    getState() {
        return {
            initialized: state.initialized,
            autoRotation: state.autoRotation,
            telemetryReceived: state.telemetryReceived,
            currentOrientation: { ...state.currentOrientation },
            targetOrientation: { ...state.targetOrientation },
            model: "generic-2u-tape-dipole",
        };
    },
});

initialize();
