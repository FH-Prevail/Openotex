import { clipboard, contextBridge, ipcRenderer } from 'electron';
import * as path from 'path';

// Simple validators reused in API wrappers
const isSafePackageName = (name: string) => /^[A-Za-z0-9._-]+$/.test(name);
const isAllowedEngine = (engine: string) => (
  engine === 'pdflatex' || engine === 'xelatex' || engine === 'lualatex'
);

// Expose a minimal, explicit API surface to the renderer
contextBridge.exposeInMainWorld('api', {
  // Files
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  readFileBase64: (filePath: string) => ipcRenderer.invoke('read-file-base64', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  pathExists: (targetPath: string) => ipcRenderer.invoke('path-exists', targetPath),
  saveZipFile: (opts: { defaultPath: string; data: string }) => ipcRenderer.invoke('save-zip-file', opts),
  savePdfAs: (opts: { sourcePath: string; defaultPath?: string }) => ipcRenderer.invoke('save-pdf-as', opts),
  createFile: (filePath: string) => ipcRenderer.invoke('create-file', filePath),
  deletePath: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  renamePath: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('create-directory', dirPath),
  copyPaths: (sources: string[], destination: string) => ipcRenderer.invoke('copy-paths', { sources, destination }),
  readBinaryFile: (filePath: string) => ipcRenderer.invoke('read-binary-file', filePath),
  watchPath: (projectRoot: string) => ipcRenderer.invoke('watch-path', projectRoot),
  unwatchPath: () => ipcRenderer.invoke('unwatch-path'),

  // Dialogs + system
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  getDefaultProjectsDirectory: () => ipcRenderer.invoke('get-default-projects-directory'),
  showInFileBrowser: (filePath: string) => ipcRenderer.invoke('show-in-file-browser', filePath),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openPath: (targetPath: string) => ipcRenderer.invoke('open-path', targetPath),
  showUnsavedDialog: (fileNames: string[]) => ipcRenderer.invoke('show-unsaved-dialog', { fileNames }),
  copyText: (text: string) => clipboard.writeText(String(text ?? '')),

  // Coding agents (MCP) and `Openotex --open <file>` requests
  getMcpSetup: () => ipcRenderer.invoke('get-mcp-setup'),
  takePendingOpenRequest: () => ipcRenderer.invoke('take-pending-open-request'),
  onOpenRequest: (listener: (request: { file: string; line?: number; project?: string; isDirectory?: boolean }) => void) => {
    const handler = (_event: any, request: any) => listener(request);
    ipcRenderer.on('open-request', handler);
    return () => ipcRenderer.removeListener('open-request', handler);
  },

  // Window close handshake (lets the renderer save unsaved work first)
  onCloseRequested: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('app-close-requested', handler);
    return () => ipcRenderer.removeListener('app-close-requested', handler);
  },
  acknowledgeClose: () => ipcRenderer.send('app-close-ack'),
  confirmClose: () => ipcRenderer.invoke('app-close-confirmed'),
  cancelClose: () => ipcRenderer.invoke('app-close-cancelled'),

  // LaTeX
  checkLatexInstallation: () => ipcRenderer.invoke('check-latex-installation'),
  checkPackageInstalled: (packageName: string) => ipcRenderer.invoke('check-package-installed', packageName),
  installLatexPackage: (packageName: string) => {
    if (!isSafePackageName(packageName)) {
      return Promise.resolve({ success: false, error: 'Invalid package name.' });
    }
    return ipcRenderer.invoke('install-latex-package', packageName);
  },
  openLatexDownload: () => ipcRenderer.invoke('open-latex-download'),
  compileLatex: (
    texFilePath: string,
    engine: 'pdflatex' | 'xelatex' | 'lualatex',
    options: { projectRoot?: string; force?: boolean } = {}
  ) => {
    if (!isAllowedEngine(engine)) {
      engine = 'pdflatex';
    }
    const safeOptions = {
      projectRoot: typeof options?.projectRoot === 'string' ? options.projectRoot : undefined,
      force: Boolean(options?.force),
    };
    return ipcRenderer.invoke('compile-latex', texFilePath, engine, safeOptions);
  },
  resolveRootDocument: (texFile: string, projectRoot?: string) =>
    ipcRenderer.invoke('resolve-root-document', { texFile, projectRoot }),
  collectLatexReferences: (projectRoot: string) =>
    ipcRenderer.invoke('collect-latex-references', { projectRoot }),
  onCompilationStatus: (listener: (status: { stage: string; message: string }) => void) => {
    const handler = (_event: any, status: any) => listener(status);
    ipcRenderer.on('compilation-status', handler);
    return () => ipcRenderer.removeListener('compilation-status', handler);
  },
  onFilesystemEvent: (listener: (payload: { event: string; path: string; root: string }) => void) => {
    const handler = (_event: any, payload: any) => listener(payload);
    ipcRenderer.on('filesystem-changed', handler);
    return () => ipcRenderer.removeListener('filesystem-changed', handler);
  },

  // SyncTeX forward/inverse search
  synctex: {
    forward: (texFile: string, line: number, column: number, pdfFile?: string, texRoot?: string) =>
      ipcRenderer.invoke('synctex-forward', { texFile, line, column, pdfFile, texRoot }),
    inverse: (pdfFile: string, page: number, h: number, v: number, texRoot?: string) =>
      ipcRenderer.invoke('synctex-inverse', { pdfFile, page, h, v, texRoot }),
  },

  // Git Terminal (git-only)
  gitTerminal: {
    start: (options: { cwd?: string } = {}) => ipcRenderer.invoke('git-terminal-start', options),
    stop: () => ipcRenderer.invoke('git-terminal-stop'),
    run: (command: string) => ipcRenderer.invoke('git-terminal-run', { command }),
    onData: (listener: (data: string) => void) => {
      const handler = (_event: any, data: string) => listener(data);
      ipcRenderer.on('git-terminal-data', handler);
      return () => ipcRenderer.removeListener('git-terminal-data', handler);
    },
    onExit: (listener: (code: number | null) => void) => {
      const handler = (_event: any, code: number | null) => listener(code);
      ipcRenderer.on('git-terminal-exit', handler);
      return () => ipcRenderer.removeListener('git-terminal-exit', handler);
    }
  },
  git: {
    status: (cwd: string) => ipcRenderer.invoke('git-status', { cwd }),
    commit: (payload: { cwd: string; message: string }) => ipcRenderer.invoke('git-commit', payload),
    pull: (cwd: string) => ipcRenderer.invoke('git-pull', { cwd }),
    push: (cwd: string) => ipcRenderer.invoke('git-push', { cwd }),
    init: (cwd: string) => ipcRenderer.invoke('git-init', { cwd }),
    check: () => ipcRenderer.invoke('git-check'),
  },

  // Minimal path helpers (Node path in preload)
  path: {
    basename: (p: string, ext?: string) => path.basename(p, ext),
    dirname: (p: string) => path.dirname(p),
    join: (...parts: string[]) => path.join(...parts),
    extname: (p: string) => path.extname(p),
    relative: (from: string, to: string) => path.relative(from, to),
    sep: path.sep,
  },
  platform: process.platform,
});

// Intentionally do NOT expose a global "require" to avoid clobbering
// Monaco's AMD loader or other libraries that rely on window.require.
// The renderer-facing type lives in src/types/preload.d.ts.
export {}; // ensure this is a module
