# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.1] - 2026-10-26 — Steyr Edition

### Added
- Linux distributions' TeX Live (Debian/Ubuntu, Fedora, openSUSE, Arch) is recognized. For a missing package Openotex names the system package that contains the file (for example `lmodern`, `texlive-latex-extra`, `texlive-science`, `tex(siunitx.sty)`) and installs it after the system's password prompt, or shows the command to copy.
- The "LaTeX not found" screen shows the install command for the detected Linux distribution.
- The compile error panel explains how to install a missing package or font, with a copy button and an "Install missing packages…" button.
- MCP: `get_latex_environment` reports the `package_manager`; a failed `compile_document` includes an `install_hint`.

### Changed
- The Linux AppImage adds `--no-sandbox` by itself only where Chromium's sandbox cannot work (Ubuntu 24.04+ AppArmor restriction, user namespaces disabled, running as root); everywhere else the sandbox stays on.
- Project templates load the T1/Latin Modern fonts only when they are installed, so new projects also compile where `lmodern` is missing (for example Ubuntu's TeX Live without recommended packages).
- "Install All" installs all missing packages in one step (one password prompt), then recompiles. A closed install dialog no longer reopens on every auto-compile for the same packages.
- Packages whose name differs from the file are installed under the right name (`tikz` → `pgf`, `lmodern` → `lm`, `IEEEtran.cls` → `ieeetran`, …); tlmgr looks up the others.

### Fixed
- Linux with distribution TeX Live: a missing package or font ended in "tlmgr: user mode not initialized" (tlmgr is disabled there), so no PDF preview appeared.
- Missing document classes (`.cls`) were not recognized as missing packages.
- tlmgr could not be started on Windows (it is a batch file).
- MiKTeX packages are installed with `miktex packages install` (`mpm --install` is deprecated and reported unknown packages as installed).
- Automatic package installs opened an "Installing Dependencies" dialog that blocked the editor until it was dismissed; progress now shows in the preview status line.

## [1.6.0] - 2026-10-26 — Steyr Edition

### Added
- Linux x86_64 AppImage and a portable Windows ZIP next to the Windows installer.
- MCP server for coding agents (Claude Code, Claude Desktop, Cursor, VS Code, Codex): `compile_document`, `check_references`, `get_document_outline`, `find_root_document`, `list_labels_and_citations`, `source_to_pdf`, `pdf_to_source`, `open_in_openotex`, `get_latex_environment`. Help → "Connect a Coding Agent (MCP)…" shows ready-to-copy settings. See `docs/MCP.md`.
- `Openotex --open=<file> [--line=N] [--project=<folder>]` opens a file in the running window.
- Multi-file projects: compiling a chapter builds the main document that `\input`/`\include`/`\subfile`/`\import`-s it; `% !TEX root = …` is supported.
- Autocomplete for `\ref`-style labels and `\cite` keys from the whole project, `\begin{…}` environments with the matching `\end`, and a larger command list.
- LaTeX language settings: `Ctrl+/` toggles `%` comments, bracket matching and auto-closing; BibTeX highlighting.
- Unsaved-change tracking: dot on modified tabs, unsaved counter, Save/Don't Save/Cancel prompts before closing tabs, switching projects or quitting.
- Open files reload automatically when they change outside Openotex (git pull, other editors, coding agents) and recompile with Auto Compile.
- PDF preview: sharp rendering on high-DPI screens, lazy page rendering for long documents, flicker-free refresh, fit-to-width, Ctrl+wheel zoom (25–400%, remembered), "open in system viewer", Export PDF with a save dialog and the document's name.
- Warnings panel under the PDF (undefined references and citations, attributed to the right sub-file) with click-to-jump.
- New project templates: Article (with bibliography), Report/Thesis (chapters in separate files), Beamer presentation, Blank.
- Window size, position and maximized state are remembered; a second launch focuses the running window.
- Git panel shows the current branch.

### Changed
- Auto Save writes 0.7 s after typing pauses instead of on every keystroke; writes to a file are serialized.
- latexmk builds are incremental; a full rebuild runs only when needed or when "Recompile" is pressed.
- With Auto Save off, the document compiles when it is saved; Compile saves first.
- Saving shows a status-bar message instead of a dialog.
- Compiled PDFs used for preview, export and SyncTeX survive failed compilations.
- The `.git` and `.openotex` folders are hidden from the file tree and excluded from ZIP exports.
- The installer is smaller: libraries are only bundled once and source maps are no longer shipped.

### Fixed
- The renderer bundle was loaded twice, running two copies of the app (duplicate update prompts, compiles and file watchers, lost sessions).
- Undo after switching tabs could restore another file's text into the current file (each file now has its own editor model and undo history).
- "New File" emptied an existing file of the same name; "Rename" overwrote existing files; "New Project" overwrote `main.tex` in existing folders.
- Opening PDFs, images or archives as text could corrupt them on save; binary files now open in the system viewer.
- Renaming or deleting an open file left a stale tab that recreated the file on the next save.
- The session file could be deleted at startup, losing the previously open tabs.
- BibTeX/Biber could not find `.bib` files with latexmk when Perl reported Unix-style paths (e.g. MSYS/Git Perl on Windows).
- When latexmk stopped in BibTeX after a LaTeX error, the real error is now shown from the LaTeX log; wrapped log lines and warnings in included files are parsed correctly.
- Cancelled compilations left `pdflatex`/`perl` processes running and holding files; the whole process tree is stopped now. Console windows no longer flash on Windows.
- Editor snippets inserted literal `\n` and single backslashes; command completion doubled the backslash; Ctrl+/ did nothing in `.tex` files.
- The file tree collapsed on every save; folders now stay expanded.
- Links in the Markdown preview and files dropped outside the tree no longer replace the application window.
- Ctrl+N and Ctrl+O did nothing although shown in the menu.
- The Git terminal kept using the first project's folder after switching projects; git commands no longer wait for credential prompts.
- Long error messages pushed the preview controls off-screen.
- Instant Backup file names repeated the extension (`main.tex_backup_….tex`).
- The About dialog violated React's hook rules.
- TeX installations in standard MiKTeX, TeX Live, MacTeX and TinyTeX folders are found even when the desktop session's PATH does not include them (important for AppImages).

### Removed
- Unused dependencies (`latex.js`, `mathjax-full`, `html2pdf.js`, `react-pdf`, `react-resizable-panels`).

## [1.5.0] - 2026-04-28

### Added
- Zlin Edition release label.
- Right-click editor command to highlight the matching compiled PDF location with SyncTeX.
- Structured LaTeX diagnostics and clickable source locations.
- LaTeX diagnostic parser tests.

### Changed
- Improved LaTeX compilation through `latexmk` when available.
- Isolated `latexmk` build artifacts under `.openotex/build/`.
- Improved SyncTeX forward search accuracy by using the displayed PDF path and live Monaco cursor.

## [1.0.2] - 2025-02-XX

### Changed
- Updated version to 1.0.2
- Improved .gitignore configuration

### Security
- Cleaned up unnecessary backup files
- Enhanced build artifact exclusion

## [1.0.0] - 2025-01-XX

### Added
- Initial release of Openotex
- Live LaTeX preview with real-time compilation
- Syntax highlighting and autocomplete powered by Monaco Editor
- Project-based file management with tree view
- Auto-save and auto-compile functionality
- Structure map for easy document navigation
- Integrated terminal for LaTeX commands
- Annotations and comments with color-coded highlights
- Version freeze for creating document snapshots
- Automatic LaTeX package installation (MiKTeX/TinyTeX)
- Dark/Light theme support with system preference detection
- Session persistence (remembers open files and cursor positions)
- Export projects as ZIP archives
- Automatic update checking with user preference
- Support for pdfLaTeX, XeLaTeX, and LuaLaTeX engines
- Keyboard shortcuts for common operations
- About dialog with version information
- New project wizard with LaTeX templates

### Features
- **Editor**: Monaco Editor with full LaTeX syntax support
- **Preview**: Real-time LaTeX compilation and PDF preview
- **File Management**: Tree view, tabs, and session restoration
- **Annotations**: Highlight text with colors and comments
- **Version Control**: Create snapshots with version freeze
- **Terminal**: Integrated terminal for running LaTeX commands
- **Themes**: System-aware dark/light mode
- **Package Manager**: Automatic detection and installation of missing packages
- **Update Checker**: Automatic and manual update checking

### Technical
- Built with Electron 28.0.0
- React 18.2.0 for UI
- TypeScript 5.3.3 for type safety
- Monaco Editor 0.54.0
- Webpack 5 for bundling
- electron-builder for packaging

## [Unreleased]

### Planned Features
- Spell checking
- Git integration
- Collaborative editing
- Cloud sync
- More LaTeX templates
- Custom snippet support
- Advanced find and replace with regex
- Bibliography management
- PDF export options

---

## Version History

### Version Numbering
We use [Semantic Versioning](https://semver.org/):
- MAJOR version for incompatible API changes
- MINOR version for added functionality in a backwards compatible manner
- PATCH version for backwards compatible bug fixes

### Types of Changes
- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** in case of vulnerabilities
