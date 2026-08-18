# OpenMCC Desktop for Windows

OpenMCC can be distributed as a normal Windows application. The desktop edition wraps the existing web interface in Electron, starts an internal local HTTP server automatically and exposes Web Serial to the same JavaScript modules that are already used by the browser edition.

## What changes for the operator

The operator no longer needs Python, a BAT launcher or a browser tab. After installation OpenMCC is started from the Start menu or desktop shortcut like a normal program.

The application still works locally. The interface files, Chart.js and Three.js are packaged with the program. Internet access is not required for ordinary operation.

## Serial devices

The desktop host handles Electron's Web Serial device-selection event. When the existing OpenMCC interface calls `navigator.serial.requestPort()`, the desktop application shows a native Windows selection dialog.

This preserves the existing separation between the two serial connections:

- spacecraft/radio gateway connection;
- AZ/EL rotator connection.

The browser JavaScript modules do not need to know whether they are running in Chrome/Edge or in the installed desktop application.

## Windows installer

The project uses Electron and electron-builder. The Windows target is NSIS x64.

Generated installer name:

```text
OpenMCC-Setup-0.2.0.exe
```

The installer:

- allows the user to choose the installation directory;
- creates a Start menu shortcut;
- creates a desktop shortcut;
- can launch OpenMCC when installation finishes.

## Building locally

Requirements for developers only:

- Windows 10/11 x64;
- Node.js 22 or newer compatible environment;
- npm.

Commands:

```powershell
npm install
npm run dist:win
```

The result appears in:

```text
release/
```

Ordinary OpenMCC users do **not** need Node.js, npm or Python.

## GitHub Actions

Workflow:

```text
.github/workflows/windows-installer.yml
```

Every pull request and push to `main` builds a Windows installer and stores it as a GitHub Actions artifact for 30 days.

A tag whose name starts with `v`, for example:

```text
v0.2.0
```

causes electron-builder to publish the installer to a GitHub Release automatically.

## Public distribution

At the moment the repository may be private. Releases from a private repository are not a public download channel. To let any user download OpenMCC without a GitHub invitation, use one of these approaches:

1. make `Anton778/OpenMCC` public after reviewing the repository contents; or
2. keep the development repository private and publish installers in a separate public distribution repository.

Do not change repository visibility until you have checked that no credentials, private documents or other sensitive material are committed.

## Windows SmartScreen and code signing

The initial installer is unsigned. Windows may therefore display an `Unknown publisher` / SmartScreen warning even when the file was built by GitHub Actions.

For public non-technical users, a later production step should be Windows code signing using a trusted signing certificate or another supported signing service. Signing is not required to test the installer, but it materially improves the installation experience and trust chain.

## Security decisions in the desktop host

`desktop/main.cjs` uses:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- Chromium sandboxing;
- a local server bound only to `127.0.0.1`;
- serial permission only for the local OpenMCC origin;
- a native port-selection dialog;
- external web links opened outside the application.

The local server binds to a free ephemeral TCP port, so it does not depend on port 8000 being available.

## Versioning

Before a public release:

1. update the `version` field in `package.json`;
2. update `CHANGELOG.md`;
3. merge tested changes into `main`;
4. create/push a matching tag, for example `v0.2.0`;
5. verify the GitHub Release installer on a clean Windows PC.

The package version and release tag should match.
