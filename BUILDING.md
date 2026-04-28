# Building Openotex

## Prerequisites

- Node.js 20 or newer
- npm
- A LaTeX distribution for PDF compilation in the app:
  - Windows: MiKTeX or TeX Live
  - macOS: MacTeX
  - Linux: TeX Live
- `latexmk` is recommended. Openotex uses it when available because it handles bibliography and cross-reference reruns reliably.

## Install

```powershell
npm install
```

## Run In Development

```powershell
npm run dev
```

This starts the renderer dev server, watches the Electron main and preload bundles, and opens the desktop app.

## Build Production Files

```powershell
npm run build
```

Build output is written to:

```text
dist/
```

This does not create an installer.

## Run Tests

```powershell
npm test
```

The current test suite covers LaTeX diagnostic parsing used by the compile error UI.

## Package The App

```powershell
npm run package
```

Packaged output is written to:

```text
release/
```

On Windows, this uses the NSIS target configured in `package.json`.

## LaTeX Build Output

When `latexmk` is installed, Openotex writes LaTeX auxiliary files and compiled PDFs to:

```text
.openotex/build/<tex-file-name>/
```

This keeps `.aux`, `.log`, `.fls`, `.fdb_latexmk`, and SyncTeX files out of the document folder. If `latexmk` is not installed, Openotex falls back to direct engine compilation for compatibility.

