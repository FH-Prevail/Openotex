import { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import chokidar, { FSWatcher } from 'chokidar';
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

// spawn collector with timeout
const spawnCollect = (command: string, args: string[], options: any = {}, timeoutMs = 120000): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'pipe' }) as ChildProcessWithoutNullStreams;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        try { child.kill(); } catch {}
      }
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      (err as any).stdout = stdout;
      (err as any).stderr = stderr;
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code && code !== 0) {
        const error: any = new Error(`Process exited with code ${code}`);
        error.stdout = stdout; error.stderr = stderr; error.code = code;
        reject(error);
      } else {
        resolve({ stdout, stderr, code });
      }
    });
  });
};

let mainWindow: BrowserWindow | null = null;
// Git-only terminal sessions (stores running process and cwd per sender)
const gitTerminalSessions = new Map<number, { cwd: string; proc: ChildProcessWithoutNullStreams | null }>();
const fileWatchers = new Map<number, { watcher: FSWatcher; root: string }>();

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
    title: 'Openotex',
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
    const child = spawn(process.platform === 'win32' ? 'git.exe' : 'git', args, {
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
    /Font encoding.*not available/i
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

// Helper function to detect missing package errors
const detectMissingPackage = (output: string): string | null => {
  const packagePatterns = [
    /! LaTeX Error: File `([^']+\.sty)' not found/,
    /! Package .* Error:.*package `([^']+)'/,
    /LaTeX Error: File `([^']+\.sty)' not found/,
    /Cannot find file `([^']+\.sty)'/
  ];

  for (const pattern of packagePatterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      // Extract package name without .sty extension
      return match[1].replace(/\.sty$/, '');
    }
  }
  return null;
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
    /Rerun to get outlines right/i
  ];
  return recompilePatterns.some(pattern => pattern.test(output));
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
      '-synctex=1',
      `-output-directory=${dir}`,
      texFilePath
    ];

    console.log('Compiling LaTeX with', engine, 'args:', args.join(' '));

    const runLatexEngine = async () => {
      return spawnCollect(engine, args, { cwd: dir }, 120000);
    };

    let currentAttempt: { stdout: string; stderr: string } | undefined;
    let attemptCount = 0;
    const maxAttempts = 5; // Maximum compilation attempts
    let installedPackages = new Set<string>(); // Track installed packages to avoid loops
    let attemptedFontFallback = false;

    while (attemptCount < maxAttempts) {
      attemptCount++;
      console.log(`Compilation attempt ${attemptCount}/${maxAttempts}`);

      try {
        currentAttempt = await runLatexEngine();
        const output = currentAttempt.stdout + currentAttempt.stderr;

        // Check if recompilation is needed for references/citations
        if (needsRecompilation(output) && attemptCount < maxAttempts) {
          console.log('Recompilation needed for references/citations');
          continue; // Run again
        }

        // Compilation successful and no recompilation needed
        break;

      } catch (error: any) {
        const errorOutput = (error.stdout || '') + (error.stderr || '');

        // Check for citation/bibliography errors - clean auxiliary files and retry
        if (detectCitationError(errorOutput) && attemptCount === 1) {
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
            continue; // Retry compilation
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
              continue; // Retry compilation
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
                success: false,
                error: 'Font installation failed',
                log: errorOutput,
                details: 'Unknown LaTeX distribution. Install fonts manually.'
              };
            }

            const installResult = await installLatexFonts(distribution);

            if (installResult.success) {
              console.log('Fonts installed, retrying compilation...');
              event.sender.send('compilation-status', {
                stage: 'retry',
                message: 'Fonts installed successfully. Retrying compilation...'
              });
              continue; // Retry compilation
            } else {
              return {
                success: false,
                error: 'Font installation failed',
                log: errorOutput,
                details: installResult.message
              };
            }
          }
        }

        // Check for missing packages
        const missingPackage = detectMissingPackage(errorOutput);
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
            continue; // Retry compilation
          } else {
            return {
              success: false,
              error: `Failed to install package: ${missingPackage}`,
              log: errorOutput,
              details: installResult.message
            };
          }
        }

        // If we've exhausted attempts or it's not a recoverable error, return the error
        if (attemptCount >= maxAttempts) {
          return {
            success: false,
            error: 'Compilation failed after multiple attempts',
            log: errorOutput,
            details: error.message || 'Maximum compilation attempts reached'
          };
        }

        // Re-throw for unrecoverable errors
        throw error;
      }
    }

    if (!currentAttempt) {
      return {
        success: false,
        error: 'Compilation failed - no successful attempt',
        log: '',
        details: 'Failed to compile after all attempts'
      };
    }

    const { stdout, stderr } = currentAttempt;

    let combinedStdout = stdout;
    let combinedStderr = stderr;

    let ranBibtex = false;
    try {
      const auxContent = await fs.readFile(auxPath, 'utf-8');
      if (auxContent.includes('\\bibdata') || auxContent.includes('\\citation')) {
        console.log('Running BibTeX:', filename);
        const { stdout: bibStdout, stderr: bibStderr } = await execFileAsync('bibtex', [filename], { cwd: dir });
        combinedStdout += `\n\n[BibTeX]\n${bibStdout}`;
        combinedStderr += `\n\n[BibTeX]\n${bibStderr}`;
        ranBibtex = true;
      }
    } catch (bibError) {
      console.warn('BibTeX step skipped or failed:', bibError);
    }

    if (ranBibtex) {
      const secondPass = await runLatexEngine();
      combinedStdout += `\n\n[Re-run 1]\n${secondPass.stdout}`;
      combinedStderr += `\n\n[Re-run 1]\n${secondPass.stderr}`;

      const thirdPass = await runLatexEngine();
      combinedStdout += `\n\n[Re-run 2]\n${thirdPass.stdout}`;
      combinedStderr += `\n\n[Re-run 2]\n${thirdPass.stderr}`;
    }

    // Check if PDF was created
    try {
      await fs.access(pdfPath);

      // Read the PDF file
      const pdfBuffer = await fs.readFile(pdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');

      return {
        success: true,
        pdfPath,
        pdfData: pdfBase64,
        log: combinedStdout,
        warnings: combinedStderr
      };
    } catch (err) {
      // PDF not created, compilation failed
      return {
        success: false,
        error: 'Compilation failed - PDF not generated',
        log: combinedStdout,
        details: combinedStderr
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Compilation error',
      log: error.stdout || '',
      details: error.stderr || ''
    };
  }
});

