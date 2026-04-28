import * as assert from 'assert';
import {
  detectMissingLatexPackage,
  parseLatexDiagnostics,
  summarizeLatexError,
} from '../src/shared/latexDiagnostics';

const texFile = 'C:/work/paper/ieee.tex';

{
  const log = "LaTeX Warning: File `fig1.png' not found on input line 232.\n" +
    "C:/work/paper/ieee.tex:232: Package luatex.def Error: File `fig1.png' not found: using draft setting.";
  const diagnostics = parseLatexDiagnostics(log, texFile);
  assert.equal(diagnostics[0].severity, 'error');
  assert.equal(diagnostics[0].line, 232);
  assert.equal(diagnostics[0].code, 'missing-file');
  assert.match(summarizeLatexError(log, texFile), /Missing image or input file: fig1\.png/);
}

{
  const log = "! LaTeX Error: File `algorithm.sty' not found.";
  assert.equal(detectMissingLatexPackage(log), 'algorithm');
  assert.match(summarizeLatexError(log, texFile), /Missing LaTeX package: algorithm/);
}

{
  const log = "LaTeX Warning: Citation `b7' on page 2 undefined on input line 176.\n" +
    "LaTeX Warning: Reference `fig' on page 2 undefined on input line 212.";
  const diagnostics = parseLatexDiagnostics(log, texFile);
  assert.deepEqual(
    diagnostics.map(diagnostic => diagnostic.code),
    ['undefined-citation', 'undefined-reference']
  );
  assert.equal(diagnostics[0].line, 176);
  assert.equal(diagnostics[1].line, 212);
}

{
  const log = 'C:/work/paper/ieee.tex:99: Undefined control sequence.';
  const diagnostics = parseLatexDiagnostics(log, texFile);
  assert.equal(diagnostics[0].severity, 'error');
  assert.equal(diagnostics[0].file, 'C:/work/paper/ieee.tex');
  assert.equal(diagnostics[0].line, 99);
}

console.log('latexDiagnostics tests passed');

