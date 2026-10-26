// Which package provides a missing LaTeX file, and how to install it, for
// each kind of TeX installation. Pure functions shared by the main process,
// the MCP server and the tests.

// - miktex: MiKTeX's own package manager (no administrator rights needed)
// - tlmgr: a TeX Live tree the user can write to (TinyTeX, per-user install)
// - tlmgr-root: an upstream TeX Live tree owned by root/administrators
// - apt/dnf/zypper/pacman: TeX Live packaged by the Linux distribution. tlmgr
//   is disabled there; packages come from the system package manager.
export type TexPackageManager = 'miktex' | 'tlmgr' | 'tlmgr-root' | 'apt' | 'dnf' | 'zypper' | 'pacman' | 'unknown';

export const SYSTEM_PACKAGE_MANAGERS: readonly TexPackageManager[] = ['apt', 'dnf', 'zypper', 'pacman'];

export const isSystemPackageManager = (manager: TexPackageManager) => SYSTEM_PACKAGE_MANAGERS.includes(manager);

// Installs that need no password can run on their own during compilation.
export const canInstallSilently = (manager: TexPackageManager) => manager === 'miktex' || manager === 'tlmgr';

export const isValidTexPackageName = (name: string) => /^[A-Za-z0-9._-]+$/.test(name);

// Font packages Openotex installs when TeX falls back to METAFONT bitmaps.
export const FONT_PACKAGES = ['ec', 'cm-super'];

// TeX Live / MiKTeX package names that differ from the .sty file loaded.
const TEX_PACKAGE_FOR_FILE: Record<string, string> = {
  tikz: 'pgf',
  pgf: 'pgf',
  pgfcore: 'pgf',
  pgfmath: 'pgf',
  pgffor: 'pgf',
  pgfkeys: 'pgf',
  algpseudocode: 'algorithmicx',
  algorithm: 'algorithms',
  algorithmic: 'algorithms',
  subcaption: 'caption',
  graphicx: 'graphics',
  color: 'graphics',
  lscape: 'graphics',
  amssymb: 'amsfonts',
  eucal: 'amsfonts',
  amsthm: 'amscls',
  lmodern: 'lm',
  IEEEtran: 'ieeetran',
  array: 'tools',
  tabularx: 'tools',
  longtable: 'tools',
  multicol: 'tools',
  afterpage: 'tools',
  calc: 'tools',
  verbatim: 'tools',
  xspace: 'tools',
  bm: 'tools',
  dcolumn: 'tools',
  hhline: 'tools',
  varioref: 'tools',
  enumerate: 'tools',
  indentfirst: 'tools',
  xr: 'tools',
  pifont: 'psnfss',
  times: 'psnfss',
  helvet: 'psnfss',
  courier: 'psnfss',
  mathptmx: 'psnfss',
  mathpazo: 'psnfss',
  palatino: 'psnfss',
  newtxtext: 'newtx',
  newtxmath: 'newtx',
  tgtermes: 'tex-gyre',
  tgheros: 'tex-gyre',
  tgpagella: 'tex-gyre',
  tgbonum: 'tex-gyre',
  tgschola: 'tex-gyre',
  tgcursor: 'tex-gyre',
  tgadventor: 'tex-gyre',
  bbm: 'bbm-macros',
  dsfont: 'doublestroke',
  mathrsfs: 'jknapltx',
  upgreek: 'was',
  gensymb: 'was',
  nicefrac: 'units',
  epstopdf: 'epstopdf-pkg',
  stfloats: 'sttools',
  cuted: 'sttools',
  authblk: 'preprint',
  fullpage: 'preprint',
  empheq: 'mh',
  xparse: 'l3packages',
  expl3: 'l3kernel',
  overcite: 'cite',
};

// Names are package files without extension ("lmodern") or classes with it
// ("IEEEtran.cls"), as reported by detectMissingLatexPackage.
const stripTexExtension = (fileName: string) => fileName.replace(/\.(sty|cls)$/i, '');

export const texPackageFor = (fileName: string) => {
  const base = stripTexExtension(fileName);
  return TEX_PACKAGE_FOR_FILE[base] ?? base;
};

// Debian/Ubuntu ship TeX Live as a few large packages. Everything not listed
// is in texlive-latex-extra, which also pulls in -latex-recommended and
// -pictures.
const DEBIAN_PACKAGES_FOR_TEX_PACKAGE: Record<string, string[]> = {
  lm: ['lmodern'],
  ec: ['texlive-fonts-recommended', 'cm-super'],
  'cm-super': ['cm-super'],
  'tex-gyre': ['tex-gyre'],
  pgf: ['texlive-pictures'],
  biblatex: ['texlive-bibtex-extra', 'biber'],
};

const DEBIAN_COLLECTIONS: Array<[string, string[]]> = [
  ['texlive-science', [
    'siunitx', 'algorithm2e', 'algorithmicx', 'algorithms', 'mhchem', 'chemfig', 'chemformula', 'chemmacros',
    'physics', 'braket', 'SIunits', 'bohr', 'tensor', 'commath', 'diffcoeff', 'karnaugh-map', 'statex',
    'pseudocode', 'clrscode', 'clrscode3e', 'complexity', 'isomath', 'interval', 'esvect', 'steinmetz',
  ]],
  ['texlive-publishers', [
    'ieeetran', 'acmart', 'elsarticle', 'llncs', 'revtex', 'revtex4-1', 'revtex4-2', 'aastex', 'apa7', 'apa6',
    'mnras', 'svjour3', 'sn-jnl', 'jmlr', 'ametsoc', 'aomart', 'asmeconf', 'ascelike', 'IEEEconf', 'IEEEtrantools',
  ]],
  ['texlive-bibtex-extra', [
    'apacite', 'biblatex-apa', 'biblatex-ieee', 'biblatex-chicago', 'biblatex-mla', 'chicago', 'chembst',
    'harvard', 'jurabib', 'multibib', 'bibentry', 'usebib', 'biblatex-ext', 'biblatex-nature', 'biblatex-science',
  ]],
  ['texlive-fonts-extra', [
    'fontawesome', 'fontawesome5', 'academicons', 'libertine', 'libertinus', 'inconsolata', 'sourcesanspro',
    'sourcecodepro', 'sourceserifpro', 'roboto', 'opensans', 'lato', 'raleway', 'fira', 'FiraSans', 'FiraMono',
    'montserrat', 'noto', 'ebgaramond', 'cabin', 'carlito', 'merriweather', 'stix', 'stix2', 'newtx', 'newpx',
    'mathabx', 'doublestroke', 'bbm', 'mdsymbol', 'fourier', 'kpfonts', 'mlmodern', 'cmbright', 'baskervillef',
  ]],
];

const debianPackagesFor = (fileName: string): string[] => {
  const texPackage = texPackageFor(fileName);
  if (DEBIAN_PACKAGES_FOR_TEX_PACKAGE[texPackage]) {
    return DEBIAN_PACKAGES_FOR_TEX_PACKAGE[texPackage];
  }
  if (/^biblatex-/.test(texPackage)) {
    return ['texlive-bibtex-extra'];
  }
  for (const [debianPackage, members] of DEBIAN_COLLECTIONS) {
    if (members.includes(texPackage) || members.includes(stripTexExtension(fileName))) {
      return [debianPackage];
    }
  }
  return ['texlive-latex-extra'];
};

// Arch Linux splits TeX Live by collection, like Debian, with other names.
const ARCH_PACKAGE_FOR_DEBIAN: Record<string, string> = {
  lmodern: 'texlive-fontsrecommended',
  'cm-super': 'texlive-fontsrecommended',
  'tex-gyre': 'texlive-fontsrecommended',
  'texlive-fonts-recommended': 'texlive-fontsrecommended',
  'texlive-latex-extra': 'texlive-latexextra',
  'texlive-science': 'texlive-mathscience',
  'texlive-publishers': 'texlive-publishers',
  'texlive-bibtex-extra': 'texlive-bibtexextra',
  'texlive-fonts-extra': 'texlive-fontsextra',
  'texlive-pictures': 'texlive-pictures',
  biber: 'biber',
};

// Fedora and openSUSE packages provide the files they contain, so the file
// itself can be requested: `dnf install 'tex(lmodern.sty)'`.
const rpmPackagesFor = (fileName: string): string[] => {
  if (FONT_PACKAGES.includes(fileName)) {
    return [`texlive-${fileName}`];
  }
  if (fileName === 'lm') {
    return ['tex(lmodern.sty)'];
  }
  return [/\.(sty|cls)$/i.test(fileName) ? `tex(${fileName})` : `tex(${fileName}.sty)`];
};

const unique = (values: string[]) => Array.from(new Set(values));

export const systemPackagesFor = (manager: TexPackageManager, fileNames: string[]): string[] => {
  switch (manager) {
    case 'apt':
      return unique(fileNames.flatMap(debianPackagesFor));
    case 'pacman':
      return unique(fileNames.flatMap(debianPackagesFor).map(name => ARCH_PACKAGE_FOR_DEBIAN[name] ?? 'texlive-latexextra'));
    case 'dnf':
    case 'zypper':
      return unique(fileNames.flatMap(rpmPackagesFor));
    case 'miktex':
    case 'tlmgr':
    case 'tlmgr-root':
      return unique(fileNames.map(texPackageFor));
    default:
      return [];
  }
};

const shellQuote = (arg: string) => (/^[A-Za-z0-9._\/=:-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`);

export type TexInstallPlan = {
  manager: TexPackageManager;
  packages: string[];
  // Program and arguments; run through pkexec when `elevated` is true.
  argv: string[];
  elevated: boolean;
  // The equivalent command to type in a terminal.
  manualCommand: string;
};

export const planTexPackageInstall = (
  manager: TexPackageManager,
  fileNames: string[],
  options: { platform: string; tlmgrPath?: string }
): TexInstallPlan | null => {
  const packages = systemPackagesFor(manager, fileNames.filter(isValidTexPackageName));
  if (packages.length === 0) {
    return null;
  }
  const windows = options.platform === 'win32';
  const tlmgr = options.tlmgrPath || 'tlmgr';
  const quoted = packages.map(shellQuote).join(' ');
  switch (manager) {
    case 'miktex': {
      // `mpm --install` is deprecated and exits with 0 for unknown packages.
      const argv = ['miktex', 'packages', 'install', ...packages];
      return { manager, packages, argv, elevated: false, manualCommand: argv.join(' ') };
    }
    case 'tlmgr':
      return { manager, packages, argv: [tlmgr, 'install', ...packages], elevated: false, manualCommand: `tlmgr install ${quoted}` };
    case 'tlmgr-root':
      return {
        manager,
        packages,
        argv: [tlmgr, 'install', ...packages],
        elevated: options.platform === 'linux',
        manualCommand: windows
          ? `tlmgr install ${quoted}   (in a terminal opened as administrator)`
          : `sudo ${shellQuote(tlmgr)} install ${quoted}`,
      };
    case 'apt':
      return {
        manager,
        packages,
        argv: ['/usr/bin/env', 'DEBIAN_FRONTEND=noninteractive', '/usr/bin/apt-get', 'install', '-y', ...packages],
        elevated: true,
        manualCommand: `sudo apt install ${quoted}`,
      };
    case 'dnf':
      return { manager, packages, argv: ['/usr/bin/dnf', 'install', '-y', ...packages], elevated: true, manualCommand: `sudo dnf install ${quoted}` };
    case 'zypper':
      return {
        manager,
        packages,
        argv: ['/usr/bin/zypper', '--non-interactive', 'install', ...packages],
        elevated: true,
        manualCommand: `sudo zypper install ${quoted}`,
      };
    case 'pacman':
      return {
        manager,
        packages,
        argv: ['/usr/bin/pacman', '-S', '--needed', '--noconfirm', ...packages],
        elevated: true,
        manualCommand: `sudo pacman -S --needed ${quoted}`,
      };
    default:
      return null;
  }
};

// What to suggest when no LaTeX distribution was found at all.
export const latexInstallSuggestion = (manager: TexPackageManager, platform: string): { message: string; command?: string } => {
  switch (manager) {
    case 'apt':
      return {
        message: 'Install TeX Live from your distribution with:',
        command: 'sudo apt install texlive-latex-extra texlive-fonts-recommended lmodern cm-super latexmk',
      };
    case 'dnf':
      return { message: 'Install TeX Live from your distribution with:', command: 'sudo dnf install texlive-scheme-medium texlive-latexmk' };
    case 'zypper':
      return { message: 'Install TeX Live from your distribution with:', command: 'sudo zypper install texlive-scheme-medium texlive-latexmk' };
    case 'pacman':
      return {
        message: 'Install TeX Live from your distribution with:',
        command: 'sudo pacman -S --needed texlive-basic texlive-latex texlive-latexrecommended texlive-latexextra texlive-fontsrecommended texlive-binextra',
      };
    default:
      if (platform === 'darwin') {
        return { message: 'Install MacTeX, for example with Homebrew:', command: 'brew install --cask mactex-no-gui' };
      }
      if (platform === 'win32') {
        return { message: 'Install MiKTeX (recommended) or TeX Live.' };
      }
      return { message: 'Install TeX Live (https://tug.org/texlive/) or your distribution\'s texlive packages.' };
  }
};
