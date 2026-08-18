"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const WEB_ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";

const MIME_TYPES = Object.freeze({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8"
});

let mainWindow = null;
let staticServer = null;
let applicationOrigin = null;

function getMimeType(filePath) {
    return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function resolveRequestPath(requestUrl) {
    const url = new URL(requestUrl, `http://${HOST}`);
    const decodedPath = decodeURIComponent(url.pathname);
    const relativePath = decodedPath === "/"
        ? "index.html"
        : decodedPath.replace(/^\/+/, "");

    const requestedPath = path.resolve(WEB_ROOT, relativePath);
    const rootPrefix = WEB_ROOT.endsWith(path.sep)
        ? WEB_ROOT
        : `${WEB_ROOT}${path.sep}`;

    if (
        requestedPath !== WEB_ROOT &&
        !requestedPath.startsWith(rootPrefix)
    ) {
        return null;
    }

    return requestedPath;
}

async function serveFile(request, response) {
    try {
        let filePath = resolveRequestPath(request.url || "/");

        if (!filePath) {
            response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
            response.end("Forbidden");
            return;
        }

        let stat = await fs.promises.stat(filePath);

        if (stat.isDirectory()) {
            filePath = path.join(filePath, "index.html");
            stat = await fs.promises.stat(filePath);
        }

        if (!stat.isFile()) {
            throw new Error("Not a file");
        }

        response.writeHead(200, {
            "Content-Type": getMimeType(filePath),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
        });

        fs.createReadStream(filePath).pipe(response);
    }
    catch (error) {
        const statusCode = error && error.code === "ENOENT" ? 404 : 500;
        response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(statusCode === 404 ? "Not found" : "Internal server error");
    }
}

function startStaticServer() {
    return new Promise((resolve, reject) => {
        staticServer = http.createServer(serveFile);

        staticServer.once("error", reject);
        staticServer.listen(0, HOST, () => {
            const address = staticServer.address();

            if (!address || typeof address === "string") {
                reject(new Error("Unable to determine local OpenMCC server port"));
                return;
            }

            applicationOrigin = `http://${HOST}:${address.port}`;
            resolve(applicationOrigin);
        });
    });
}

function formatSerialPort(port) {
    const title = port.displayName || port.portName || "Последовательное устройство";
    const details = [];

    if (port.portName && port.portName !== title) {
        details.push(port.portName);
    }

    if (port.vendorId) {
        details.push(`VID ${port.vendorId}`);
    }

    if (port.productId) {
        details.push(`PID ${port.productId}`);
    }

    return details.length > 0
        ? `${title} — ${details.join(" · ")}`
        : title;
}

function configureSerialAccess(window) {
    const session = window.webContents.session;

    session.setPermissionCheckHandler(
        (_webContents, permission, requestingOrigin) => {
            return permission === "serial" &&
                Boolean(applicationOrigin) &&
                requestingOrigin.startsWith(applicationOrigin);
        }
    );

    session.setDevicePermissionHandler(details => {
        return details.deviceType === "serial" &&
            Boolean(applicationOrigin) &&
            details.origin.startsWith(applicationOrigin);
    });

    session.on(
        "select-serial-port",
        async (event, portList, _webContents, callback) => {
            event.preventDefault();

            if (!Array.isArray(portList) || portList.length === 0) {
                await dialog.showMessageBox(window, {
                    type: "info",
                    title: "OpenMCC — последовательный порт",
                    message: "Последовательные устройства не обнаружены",
                    detail: "Подключите Arduino, ESP32, STM32 или контроллер поворотки по USB и повторите подключение.",
                    buttons: ["Понятно"]
                });

                callback("");
                return;
            }

            const deviceButtons = portList.map(formatSerialPort);
            const cancelIndex = deviceButtons.length;

            const result = await dialog.showMessageBox(window, {
                type: "question",
                title: "OpenMCC — выбор устройства",
                message: "Выберите последовательное устройство",
                detail: "Выбранный порт будет передан в интерфейс OpenMCC через Web Serial API.",
                buttons: [...deviceButtons, "Отмена"],
                defaultId: 0,
                cancelId: cancelIndex,
                noLink: true
            });

            if (result.response >= 0 && result.response < portList.length) {
                callback(portList[result.response].portId);
            }
            else {
                callback("");
            }
        }
    );
}

async function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 1000,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: "#070b16",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    configureSerialAccess(mainWindow);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url);
        }

        return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!applicationOrigin || !url.startsWith(applicationOrigin)) {
            event.preventDefault();

            if (/^https?:\/\//i.test(url)) {
                shell.openExternal(url);
            }
        }
    });

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
    });

    await mainWindow.loadURL(`${applicationOrigin}/`);
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
    app.quit();
}
else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }

            mainWindow.focus();
        }
    });

    app.whenReady()
        .then(async () => {
            app.setAppUserModelId("org.openmcc.desktop");
            await startStaticServer();
            await createMainWindow();
        })
        .catch(async error => {
            await dialog.showMessageBox({
                type: "error",
                title: "OpenMCC",
                message: "Не удалось запустить OpenMCC",
                detail: error?.stack || error?.message || String(error)
            });

            app.quit();
        });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0 && applicationOrigin) {
            createMainWindow();
        }
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });

    app.on("before-quit", () => {
        if (staticServer) {
            staticServer.close();
            staticServer = null;
        }
    });
}
