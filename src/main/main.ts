import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItemConstructorOptions, screen } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import chokidar, { FSWatcher } from 'chokidar';
import { APP_EDITION } from '../shared/appInfo';
import {
  augmentPathWithTexDistributions,
  cancelProcessToken,
  collectLatexReferences,
  compileLatexDocument,
  CompileOptions,
  detectSystemPackageManager,
  detectTexSetup,
  execFileAsync,
  installLatexPackages,
  isLatexmkAvailable,
  isMac,
  isWindows,
  latexInstallSuggestion,
  LatexEngine,
  normalizeForCompare,
  pathExists,
  planTexPackageInstall,
  ProcessCancelToken,
  resetToolProbeCache,
  resolveRootDocument,
  samePath,
  synctexForward,
  synctexInverse,
} from './latexService';

let mainWindow: BrowserWindow | null = null;
const gitCmd = isWindows ? 'git.exe' : 'git';
// Git commands must never block waiting for a terminal prompt nobody can answer.
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0' });
// Git-only terminal sessions (stores running process and cwd per sender)
const gitTerminalSessions = new Map<number, { cwd: string; proc: ChildProcessWithoutNullStreams | null }>();
const fileWatchers = new Map<number, { watcher: FSWatcher; root: string }>();
const latexCompileSessions = new Map<number, ProcessCancelToken>();

// Close handshake: the renderer gets a chance to save or confirm unsaved work.
let isQuitting = false;
let rendererCloseConfirmed = false;
let closeWatchdog: NodeJS.Timeout | null = null;

const buildUniqueDestination = async (destinationDir: string, baseName: string): Promise<string> => {
  let candidate = path.join(destinationDir, baseName);
  if (!(await pathExists(candidate))) {
    return candidate;
  }
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let index = 1;
  do {
    candidate = path.join(destinationDir, `${stem} (${index})${ext}`);
    index += 1;
  } while (await pathExists(candidate));
  return candidate;
};

// Writes to the same file are serialized so that a slow earlier write can
// never land after (and overwrite) a newer one.
const writeQueues = new Map<string, Promise<unknown>>();
const queueFileWrite = <T>(filePath: string, task: () => Promise<T>): Promise<T> => {
  const key = normalizeForCompare(filePath);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  writeQueues.set(key, next);
  const cleanup = () => {
    if (writeQueues.get(key) === next) {
      writeQueues.delete(key);
    }
  };
  next.then(cleanup, cleanup);
  return next;
};

// Text files never contain NUL bytes in their first few kilobytes; PDFs,
// images and archives almost always do.
const looksBinary = (buffer: Buffer): boolean => {
  const length = Math.min(buffer.length, 8000);
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
};

const runGit = async (args: string[], cwd: string) => {
  return execFileAsync(gitCmd, args, { cwd, env: gitEnv() });
};

const splitCommandLine = (input: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  for (const char of input.trim()) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (char === '\\' && !inSingle) {
      escapeNext = true;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (/\s/.test(char) && !inSingle && !inDouble) {
      pushCurrent();
      continue;
    }
    current += char;
  }

  pushCurrent();
  return tokens;
};

const stopWatcherForSender = (senderId: number) => {
  const existing = fileWatchers.get(senderId);
  if (!existing) {
    return;
  }
  fileWatchers.delete(senderId);
  try {
    void existing.watcher.close();
  } catch (error) {
    console.warn('Error closing file watcher:', error);
  }
};

const buildApplicationMenu = () => {
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    const appSubmenu: MenuItemConstructorOptions[] = [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ];

    template.push({
      label: app.name,
      submenu: appSubmenu,
    });
  }

  const fileSubmenu: MenuItemConstructorOptions[] = [];
  if (isMac) {
    fileSubmenu.push({ role: 'close' });
  } else {
    fileSubmenu.push({ role: 'quit' });
  }

  template.push({
    label: 'File',
    submenu: fileSubmenu,
  });

  const editSubmenu: MenuItemConstructorOptions[] = [];
  editSubmenu.push({ role: 'undo' });
  editSubmenu.push({ role: 'redo' });
  editSubmenu.push({ type: 'separator' });
  editSubmenu.push({ role: 'cut' });
  editSubmenu.push({ role: 'copy' });
  editSubmenu.push({ role: 'paste' });
  if (isMac) {
    editSubmenu.push({ role: 'pasteAndMatchStyle' });
  }
  editSubmenu.push({ role: 'delete' });
  editSubmenu.push({ role: 'selectAll' });

  template.push({
    label: 'Edit',
    submenu: editSubmenu,
  });

  const viewSubmenu: MenuItemConstructorOptions[] = [];
  viewSubmenu.push({ role: 'resetZoom' });
  viewSubmenu.push({ role: 'zoomIn' });
  viewSubmenu.push({ role: 'zoomOut' });
  viewSubmenu.push({ type: 'separator' });
  viewSubmenu.push({ role: 'togglefullscreen' });

  if (process.env.NODE_ENV === 'development') {
    viewSubmenu.push({ type: 'separator' } as MenuItemConstructorOptions);
    viewSubmenu.push({ role: 'reload' } as MenuItemConstructorOptions);
    viewSubmenu.push({ role: 'toggleDevTools' } as MenuItemConstructorOptions);
  }

  template.push({
    label: 'View',
    submenu: viewSubmenu,
  });

  const windowSubmenu: MenuItemConstructorOptions[] = [];
  windowSubmenu.push({ role: 'minimize' });
  windowSubmenu.push({ role: 'zoom' });

  if (isMac) {
    windowSubmenu.push({ type: 'separator' } as MenuItemConstructorOptions);
    windowSubmenu.push({ role: 'front' } as MenuItemConstructorOptions);
  } else {
    windowSubmenu.push({ role: 'close' } as MenuItemConstructorOptions);
  }

  template.push({
    role: 'windowMenu',
    submenu: windowSubmenu,
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

// --- Window state -----------------------------------------------------------

type WindowState = { x?: number; y?: number; width: number; height: number; isMaximized?: boolean };
const DEFAULT_WINDOW_STATE: WindowState = { width: 1400, height: 900 };

const windowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');

const loadWindowState = (): WindowState => {
  try {
    const parsed = JSON.parse(readFileSync(windowStatePath(), 'utf8'));
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 600 || height < 400) {
      return DEFAULT_WINDOW_STATE;
    }
    const state: WindowState = { width, height, isMaximized: Boolean(parsed.isMaximized) };
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      // Only restore the position if it is still on a connected display.
      const visible = screen.getAllDisplays().some(({ workArea }) => (
        x + 100 > workArea.x &&
        y + 50 > workArea.y &&
        x < workArea.x + workArea.width - 100 &&
        y < workArea.y + workArea.height - 50
      ));
      if (visible) {
        state.x = x;
        state.y = y;
      }
    }
    return state;
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
};

const saveWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  try {
    const bounds = mainWindow.getNormalBounds();
    const state: WindowState = { ...bounds, isMaximized: mainWindow.isMaximized() };
    writeFileSync(windowStatePath(), JSON.stringify(state), 'utf8');
  } catch (error) {
    console.warn('Unable to save window state:', error);
  }
};

function createWindow() {
  const appPath = app.getAppPath();
  const iconPath = path.join(appPath, 'assets', 'openotex-icon.png');
  const windowState = loadWindowState();
  rendererCloseConfirmed = false;

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 1000,
    minHeight: 600,
    title: `Openotex (${APP_EDITION})`,
    icon: iconPath,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true
    },
    titleBarStyle: 'default',
    backgroundColor: '#1e1e1e',
    show: false
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  buildApplicationMenu();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  // Links (e.g. in the Markdown preview) must open in the system browser and
  // never replace the application page.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  // The app never navigates itself; block link clicks and files dropped
  // outside the file tree (which would replace the whole UI).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!app.isPackaged && url.startsWith('http://localhost:3000')) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }

    const hasPrimaryModifier = input.control || input.meta;
    const key = input.key.toLowerCase();

    if (!hasPrimaryModifier || input.shift) {
      return;
    }

    if (key === 'c') {
      event.preventDefault();
      mainWindow?.webContents.copy();
    } else if (key === 'v') {
      event.preventDefault();
      mainWindow?.webContents.paste();
    } else if (key === 'x') {
      event.preventDefault();
      mainWindow?.webContents.cut();
    }
  });

  // Load the app
  const isDev = !app.isPackaged;

  let distRequested = false;
  const loadDist = () => {
    // Both the failed dev-server promise and did-fail-load land here.
    if (distRequested) return;
    distRequested = true;
    const filePath = path.join(appPath, 'dist', 'index.html');
    console.log('Loading production file:', filePath);
    mainWindow!.loadFile(filePath).catch(err => {
      console.error('Failed to load dist/index.html:', err);
    });
  };

  if (isDev) {
    const devUrl = 'http://localhost:3000';
    console.log('Loading dev URL:', devUrl);
    mainWindow.loadURL(devUrl).catch(err => {
      console.warn('Dev server not available, falling back to dist. Error:', err);
      loadDist();
    });
    // If dev server fails to load, fallback automatically
    mainWindow.webContents.once('did-fail-load', () => {
      console.warn('did-fail-load from dev URL. Falling back to dist.');
      loadDist();
    });
  } else {
    loadDist();
  }

  if (process.env.OPENOTEX_DEBUG === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    saveWindowState();
    const contents = mainWindow?.webContents;
    if (rendererCloseConfirmed || !contents || contents.isDestroyed() || contents.isCrashed()) {
      return;
    }
    event.preventDefault();
    contents.send('app-close-requested');
    if (closeWatchdog) clearTimeout(closeWatchdog);
    // If the renderer does not answer (hung page), close anyway.
    closeWatchdog = setTimeout(() => {
      closeWatchdog = null;
      rendererCloseConfirmed = true;
      if (isQuitting) app.quit(); else mainWindow?.close();
    }, 4000);
  });

  mainWindow.on('closed', () => {
    // Clean up all git terminal sessions when window closes
    gitTerminalSessions.forEach(({ proc }) => {
      try {
        proc?.kill();
      } catch (error) {
        console.error('Error killing git terminal process:', error);
      }
    });
    gitTerminalSessions.clear();
    fileWatchers.forEach(({ watcher }) => {
      try {
        void watcher.close();
      } catch (error) {
        console.error('Error closing watcher:', error);
      }
    });
    fileWatchers.clear();
    latexCompileSessions.forEach(token => cancelProcessToken(token));
    latexCompileSessions.clear();
    mainWindow = null;
  });

  // Clean up watchers and sessions if the renderer crashes (window stays open)
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.warn('Renderer process gone:', details.reason);
    const senderId = mainWindow?.webContents.id;
    if (senderId != null) {
      stopWatcherForSender(senderId);
      const session = gitTerminalSessions.get(senderId);
      try { session?.proc?.kill(); } catch {}
      gitTerminalSessions.delete(senderId);
    }
  });
}

// --- Opening files from the command line ---------------------------------------
// `Openotex --open=<file> [--line=N] [--project=<folder>]` is what the MCP
// tool open_in_openotex runs; a second launch hands the request to the
// running instance. Use the `=` form: Chromium moves switches in front of
// plain arguments when it forwards a second instance's command line, which
// separates `--open <file>` from its value.

type OpenRequest = { file: string; line?: number; project?: string; isDirectory?: boolean };
let pendingOpenRequest: OpenRequest | null = null;

const parseOpenRequest = (argv: string[], workingDirectory = process.cwd()): OpenRequest | null => {
  const valueOf = (flag: string) => {
    const prefix = `${flag}=`;
    const inline = argv.find(arg => arg.toLowerCase().startsWith(prefix));
    if (inline) {
      return inline.slice(prefix.length);
    }
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length && !argv[index + 1].startsWith('--') ? argv[index + 1] : undefined;
  };
  const file = valueOf('--open');
  if (!file) {
    return null;
  }
  const line = Number(valueOf('--line'));
  const project = valueOf('--project');
  return {
    file: path.resolve(workingDirectory, file),
    line: Number.isFinite(line) && line > 0 ? Math.floor(line) : undefined,
    project: project ? path.resolve(workingDirectory, project) : undefined,
  };
};

const deliverOpenRequest = async (request: OpenRequest) => {
  try {
    request.isDirectory = (await fs.stat(request.file)).isDirectory();
  } catch {
    return;
  }
  const contents = mainWindow?.webContents;
  if (contents && !contents.isDestroyed() && !contents.isLoading()) {
    contents.send('open-request', request);
  } else {
    pendingOpenRequest = request;
  }
};

ipcMain.handle('take-pending-open-request', () => {
  const request = pendingOpenRequest;
  pendingOpenRequest = null;
  return request;
});

// --- MCP server for coding agents -------------------------------------------------
// The server script ships inside the app (dist/mcp-server.js). It is copied
// to the user data folder so agents get a path that survives updates and
// works for AppImages, whose files live under a temporary mount point.

const mcpScriptPath = () => path.join(app.getPath('userData'), 'mcp', 'openotex-mcp.cjs');

const installMcpServerScript = async () => {
  try {
    const source = await fs.readFile(path.join(app.getAppPath(), 'dist', 'mcp-server.js'), 'utf8');
    const target = mcpScriptPath();
    const current = await fs.readFile(target, 'utf8').catch(() => null);
    if (current !== source) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, source, 'utf8');
    }
  } catch (error) {
    console.warn('Could not install the MCP server script:', error);
  }
};

// The packaged Linux binary is openotex.bin behind a launcher script that
// decides about the Chromium sandbox (scripts/linux-after-pack.js). Other
// programs should start the launcher (or the AppImage), not the binary.
const appLauncherPath = () => {
  if (process.env.APPIMAGE) return process.env.APPIMAGE;
  if (process.platform === 'linux' && process.execPath.endsWith('.bin')) {
    const launcher = process.execPath.slice(0, -'.bin'.length);
    if (existsSync(launcher)) return launcher;
  }
  return process.execPath;
};

ipcMain.handle('get-mcp-setup', async () => {
  await installMcpServerScript();
  // The Openotex executable doubles as the Node.js runtime for the server.
  const command = appLauncherPath();
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1', OPENOTEX_APP: command };
  if (!app.isPackaged) {
    // Development: electron.exe needs the app folder to start the editor.
    env.OPENOTEX_APP_ARGS = JSON.stringify([app.getAppPath()]);
  }
  return {
    success: true,
    name: 'openotex',
    command,
    args: [mcpScriptPath()],
    env,
    scriptPath: mcpScriptPath(),
    platform: process.platform,
  };
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Two windows editing the same files with auto-save would overwrite each
  // other, so a second launch only focuses the running instance.
  app.quit();
} else {
  pendingOpenRequest = parseOpenRequest(process.argv);
  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    const request = parseOpenRequest(argv, workingDirectory);
    if (request) {
      void deliverOpenRequest(request);
    }
  });
}

app.on('ready', () => {
  if (!gotSingleInstanceLock) {
    return;
  }
  augmentPathWithTexDistributions();
  createWindow();
  void installMcpServerScript();
  if (pendingOpenRequest) {
    const request = pendingOpenRequest;
    pendingOpenRequest = null;
    void deliverOpenRequest(request);
  }
});

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null && gotSingleInstanceLock) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  gitTerminalSessions.forEach(({ proc }) => {
    try { proc?.kill(); } catch {}
  });
  gitTerminalSessions.clear();
  fileWatchers.forEach(({ watcher }) => {
    try { void watcher.close(); } catch {}
  });
  fileWatchers.clear();
  latexCompileSessions.forEach(token => cancelProcessToken(token));
  latexCompileSessions.clear();
});

// --- Close handshake ----------------------------------------------------------

ipcMain.on('app-close-ack', () => {
  if (closeWatchdog) {
    clearTimeout(closeWatchdog);
    closeWatchdog = null;
  }
});

ipcMain.handle('app-close-confirmed', () => {
  if (closeWatchdog) {
    clearTimeout(closeWatchdog);
    closeWatchdog = null;
  }
  rendererCloseConfirmed = true;
  if (isQuitting) {
    app.quit();
  } else {
    mainWindow?.close();
  }
  return { success: true };
});

ipcMain.handle('app-close-cancelled', () => {
  if (closeWatchdog) {
    clearTimeout(closeWatchdog);
    closeWatchdog = null;
  }
  isQuitting = false;
  return { success: true };
});

ipcMain.handle('show-unsaved-dialog', async (_event, payload: { fileNames?: string[] }) => {
  const fileNames = Array.isArray(payload?.fileNames) ? payload.fileNames.filter(name => typeof name === 'string') : [];
  const count = fileNames.length;
  const message = count === 1
    ? `Do you want to save the changes you made to ${fileNames[0]}?`
    : `Do you want to save the changes you made to ${count} files?`;
  const listed = count > 1 ? `\n\n${fileNames.slice(0, 12).join('\n')}${count > 12 ? '\n…' : ''}` : '';
  const options = {
    type: 'warning' as const,
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'Unsaved changes',
    message,
    detail: `Your changes will be lost if you don't save them.${listed}`,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel';
});

// IPC Handlers for file operations
ipcMain.handle('read-file', async (event, filePath: string) => {
  try {
    const buffer = await fs.readFile(filePath);
    if (looksBinary(buffer)) {
      return { success: false, binary: true, error: 'This is a binary file and cannot be edited as text.' };
    }
    return { success: true, content: buffer.toString('utf8') };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('read-file-base64', async (event, filePath: string) => {
  try {
    const buffer = await fs.readFile(filePath);
    return { success: true, data: buffer.toString('base64') };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('write-file', async (event, filePath: string, content: string) => {
  try {
    await queueFileWrite(filePath, () => fs.writeFile(filePath, content, 'utf-8'));
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('path-exists', async (_event, targetPath: string) => {
  if (typeof targetPath !== 'string' || !targetPath) {
    return { success: false, exists: false };
  }
  return { success: true, exists: await pathExists(targetPath) };
});

ipcMain.handle('save-zip-file', async (event, options: { defaultPath: string; data: string }) => {
  try {
    const { defaultPath, data } = options;
    if (!mainWindow) {
      return { success: false, error: 'Window is not available.' };
    }

    const dialogOptions = {
      title: 'Save Project as ZIP',
      defaultPath,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    };

    const result = await dialog.showSaveDialog(mainWindow, dialogOptions);
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const buffer = Buffer.from(data, 'base64');
    await fs.writeFile(result.filePath, buffer);
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('save-pdf-as', async (_event, payload: { sourcePath?: string; defaultPath?: string }) => {
  try {
    const sourcePath = payload?.sourcePath;
    if (!sourcePath || path.extname(sourcePath).toLowerCase() !== '.pdf' || !(await pathExists(sourcePath))) {
      return { success: false, error: 'No compiled PDF is available yet.' };
    }
    const defaultPath = payload?.defaultPath || path.join(app.getPath('documents'), path.basename(sourcePath));
    const options = {
      title: 'Export PDF',
      defaultPath,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    if (!samePath(result.filePath, sourcePath)) {
      await fs.copyFile(sourcePath, result.filePath);
    }
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('create-file', async (event, filePath: string) => {
  try {
    // 'wx' fails instead of silently emptying an existing file.
    await fs.writeFile(filePath, '', { encoding: 'utf-8', flag: 'wx' });
    return { success: true };
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      return { success: false, error: 'A file with that name already exists.' };
    }
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('delete-file', async (event, filePath: string) => {
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true });
    } else {
      await fs.unlink(filePath);
      // Remove the highlight metadata that belongs to the deleted file.
      await fs.unlink(`${filePath}.metadata`).catch(() => {});
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('rename-file', async (event, oldPath: string, newPath: string) => {
  try {
    if (!samePath(oldPath, newPath) && await pathExists(newPath)) {
      return { success: false, error: 'A file or folder with that name already exists.' };
    }
    const stats = await fs.lstat(oldPath);
    await fs.rename(oldPath, newPath);
    if (!stats.isDirectory()) {
      const oldMetadata = `${oldPath}.metadata`;
      if (await pathExists(oldMetadata)) {
        await fs.rename(oldMetadata, `${newPath}.metadata`).catch(() => {});
      }
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('read-directory', async (event, dirPath: string) => {
  try {
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    const fileList = files.map(file => ({
      name: file.name,
      isDirectory: file.isDirectory(),
      path: path.join(dirPath, file.name)
    }));
    return { success: true, files: fileList };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('create-directory', async (event, dirPath: string) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('copy-paths', async (_event, payload: { sources: string[]; destination: string }) => {
  const { sources, destination } = payload ?? { sources: [], destination: '' };
  if (!Array.isArray(sources) || !destination) {
    return { success: false, error: 'Invalid copy request.' };
  }

  try {
    await fs.mkdir(destination, { recursive: true });
    for (const source of sources) {
      if (!source) {
        continue;
      }
      const baseName = path.basename(source);
      const targetPath = await buildUniqueDestination(destination, baseName);
      await fs.cp(source, targetPath, { recursive: true, errorOnExist: false });
    }
    return { success: true };
  } catch (error: any) {
    console.error('Error copying files into project:', error);
    return { success: false, error: error?.message || 'Failed to copy files.' };
  }
});

ipcMain.handle('read-binary-file', async (_event, filePath: string) => {
  try {
    const buffer = await fs.readFile(filePath);
    return { success: true, data: buffer.toString('base64') };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

const isIgnoredWatchPath = (changedPath: string) => {
  if (!changedPath) {
    return false;
  }
  if (changedPath.endsWith('.openotex-session.yml') || changedPath.endsWith('.metadata')) {
    return true;
  }
  for (const dir of ['.git', '.openotex', 'node_modules']) {
    if (changedPath.includes(`${path.sep}${dir}${path.sep}`) || changedPath.endsWith(`${path.sep}${dir}`)) {
      return true;
    }
  }
  return false;
};

ipcMain.handle('watch-path', async (event, projectRoot: string) => {
  stopWatcherForSender(event.sender.id);

  if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
    return { success: false, error: 'Invalid project path.' };
  }

  try {
    const watcher = chokidar.watch(projectRoot, {
      ignoreInitial: true,
      ignored: (changedPath: string) => isIgnoredWatchPath(changedPath),
    });

    watcher.on('all', (changeEvent, changedPath) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('filesystem-changed', {
          event: changeEvent,
          path: changedPath,
          root: projectRoot,
        });
      }
    });

    watcher.on('error', (error) => {
      console.warn('File watcher error:', error);
    });

    fileWatchers.set(event.sender.id, { watcher, root: projectRoot });
    return { success: true };
  } catch (error) {
    console.error('Failed to start watcher:', error);
    return { success: false, error: (error as Error).message || 'Failed to watch path.' };
  }
});

ipcMain.handle('unwatch-path', async (event) => {
  stopWatcherForSender(event.sender.id);
  return { success: true };
});

ipcMain.handle('git-check', async () => {
  try {
    const { stdout } = await runGit(['--version'], process.cwd());
    return { success: true, version: stdout.trim() };
  } catch (error) {
    const errMsg = (error as any)?.stderr || (error as Error).message || 'Git not available';
    return { success: false, error: errMsg };
  }
});

const gitErrorMessage = (error: any) => (
  (error?.stderr || '').trim() || (error?.stdout || '').trim() || error?.message || 'Git command failed.'
);

ipcMain.handle('git-status', async (_event, payload: { cwd?: string }) => {
  const cwd = payload?.cwd;
  if (!cwd) {
    return { success: false, error: 'No project path provided.' };
  }
  try {
    const { stdout } = await runGit(['-C', cwd, 'status', '--porcelain=v1'], cwd);
    const files = stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const status = line.slice(0, 2).trim() || line.charAt(0);
        const filePath = line.slice(3).trim();
        return { status, path: filePath || line.trim() };
      });
    let branch = '';
    try {
      branch = (await runGit(['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)).stdout.trim();
    } catch {
      // A repository without commits has no HEAD yet.
    }
    return { success: true, files, branch };
  } catch (error) {
    const message = gitErrorMessage(error);
    const notRepo = /not a git repository/i.test(message || '');
    return { success: false, error: message, notRepo };
  }
});

ipcMain.handle('git-commit', async (_event, payload: { cwd?: string; message?: string }) => {
  const cwd = payload?.cwd;
  const message = (payload?.message || '').trim();
  if (!cwd) {
    return { success: false, error: 'No project path provided.' };
  }
  if (!message) {
    return { success: false, error: 'Commit message is required.' };
  }
  try {
    await runGit(['-C', cwd, 'add', '-A'], cwd);
    await runGit(['-C', cwd, 'commit', '-m', message], cwd);
    return { success: true };
  } catch (error) {
    return { success: false, error: gitErrorMessage(error) };
  }
});

ipcMain.handle('git-pull', async (_event, payload: { cwd?: string }) => {
  const cwd = payload?.cwd;
  if (!cwd) {
    return { success: false, error: 'No project path provided.' };
  }
  try {
    const { stdout } = await runGit(['-C', cwd, 'pull'], cwd);
    return { success: true, output: stdout };
  } catch (error) {
    return { success: false, error: gitErrorMessage(error) };
  }
});

ipcMain.handle('git-push', async (_event, payload: { cwd?: string }) => {
  const cwd = payload?.cwd;
  if (!cwd) {
    return { success: false, error: 'No project path provided.' };
  }
  try {
    const { stdout } = await runGit(['-C', cwd, 'push'], cwd);
    return { success: true, output: stdout };
  } catch (error) {
    return { success: false, error: gitErrorMessage(error) };
  }
});

ipcMain.handle('git-init', async (_event, payload: { cwd?: string }) => {
  const cwd = payload?.cwd;
  if (!cwd) {
    return { success: false, error: 'No project path provided.' };
  }
  try {
    const { stdout } = await runGit(['-C', cwd, 'init'], cwd);
    return { success: true, output: stdout };
  } catch (error) {
    return { success: false, error: gitErrorMessage(error) };
  }
});

// Git-only terminal API
ipcMain.handle('git-terminal-start', async (event, options: { cwd?: string } = {}) => {
  const senderId = event.sender.id;
  const existing = gitTerminalSessions.get(senderId);
  const cwd = options.cwd || existing?.cwd || os.homedir();
  gitTerminalSessions.set(senderId, { cwd, proc: existing?.proc ?? null });
  return { success: true, shell: 'Git Terminal', cwd };
});

ipcMain.handle('git-terminal-stop', async (event) => {
  const senderId = event.sender.id;
  const session = gitTerminalSessions.get(senderId);
  try {
    session?.proc?.kill();
  } catch {}
  if (session) session.proc = null;
  return { success: true };
});

ipcMain.handle('git-terminal-run', async (event, payload: { command: string }) => {
  const senderId = event.sender.id;
  const session = gitTerminalSessions.get(senderId) || { cwd: os.homedir(), proc: null };
  gitTerminalSessions.set(senderId, session);

  const raw = (payload?.command || '').trim();
  const tokens = splitCommandLine(raw);
  if (!tokens.length || tokens[0].toLowerCase() !== 'git') {
    if (!event.sender.isDestroyed()) {
      event.sender.send('git-terminal-data', 'Only git commands are allowed.\n');
      event.sender.send('git-terminal-exit', 1);
    }
    return { success: false, error: 'Only git commands are allowed.' };
  }

  if (session.proc) {
    if (!event.sender.isDestroyed()) {
      event.sender.send('git-terminal-data', 'A git command is still running. Wait for it to finish.\n');
    }
    return { success: false, error: 'A git command is still running.' };
  }

  const args = tokens.slice(1);

  try {
    const child = spawn(gitCmd, args, {
      cwd: session.cwd,
      env: gitEnv(),
      stdio: 'pipe',
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    session.proc = child;

    child.stdout.on('data', (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('git-terminal-data', data.toString());
      }
    });
    child.stderr.on('data', (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('git-terminal-data', data.toString());
      }
    });
    child.on('exit', (code) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('git-terminal-exit', code);
      }
      session.proc = null;
    });
    child.on('error', (err) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('git-terminal-data', `Error: ${(err as Error).message}\n`);
        event.sender.send('git-terminal-exit', 1);
      }
      session.proc = null;
    });

    return { success: true };
  } catch (error) {
    if (!event.sender.isDestroyed()) {
      event.sender.send('git-terminal-data', `Error starting git: ${(error as Error).message}\n`);
      event.sender.send('git-terminal-exit', 1);
    }
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('open-directory-dialog', async (event) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    });
    return { success: true, canceled: result.canceled, filePaths: result.filePaths };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Get OS-specific default projects directory
ipcMain.handle('get-default-projects-directory', async () => {
  try {
    const homeDir = os.homedir();
    const documentsPath = path.join(homeDir, 'Documents');
    if (await pathExists(documentsPath)) {
      return { success: true, path: documentsPath };
    }
    return { success: true, path: homeDir };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Check if LaTeX is installed
ipcMain.handle('check-latex-installation', async () => {
  // Re-scan the standard install folders so a distribution installed while
  // Openotex was running is found without a restart.
  augmentPathWithTexDistributions();
  resetToolProbeCache();
  try {
    const { stdout } = await execFileAsync('pdflatex', ['--version'], { timeout: 20000 });
    const setup = await detectTexSetup();
    return {
      success: true,
      installed: true,
      version: stdout.split('\n')[0].trim(),
      engine: 'pdflatex',
      distribution: setup.distribution,
      manager: setup.manager,
      latexmk: await isLatexmkAvailable(),
    };
  } catch (error) {
    const manager = detectSystemPackageManager();
    return {
      success: true,
      installed: false,
      manager,
      installSuggestion: latexInstallSuggestion(manager, process.platform),
      message: 'LaTeX not found. Please install TeX Live or MiKTeX.'
    };
  }
});

// Check if a specific package is installed
ipcMain.handle('check-package-installed', async (event, packageName: string) => {
  try {
    // Use kpsewhich to check if package exists (safe args)
    const { stdout } = await execFileAsync('kpsewhich', [`${packageName}.sty`]);
    return {
      success: true,
      installed: stdout.trim().length > 0,
      path: stdout.trim()
    };
  } catch (error) {
    return {
      success: true,
      installed: false
    };
  }
});

const toPackageNames = (input: unknown): string[] =>
  (Array.isArray(input) ? input : [input]).filter((name): name is string => typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name));

// What installing these packages involves (shown before asking for a password).
ipcMain.handle('plan-latex-package-install', async (_event, packageNames: string | string[]) => {
  const setup = await detectTexSetup();
  const plan = planTexPackageInstall(setup.manager, toPackageNames(packageNames), { platform: process.platform, tlmgrPath: setup.tlmgrPath });
  return {
    manager: setup.manager,
    packages: plan?.packages ?? [],
    elevated: plan?.elevated ?? false,
    manualCommand: plan?.manualCommand,
  };
});

// Install LaTeX packages (one name or a list, installed in one go so a
// system package manager asks for the password only once).
ipcMain.handle('install-latex-package', async (_event, packageNames: string | string[]) => {
  const names = toPackageNames(packageNames);
  if (names.length === 0) {
    return { success: false, error: 'Invalid package name.' };
  }
  const result = await installLatexPackages(names, { interactive: true });
  resetToolProbeCache();
  return { ...result, error: result.success ? undefined : result.message };
});

// Open LaTeX installation page
ipcMain.handle('open-latex-download', async () => {
  try {
    await shell.openExternal('https://www.latex-project.org/get/');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Open an external URL (used by About dialog, etc.)
ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    // Basic allowlist: only http/https protocols
    if (!/^https?:\/\//i.test(url)) {
      return { success: false, error: 'Blocked non-HTTP(S) URL' };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Open a file with the operating system's default application (PDFs, images,
// office documents and other files the editor cannot show as text).
ipcMain.handle('open-path', async (_event, targetPath: string) => {
  try {
    if (typeof targetPath !== 'string' || !targetPath || !(await pathExists(targetPath))) {
      return { success: false, error: 'File not found.' };
    }
    const errorMessage = await shell.openPath(targetPath);
    return errorMessage ? { success: false, error: errorMessage } : { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Show file or folder in OS file browser
ipcMain.handle('show-in-file-browser', async (event, filePath: string) => {
  try {
    // shell.showItemInFolder will open the parent directory and select the item
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// --- LaTeX: root documents, references, compilation, SyncTeX -------------------
// The work happens in latexService.ts, which the MCP server shares.

ipcMain.handle('resolve-root-document', async (_event, payload: { texFile?: string; projectRoot?: string }) => {
  if (!payload?.texFile) {
    return { success: false, error: 'Missing texFile.' };
  }
  try {
    const rootFile = await resolveRootDocument(payload.texFile, payload.projectRoot);
    return { success: true, rootFile };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});


ipcMain.handle('collect-latex-references', async (_event, payload: { projectRoot?: string }) => {
  const projectRoot = payload?.projectRoot;
  if (!projectRoot || typeof projectRoot !== 'string') {
    return { success: false, labels: [], citations: [] };
  }
  return collectLatexReferences(projectRoot);
});

ipcMain.handle('compile-latex', async (event, texFilePath: string, engine: LatexEngine = 'pdflatex', options: CompileOptions = {}) => {
  const senderId = event.sender.id;
  const previousCompile = latexCompileSessions.get(senderId);
  if (previousCompile) {
    cancelProcessToken(previousCompile);
  }
  const cancelToken: ProcessCancelToken = { cancelled: false, processes: new Set() };
  latexCompileSessions.set(senderId, cancelToken);
  try {
    return await compileLatexDocument(texFilePath, engine, options, {
      cancelToken,
      onStatus: status => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('compilation-status', status);
        }
      },
    });
  } finally {
    if (latexCompileSessions.get(senderId) === cancelToken) {
      latexCompileSessions.delete(senderId);
    }
  }
});

ipcMain.handle('synctex-forward', async (_event, payload: { texFile: string; line: number; column?: number; pdfFile?: string; texRoot?: string }) => (
  synctexForward(payload)
));

ipcMain.handle('synctex-inverse', async (_event, payload: { pdfFile: string; page: number; h: number; v: number; texRoot?: string }) => (
  synctexInverse(payload)
));
