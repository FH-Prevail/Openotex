import * as assert from 'assert';
import { detectMissingLatexPackage } from '../src/shared/latexDiagnostics';
import {
  canInstallSilently,
  latexInstallSuggestion,
  planTexPackageInstall,
  systemPackagesFor,
  texPackageFor,
} from '../src/shared/texPackages';
import { PROJECT_TEMPLATES } from '../src/renderer/utils/projectTemplates';

const linux = { platform: 'linux' };

{
  // File names that live in differently named TeX Live packages.
  assert.equal(texPackageFor('tikz'), 'pgf');
  assert.equal(texPackageFor('lmodern'), 'lm');
  assert.equal(texPackageFor('IEEEtran.cls'), 'ieeetran');
  assert.equal(texPackageFor('siunitx'), 'siunitx');
}

{
  // Debian/Ubuntu: the bundle that contains the file.
  assert.deepEqual(systemPackagesFor('apt', ['lmodern']), ['lmodern']);
  assert.deepEqual(systemPackagesFor('apt', ['siunitx', 'algpseudocode']), ['texlive-science']);
  assert.deepEqual(systemPackagesFor('apt', ['IEEEtran.cls']), ['texlive-publishers']);
  assert.deepEqual(systemPackagesFor('apt', ['biblatex']), ['texlive-bibtex-extra', 'biber']);
  assert.deepEqual(systemPackagesFor('apt', ['tcolorbox', 'cleveref']), ['texlive-latex-extra']);
  // beamer on Debian without recommends lacks pgf (texlive-pictures).
  assert.deepEqual(systemPackagesFor('apt', ['pgfmath', 'tikz']), ['texlive-pictures']);
  assert.deepEqual(systemPackagesFor('pacman', ['pgfmath']), ['texlive-pictures']);
  assert.deepEqual(systemPackagesFor('apt', ['ec', 'cm-super']), ['texlive-fonts-recommended', 'cm-super']);
  // Arch uses its own bundle names; Fedora/openSUSE install by file.
  assert.deepEqual(systemPackagesFor('pacman', ['lmodern', 'tcolorbox']), ['texlive-fontsrecommended', 'texlive-latexextra']);
  assert.deepEqual(systemPackagesFor('dnf', ['lmodern', 'IEEEtran.cls']), ['tex(lmodern.sty)', 'tex(IEEEtran.cls)']);
  assert.deepEqual(systemPackagesFor('zypper', ['cm-super']), ['texlive-cm-super']);
}

{
  const apt = planTexPackageInstall('apt', ['lmodern', 'tcolorbox'], linux)!;
  assert.equal(apt.elevated, true);
  assert.deepEqual(apt.argv, ['/usr/bin/env', 'DEBIAN_FRONTEND=noninteractive', '/usr/bin/apt-get', 'install', '-y', 'lmodern', 'texlive-latex-extra']);
  assert.equal(apt.manualCommand, 'sudo apt install lmodern texlive-latex-extra');

  const dnf = planTexPackageInstall('dnf', ['lmodern'], linux)!;
  assert.equal(dnf.manualCommand, "sudo dnf install 'tex(lmodern.sty)'");

  const tlmgr = planTexPackageInstall('tlmgr', ['tikz'], { platform: 'linux', tlmgrPath: '/home/u/.TinyTeX/bin/x86_64-linux/tlmgr' })!;
  assert.equal(tlmgr.elevated, false);
  assert.deepEqual(tlmgr.argv, ['/home/u/.TinyTeX/bin/x86_64-linux/tlmgr', 'install', 'pgf']);

  const rootTlmgr = planTexPackageInstall('tlmgr-root', ['lmodern'], { platform: 'linux', tlmgrPath: '/usr/local/texlive/2025/bin/x86_64-linux/tlmgr' })!;
  assert.equal(rootTlmgr.elevated, true);
  assert.equal(rootTlmgr.manualCommand, 'sudo /usr/local/texlive/2025/bin/x86_64-linux/tlmgr install lm');

  const miktex = planTexPackageInstall('miktex', ['tikz'], { platform: 'win32' })!;
  assert.deepEqual(miktex.argv, ['miktex', 'packages', 'install', 'pgf']);
  assert.equal(miktex.manualCommand, 'miktex packages install pgf');

  // Unsafe names never reach a command line; unknown managers get no plan.
  assert.equal(planTexPackageInstall('apt', ['x; rm -rf /'], linux), null);
  assert.equal(planTexPackageInstall('unknown', ['lmodern'], linux), null);
}

{
  assert.equal(canInstallSilently('miktex'), true);
  assert.equal(canInstallSilently('tlmgr'), true);
  assert.equal(canInstallSilently('apt'), false);
  assert.equal(canInstallSilently('tlmgr-root'), false);
  assert.match(latexInstallSuggestion('apt', 'linux').command!, /^sudo apt install .*latexmk/);
  assert.equal(latexInstallSuggestion('unknown', 'win32').command, undefined);
}

{
  // Missing classes keep their extension; packages drop it.
  assert.equal(detectMissingLatexPackage("./main.tex:1: LaTeX Error: File `IEEEtran.cls' not found."), 'IEEEtran.cls');
  assert.equal(detectMissingLatexPackage("./main.tex:3: LaTeX Error: File `lmodern.sty' not found."), 'lmodern');
}

{
  // Templates must compile on minimal TeX installations without Latin Modern.
  for (const template of PROJECT_TEMPLATES) {
    const main = template.files('Test')['main.tex'];
    if (!main) continue;
    assert.ok(!/^\\usepackage\{lmodern\}/m.test(main), `${template.id}: lmodern must be guarded`);
    assert.ok(!/^\\usepackage\[T1\]\{fontenc\}/m.test(main), `${template.id}: T1 needs the Latin Modern guard`);
  }
}

console.log('texPackages tests passed');
