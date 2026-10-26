# Openotex

<div align="center">

![Openotex Logo](assets/openotex-icon.png)

**A modern, open-source LaTeX editor for desktop**

Version 1.6.1 (Steyr Edition)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-28-blue.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)

[Features](#features) • [Installation](#installation) • [Coding agents (MCP)](#use-openotex-from-a-coding-agent-mcp) • [Usage](#usage) • [Development](#development) • [Contributing](#contributing) • [License](#license)

</div>

---

## Overview

Openotex is a clean, modern LaTeX editor built with Electron, React, and TypeScript. It provides a powerful yet intuitive interface for creating and editing LaTeX documents with live preview, syntax highlighting, and advanced features like annotations, Git integration, and a built-in server for AI coding agents.

## Features

✨ **Core Features:**
- 📝 Live PDF preview with SyncTeX navigation in both directions
- 📚 Multi-file projects: compiling a chapter builds its main document (`% !TEX root` supported)
- 🎨 Syntax highlighting and autocomplete for commands, environments, `\ref` labels and `\cite` keys
- 📁 Project-based file management with tree view
- 🔄 Auto-save, auto-compile and incremental `latexmk` builds
- ⚠️ Clickable errors and warnings that open the right file and line
- 📊 Structure map for easy document navigation
- 🖥️ Git panel and Git terminal

🛠️ **Advanced Features:**
- 🤖 MCP server so Claude Code, Claude Desktop, Cursor, VS Code or Codex can compile, check and open your documents
- 🛡️ Unsaved-change protection, per-tab undo history, and reload of files changed outside Openotex
- ✍️ Annotations and comments with color-coded highlights
- 📌 Instant Backup snapshots of a file
- 🔧 Automatic LaTeX package installation (MiKTeX / TeX Live)
- 🧩 New-project templates (article, report/thesis, Beamer presentation, blank)
- 🌓 Dark/Light theme support with system preference detection
- 💾 Session and window persistence
- 🗜️ Export projects as ZIP archives
- 🔄 Automatic update checking

⚙️ **LaTeX Engines:**
- pdfLaTeX
- XeLaTeX
- LuaLaTeX

## Installation

### Download (Recommended)

Download Openotex from the official website:

**🌐 [openotex.com](https://openotex.com/#download)**

| Platform | Package | Notes |
|----------|---------|-------|
| Windows 10/11 (x64) | `Openotex-Setup-1.6.1.exe` | Installer with Start menu entry |
| Windows 10/11 (x64) | `Openotex-1.6.1-win-x64.zip` | Portable: extract and run `Openotex.exe` |
| Linux (x86_64) | `Openotex-1.6.1-x86_64.AppImage` | Single file, no installation |

**Linux AppImage:**

```bash
chmod +x Openotex-1.6.1-x86_64.AppImage
./Openotex-1.6.1-x86_64.AppImage
```

On systems that restrict unprivileged user namespaces (Ubuntu 24.04 and newer) or when started as root, the AppImage turns off the Chromium sandbox by itself. Some systems need FUSE 2 to run AppImages (`sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` on older releases).

A LaTeX distribution is required: MiKTeX or TeX Live on Windows, TeX Live on Linux, MacTeX on macOS. `latexmk` is recommended. On Debian/Ubuntu a good start is `sudo apt install texlive-latex-extra texlive-fonts-recommended lmodern cm-super latexmk` (`texlive-full` has everything). When a document needs a package that is missing, Openotex names the distribution package that contains it and can install it for you (it asks for your password).

### Building from Source

Want to run or build Openotex on your own computer? Follow these steps to build from source code.

For the complete build, test, packaging, and LaTeX output notes, see [BUILDING.md](BUILDING.md).

#### Prerequisites

Before you begin, make sure you have these installed on your computer:

- **Node.js** (version 20 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Git** - [Download here](https://git-scm.com/)
- **LaTeX distribution** - Required for compiling LaTeX documents:
  - Windows: [MiKTeX](https://miktex.org/download) or [TinyTeX](https://yihui.org/tinytex/)
  - macOS: [MacTeX](https://www.tug.org/mactex/) or [TinyTeX](https://yihui.org/tinytex/)
  - Linux: [TeX Live](https://www.tug.org/texlive/) or [TinyTeX](https://yihui.org/tinytex/)

#### Step-by-Step Build Instructions

**1. Clone the repository**

```bash
git clone https://github.com/FH-Prevail/Openotex.git
cd Openotex
```

**2. Install dependencies**

```bash
npm install
```

**3. Run in development mode**

```bash
npm run dev
```

This starts a webpack dev server on port 3000 and launches Electron with hot reload.

**4. Build for production**

```bash
npm run build           # compile main, renderer, preload and MCP server into dist/
npm run package         # Windows installer + portable ZIP in release/
npm run package:linux   # Linux AppImage in release/ (see BUILDING.md)
```

#### Available Scripts

- `npm run dev` - Start development server with hot-reload
- `npm run build` - Clean `dist/` and build for production
- `npm run build:main` / `build:renderer` / `build:preload` / `build:mcp` - Build one part
- `npm test` - Run the LaTeX diagnostics and project-analysis tests
- `npm run package` / `package:win` - Windows installer and ZIP
- `npm run package:linux` - Linux AppImage
- `npm run package:all` - Windows and Linux packages

#### Troubleshooting

**"Command not found" errors:**
- Make sure Node.js and npm are properly installed: `node --version` and `npm --version`

**Port 3000 already in use:**
- Stop other applications using port 3000, or modify the port in `webpack.renderer.config.js`

**LaTeX compilation errors:**
- Ensure your LaTeX distribution is installed. Openotex also looks in the standard MiKTeX, TeX Live, MacTeX and TinyTeX folders, so a fresh install is usually found without a restart (use "check again" in the preview).
- Try running `pdflatex --version` to verify installation

**Build errors:**
- Delete `node_modules` folder and run `npm install` again
- Clear npm cache: `npm cache clean --force`

## Use Openotex from a coding agent (MCP)

Openotex ships a [Model Context Protocol](https://modelcontextprotocol.io) server. Connect it to your AI coding agent and the agent can compile your document, read the errors with file and line, check references, and show files in the Openotex window while you watch the PDF update.

1. Start Openotex once (it installs the server script).
2. Open **Help → Connect a Coding Agent (MCP)…**.
3. Copy the ready-made setup for **Claude Code**, **Claude Desktop / Cursor**, **VS Code** or **Codex CLI**.

For Claude Code the command looks like this (paths are filled in for your computer):

```bash
claude mcp add --transport stdio --scope user openotex --env ELECTRON_RUN_AS_NODE=1 --env "OPENOTEX_APP=C:\Users\you\AppData\Local\Programs\Openotex\Openotex.exe" -- "C:\Users\you\AppData\Local\Programs\Openotex\Openotex.exe" "C:\Users\you\AppData\Roaming\openotex\mcp\openotex-mcp.cjs"
```

The Openotex executable runs the server itself (`ELECTRON_RUN_AS_NODE=1`), so no separate Node.js is needed. Tools: `compile_document`, `check_references`, `get_document_outline`, `find_root_document`, `list_labels_and_citations`, `source_to_pdf`, `pdf_to_source`, `open_in_openotex`, `get_latex_environment`. See [docs/MCP.md](docs/MCP.md) for details.

## Usage

### Getting Started

1. **Create a New Project:**
   - Click `File > New Project` or press `Ctrl+N`
   - Choose a name, a template (Article, Report/Thesis, Presentation, Blank) and a location
   - Openotex never writes a template into a folder that already contains files

2. **Open an Existing Project:**
   - Click `File > Open Project` or press `Ctrl+O`
   - Select your LaTeX project folder

3. **Edit and Compile:**
   - Edit your `.tex` files in the Monaco editor
   - With Auto Save on, the PDF updates about 2.5 seconds after you stop typing
   - With Auto Save off, the document compiles when you save; `Ctrl+Shift+C` saves and compiles

### Key Features

#### Multi-file projects
- Split documents with `\input`, `\include`, `\subfile` or `\import`
- Compiling a chapter file builds the main document that includes it
- Override the main file with `% !TEX root = main.tex` at the top of a chapter

#### Annotations
- Select text and click the highlight button to add colored annotations
- Add comments to your highlights for collaborative work
- Annotations are saved in `.metadata` files alongside your LaTeX files

#### Instant Backup
- Create a snapshot of the current file with `Ctrl+Shift+V`
- Snapshots are saved in a `<file>_backups_` folder next to the file

#### Structure Map
- View document structure (parts, chapters, sections, subsections)
- Click on any section to jump to it in the editor
- Toggle with the structure map button in the toolbar

#### Build output
- With `latexmk`, auxiliary files and the PDF are written to `.openotex/build/<document>/`; use **Export PDF** to save a copy anywhere

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New Project |
| `Ctrl+O` | Open Project |
| `Ctrl+S` | Save Current File |
| `Ctrl+Shift+S` | Save All Files |
| `Ctrl+Shift+C` | Compile Document |
| `Ctrl+Shift+V` | Instant Backup |
| `Ctrl+/` | Toggle Line Comment |
| `Ctrl+Alt+J` | Show the cursor position in the PDF |
| `Ctrl+Click` on the PDF | Jump to the source line |
| `Ctrl+Wheel` on the PDF | Zoom the preview |
| ``Ctrl+` `` | Toggle Git Terminal |
| `Ctrl+F` | Find |
| `Ctrl+H` | Find & Replace |

## Development

### Project Structure

```
Openotex/
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.ts        # Windows, IPC, file system, Git
│   │   ├── latexService.ts # LaTeX compilation, root detection, SyncTeX (no Electron)
│   │   └── preload.ts     # Renderer API bridge
│   ├── mcp/server.ts      # MCP server for coding agents (stdio)
│   ├── shared/            # Pure helpers shared by main, renderer, MCP and tests
│   ├── renderer/          # React renderer process
│   │   ├── components/    # React components
│   │   ├── styles/        # CSS stylesheets
│   │   └── App.tsx        # Main app component
│   └── types/             # TypeScript type definitions
├── tests/                 # Unit tests (npm test)
├── assets/                # Application assets (icons, etc.)
├── webpack.*.config.js    # Webpack configs (main, renderer, preload, mcp)
└── package.json
```

### Tech Stack

- **Framework:** Electron 28
- **UI Library:** React 18
- **Language:** TypeScript 5
- **Editor:** Monaco Editor 0.54
- **PDF rendering:** pdf.js 3
- **Build Tool:** Webpack 5
- **Packaging:** electron-builder (NSIS, ZIP, AppImage)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Start for Contributors

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Editor powered by [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- PDF rendering by [pdf.js](https://mozilla.github.io/pdf.js/)
- Icons from [React Icons](https://react-icons.github.io/react-icons/)

## Support

- **Website:** [openotex.com](https://openotex.com)
- **Issues:** [GitHub Issues](https://github.com/FH-Prevail/Openotex/issues)

## Disclaimer

This application is **free to use** and comes with **no warranty**. The software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement.

---

<div align="center">

**Made with ❤️ by the Openotex Team**

© 2026 Openotex Team

</div>
