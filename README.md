# Openotex

<div align="center">

![Openotex Logo](assets/openotex-icon.png)

**A modern, open-source LaTeX editor for desktop**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-28.0.0-blue.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2.0-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue.svg)](https://www.typescriptlang.org/)

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Development](#development) • [Contributing](#contributing) • [License](#license)

</div>

---

## Overview

Openotex is a clean, modern LaTeX editor built with Electron, React, and TypeScript. It provides a powerful yet intuitive interface for creating and editing LaTeX documents with live preview, syntax highlighting, and advanced features like annotations and version control.

## Features

✨ **Core Features:**
- 📝 Live LaTeX preview with real-time compilation
- 🎨 Syntax highlighting and autocomplete powered by Monaco Editor
- 📁 Project-based file management with tree view
- 🔄 Auto-save and auto-compile functionality
- 📊 Structure map for easy document navigation
- 🖥️ Integrated terminal for LaTeX commands

🛠️ **Advanced Features:**
- ✍️ Annotations and comments with color-coded highlights
- 📌 Version freeze for creating document snapshots
- 🔧 Automatic LaTeX package installation (MiKTeX/TinyTeX)
- 🌓 Dark/Light theme support with system preference detection
- 💾 Session persistence (remembers open files and cursor positions)
- 🗜️ Export projects as ZIP archives
- 🔄 Automatic update checking

⚙️ **LaTeX Engines:**
- pdfLaTeX
- XeLaTeX
- LuaLaTeX

## Installation

### Download Installer (Recommended)

The easiest way to install Openotex is to download the installer from the official website:

**🌐 [openotex.com](https://openotex.com)**

**Currently available for:**
- ✅ Windows (`.exe` installer)

*macOS and Linux versions coming soon!*

### Building from Source

Want to run or build Openotex on your own computer? Follow these steps to build from source code.

#### Prerequisites

Before you begin, make sure you have these installed on your computer:

- **Node.js** (version 18 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js) or **yarn**
- **Git** - [Download here](https://git-scm.com/)
- **LaTeX distribution** - Required for compiling LaTeX documents:
  - Windows: [MiKTeX](https://miktex.org/download) or [TinyTeX](https://yihui.org/tinytex/)
  - macOS: [MacTeX](https://www.tug.org/mactex/) or [TinyTeX](https://yihui.org/tinytex/)
  - Linux: [TeX Live](https://www.tug.org/texlive/) or [TinyTeX](https://yihui.org/tinytex/)

#### Step-by-Step Build Instructions

**1. Clone the repository**

Open your terminal/command prompt and run:
```bash
git clone https://github.com/FH-Prevail/Openotex.git
cd Openotex
```

This downloads the source code to your computer.

**2. Install dependencies**

Install all required Node.js packages:
```bash
npm install
```

This will download and install all dependencies listed in `package.json`. It may take a few minutes.

**3. Run in development mode (recommended for testing)**

Start the development server with hot-reload:
```bash
npm run dev
```

This will:
- Start a webpack dev server on port 3000
- Launch Electron with the application
- Enable hot-reload (changes reflect immediately)

The application should open automatically. You can now test and modify the code!

**4. Build for production (create distributable app)**

To create a production build:
```bash
# Build the source code
npm run build

# Package the application for distribution
npm run package
```

This creates:
- `dist/` folder with compiled code
- `release/` folder with the installer for your platform (.exe for Windows, .dmg for macOS, etc.)

#### Available Scripts

- `npm run dev` - Start development server with hot-reload
- `npm run dev:renderer` - Start only the renderer webpack dev server
- `npm run dev:main` - Build main process in watch mode
- `npm run build` - Build for production
- `npm run build:main` - Build only the main process
- `npm run build:renderer` - Build only the renderer process
- `npm run package` - Create distributable packages

#### Troubleshooting

**"Command not found" errors:**
- Make sure Node.js and npm are properly installed: `node --version` and `npm --version`

**Port 3000 already in use:**
- Stop other applications using port 3000, or modify the port in `webpack.renderer.config.js`

**LaTeX compilation errors:**
- Ensure your LaTeX distribution is properly installed and in your system PATH
- Try running `pdflatex --version` to verify installation

**Build errors:**
- Delete `node_modules` folder and run `npm install` again
- Clear npm cache: `npm cache clean --force`

## Usage

### Getting Started

1. **Create a New Project:**
   - Click `File > New Project` or press `Ctrl+N`
   - Choose a project name and location
   - A basic LaTeX template will be created

2. **Open an Existing Project:**
   - Click `File > Open Project` or press `Ctrl+O`
   - Select your LaTeX project folder

3. **Edit and Compile:**
   - Edit your `.tex` files in the Monaco editor
   - Preview updates automatically with auto-compile enabled
   - Or manually compile with `Ctrl+Shift+C`

### Key Features

#### Annotations
- Select text and click the highlight button to add colored annotations
- Add comments to your highlights for collaborative work
- Annotations are saved in `.metadata` files alongside your LaTeX files

#### Version Freeze
- Create snapshots of your documents with `Ctrl+Shift+V`
- Versions are saved in `filename_timeline_` folders
- Useful for tracking document evolution or creating backups

#### Structure Map
- View document structure (sections, subsections, etc.)
- Click on any section to jump to it in the editor
- Toggle with the structure map button in the toolbar

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New Project |
| `Ctrl+O` | Open Project |
| `Ctrl+S` | Save Current File |
| `Ctrl+Shift+S` | Save All Files |
| `Ctrl+Shift+C` | Compile Document |
| `Ctrl+Shift+V` | Version Freeze |
| ``Ctrl+` `` | Toggle Terminal |
| `Ctrl+F` | Find |
| `Ctrl+H` | Find & Replace |

## Development

### Project Structure

```
Openotex/
├── src/
│   ├── main/              # Electron main process
│   ├── renderer/          # React renderer process
│   │   ├── components/    # React components
│   │   ├── styles/        # CSS stylesheets
│   │   └── App.tsx        # Main app component
│   └── types/             # TypeScript type definitions
├── assets/                # Application assets (icons, etc.)
├── webpack.main.config.js # Webpack config for main process
├── webpack.renderer.config.js # Webpack config for renderer
└── package.json
```

### Tech Stack

- **Framework:** Electron 28.0.0
- **UI Library:** React 18.2.0
- **Language:** TypeScript 5.3.3
- **Editor:** Monaco Editor 0.54.0
- **Build Tool:** Webpack 5
- **Bundler:** electron-builder

### Building

Development build:
```bash
npm run dev
```

Production build:
```bash
npm run build
```

Package for distribution:
```bash
npm run package
```

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run dev:renderer` - Start renderer webpack dev server
- `npm run dev:main` - Build main process in watch mode
- `npm run dev:electron` - Start Electron in development mode
- `npm run build` - Build for production
- `npm run build:main` - Build main process
- `npm run build:renderer` - Build renderer process
- `npm run package` - Create distributable packages

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
- Icons from [React Icons](https://react-icons.github.io/react-icons/)

## Support

- **Website:** [openotex.com](https://openotex.com)
- **Issues:** [GitHub Issues](https://github.com/FH-Prevail/Openotex/issues)
- **Documentation:** [Wiki](https://github.com/FH-Prevail/Openotex/wiki)

## Disclaimer

This application is **free to use** and comes with **no warranty**. The software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement.

---

<div align="center">

**Made with ❤️ by the Openotex Team**

© 2025 Openotex Team

</div>
