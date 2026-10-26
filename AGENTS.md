# Agent operations guide — Openotex desktop app

These instructions apply to this repository (`GitHub/Openotex_github/Openotex`),
the maintained source of the Openotex Electron desktop application.

Current release: **1.6.1 (Steyr Edition)**, 2026-10-26.

## Project boundary

- This repository is the desktop app. Its `dist/` folder is Electron/Webpack
  output and is **not** the public website. Never copy it to the web server.
- The website source for `https://openotex.com/` is
  `../../openotex_website` (i.e. `GitHub/openotex_website`). Its own
  `AGENTS.md` describes validation, deployment and rollback.
- `GitHub/Openotex` (no `_github`) is an older copy of the app; do not develop
  there.

## Layout

- `src/main/main.ts` — Electron main process: windows, IPC, files, Git, close
  handshake, `--open=<file>` requests, MCP script installation.
- `src/main/latexService.ts` — LaTeX compilation (latexmk or direct engine +
  BibTeX/Biber/MakeIndex), root-document detection, references, SyncTeX,
  TeX PATH discovery, per-document build lock. **No Electron imports**: the MCP
  server bundles it.
- `src/mcp/server.ts` — MCP server (stdio JSON-RPC, no dependencies).
- `src/shared/` — pure helpers (diagnostics parser, LaTeX project analysis,
  version). Covered by `npm test`.
- `src/renderer/` — React UI. `App.tsx` owns tabs, saving/dirty tracking,
  sessions; `Editor.tsx` (Monaco, one model per file), `Preview.tsx` (pdf.js,
  lazy HiDPI rendering).

## Version bumps

Update `package.json` (`version`) and `src/shared/appInfo.ts`
(`APP_VERSION`, `APP_EDITION`). Everything else (About dialog, update check,
window title, MCP server info) reads `appInfo.ts`. Also update `README.md` and
`CHANGELOG.md`.

## Build, test, package

```powershell
npm ci
npm test               # unit tests (tsc + node)
npm run build          # cleans dist/, builds main, renderer, preload, mcp
npm run package        # Windows: release/Openotex-Setup-<v>.exe + Openotex-<v>-win-x64.zip
npm run package:linux  # Linux: release/Openotex-<v>-x86_64.AppImage (Linux/WSL/container only)
```

- The AppImage needs Linux tools (mksquashfs); on Windows build it in a
  `node:20-bookworm-slim` container (see BUILDING.md). The `afterPack` hook
  `scripts/linux-after-pack.js` renames the binary to `openotex.bin` and
  installs the `openotex` launcher that adds `--no-sandbox` only where the
  Chromium sandbox cannot work. Keep it when changing the Linux target.
- LaTeX package installs go through `src/shared/texPackages.ts` (which
  package contains a file, per package manager) and `detectTexSetup` /
  `installLatexPackages` in `src/main/latexService.ts`. Distribution TeX
  (pdflatex in /usr/bin) is never touched without the user: no tlmgr, and
  pkexec only after the user clicks Install.

- If `ELECTRON_RUN_AS_NODE=1` is set in your shell (VS Code terminals and
  agent sessions often set it), Electron runs as plain Node and the app
  crashes with "Cannot read properties of undefined (reading
  'requestSingleInstanceLock')". Unset it before launching Electron or
  electron-builder.
- All libraries are devDependencies; webpack bundles them. Keep it that way so
  `app.asar` stays small.
- `src/renderer/index.html` must not contain a `<script src="renderer.js">`;
  HtmlWebpackPlugin injects it. A second tag runs the whole app twice.

## Manual verification

There is no GUI test suite in the repo. Drive the built app with Playwright's
Electron support (`_electron.launch` with `executablePath` =
`node_modules/electron/dist/electron.exe`, `args` = [repo, `--user-data-dir=<temp>`],
and `ELECTRON_RUN_AS_NODE` removed from `env`). Always use a temporary
user-data dir and project folder; a fresh profile otherwise opens the user's
Documents folder.

## MCP server

`dist/mcp-server.js` is copied on startup to `<userData>/mcp/openotex-mcp.cjs`
(`%APPDATA%\openotex\mcp\` on Windows). Clients run it with the Openotex
executable and `ELECTRON_RUN_AS_NODE=1`. Help → "Connect a Coding Agent
(MCP)…" generates client settings. Details: `docs/MCP.md`.

## Publishing a release on the website

1. Package Windows and Linux builds (above) and record size + SHA-256 of all
   three files.
2. Copy them into `../../openotex_website/public/downloads/` and update the
   download section, `version.json`, checks and tests there.
3. Follow the website `AGENTS.md` for validation and deployment to the
   `neurogenou` host (versioned release directory, backup, atomic `current`
   switch, verification).

Never store SSH keys, passphrases, signing credentials or tokens in this
repository.
