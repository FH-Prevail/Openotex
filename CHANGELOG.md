# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
