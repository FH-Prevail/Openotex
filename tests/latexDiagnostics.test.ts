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

{
  // TeX wraps output at 79 characters; paths with spaces are not quoted.
  const wrap = (text: string) => (text.match(/.{1,79}/g) || []).join('\n');
  const log = [
    'This is pdfTeX, Version 3.141592653-2.6-1.40.25 (TeX Live 2024)',
    wrap('(C:/work/My Thesis With A Rather Long Folder Name/and/even/more/folders/main.tex'),
    'LaTeX2e <2023-11-01>',
    '(C:/texlive/2024/texmf-dist/tex/latex/base/report.cls',
    'Document Class: report 2023/05/17 v1.4n Standard LaTeX document class',
    ')',
    ' (chapters/intro.tex',
    'Chapter 1.',
    '',
    wrap("LaTeX Warning: Citation `knuth1984-with-a-rather-long-key-to-force-wrapping' on page 2 undefined on input line 3."),
    '',
    ') [2]',
    "LaTeX Warning: Reference `fig:x' on page 3 undefined on input line 9.",
    'C:/work/chapters/intro.tex:5:  ==> Fatal error occurred, no output PDF file produced!',
    ')',
  ].join('\n');
  const diagnostics = parseLatexDiagnostics(log, 'C:/work/main.tex');
  assert.deepEqual(
    diagnostics.map(diagnostic => [diagnostic.code, diagnostic.file, diagnostic.line]),
    [
      ['undefined-citation', 'chapters/intro.tex', 3],
      ['undefined-reference', 'C:/work/main.tex', 9],
    ]
  );
}

console.log('latexDiagnostics tests passed');

