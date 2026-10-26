// LaTeX tooling shared by the Electron main process and the Openotex MCP
// server. Nothing in here may import Electron: the MCP server runs as plain
// Node.js (ELECTRON_RUN_AS_NODE=1 or a regular node binary).
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { constants as fsConstants, existsSync, readdirSync, realpathSync, statSync } from 'fs';
import { execFile, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import {
  detectMissingLatexPackage,
  LatexDiagnostic,
  parseLatexDiagnostics,
  summarizeLatexError,
} from '../shared/latexDiagnostics';
import {
  extractBibEntries,
  extractIncludes,
  extractLabels,
  findMagicRoot,
  hasDocumentClass,
  stripLatexComments,
} from '../shared/latexProject';
import {
  FONT_PACKAGES,
  TexInstallPlan,
  TexPackageManager,
  canInstallSilently,
  isSystemPackageManager,
  isValidTexPackageName,
  latexInstallSuggestion,
  planTexPackageInstall,
  texPackageFor,
} from '../shared/texPackages';

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

// execFile promise wrapper to avoid shell interpolation
const execFileAsync = (
  file: string,
  args: readonly string[] = [],
  options: any = {}
): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const finalOptions = { windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...(options || {}), encoding: 'utf8' };
    execFile(file, args as string[], finalOptions as any, (error, stdout: any, stderr: any) => {
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

// LaTeX tools spawn helpers (latexmk -> perl -> pdflatex, biber, ...). Killing
// only the direct child leaves those running and holding locks on the PDF, so
// always terminate the whole process tree.
const killProcessTree = (child: ChildProcessWithoutNullStreams) => {
  if (!child.pid || child.exitCode !== null) {
    return;
  }
  if (isWindows) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch {
      try { child.kill(); } catch {}
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
};

const cancelProcessToken = (token: ProcessCancelToken) => {
  token.cancelled = true;
  for (const child of token.processes) {
    killProcessTree(child);
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

    const child = spawn(command, args, {
      ...options,
      stdio: 'pipe',
      windowsHide: true,
      // A separate process group lets us terminate the whole tree on POSIX.
      detached: !isWindows,
    }) as ChildProcessWithoutNullStreams;
    cancelToken?.processes.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        killProcessTree(child);
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
        error.stdout = stdout; error.stderr = stderr; error.cancelled = true;
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

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const normalizeForCompare = (targetPath: string): string => {
  const normalized = path.normalize(path.resolve(targetPath));
  return isWindows || isMac ? normalized.toLowerCase() : normalized;
};

const samePath = (a: string, b: string) => normalizeForCompare(a) === normalizeForCompare(b);

const isInsideDirectory = (target: string, directory: string) => {
  const relative = path.relative(normalizeForCompare(directory), normalizeForCompare(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// Desktop launchers (and AppImages started from a file manager) often do not
// inherit the shell PATH that contains the TeX binaries. Add the standard
// install locations of MiKTeX, TeX Live, MacTeX and TinyTeX when they exist.
const listTexLiveYearDirs = (base: string): string[] => {
  try {
    return readdirSync(base)
      .filter(name => /^\d{4}$/.test(name))
      .sort()
      .reverse()
      .map(name => path.join(base, name));
  } catch {
    return [];
  }
};

const augmentPathWithTexDistributions = () => {
  const home = os.homedir();
  const candidates: string[] = [];

  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      path.join(localAppData, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
      path.join(programFiles, 'MiKTeX', 'miktex', 'bin', 'x64'),
      path.join(programFilesX86, 'MiKTeX', 'miktex', 'bin'),
      path.join(appData, 'TinyTeX', 'bin', 'windows'),
      path.join(appData, 'TinyTeX', 'bin', 'win32'),
    );
    for (const yearDir of listTexLiveYearDirs('C:\\texlive')) {
      candidates.push(path.join(yearDir, 'bin', 'windows'), path.join(yearDir, 'bin', 'win64'), path.join(yearDir, 'bin', 'win32'));
    }
  } else if (isMac) {
    candidates.push(
      '/Library/TeX/texbin',
      '/usr/local/bin',
      '/opt/homebrew/bin',
      path.join(home, 'Library', 'TinyTeX', 'bin', 'universal-darwin'),
    );
  } else {
    const arch = process.arch === 'arm64' ? 'aarch64-linux' : 'x86_64-linux';
    for (const base of ['/usr/local/texlive', '/opt/texlive', path.join(home, 'texlive')]) {
      for (const yearDir of listTexLiveYearDirs(base)) {
        candidates.push(path.join(yearDir, 'bin', arch));
      }
    }
    candidates.push(
      path.join(home, '.TinyTeX', 'bin', arch),
      '/usr/bin',
      '/usr/local/bin',
      '/snap/bin',
      path.join(home, '.local', 'bin'),
      path.join(home, 'bin'),
    );
  }

  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const known = new Set(current.map(entry => normalizeForCompare(entry)));
  const additions = candidates.filter(dir => {
    if (known.has(normalizeForCompare(dir))) return false;
    try {
      return existsSync(dir);
    } catch {
      return false;
    }
  });
  if (additions.length > 0) {
    process.env.PATH = [...current, ...additions].join(path.delimiter);
  }
};

// Results of TeX tool probes are cached briefly; probing spawns processes and
// used to run on every single compilation.
const PROBE_CACHE_MS = 5 * 60 * 1000;
let distributionCache: { value: 'miktex' | 'texlive' | 'unknown'; at: number } | null = null;
let latexmkCache: { value: boolean; at: number } | null = null;

const detectLatexDistribution = async (): Promise<'miktex' | 'texlive' | 'unknown'> => {
  if (distributionCache && Date.now() - distributionCache.at < PROBE_CACHE_MS) {
    return distributionCache.value;
  }
  let value: 'miktex' | 'texlive' | 'unknown' = 'unknown';
  try {
    const { stdout } = await execFileAsync('pdflatex', ['--version'], { timeout: 15000 });
    const normalized = stdout.toLowerCase();
    if (normalized.includes('miktex')) {
      value = 'miktex';
    } else if (normalized.includes('tex live')) {
      value = 'texlive';
    }
  } catch {
    // ignored – we'll report as unknown below
  }
  distributionCache = { value, at: Date.now() };
  return value;
};

const isLatexmkAvailable = async (): Promise<boolean> => {
  if (latexmkCache && Date.now() - latexmkCache.at < PROBE_CACHE_MS) {
    return latexmkCache.value;
  }
  let value = false;
  try {
    await execFileAsync('latexmk', ['-v'], { timeout: 15000 });
    value = true;
  } catch {
    value = false;
  }
  latexmkCache = { value, at: Date.now() };
  return value;
};

export const resetToolProbeCache = () => {
  distributionCache = null;
  latexmkCache = null;
  texSetupCache = null;
};

// --- TeX package management ----------------------------------------------------

const findOnPath = (command: string): string | null => {
  const extensions = isWindows ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, command + extension);
      try {
        if (statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // not here
      }
    }
  }
  return null;
};

const detectSystemPackageManager = (): TexPackageManager => {
  if (process.platform !== 'linux') {
    return 'unknown';
  }
  const binaries: Array<[TexPackageManager, string]> = [
    ['apt', '/usr/bin/apt-get'],
    ['dnf', '/usr/bin/dnf'],
    ['zypper', '/usr/bin/zypper'],
    ['pacman', '/usr/bin/pacman'],
  ];
  return binaries.find(([, binary]) => existsSync(binary))?.[0] ?? 'unknown';
};

type TexSetup = {
  distribution: 'miktex' | 'texlive' | 'unknown';
  manager: TexPackageManager;
  tlmgrPath?: string;
};

let texSetupCache: { value: TexSetup; at: number } | null = null;

// Works out who owns the TeX installation, which decides how packages get
// installed. Distribution TeX Live (pdflatex in /usr/bin) refuses tlmgr
// ("running on Debian, switching to user mode") and is updated through the
// system package manager instead.
const detectTexSetup = async (): Promise<TexSetup> => {
  if (texSetupCache && Date.now() - texSetupCache.at < PROBE_CACHE_MS) {
    return texSetupCache.value;
  }
  const distribution = await detectLatexDistribution();
  let manager: TexPackageManager = 'unknown';
  let tlmgrPath: string | undefined;

  const pdflatex = findOnPath('pdflatex');
  let resolvedPdflatex = pdflatex;
  try {
    if (pdflatex) resolvedPdflatex = realpathSync(pdflatex);
  } catch {
    // keep the unresolved path
  }

  if (distribution === 'miktex') {
    manager = 'miktex';
  } else if (process.platform === 'linux' && resolvedPdflatex && /^\/(usr\/)?bin\//.test(resolvedPdflatex)) {
    manager = detectSystemPackageManager();
  } else if (distribution === 'texlive') {
    const besideEngine = resolvedPdflatex ? path.join(path.dirname(resolvedPdflatex), isWindows ? 'tlmgr.bat' : 'tlmgr') : '';
    tlmgrPath = besideEngine && existsSync(besideEngine) ? besideEngine : findOnPath('tlmgr') ?? undefined;
    let writable = false;
    try {
      const { stdout } = await execFileAsync('kpsewhich', ['-var-value=TEXMFROOT'], { timeout: 15000 });
      const root = stdout.trim();
      if (root) {
        await fs.access(path.join(root, 'tlpkg'), fsConstants.W_OK);
        writable = true;
      }
    } catch {
      writable = false;
    }
    manager = tlmgrPath ? (writable ? 'tlmgr' : 'tlmgr-root') : 'unknown';
  }

  const value: TexSetup = { distribution, manager, tlmgrPath };
  texSetupCache = { value, at: Date.now() };
  return value;
};

type PackageInstallResult = {
  success: boolean;
  message: string;
  manager: TexPackageManager;
  packages: string[];
  // Set when the user has to run the install themselves.
  manualCommand?: string;
  output?: string;
};

const lastLines = (text: string, count = 6) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-count).join('\n');

const runInstallPlan = async (plan: TexInstallPlan): Promise<{ stdout: string; stderr: string }> => {
  if (plan.elevated) {
    const pkexec = findOnPath('pkexec') ?? (existsSync('/usr/bin/pkexec') ? '/usr/bin/pkexec' : null);
    if (!pkexec) {
      throw Object.assign(new Error('pkexec is not available'), { noElevation: true });
    }
    // Downloads for distribution TeX packages can be large.
    return execFileAsync(pkexec, plan.argv, { timeout: 30 * 60 * 1000 });
  }
  if (isWindows && /^tlmgr(\.bat)?$/i.test(path.basename(plan.argv[0]))) {
    // tlmgr is a batch file on Windows, which execFile cannot start directly.
    // Package names were validated, so they are safe on a cmd.exe line.
    return execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'tlmgr', ...plan.argv.slice(1)], { timeout: 10 * 60 * 1000 });
  }
  if (plan.manager === 'miktex' && !findOnPath('miktex') && findOnPath('mpm')) {
    // MiKTeX before 22.x has no `miktex` utility. Its mpm reports unknown
    // packages with exit code 0, so check the message too.
    const result = await execFileAsync('mpm', plan.packages.map(name => `--install=${name}`), { timeout: 10 * 60 * 1000 });
    if (/Sorry, but:/i.test(`${result.stdout}\n${result.stderr}`)) {
      throw Object.assign(new Error('mpm could not install the package'), result);
    }
    return result;
  }
  return execFileAsync(plan.argv[0], plan.argv.slice(1), { timeout: 10 * 60 * 1000 });
};

// `tlmgr search` finds the TeX Live package that contains a file, for
// packages whose name differs from the .sty and is not in our table.
const searchTexLivePackage = async (setup: TexSetup, fileName: string): Promise<string | null> => {
  const target = /\.(sty|cls)$/i.test(fileName) ? fileName : `${fileName}.sty`;
  const plan = planTexPackageInstall('tlmgr', ['placeholder'], { platform: process.platform, tlmgrPath: setup.tlmgrPath });
  if (!plan) return null;
  try {
    const { stdout } = await runInstallPlan({ ...plan, argv: [plan.argv[0], 'search', '--global', '--file', `/${target}`] });
    let current: string | null = null;
    for (const line of stdout.split(/\r?\n/)) {
      const header = line.match(/^([A-Za-z0-9._-]+):\s*$/);
      if (header) {
        current = header[1];
      } else if (current && line.trim().endsWith(`/${target}`)) {
        return current;
      }
    }
  } catch {
    // offline or no tlmgr: keep the original name
  }
  return null;
};

const describeInstallFailure = (error: any): string => {
  if (error?.noElevation) {
    return 'Installing system packages needs administrator rights, and no password prompt (pkexec) is available.';
  }
  if (error?.code === 126) {
    return 'The administrator password prompt was cancelled.';
  }
  if (error?.code === 127) {
    return 'Administrator rights could not be obtained (no polkit authentication agent is running).';
  }
  const detail = lastLines(`${error?.stderr || ''}\n${error?.stdout || ''}`) || error?.message || 'unknown error';
  return `The installation failed:\n${detail}`;
};

// Installs the packages that provide the given LaTeX files (names as reported
// by detectMissingLatexPackage). With `interactive: false` nothing that needs
// a password is attempted; the result then carries the manual command.
const installLatexPackages = async (
  fileNames: string[],
  options: { interactive?: boolean } = {}
): Promise<PackageInstallResult> => {
  const names = fileNames.filter(isValidTexPackageName);
  const setup = await detectTexSetup();
  if (names.length === 0) {
    return { success: false, message: 'Invalid package name.', manager: setup.manager, packages: [] };
  }
  const plan = planTexPackageInstall(setup.manager, names, { platform: process.platform, tlmgrPath: setup.tlmgrPath });
  if (!plan) {
    return {
      success: false,
      message: 'Openotex could not tell which package manager owns this LaTeX installation. Install the missing packages with your TeX distribution\'s tools.',
      manager: setup.manager,
      packages: names,
    };
  }
  if (plan.elevated && !options.interactive) {
    return {
      success: false,
      message: 'This LaTeX installation is managed by the system; installing packages needs administrator rights.',
      manager: setup.manager,
      packages: plan.packages,
      manualCommand: plan.manualCommand,
    };
  }

  const finish = async (activePlan: TexInstallPlan, output: string): Promise<PackageInstallResult> => {
    if (activePlan.manager === 'miktex') {
      await execFileAsync('initexmf', ['--update-fndb'], { timeout: 60000 }).catch(() => {});
    }
    return {
      success: true,
      message: `Installed ${activePlan.packages.join(', ')}`,
      manager: activePlan.manager,
      packages: activePlan.packages,
      output,
    };
  };

  try {
    console.log(`Installing LaTeX packages via ${plan.manager}: ${plan.packages.join(' ')}`);
    const { stdout, stderr } = await runInstallPlan(plan);
    return await finish(plan, `${stdout}\n${stderr}`);
  } catch (error: any) {
    const output = `${error?.stdout || ''}\n${error?.stderr || ''}`;
    // tlmgr only knows package names; look up the package that has the file.
    if ((plan.manager === 'tlmgr' || plan.manager === 'tlmgr-root') && /not present in repository|unknown package/i.test(output)) {
      const resolved = await Promise.all(names.map(async name => (await searchTexLivePackage(setup, name)) ?? texPackageFor(name)));
      const retryPlan = planTexPackageInstall(setup.manager, resolved, { platform: process.platform, tlmgrPath: setup.tlmgrPath });
      if (retryPlan && retryPlan.packages.join(' ') !== plan.packages.join(' ')) {
        try {
          const { stdout, stderr } = await runInstallPlan(retryPlan);
          return await finish(retryPlan, `${stdout}\n${stderr}`);
        } catch (retryError: any) {
          error = retryError;
        }
      }
    }
    console.error(`Package installation failed (${plan.manager}):`, error?.message || error);
    return {
      success: false,
      message: describeInstallFailure(error),
      manager: plan.manager,
      packages: plan.packages,
      manualCommand: plan.manualCommand,
      output,
    };
  }
};

// Text for the preview when a package is missing and cannot be installed
// without the user (system-managed or unknown TeX installations).
const manualInstallHint = async (fileNames: string[], label?: string): Promise<{ message: string; command?: string }> => {
  const setup = await detectTexSetup();
  const plan = planTexPackageInstall(setup.manager, fileNames, { platform: process.platform, tlmgrPath: setup.tlmgrPath });
  const what = label ?? fileNames.map(name => (/\.(sty|cls)$/i.test(name) ? name : `${name}.sty`)).join(', ');
  if (!plan) {
    return { message: `${what} is not installed. Install it with your TeX distribution's package manager.` };
  }
  const owner = isSystemPackageManager(setup.manager) ? `your system package manager (${setup.manager})` : setup.manager;
  return { message: `${what} is not installed. This LaTeX installation is managed by ${owner}; install it with:`, command: plan.manualCommand };
};

// --- Multi-file project support -------------------------------------------------

const PROJECT_SCAN_SKIP_DIRS = new Set(['.git', '.svn', '.hg', '.openotex', 'node_modules', '__pycache__']);
const TEX_EXTENSIONS = new Set(['.tex', '.ltx', '.latex']);

const collectProjectFiles = async (
  root: string,
  extensions: Set<string>,
  limit = 1500,
  maxDepth = 8
): Promise<string[]> => {
  const results: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (results.length >= limit || depth > maxDepth) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip VCS/build folders and Instant Backup snapshot folders.
        if (PROJECT_SCAN_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') || entry.name.endsWith('_backups_')) {
          continue;
        }
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  };
  await walk(root, 0);
  return results;
};

const readTextFile = async (filePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

const withTexExtension = (filePath: string) => (path.extname(filePath) ? filePath : `${filePath}.tex`);

// Find the document that should actually be compiled for `texFilePath`:
// 1. a `% !TEX root = ...` magic comment, 2. the file itself when it has a
// \documentclass, 3. the nearest file with a \documentclass that (directly or
// through other files) \input/\include-s it.
const resolveRootDocument = async (texFilePath: string, projectRoot?: string): Promise<string> => {
  const source = await readTextFile(texFilePath);
  if (source === null) {
    return texFilePath;
  }

  let current = texFilePath;
  let currentSource = source;
  for (let hop = 0; hop < 4; hop++) {
    const magic = findMagicRoot(currentSource);
    if (!magic) break;
    const target = withTexExtension(path.resolve(path.dirname(current), magic));
    if (samePath(target, current)) break;
    const targetSource = await readTextFile(target);
    if (targetSource === null) break;
    current = target;
    currentSource = targetSource;
  }
  if (!samePath(current, texFilePath)) {
    return current;
  }

  if (hasDocumentClass(source)) {
    return texFilePath;
  }

  const searchRoot = projectRoot && isInsideDirectory(texFilePath, projectRoot)
    ? projectRoot
    : path.dirname(texFilePath);
  const files = await collectProjectFiles(searchRoot, TEX_EXTENSIONS);
  const parents = new Map<string, string[]>();
  const rootFiles = new Set<string>();

  for (const file of files) {
    const content = await readTextFile(file);
    if (content === null) continue;
    const stripped = stripLatexComments(content);
    if (hasDocumentClass(stripped)) {
      rootFiles.add(normalizeForCompare(file));
    }
    for (const target of extractIncludes(stripped)) {
      // LaTeX resolves inputs relative to the root document's folder; nested
      // projects often also use paths relative to the including file.
      const candidates = [
        withTexExtension(path.resolve(path.dirname(file), target)),
        withTexExtension(path.resolve(searchRoot, target)),
      ];
      for (const candidate of candidates) {
        const key = normalizeForCompare(candidate);
        const list = parents.get(key) ?? [];
        if (!list.includes(file)) list.push(file);
        parents.set(key, list);
      }
    }
  }

  const queue = [texFilePath];
  const seen = new Set<string>([normalizeForCompare(texFilePath)]);
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const parent of parents.get(normalizeForCompare(next)) ?? []) {
      const key = normalizeForCompare(parent);
      if (seen.has(key)) continue;
      if (rootFiles.has(key)) {
        return parent;
      }
      seen.add(key);
      queue.push(parent);
    }
  }

  return texFilePath;
};

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

// Diagnostics from `-file-line-error` use paths relative to the root folder;
// make them absolute so the editor can open the right file.
// The console and the .log spell the same file differently ("a.tex" vs
// "./a.tex"), so duplicates are removed after resolving.
const resolveDiagnosticFiles = (diagnostics: LatexDiagnostic[], rootDir: string): LatexDiagnostic[] => {
  const seen = new Set<string>();
  return diagnostics
    .map(diagnostic => (
      diagnostic.file
        ? { ...diagnostic, file: path.normalize(path.resolve(rootDir, diagnostic.file)) }
        : diagnostic
    ))
    .filter(diagnostic => {
      const key = `${diagnostic.severity}|${diagnostic.file ? normalizeForCompare(diagnostic.file) : ''}|${diagnostic.line ?? ''}|${diagnostic.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// Labels and bibliography keys of a project, e.g. for \ref / \cite completion.
// Cached briefly because the editor asks on every completion request.
export type LatexReferences = {
  success: boolean;
  error?: string;
  labels: Array<{ key: string; file: string; line: number }>;
  citations: Array<{ key: string; type: string; title?: string; file: string }>;
};

const referenceCache = new Map<string, { at: number; data: LatexReferences }>();

export const collectLatexReferences = async (projectRoot: string, maxAgeMs = 4000): Promise<LatexReferences> => {
  const cacheKey = normalizeForCompare(projectRoot);
  const cached = referenceCache.get(cacheKey);
  if (cached && Date.now() - cached.at < maxAgeMs) {
    return cached.data;
  }
  try {
    const files = await collectProjectFiles(projectRoot, new Set([...TEX_EXTENSIONS, '.bib']), 1500);
    const labels: LatexReferences['labels'] = [];
    const citations: LatexReferences['citations'] = [];
    for (const file of files) {
      const content = await readTextFile(file);
      if (content === null) continue;
      if (path.extname(file).toLowerCase() === '.bib') {
        extractBibEntries(content).forEach(entry => citations.push({ ...entry, file }));
      } else {
        extractLabels(content).forEach(label => labels.push({ ...label, file }));
      }
    }
    const data = { success: true, labels, citations };
    referenceCache.set(cacheKey, { at: Date.now(), data });
    return data;
  } catch (error) {
    return { success: false, error: (error as Error).message, labels: [], citations: [] };
  }
};


export type LatexEngine = 'pdflatex' | 'xelatex' | 'lualatex';
export type CompileOptions = { projectRoot?: string; force?: boolean; includePdfData?: boolean };
export type CompileHooks = {
  onStatus?: (status: { stage: string; message: string }) => void;
  cancelToken?: ProcessCancelToken;
};
export type CompileResult = {
  success: boolean;
  error?: string;
  log?: string;
  warnings?: string;
  details?: string;
  pdfPath?: string;
  pdfData?: string;
  rootFile: string;
  cancelled?: boolean;
  notDocument?: boolean;
  // How to install a missing package/font when Openotex cannot do it alone.
  installHint?: { message: string; command?: string };
  diagnostics: LatexDiagnostic[];
};

// Compile LaTeX file
const compileLatexDocumentUnlocked = async (
  texFilePath: string,
  engine: LatexEngine = 'pdflatex',
  options: CompileOptions = {},
  hooks: CompileHooks = {}
): Promise<CompileResult> => {
  const cancelToken: ProcessCancelToken = hooks.cancelToken ?? { cancelled: false, processes: new Set() };
  const sendStatus = (status: { stage: string; message: string }) => {
    if (!cancelToken.cancelled) {
      hooks.onStatus?.(status);
    }
  };

  let rootFile = texFilePath;

  try {
    rootFile = await resolveRootDocument(texFilePath, options?.projectRoot);
    const dir = path.dirname(rootFile);
    const filename = path.basename(rootFile, path.extname(rootFile));
    const pdfPath = path.join(dir, `${filename}.pdf`);
    const auxPath = path.join(dir, `${filename}.aux`);
    const texSetup = await detectTexSetup();
    // Installs that would need a password are left to the user.
    const autoInstall = canInstallSilently(texSetup.manager);
    const forceRebuild = Boolean(options?.force);

    if (!samePath(rootFile, texFilePath)) {
      sendStatus({ stage: 'compile', message: `Compiling root document ${path.basename(rootFile)}...` });
    }

    // A loose fragment (no \documentclass, no \begin{document}, not included
    // anywhere) cannot be compiled; explain that instead of a LaTeX error.
    const rootSource = await readTextFile(rootFile);
    if (rootSource !== null && !hasDocumentClass(rootSource) && !/\\begin\s*\{document\}/.test(stripLatexComments(rootSource))) {
      return {
        success: false,
        notDocument: true,
        rootFile,
        error: `${path.basename(rootFile)} is not a complete LaTeX document and no other file includes it. ` +
          'Open the main document, or add "% !TEX root = main.tex" at the top of this file.',
        log: '',
        details: '',
        diagnostics: [],
      };
    }

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
      rootFile
    ];

    console.log('Compiling LaTeX with', engine, 'args:', args.join(' '));

    // Allow up to 5 minutes per pass — large documents or first-time package
    // downloads can easily exceed the old 2-minute limit.
    const runLatexEngine = async () => {
      return spawnCollect(engine, args, { cwd: dir }, 300000, cancelToken);
    };

    const installedPackages = new Set<string>(); // Track installed packages to avoid loops
    let attemptedFontFallback = false;

    const diagnosticsFor = (output: string) => resolveDiagnosticFiles(parseLatexDiagnostics(output, rootFile), dir);

    // `engineLog` is the .log written by the last LaTeX run. latexmk may stop
    // in a later step (e.g. BibTeX failing on an incomplete .aux) without
    // printing the LaTeX error again, so the log is where the cause is.
    const makeFailure = (output: string, details = '', engineLog = '') => {
      const combined = engineLog ? `${output}\n${engineLog}` : output;
      const logTail = engineLog.split(/\r?\n/).slice(-300).join('\n');
      return {
        success: false,
        error: summarizeLatexError(combined, rootFile),
        log: engineLog ? `${output}\n\n----- ${filename}.log (last LaTeX run) -----\n${logTail}` : output,
        details,
        rootFile,
        cancelled: cancelToken.cancelled,
        diagnostics: diagnosticsFor(combined)
      };
    };

    // TeX deletes its PDF when a later run fails, and external viewers lock
    // the file on Windows. Preview, export, "open externally" and SyncTeX
    // therefore use a copy of the last successful PDF (and its SyncTeX data).
    const publishViewCopy = async (sourcePdf: string): Promise<string> => {
      const viewDir = path.join(dir, '.openotex', 'build', filename);
      const viewPdf = path.join(viewDir, `${filename}.view.pdf`);
      try {
        await fs.mkdir(viewDir, { recursive: true });
        await fs.copyFile(sourcePdf, viewPdf);
        const sourceSynctex = sourcePdf.replace(/\.pdf$/i, '.synctex.gz');
        if (await pathExists(sourceSynctex)) {
          await fs.copyFile(sourceSynctex, path.join(viewDir, `${filename}.view.synctex.gz`));
        }
        return viewPdf;
      } catch (error) {
        console.warn('Could not update the preview copy of the PDF:', error);
        return sourcePdf;
      }
    };

    // On success, warnings come from the final engine log: the console output
    // also contains warnings of earlier passes that later passes resolved.
    const readCompiledPdf = async (log: string, warnings = '', targetPdfPath = pdfPath, engineLogPath = path.join(dir, `${filename}.log`)) => {
      const engineLog = await readTextFile(engineLogPath);
      try {
        await fs.access(targetPdfPath);
        const pdfBuffer = await fs.readFile(targetPdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');

        return {
          success: true,
          pdfPath: await publishViewCopy(targetPdfPath),
          pdfData: options?.includePdfData === false ? undefined : pdfBase64,
          rootFile,
          log,
          warnings,
          diagnostics: diagnosticsFor(engineLog ?? `${log}\n${warnings}`)
        };
      } catch {
        return {
          success: false,
          error: 'Compilation failed - PDF not generated',
          log,
          details: warnings,
          rootFile,
          diagnostics: diagnosticsFor(`${log}\n${warnings}\n${engineLog ?? ''}`)
        };
      }
    };

    const cleanAuxiliaryFiles = async (auxDir: string) => {
      await fs.unlink(path.join(auxDir, `${filename}.aux`)).catch(() => {});
      await fs.unlink(path.join(auxDir, `${filename}.out`)).catch(() => {});
      await fs.unlink(path.join(auxDir, `${filename}.bbl`)).catch(() => {});
    };

    type Recovery = { retry: boolean; installHint?: CompileResult['installHint'] };

    const recoverFromLatexFailure = async (errorOutput: string, attemptCount: number, auxDir: string): Promise<Recovery> => {
        // Check for citation/bibliography errors - clean auxiliary files and retry
        if (detectCitationError(errorOutput) && attemptCount <= 2) {
          console.log('Citation error detected, cleaning auxiliary files...');

          sendStatus({
            stage: 'cleaning',
            message: 'Cleaning corrupted auxiliary files...'
          });

          try {
            // Delete potentially corrupted auxiliary files
            await cleanAuxiliaryFiles(auxDir);

            console.log('Auxiliary files cleaned, retrying compilation...');
            sendStatus({
              stage: 'retry',
              message: 'Auxiliary files cleaned. Retrying compilation...'
            });
            return { retry: true };
          } catch (cleanError) {
            console.error('Failed to clean auxiliary files:', cleanError);
          }
        }

        // Missing packages first: "File `x.sty' not found" also matches the
        // broad font patterns below.
        const missingPackage = detectMissingLatexPackage(errorOutput);
        if (missingPackage) {
          if (!autoInstall) {
            // System-managed TeX needs a password: the preview offers the
            // install instead of a prompt appearing during compilation.
            return { retry: false, installHint: await manualInstallHint([missingPackage]) };
          }
          if (!installedPackages.has(missingPackage)) {
            installedPackages.add(missingPackage);
            sendStatus({
              stage: 'package-installation',
              message: `Installing missing LaTeX package: ${missingPackage}...`
            });
            const installResult = await installLatexPackages([missingPackage]);
            if (installResult.success) {
              sendStatus({ stage: 'retry', message: `Package ${missingPackage} installed. Retrying compilation...` });
              return { retry: true };
            }
            return {
              retry: false,
              installHint: { message: `Installing ${missingPackage} failed. ${installResult.message}`, command: installResult.manualCommand },
            };
          }
          return {
            retry: false,
            installHint: {
              message: `${missingPackage} is still missing after installing "${texPackageFor(missingPackage)}". ` +
                'Check the spelling, or find the package that provides this file in your TeX distribution\'s package manager.',
            },
          };
        }

        // Fonts TeX tries to generate with METAFONT (T1 encoding without
        // cm-super or lmodern).
        const fontError = detectFontError(errorOutput);
        const fontsMissing = /This is METAFONT|mktextfm|\.tfm'|No file .+\.tfm/i.test(errorOutput);
        if (fontError.hasError && fontsMissing) {
          if (!autoInstall) {
            return { retry: false, installHint: await manualInstallHint(FONT_PACKAGES, 'The EC/CM-Super fonts are') };
          }
          if (!attemptedFontFallback) {
            attemptedFontFallback = true;
            sendStatus({
              stage: 'font-installation',
              message: 'Installing required LaTeX fonts (EC, CM-Super)... This may take a few minutes.'
            });
            const installResult = await installLatexPackages(FONT_PACKAGES);
            if (installResult.success) {
              sendStatus({ stage: 'retry', message: 'Fonts installed successfully. Retrying compilation...' });
              return { retry: true };
            }
            return {
              retry: false,
              installHint: { message: `Installing the EC/CM-Super fonts failed. ${installResult.message}`, command: installResult.manualCommand },
            };
          }
        }

        return { retry: false };
    };

    const compileWithLatexmk = async () => {
      const latexmkOutputDir = path.join(dir, '.openotex', 'build', filename);
      const latexmkPdfPath = path.join(latexmkOutputDir, `${filename}.pdf`);
      const latexmkLogPath = path.join(latexmkOutputDir, `${filename}.log`);
      await fs.mkdir(latexmkOutputDir, { recursive: true });
      // \include{chapters/intro} writes chapters/intro.aux inside the output
      // directory, which TeX cannot do unless that sub-folder exists.
      for (const target of rootSource ? extractIncludes(rootSource) : []) {
        const subDir = path.dirname(target);
        if (subDir && subDir !== '.' && !path.isAbsolute(subDir) && !subDir.startsWith('..')) {
          await fs.mkdir(path.join(latexmkOutputDir, subDir), { recursive: true }).catch(() => {});
        }
      }

      // BibTeX/Biber run inside the output folder and need to find the .bib
      // and .bst files of the document folder. latexmk adds that folder to
      // BIBINPUTS itself, but with a Unix-style path when it runs under an
      // MSYS/Cygwin Perl, which native Windows TeX cannot read. The trailing
      // separator keeps the distribution's default search path.
      const withDocumentFolder = (existing?: string) => (
        [dir, existing].filter(Boolean).join(path.delimiter) + path.delimiter
      );
      const latexmkEnv = {
        ...process.env,
        BIBINPUTS: withDocumentFolder(process.env.BIBINPUTS),
        BSTINPUTS: withDocumentFolder(process.env.BSTINPUTS),
      };

      const latexmkMode = engine === 'xelatex' ? '-xelatex' : engine === 'lualatex' ? '-lualatex' : '-pdf';
      // Incremental by default: latexmk only reruns what changed, so
      // switching tabs or saving without edits is nearly instant. `-g` forces
      // a full rebuild when requested or when latexmk refuses to retry a
      // document whose previous run failed.
      let forceNext = forceRebuild;
      const buildArgs = () => [
        latexmkMode,
        ...(forceNext ? ['-g'] : []),
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-file-line-error',
        '-synctex=1',
        `-outdir=${latexmkOutputDir}`,
        rootFile
      ];

      const maxLatexmkAttempts = 4;
      for (let attempt = 1; attempt <= maxLatexmkAttempts; attempt++) {
        console.log(`Compilation attempt ${attempt}/${maxLatexmkAttempts} using latexmk`);
        sendStatus({
          stage: 'compile',
          message: attempt === 1 ? 'Compiling with latexmk...' : `Retrying with latexmk (${attempt}/${maxLatexmkAttempts})...`
        });

        try {
          const result = await spawnCollect('latexmk', buildArgs(), { cwd: dir, env: latexmkEnv }, 300000, cancelToken);
          return await readCompiledPdf(result.stdout, result.stderr, latexmkPdfPath, latexmkLogPath);
        } catch (error: any) {
          if (cancelToken.cancelled) {
            return makeFailure('', 'Compilation cancelled');
          }
          const errorOutput = (error.stdout || '') + (error.stderr || '');
          if (!forceNext && /in previous invocation of latexmk/i.test(errorOutput)) {
            forceNext = true;
            continue;
          }
          forceNext = true;
          const recovery = await recoverFromLatexFailure(errorOutput, attempt, latexmkOutputDir);
          if (recovery.retry && attempt < maxLatexmkAttempts) {
            continue;
          }
          return {
            ...makeFailure(errorOutput, error.message || 'latexmk failed', (await readTextFile(latexmkLogPath)) ?? ''),
            installHint: recovery.installHint,
          };
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
      sendStatus({
        stage: 'compile',
        message: attemptCount === 1 ? 'Compiling...' : `Retrying compilation (${attemptCount}/${maxAttempts})...`
      });

      try {
        currentAttempt = await runLatexEngine();
        break;
      } catch (error: any) {
        if (cancelToken.cancelled) {
          return makeFailure('', 'Compilation cancelled');
        }
        const errorOutput = (error.stdout || '') + (error.stderr || '');
        const recovery = await recoverFromLatexFailure(errorOutput, attemptCount, dir);
        if (recovery.retry && attemptCount < maxAttempts) {
          continue;
        }

        return { ...makeFailure(errorOutput, error.message || 'Compilation failed'), installHint: recovery.installHint };
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
        sendStatus({ stage: 'biber', message: 'Running Biber bibliography processor...' });
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
          sendStatus({ stage: 'bibtex', message: 'Running BibTeX bibliography processor...' });
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
        sendStatus({ stage: 'makeindex', message: 'Generating document index...' });
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
        sendStatus({
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
    const rootDir = path.dirname(rootFile);
    return {
      success: false,
      error: output.trim() ? summarizeLatexError(output, rootFile) : (error.message || 'Compilation error'),
      log: error.stdout || '',
      details: error.stderr || '',
      rootFile,
      cancelled: cancelToken.cancelled,
      diagnostics: output.trim() ? resolveDiagnosticFiles(parseLatexDiagnostics(output, rootFile), rootDir) : []
    };
  }
};

// The editor and the MCP server (driven by a coding agent) may compile the
// same document at the same time. Two LaTeX runs in one build folder corrupt
// each other's files, so builds of a document take turns via a lock file.
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 6 * 60 * 1000;

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
};

const acquireBuildLock = async (lockPath: string, cancelToken: ProcessCancelToken): Promise<(() => Promise<void>) | null> => {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const started = Date.now();
  while (!cancelToken.cancelled) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      await handle.close();
      return async () => { await fs.unlink(lockPath).catch(() => {}); };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') {
        // The build folder is not writable; compile without a lock.
        return async () => {};
      }
    }
    try {
      const [stat, content] = await Promise.all([fs.stat(lockPath), fs.readFile(lockPath, 'utf8')]);
      const owner = Number(JSON.parse(content || '{}').pid);
      const stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS || (Number.isFinite(owner) && owner > 0 && !isProcessAlive(owner));
      if (stale) {
        await fs.unlink(lockPath).catch(() => {});
        continue;
      }
    } catch {
      // The lock vanished between open and stat, or is being written; retry.
    }
    if (Date.now() - started > LOCK_WAIT_MS) {
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return null;
};

export const compileLatexDocument = async (
  texFilePath: string,
  engine: LatexEngine = 'pdflatex',
  options: CompileOptions = {},
  hooks: CompileHooks = {}
): Promise<CompileResult> => {
  const cancelToken: ProcessCancelToken = hooks.cancelToken ?? { cancelled: false, processes: new Set() };
  const rootFile = await resolveRootDocument(texFilePath, options?.projectRoot).catch(() => texFilePath);
  const name = path.basename(rootFile, path.extname(rootFile));
  const lockPath = path.join(path.dirname(rootFile), '.openotex', 'build', name, 'compile.lock');
  const release = await acquireBuildLock(lockPath, cancelToken);
  if (!release) {
    return {
      success: false,
      rootFile,
      cancelled: cancelToken.cancelled,
      error: cancelToken.cancelled ? 'Compilation cancelled' : 'Another compilation of this document is still running. Try again shortly.',
      diagnostics: [],
    };
  }
  try {
    return await compileLatexDocumentUnlocked(texFilePath, engine, options, { ...hooks, cancelToken });
  } finally {
    await release();
  }
};

// --- SyncTeX: forward (source -> PDF) and inverse (PDF -> source) ---
//
// synctex view -i LINE:COLUMN:TEXFILE -o PDFFILE
// synctex edit -o PAGE:H:V:PDFFILE
//
// Coordinates are in PDF points (72dpi), with h measured from the left of the
// page and v measured from the top.

export type SynctexRect = { page: number; h: number; v: number; W: number; H: number };
export type SynctexForwardResult = { success: boolean; rects?: SynctexRect[]; pdfFile?: string; error?: string };
export type SynctexInverseResult = { success: boolean; file?: string; line?: number; column?: number; error?: string };

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

// The source folder of a compiled PDF: latexmk builds live in
// <root>/.openotex/build/<name>/, direct builds next to the source.
const sourceDirForPdf = (pdfFile: string, texRoot?: string) => {
  if (texRoot) {
    return path.dirname(texRoot);
  }
  const pdfDir = path.dirname(pdfFile);
  const marker = `${path.sep}.openotex${path.sep}build${path.sep}`;
  const index = pdfDir.indexOf(marker);
  return index >= 0 ? pdfDir.slice(0, index) : pdfDir;
};

export const synctexForward = async (payload: { texFile: string; line: number; column?: number; pdfFile?: string; texRoot?: string }): Promise<SynctexForwardResult> => {
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

    // SyncTeX stores included files relative to the root folder, so also try
    // the relative spellings when the absolute path does not match.
    const candidates = [texFile];
    const sourceDir = sourceDirForPdf(pdfFile, typeof payload?.texRoot === 'string' ? payload.texRoot : undefined);
    const relative = path.relative(sourceDir, texFile);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      const forward = relative.replace(/\\/g, '/');
      candidates.push(`./${forward}`, forward, relative);
    }

    let lastError = '';
    for (const candidate of Array.from(new Set(candidates))) {
      try {
        const inputArg = `${line}:${column}:${candidate}`;
        const { stdout } = await execFileAsync('synctex', ['view', '-i', inputArg, '-o', pdfFile], { cwd: sourceDir, timeout: 15000 } as any);
        const rects = parseSyncTexViewOutput(stdout);
        if (rects.length > 0) {
          return { success: true, rects, pdfFile };
        }
      } catch (error: any) {
        lastError = (error && (error.stderr || error.message)) || '';
      }
    }
    return { success: false, error: lastError || 'No matching location in PDF (is synctex enabled?).' };
  } catch (error: any) {
    const msg = (error && (error.stderr || error.message)) || 'synctex view failed.';
    return { success: false, error: msg };
  }
};

export const synctexInverse = async (payload: { pdfFile: string; page: number; h: number; v: number; texRoot?: string }): Promise<SynctexInverseResult> => {
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
    const sourceDir = sourceDirForPdf(pdfFile, typeof payload?.texRoot === 'string' ? payload.texRoot : undefined);
    const file = path.normalize(path.isAbsolute(parsed.input) ? parsed.input : path.resolve(sourceDir, parsed.input));
    return {
      success: true,
      file,
      line: parsed.line,
      column: Number.isFinite(parsed.column) && parsed.column > 0 ? parsed.column : 1,
    };
  } catch (error: any) {
    const msg = (error && (error.stderr || error.message)) || 'synctex edit failed.';
    return { success: false, error: msg };
  }
};

export {
  execFileAsync,
  killProcessTree,
  cancelProcessToken,
  spawnCollect,
  pathExists,
  normalizeForCompare,
  samePath,
  isInsideDirectory,
  augmentPathWithTexDistributions,
  detectLatexDistribution,
  isLatexmkAvailable,
  collectProjectFiles,
  readTextFile,
  resolveRootDocument,
  detectTexSetup,
  detectSystemPackageManager,
  installLatexPackages,
  planTexPackageInstall,
  latexInstallSuggestion,
  TEX_EXTENSIONS,
};
export type { ProcessCancelToken, TexSetup, PackageInstallResult };
