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

All libraries are `devDependencies`: webpack bundles everything the app needs into `dist/`, so the packaged app contains no `node_modules`.

## Run In Development

```powershell
npm run dev
```

This starts the renderer dev server, watches the Electron main and preload bundles, and opens the desktop app.

Note: if the environment variable `ELECTRON_RUN_AS_NODE` is set (VS Code's integrated terminal and some agents set it), Electron starts as plain Node.js and the app fails with `Cannot read properties of undefined`. Unset it before starting Electron.

## Build Production Files

```powershell
npm run build
```

This deletes `dist/` and builds four bundles into it:

| Bundle | Source | Purpose |
|--------|--------|---------|
| `main.js` | `src/main/main.ts` | Electron main process |
| `preload.js` | `src/main/preload.ts` | Renderer API bridge |
| `renderer.js` (+ chunks, workers) | `src/renderer/` | User interface |
| `mcp-server.js` | `src/mcp/server.ts` | MCP server for coding agents |

Production renderer builds have no source maps. This does not create an installer.

## Run Tests

```powershell
npm test
```

The tests cover LaTeX diagnostic parsing (including wrapped log lines and warnings in included files), multi-file project analysis (comment stripping, root detection helpers, includes, labels, BibTeX entries, references), the structure-map parser and the project templates.

## Package The App

```powershell
npm run package        # Windows: NSIS installer + portable ZIP
npm run package:linux  # Linux: AppImage
npm run package:all    # both
```

Output in `release/`:

| File | Platform |
|------|----------|
| `Openotex-Setup-<version>.exe` | Windows installer (per-user, one click) |
| `Openotex-<version>-win-x64.zip` | Windows portable archive |
| `Openotex-<version>-x86_64.AppImage` | Linux x86_64 |

The Linux AppImage can be built on Windows; electron-builder downloads the AppImage tooling on first use. Because Windows file systems have no executable bit, users must `chmod +x` the downloaded AppImage (they have to do that after any browser download anyway).

## MCP server

`dist/mcp-server.js` is packaged inside the app. On every start, the app copies it to `<userData>/mcp/openotex-mcp.cjs` (for example `%APPDATA%\openotex\mcp\` on Windows) and Help → "Connect a Coding Agent (MCP)…" shows the matching client configuration. To try a development build:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"; .\node_modules\electron\dist\electron.exe dist\mcp-server.js
```

or simply `node dist/mcp-server.js`, then send MCP JSON-RPC messages on stdin. See [docs/MCP.md](docs/MCP.md).

## LaTeX Build Output

When `latexmk` is installed, Openotex writes LaTeX auxiliary files and compiled PDFs to:

```text
.openotex/build/<tex-file-name>/
```

This keeps `.aux`, `.log`, `.fls`, `.fdb_latexmk`, and SyncTeX files out of the document folder. The preview uses `<name>.view.pdf`, a copy of the last successful build, so a failed run never removes the PDF that is on screen. If `latexmk` is not installed, Openotex falls back to direct engine compilation (with BibTeX/Biber and MakeIndex passes) in the document folder.

Builds are incremental. A `compile.lock` file in the build folder lets the editor and the MCP server take turns when both compile the same document.
