import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import chokidar, { FSWatcher } from 'chokidar';
import { APP_EDITION } from '../shared/appInfo';
import {
  detectMissingLatexPackage,
  parseLatexDiagnostics,
  summarizeLatexError,
} from '../shared/latexDiagnostics';
// no util.promisify needed after switching to execFile/spawn helpers

// execFile promise wrapper to avoid shell interpolation
const execFileAsync = (
  file: string,
  args: readonly string[] = [],
  options: any = {}
): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const finalOptions = { ...(options || {}), encoding: 'utf8' };
    const child = execFile(file, args as string[], finalOptions as any, (error, stdout: any, stderr: any) => {
      const out = typeof stdout === 'string' ? stdout : (stdout ? stdout.toString('utf8') : '');
      const err = typeof stderr === 'string' ? stderr : (stderr ? stderr.toString('utf8') : '');
      if (error) {
        (error as any).stdout = out;
        (error as any).stderr = err;
        reject(error);
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
};

type ProcessCancelToken = {
  cancelled: boolean;
  processes: Set<ChildProcessWithoutNullStreams>;
};

const cancelProcessToken = (token: ProcessCancelToken) => {
  token.cancelled = true;
  for (const child of token.processes) {
    try { child.kill(); } catch {}
  }
};

// spawn collector with timeout
const spawnCollect = (
  command: string,
  args: string[],
  options: any = {},
  timeoutMs = 120000,
  cancelToken?: ProcessCancelToken
): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return new Promise((resolve, reject) => {
    if (cancelToken?.cancelled) {
      reject(new Error('Process cancelled'));
      return;
    }

    const child = spawn(command, args, { ...options, stdio: 'pipe' }) as ChildProcessWithoutNullStreams;
    cancelToken?.processes.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        try { child.kill(); } catch {}
      }
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      cancelToken?.processes.delete(child);
      if (settled) return;
      settled = true;
      (err as any).stdout = stdout;
      (err as any).stderr = stderr;
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      cancelToken?.processes.delete(child);
      if (settled) return;
      settled = true;
      if (cancelToken?.cancelled) {
        const error: any = new Error('Process cancelled');
        error.stdout = stdout; error.stderr = stderr;
        reject(error);
      } else if (timedOut) {
        const error: any = new Error(`Process timed out after ${timeoutMs / 1000}s`);
        error.stdout = stdout; error.stderr = stderr;
        reject(error);
      } else if (code !== null && code !== 0) {
        const error: any = new Error(`Process exited with code ${code}`);
        error.stdout = stdout; error.stderr = stderr; error.code = code;
        reject(error);
      } else if (signal) {
        // Killed by an external signal (not by our timeout handler)
        const error: any = new Error(`Process killed by signal ${signal}`);
        error.stdout = stdout; error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr, code });
      }
    });
  });
};

let mainWindow: BrowserWindow | null = null;
const gitCmd = process.platform === 'win32' ? 'git.exe' : 'git';
// Git-only terminal sessions (stores running process and cwd per sender)
const gitTerminalSessions = new Map<number, { cwd: string; proc: ChildProcessWithoutNullStreams | null }>();
const fileWatchers = new Map<number, { watcher: FSWatcher; root: string }>();
const latexCompileSessions = new Map<number, ProcessCancelToken>();

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

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

const runGit = async (args: string[], cwd: string) => {
  return execFileAsync(gitCmd, args, { cwd });
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
  const isMac = process.platform === 'darwin';

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

const getDefaultShell = () => {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoLogo'],
      displayName: 'Windows PowerShell',
    };
  }

  const shellPath =
    process.env.SHELL ||
    (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

  return {
    command: shellPath,
    args: ['-i'],
    displayName: shellPath,
  };
};

const detectLatexDistribution = async (): Promise<'miktex' | 'texlive' | 'unknown'> => {
  try {
    const { stdout } = await execFileAsync('pdflatex', ['--version']);
    const normalized = stdout.toLowerCase();
    if (normalized.includes('miktex')) {
      return 'miktex';
    }
    if (normalized.includes('tex live')) {
      return 'texlive';
    }
  } catch {
    // ignored – we'll report as unknown below
  }
  return 'unknown';
};

function createWindow() {
  const appPath = app.getAppPath();
  const iconPath = path.join(appPath, 'assets', 'openotex-icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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
    show: true  // Show window immediately for debugging
  });

  buildApplicationMenu();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

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

  const loadDist = () => {
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
    // Open DevTools only when explicitly requested
    if (process.env.OPENOTEX_DEBUG === 'true') {
      try { mainWindow.webContents.openDevTools({ mode: 'detach' }); } catch {}
    }
  } else {
    loadDist();
  }

  if (process.env.OPENOTEX_DEBUG === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
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

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  gitTerminalSessions.forEach(({ proc }) => {
    try { proc?.kill(); } catch {}
  });
  gitTerminalSessions.clear();
  fileWatchers.forEach(({ watcher }) => {
    try { void watcher.close(); } catch {}
  });
  fileWatchers.clear();
});

// IPC Handlers for file operations
ipcMain.handle('read-file', async (event, filePath: string) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, content };
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
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
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

ipcMain.handle('create-file', async (event, filePath: string) => {
  try {
    await fs.writeFile(filePath, '', 'utf-8');
    return { success: true };
  } catch (error) {
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
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('rename-file', async (event, oldPath: string, newPath: string) => {
  try {
    await fs.rename(oldPath, newPath);
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

ipcMain.handle('watch-path', async (event, projectRoot: string) => {
  stopWatcherForSender(event.sender.id);

  if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
    return { success: false, error: 'Invalid project path.' };
  }

  try {
    const watcher = chokidar.watch(projectRoot, {
      ignoreInitial: true,
      ignored: (changedPath: string) => {
        if (!changedPath) {
          return false;
        }
        if (changedPath.endsWith('.openotex-session.yml') || changedPath.endsWith('.metadata')) {
          return true;
        }
        if (changedPath.includes(`${path.sep}.git${path.sep}`) || changedPath.endsWith(`${path.sep}.git`)) {
          return true;
        }
        return false;
      },
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

ipcMain.handle('git-status', async (_event, payload: { cwd?: string }) => {
  const cwd = payload?.cwd;
  if (!cwd) {
    return { success: false, error: 'No project path provided.' };
  }
  try {
    const { stdout } = await runGit(['-C', cwd, 'status', '--short'], cwd);
    const files = stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const status = line.slice(0, 2).trim() || line.charAt(0);
        const filePath = line.slice(3).trim();
        return { status, path: filePath || line.trim() };
      });
    return { success: true, files };
  } catch (error) {
    const message = (error as any).stderr || (error as Error).message;
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
    return { success: false, error: (error as any).stderr || (error as Error).message };
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
    return { success: false, error: (error as any).stderr || (error as Error).message };
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
    return { success: false, error: (error as any).stderr || (error as Error).message };
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
    return { success: false, error: (error as any).stderr || (error as Error).message };
  }
});

// Git-only terminal API
ipcMain.handle('git-terminal-start', async (event, options: { cwd?: string } = {}) => {
  const senderId = event.sender.id;
  gitTerminalSessions.set(senderId, { cwd: options.cwd || process.cwd(), proc: null });
  return { success: true, shell: 'Git Terminal' };
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
  const session = gitTerminalSessions.get(senderId) || { cwd: process.cwd(), proc: null };
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

  const args = tokens.slice(1);

  try {
    const child = spawn(gitCmd, args, {
      cwd: session.cwd,
      env: process.env,
      stdio: 'pipe'
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
    const os = require('os');
    const homeDir = os.homedir();

    // Get platform-specific documents folder
    let documentsPath: string;

    if (process.platform === 'win32') {
      // Windows: Use Documents folder
      documentsPath = path.join(homeDir, 'Documents');
    } else if (process.platform === 'darwin') {
      // macOS: Use Documents folder
      documentsPath = path.join(homeDir, 'Documents');
    } else {
      // Linux: Use Documents folder if it exists, otherwise home
      const linuxDocuments = path.join(homeDir, 'Documents');
      try {
        await fs.access(linuxDocuments);
        documentsPath = linuxDocuments;
      } catch {
        documentsPath = homeDir;
      }
    }

    return { success: true, path: documentsPath };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// Check if LaTeX is installed
ipcMain.handle('check-latex-installation', async () => {
  try {
    // Try to find pdflatex
    const { stdout } = await execFileAsync('pdflatex', ['--version']);

    // Detect distribution
    let distribution = 'unknown';
    if (stdout.toLowerCase().includes('miktex')) {
      distribution = 'miktex';
    } else if (stdout.toLowerCase().includes('tex live')) {
      distribution = 'texlive';
    }

    return {
      success: true,
      installed: true,
      version: stdout.split('\n')[0],
      engine: 'pdflatex',
      distribution
    };
  } catch (error) {
    return {
      success: true,
      installed: false,
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

// Install LaTeX package
ipcMain.handle('install-latex-package', async (event, packageName: string) => {
  try {
    if (!/^[A-Za-z0-9._-]+$/.test(packageName)) {
      return { success: false, error: 'Invalid package name.' };
    }
    const distribution = await detectLatexDistribution();

    if (distribution === 'miktex') {
      // MiKTeX package manager
      if (process.platform === 'win32') {
        const { stdout } = await execFileAsync('mpm', [ `--install=${packageName}` ], { timeout: 120000 });
        return { success: true, message: `Package ${packageName} installed successfully`, output: stdout, distribution: 'miktex' };
      } else {
        const { stdout } = await execFileAsync('miktex', [ 'packages', 'install', packageName ], { timeout: 120000 });
        return { success: true, message: `Package ${packageName} installed successfully`, output: stdout, distribution: 'miktex' };
      }
    } else if (distribution === 'texlive') {
      // TeX Live package manager (tlmgr)
      const { stdout } = await execFileAsync('tlmgr', [ 'install', packageName ], { timeout: 120000 });
      return { success: true, message: `Package ${packageName} installed successfully`, output: stdout, distribution: 'texlive' };
    } else {
      return {
        success: false,
        error: 'Unknown LaTeX distribution. Cannot auto-install packages.',
        distribution: 'unknown'
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to install package',
      details: error.stderr || ''
    };
  }
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

// Helper function to detect font-related errors and extract font package name
const detectFontError = (output: string): { hasError: boolean; packageName?: string } => {
  const fontErrorPatterns = [
    /This is METAFONT/i,
    /\.mf\s*$/m,
    /Font.*not found/i,
    /Missing character/i,
    /ecrm\d+\.mf/i,
    /Font shape.*undefined/i,
    /Font family.*undefined/i,
    /Font encoding.*not available/i,
    // XeLaTeX / LuaLaTeX font errors
    /fontspec error/i,
    /I can't find file `[^']+\.tfm'/i,
    /No file .+\.tfm/i,
    /kpathsea: Running mktextfm/i,
    /mktextfm: `[^']+' not found/i,
  ];

  const hasError = fontErrorPatterns.some(pattern => pattern.test(output));
  if (!hasError) return { hasError: false };

  // Try to extract specific font package name from error messages
  const fontPackageMatch = output.match(/Font `([^']+)' not found/);
  if (fontPackageMatch) {
    return { hasError: true, packageName: fontPackageMatch[1] };
  }

  // Check for specific encoding issues
  if (/ecrm\d+\.mf/i.test(output) || /T1.*encoding/i.test(output)) {
    return { hasError: true, packageName: 'ec' };
  }

  return { hasError: true };
};

// Helper function to detect citation/bibliography errors
const detectCitationError = (output: string): boolean => {
  const citationErrorPatterns = [
    /File ended while scanning use of \\citation/,
    /Runaway argument/,
    /\\citation.*missing/i,
    /Bibliography not compatible/i
  ];
  return citationErrorPatterns.some(pattern => pattern.test(output));
};

// Helper function to detect if recompilation is needed
const needsRecompilation = (output: string): boolean => {
  const recompilePatterns = [
    /Rerun to get cross-references right/i,
    /Rerun LaTeX/i,
    /Label\(s\) may have changed/i,
    /Citation.*undefined/i,
    /Reference.*undefined/i,
    /Rerun to get outlines right/i,
    // Glossaries package
    /Rerun to get glossary right/i,
    /Package glossaries Warning.*Rerun/i,
    // Index / nomenclature
    /Rerun to get index right/i,
    /Package rerunfilecheck Warning/i,
    // Long tables spanning pages
    /Package longtable Warning.*rerun/i,
    // tocbibind / hyperref
    /Rerun to get bookmarks right/i,
    /rerunfilecheck Warning/i,
  ];
  return recompilePatterns.some(pattern => pattern.test(output));
};

const isLatexmkAvailable = async (): Promise<boolean> => {
  try {
    await execFileAsync('latexmk', ['-v'], { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
};

// Helper function to install missing LaTeX fonts
const installLatexFonts = async (distribution: 'miktex' | 'texlive' | 'unknown'): Promise<{ success: boolean; message: string }> => {
  try {
    if (distribution === 'miktex') {
      console.log('Installing EC fonts package via MiKTeX...');
      await execFileAsync('mpm', ['--install=ec'], { timeout: 120000 });

      console.log('Installing CM-Super fonts package via MiKTeX...');
      await execFileAsync('mpm', ['--install=cm-super'], { timeout: 120000 });

      console.log('Refreshing MiKTeX file database...');
      await execFileAsync('initexmf', ['--update-fndb'], { timeout: 60000 });
    } else if (distribution === 'texlive') {
      console.log('Installing EC fonts package via TeX Live...');
      await execFileAsync('tlmgr', ['install', 'ec'], { timeout: 120000 });

      console.log('Installing CM-Super fonts package via TeX Live...');
      await execFileAsync('tlmgr', ['install', 'cm-super'], { timeout: 120000 });

      console.log('Refreshing TeX Live file database...');
      try {
        await execFileAsync('mktexlsr', [], { timeout: 60000 });
      } catch {
        await execFileAsync('texhash', [], { timeout: 60000 });
      }
    } else {
      return { success: false, message: 'Unknown LaTeX distribution. Skipping automatic font installation.' };
    }

    return {
      success: true,
      message: 'Required fonts installed successfully'
    };
  } catch (error: any) {
    console.error('Font installation failed:', error);
    return {
      success: false,
      message: `Font installation failed: ${error.message}`
    };
  }
};

// Helper function to install missing LaTeX package
const installLatexPackage = async (packageName: string): Promise<{ success: boolean; message: string }> => {
  try {
    console.log(`Installing LaTeX package: ${packageName}`);
    if (!/^[A-Za-z0-9._-]+$/.test(packageName)) {
      return { success: false, message: 'Invalid package name.' };
    }

    const distribution = await detectLatexDistribution();
    if (distribution === 'miktex') {
      await execFileAsync('mpm', [ `--install=${packageName}` ], { timeout: 120000 });
      await execFileAsync('initexmf', ['--update-fndb'], { timeout: 60000 });
    } else if (distribution === 'texlive') {
      await execFileAsync('tlmgr', ['install', packageName], { timeout: 120000 });
      try {
        await execFileAsync('mktexlsr', [], { timeout: 60000 });
      } catch {
        await execFileAsync('texhash', [], { timeout: 60000 });
      }
    } else {
      return { success: false, message: 'Unknown LaTeX distribution.' };
    }

    return {
      success: true,
      message: `Package ${packageName} installed successfully`
    };
  } catch (error: any) {
    console.error(`Package installation failed for ${packageName}:`, error);
    return {
      success: false,
      message: `Failed to install package ${packageName}: ${error.message}`
    };
  }
};

// Compile LaTeX file
ipcMain.handle('compile-latex', async (event, texFilePath: string, engine: 'pdflatex' | 'xelatex' | 'lualatex' = 'pdflatex') => {
  const senderId = event.sender.id;
  const previousCompile = latexCompileSessions.get(senderId);
  if (previousCompile) {
    cancelProcessToken(previousCompile);
  }
  const cancelToken: ProcessCancelToken = { cancelled: false, processes: new Set() };
  latexCompileSessions.set(senderId, cancelToken);

  try {
    const dir = path.dirname(texFilePath);
    const filename = path.basename(texFilePath, '.tex');
    const pdfPath = path.join(dir, `${filename}.pdf`);
    const auxPath = path.join(dir, `${filename}.aux`);
    const distribution = await detectLatexDistribution();

    // Run LaTeX engine with proper flags
    // -interaction=nonstopmode: don't stop on errors
    // -halt-on-error: stop on first error but don't wait for input
    // -output-directory: specify output directory
    // Set environment variable to suppress MiKTeX update warnings
    process.env.MIKTEX_AUTOINSTALL = '1';
    process.env.MIKTEX_ENABLE_INSTALLER = '1';

    const allowedEngines = ['pdflatex', 'xelatex', 'lualatex'] as const;
    if (!allowedEngines.includes(engine as any)) {
      engine = 'pdflatex';
    }
    const args = [
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-file-line-error',  // emit errors as file:line:message for easier parsing
      '-synctex=1',
      `-output-directory=${dir}`,
      texFilePath
    ];

    console.log('Compiling LaTeX with', engine, 'args:', args.join(' '));

    // Allow up to 5 minutes per pass — large documents or first-time package
    // downloads can easily exceed the old 2-minute limit.
    const runLatexEngine = async () => {
      return spawnCollect(engine, args, { cwd: dir }, 300000, cancelToken);
    };

    const installedPackages = new Set<string>(); // Track installed packages to avoid loops
    let attemptedFontFallback = false;

    const makeFailure = (output: string, details = '') => ({
      success: false,
      error: summarizeLatexError(output, texFilePath),
      log: output,
      details,
      diagnostics: parseLatexDiagnostics(output, texFilePath)
    });

    const readCompiledPdf = async (log: string, warnings = '', targetPdfPath = pdfPath) => {
      try {
        await fs.access(targetPdfPath);
        const pdfBuffer = await fs.readFile(targetPdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');

        return {
          success: true,
          pdfPath: targetPdfPath,
          pdfData: pdfBase64,
          log,
          warnings,
          diagnostics: parseLatexDiagnostics(`${log}\n${warnings}`, texFilePath)
        };
      } catch {
        return {
          success: false,
          error: 'Compilation failed - PDF not generated',
          log,
          details: warnings,
          diagnostics: parseLatexDiagnostics(`${log}\n${warnings}`, texFilePath)
        };
      }
    };

    const recoverFromLatexFailure = async (errorOutput: string, attemptCount: number) => {
        // Check for citation/bibliography errors - clean auxiliary files and retry
        if (detectCitationError(errorOutput) && attemptCount <= 2) {
          console.log('Citation error detected, cleaning auxiliary files...');

          event.sender.send('compilation-status', {
            stage: 'cleaning',
            message: 'Cleaning corrupted auxiliary files...'
          });

          try {
            // Delete potentially corrupted auxiliary files
            await fs.unlink(path.join(dir, `${filename}.aux`)).catch(() => {});
            await fs.unlink(path.join(dir, `${filename}.out`)).catch(() => {});
            await fs.unlink(path.join(dir, `${filename}.bbl`)).catch(() => {});

            console.log('Auxiliary files cleaned, retrying compilation...');
            event.sender.send('compilation-status', {
              stage: 'retry',
              message: 'Auxiliary files cleaned. Retrying compilation...'
            });
            return { retry: true };
          } catch (cleanError) {
            console.error('Failed to clean auxiliary files:', cleanError);
          }
        }

        // Check for font errors
        const fontError = detectFontError(errorOutput);
        if (fontError.hasError) {
          console.log('Font error detected, attempting to install fonts...');

          // If we detected a specific font package, install it
          if (fontError.packageName && !installedPackages.has(fontError.packageName)) {
            event.sender.send('compilation-status', {
              stage: 'font-installation',
              message: `Installing font package: ${fontError.packageName}...`
            });

            const installResult = await installLatexPackage(fontError.packageName);
            if (installResult.success) {
              installedPackages.add(fontError.packageName);
              console.log(`Font package ${fontError.packageName} installed, retrying compilation...`);
              event.sender.send('compilation-status', {
                stage: 'retry',
                message: `Font package ${fontError.packageName} installed. Retrying compilation...`
              });
              return { retry: true };
            }
          }

          if (!attemptedFontFallback) {
            attemptedFontFallback = true;
            event.sender.send('compilation-status', {
              stage: 'font-installation',
              message: 'Installing required LaTeX fonts (EC, CM-Super)... This may take a few minutes.'
            });

            if (distribution === 'unknown') {
              return {
                retry: false,
                failure: {
                  success: false,
                  error: 'Font installation failed',
                  log: errorOutput,
                  details: 'Unknown LaTeX distribution. Install fonts manually.',
                  diagnostics: parseLatexDiagnostics(errorOutput, texFilePath)
                }
              };
            }

            const installResult = await installLatexFonts(distribution);

            if (installResult.success) {
              console.log('Fonts installed, retrying compilation...');
              event.sender.send('compilation-status', {
                stage: 'retry',
                message: 'Fonts installed successfully. Retrying compilation...'
              });
              return { retry: true };
            } else {
              return {
                retry: false,
                failure: {
                  success: false,
                  error: 'Font installation failed',
                  log: errorOutput,
                  details: installResult.message,
                  diagnostics: parseLatexDiagnostics(errorOutput, texFilePath)
                }
              };
            }
          }
        }

        // Check for missing packages
        const missingPackage = detectMissingLatexPackage(errorOutput);
        if (missingPackage && !installedPackages.has(missingPackage)) {
          console.log(`Missing package detected: ${missingPackage}`);

          event.sender.send('compilation-status', {
            stage: 'package-installation',
            message: `Installing missing LaTeX package: ${missingPackage}...`
          });

          const installResult = await installLatexPackage(missingPackage);

          if (installResult.success) {
            installedPackages.add(missingPackage);
            console.log(`Package ${missingPackage} installed, retrying compilation...`);
            event.sender.send('compilation-status', {
              stage: 'retry',
              message: `Package ${missingPackage} installed. Retrying compilation...`
            });
            return { retry: true };
          } else {
            return {
              retry: false,
              failure: {
                success: false,
                error: `Failed to install package: ${missingPackage}`,
                log: errorOutput,
                details: installResult.message,
                diagnostics: parseLatexDiagnostics(errorOutput, texFilePath)
              }
            };
          }
        }

        return { retry: false };
    };

    const compileWithLatexmk = async () => {
      const latexmkOutputDir = path.join(dir, '.openotex', 'build', filename);
      const latexmkPdfPath = path.join(latexmkOutputDir, `${filename}.pdf`);
      await fs.mkdir(latexmkOutputDir, { recursive: true });

      const latexmkMode = engine === 'xelatex' ? '-xelatex' : engine === 'lualatex' ? '-lualatex' : '-pdf';
      const latexmkArgs = [
        latexmkMode,
        '-g',
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-file-line-error',
        '-synctex=1',
        `-outdir=${latexmkOutputDir}`,
        texFilePath
      ];

      const maxLatexmkAttempts = 4;
      for (let attempt = 1; attempt <= maxLatexmkAttempts; attempt++) {
        console.log(`Compilation attempt ${attempt}/${maxLatexmkAttempts} using latexmk`);
        event.sender.send('compilation-status', {
          stage: 'compile',
          message: attempt === 1 ? 'Compiling with latexmk...' : `Retrying with latexmk (${attempt}/${maxLatexmkAttempts})...`
        });

        try {
          const result = await spawnCollect('latexmk', latexmkArgs, { cwd: dir }, 300000, cancelToken);
          return await readCompiledPdf(result.stdout, result.stderr, latexmkPdfPath);
        } catch (error: any) {
          const errorOutput = (error.stdout || '') + (error.stderr || '');
          const recovery = await recoverFromLatexFailure(errorOutput, attempt);
          if ('failure' in recovery && recovery.failure) {
            return recovery.failure;
          }
          if (recovery.retry && attempt < maxLatexmkAttempts) {
            continue;
          }
          return makeFailure(errorOutput, error.message || 'latexmk failed');
        }
      }

      return makeFailure('', 'latexmk failed after all attempts');
    };

    if (await isLatexmkAvailable()) {
      return await compileWithLatexmk();
    }

    let currentAttempt: { stdout: string; stderr: string } | undefined;
    let attemptCount = 0;
    const maxAttempts = 5;

    while (attemptCount < maxAttempts) {
      attemptCount++;
      console.log(`Compilation attempt ${attemptCount}/${maxAttempts}`);
      event.sender.send('compilation-status', {
        stage: 'compile',
        message: attemptCount === 1 ? 'Compiling...' : `Retrying compilation (${attemptCount}/${maxAttempts})...`
      });

      try {
        currentAttempt = await runLatexEngine();
        break;
      } catch (error: any) {
        const errorOutput = (error.stdout || '') + (error.stderr || '');
        const recovery = await recoverFromLatexFailure(errorOutput, attemptCount);

        if ('failure' in recovery && recovery.failure) {
          return recovery.failure;
        }
        if (recovery.retry && attemptCount < maxAttempts) {
          continue;
        }

        return makeFailure(errorOutput, error.message || 'Compilation failed');
      }
    }

    if (!currentAttempt) {
      return makeFailure('', 'Failed to compile after all attempts');
    }

    const { stdout, stderr } = currentAttempt;

    let combinedStdout = stdout;
    let combinedStderr = stderr;

    let ranPostProcessor = false;

    // --- Bibliography: Biber (biblatex) or BibTeX (classic) ---
    const bcfPath = path.join(dir, `${filename}.bcf`);
    try {
      const bcfExists = await pathExists(bcfPath);
      if (bcfExists) {
        // biblatex + biber workflow
        console.log('Running Biber:', filename);
        event.sender.send('compilation-status', { stage: 'biber', message: 'Running Biber bibliography processor...' });
        try {
          const { stdout: biberOut, stderr: biberErr } = await execFileAsync('biber', [filename], { cwd: dir, timeout: 120000 } as any);
          combinedStdout += `\n\n[Biber]\n${biberOut}`;
          combinedStderr += `\n\n[Biber]\n${biberErr}`;
          ranPostProcessor = true;
        } catch (biberErr: any) {
          console.warn('Biber failed:', biberErr);
          combinedStdout += `\n\n[Biber - failed]\n${biberErr.stdout || ''}`;
          combinedStderr += `\n\n[Biber - failed]\n${biberErr.stderr || ''}`;
        }
      } else {
        // Classic BibTeX workflow
        const auxContent = await fs.readFile(auxPath, 'utf-8');
        if (auxContent.includes('\\bibdata')) {
          console.log('Running BibTeX:', filename);
          event.sender.send('compilation-status', { stage: 'bibtex', message: 'Running BibTeX bibliography processor...' });
          const { stdout: bibOut, stderr: bibErr } = await execFileAsync('bibtex', [filename], { cwd: dir, timeout: 120000 } as any);
          combinedStdout += `\n\n[BibTeX]\n${bibOut}`;
          combinedStderr += `\n\n[BibTeX]\n${bibErr}`;
          ranPostProcessor = true;
        }
      }
    } catch (bibError) {
      console.warn('Bibliography step skipped or failed:', bibError);
    }

    // --- Index: MakeIndex ---
    const idxPath = path.join(dir, `${filename}.idx`);
    try {
      if (await pathExists(idxPath)) {
        console.log('Running MakeIndex:', filename);
        event.sender.send('compilation-status', { stage: 'makeindex', message: 'Generating document index...' });
        const { stdout: idxOut, stderr: idxErr } = await execFileAsync('makeindex', [`${filename}.idx`], { cwd: dir, timeout: 60000 } as any);
        combinedStdout += `\n\n[MakeIndex]\n${idxOut}`;
        combinedStderr += `\n\n[MakeIndex]\n${idxErr}`;
        ranPostProcessor = true;
      }
    } catch (idxError) {
      console.warn('MakeIndex step skipped or failed:', idxError);
    }

    // --- Final passes: recompile until stable or limit reached ---
    if (ranPostProcessor || needsRecompilation(combinedStdout + combinedStderr)) {
      const maxFinalPasses = ranPostProcessor ? 3 : 5;
      for (let pass = 1; pass <= maxFinalPasses; pass++) {
        event.sender.send('compilation-status', {
          stage: 'retry',
          message: `Finalizing document (pass ${pass}/${maxFinalPasses})...`
        });
        try {
          const finalPass = await runLatexEngine();
          combinedStdout += `\n\n[Final pass ${pass}]\n${finalPass.stdout}`;
          combinedStderr += `\n\n[Final pass ${pass}]\n${finalPass.stderr}`;
          if (!needsRecompilation(finalPass.stdout + finalPass.stderr)) break;
        } catch (error: any) {
          const errorOutput = (error.stdout || '') + (error.stderr || '');
          combinedStdout += `\n\n[Final pass ${pass} - failed]\n${error.stdout || ''}`;
          combinedStderr += `\n\n[Final pass ${pass} - failed]\n${error.stderr || ''}`;
          return makeFailure(errorOutput, error.message || 'Final LaTeX pass failed');
        }
      }
    }

    return await readCompiledPdf(combinedStdout, combinedStderr);
  } catch (error: any) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    return {
      success: false,
      error: output.trim() ? summarizeLatexError(output, texFilePath) : (error.message || 'Compilation error'),
      log: error.stdout || '',
      details: error.stderr || '',
      diagnostics: output.trim() ? parseLatexDiagnostics(output, texFilePath) : []
    };
  } finally {
    if (latexCompileSessions.get(senderId) === cancelToken) {
      latexCompileSessions.delete(senderId);
    }
  }
});

// --- SyncTeX: forward (source -> PDF) and inverse (PDF -> source) ---
//
// synctex view -i LINE:COLUMN:TEXFILE -o PDFFILE
// synctex edit -o PAGE:H:V:PDFFILE
//
// Coordinates are in PDF points (72dpi), with h measured from the left of the
// page and v measured from the top.

type SynctexRect = { page: number; h: number; v: number; W: number; H: number };

const parseSyncTexViewOutput = (output: string): SynctexRect[] => {
  const rects: SynctexRect[] = [];
  let current: Partial<SynctexRect> = {};

  const commit = () => {
    if (
      typeof current.page === 'number' &&
      typeof current.h === 'number' &&
      typeof current.v === 'number' &&
      typeof current.W === 'number' &&
      typeof current.H === 'number' &&
      Number.isFinite(current.page) &&
      Number.isFinite(current.h) &&
      Number.isFinite(current.v)
    ) {
      rects.push(current as SynctexRect);
    }
    current = {};
  };

  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    switch (key) {
      case 'Page':
        if (current.page !== undefined) commit();
        current.page = parseInt(value, 10);
        break;
      case 'h': current.h = parseFloat(value); break;
      case 'v': current.v = parseFloat(value); break;
      case 'W': current.W = parseFloat(value); break;
      case 'H':
        current.H = parseFloat(value);
        commit();
        break;
    }
  }
  if (current.page !== undefined) commit();
  return rects;
};

const parseSyncTexEditOutput = (output: string) => {
  let input = '';
  let line = NaN;
  let column = NaN;
  for (const raw of output.split(/\r?\n/)) {
    const l = raw.trim();
    const idx = l.indexOf(':');
    if (idx <= 0) continue;
    const key = l.slice(0, idx);
    const value = l.slice(idx + 1);
    if (!input && key === 'Input') input = value;
    else if (Number.isNaN(line) && key === 'Line') line = parseInt(value, 10);
    else if (Number.isNaN(column) && key === 'Column') column = parseInt(value, 10);
    if (input && !Number.isNaN(line)) break;
  }
  return { input, line, column };
};

ipcMain.handle('synctex-forward', async (_event, payload: { texFile: string; line: number; column?: number; pdfFile?: string }) => {
  try {
    const texFile = payload?.texFile;
    if (!texFile || typeof texFile !== 'string') {
      return { success: false, error: 'Missing texFile.' };
    }
    const line = Math.max(1, Math.floor(Number(payload?.line) || 1));
    const column = Math.max(0, Math.floor(Number(payload?.column) || 0));
    const dir = path.dirname(texFile);
    const base = path.basename(texFile, path.extname(texFile));
    const pdfFile = payload?.pdfFile && typeof payload.pdfFile === 'string'
      ? payload.pdfFile
      : path.join(dir, `${base}.pdf`);
    if (!(await pathExists(pdfFile))) {
      return { success: false, error: 'No compiled PDF found. Compile the document first.' };
    }
    const inputArg = `${line}:${column}:${texFile}`;
    const { stdout } = await execFileAsync('synctex', ['view', '-i', inputArg, '-o', pdfFile], { cwd: path.dirname(pdfFile), timeout: 15000 } as any);
    const rects = parseSyncTexViewOutput(stdout);
    if (rects.length === 0) {
      return { success: false, error: 'No matching location in PDF (is synctex enabled?).' };
    }
    return { success: true, rects, pdfFile };
  } catch (error: any) {
    const msg = (error && (error.stderr || error.message)) || 'synctex view failed.';
    return { success: false, error: msg };
  }
});

ipcMain.handle('synctex-inverse', async (_event, payload: { pdfFile: string; page: number; h: number; v: number }) => {
  try {
    const pdfFile = payload?.pdfFile;
    if (!pdfFile || typeof pdfFile !== 'string') {
      return { success: false, error: 'Missing pdfFile.' };
    }
    const page = Math.max(1, Math.floor(Number(payload?.page) || 1));
    const h = Number(payload?.h);
    const v = Number(payload?.v);
    if (!Number.isFinite(h) || !Number.isFinite(v)) {
      return { success: false, error: 'Invalid coordinates.' };
    }
    if (!(await pathExists(pdfFile))) {
      return { success: false, error: 'PDF not found.' };
    }
    const dir = path.dirname(pdfFile);
    const inputArg = `${page}:${h.toFixed(2)}:${v.toFixed(2)}:${pdfFile}`;
    const { stdout } = await execFileAsync('synctex', ['edit', '-o', inputArg], { cwd: dir, timeout: 15000 } as any);
    const parsed = parseSyncTexEditOutput(stdout);
    if (!parsed.input || Number.isNaN(parsed.line)) {
      return { success: false, error: 'No source mapping found for that location.' };
    }
    return {
      success: true,
      file: parsed.input,
      line: parsed.line,
      column: Number.isFinite(parsed.column) && parsed.column > 0 ? parsed.column : 1,
    };
  } catch (error: any) {
    const msg = (error && (error.stderr || error.message)) || 'synctex edit failed.';
    return { success: false, error: msg };
  }
});

