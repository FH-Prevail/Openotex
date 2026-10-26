# Openotex MCP server

Openotex 1.6.0 and later include a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets AI coding agents work on LaTeX projects with the same compiler pipeline as the editor: they can compile, read structured errors, check references, map PDF pages to source lines, and open files in the Openotex window.

The server speaks MCP over **stdio** (newline-delimited JSON-RPC, protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`). It has no dependencies and runs on any Node.js 18+, including the Node.js built into the Openotex executable.

## Connect an agent

The simplest way: open **Help → Connect a Coding Agent (MCP)…** in Openotex and copy the snippet for your client. The dialog fills in the correct paths for your installation.

Openotex copies the server to a stable location every time it starts:

| Platform | Server script |
|----------|---------------|
| Windows | `%APPDATA%\openotex\mcp\openotex-mcp.cjs` |
| Linux | `~/.config/openotex/mcp/openotex-mcp.cjs` |
| macOS | `~/Library/Application Support/openotex/mcp/openotex-mcp.cjs` |

The command is the Openotex executable with `ELECTRON_RUN_AS_NODE=1`, so no separate Node.js installation is needed. For the Linux AppImage the command is the `.AppImage` file itself.

### Claude Code

```bash
claude mcp add --transport stdio --scope user openotex \
  --env ELECTRON_RUN_AS_NODE=1 \
  --env OPENOTEX_APP=/home/you/Applications/Openotex-1.6.1-x86_64.AppImage \
  -- /home/you/Applications/Openotex-1.6.1-x86_64.AppImage /home/you/.config/openotex/mcp/openotex-mcp.cjs
```

### Claude Desktop, Cursor and other `mcpServers` clients

```json
{
  "mcpServers": {
    "openotex": {
      "command": "C:\\Users\\you\\AppData\\Local\\Programs\\Openotex\\Openotex.exe",
      "args": ["C:\\Users\\you\\AppData\\Roaming\\openotex\\mcp\\openotex-mcp.cjs"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "OPENOTEX_APP": "C:\\Users\\you\\AppData\\Local\\Programs\\Openotex\\Openotex.exe"
      }
    }
  }
}
```

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "openotex": {
      "type": "stdio",
      "command": "C:\\Users\\you\\AppData\\Local\\Programs\\Openotex\\Openotex.exe",
      "args": ["C:\\Users\\you\\AppData\\Roaming\\openotex\\mcp\\openotex-mcp.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

### Plain Node.js

If you prefer your own Node.js: `node /path/to/openotex-mcp.cjs`. Set `OPENOTEX_APP` to the Openotex executable if you want `open_in_openotex` to work.

## Tools

All paths may be absolute or relative to `project_root`, which defaults to the server's working directory (agents usually start servers in the project folder). Results are JSON in both `content` and `structuredContent`.

| Tool | Purpose |
|------|---------|
| `get_latex_environment` | Distribution (MiKTeX/TeX Live), `package_manager` (`miktex`/`tlmgr` install missing packages automatically; `tlmgr-root`, `apt`, `dnf`, `zypper`, `pacman` need the user), versions of pdfLaTeX, XeLaTeX, LuaLaTeX, latexmk, BibTeX, Biber, SyncTeX |
| `find_root_document` | Main document for a `.tex` file (`% !TEX root`, `\documentclass`, or the file that includes it) |
| `compile_document` | Compile (latexmk when available, with BibTeX/Biber and reruns). Returns `success`, `pdf`, `errors` and `warnings` with file and line, and a `log_tail` on failure. When a package is missing and needs administrator rights to install, `install_hint` has the command for the user. Sends progress notifications when the client provides a progress token |
| `get_document_outline` | Parts, chapters, sections and subsections in reading order across `\input`/`\include` |
| `list_labels_and_citations` | Every `\label` (file, line) and every `.bib` entry (key, type, title) |
| `check_references` | Without compiling: undefined `\ref` keys, `\cite` keys missing from `.bib`/`\bibitem`, duplicate labels |
| `source_to_pdf` | SyncTeX forward search: page and position of a source line |
| `pdf_to_source` | SyncTeX inverse search: source file and line for a page position (PDF points from the top-left) |
| `open_in_openotex` | Show a file at a line in the Openotex window (starts Openotex if needed) |

## How it works with the editor

- Agents edit files with their own tools. Openotex reloads open files that change on disk (unless they have unsaved edits) and recompiles with Auto Compile.
- The editor and the server share one build folder per document (`.openotex/build/<name>/`) and take turns through a lock file, so simultaneous compiles do not corrupt each other.
- `open_in_openotex` starts `Openotex --open=<file> --line=<n> --project=<folder>`. When Openotex is already running, the window switches to that file (asking about unsaved changes before changing projects).

## Environment variables

| Variable | Meaning |
|----------|---------|
| `ELECTRON_RUN_AS_NODE=1` | Required when the Openotex executable runs the server |
| `OPENOTEX_APP` | Executable used by `open_in_openotex` (defaults to the running Openotex executable or `$APPIMAGE`) |
| `OPENOTEX_APP_ARGS` | JSON array of extra arguments for that executable (used in development) |

The server writes diagnostics to stderr only; stdout carries protocol messages.
