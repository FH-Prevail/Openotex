import { contextBridge, ipcRenderer } from 'electron';
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
  saveZipFile: (opts: { defaultPath: string; data: string }) => ipcRenderer.invoke('save-zip-file', opts),
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
  compileLatex: (texFilePath: string, engine: 'pdflatex' | 'xelatex' | 'lualatex') => {
    if (!isAllowedEngine(engine)) {
      engine = 'pdflatex';
    }
    return ipcRenderer.invoke('compile-latex', texFilePath, engine);
  },
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
    basename: (p: string) => path.basename(p),
    dirname: (p: string) => path.dirname(p),
    join: (...parts: string[]) => path.join(...parts),
    extname: (p: string) => path.extname(p)
  }
});

// Intentionally do NOT expose a global "require" to avoid clobbering
// Monaco's AMD loader or other libraries that rely on window.require.
