import * as assert from 'assert';
import {
  extractBibEntries,
  extractHeadings,
  extractIncludes,
  extractLabels,
  extractReferenceUses,
  findMagicRoot,
  hasDocumentClass,
  stripLatexComments,
} from '../src/shared/latexProject';
import { parseLatexStructure } from '../src/renderer/utils/latexStructureParser';
import { escapeLatexText, PROJECT_TEMPLATES } from '../src/renderer/utils/projectTemplates';

{
  // `\%` is a literal percent sign, `\\%` is a line break followed by a comment.
  const source = 'Discount 50\\% off % a comment\nline two\\\\% gone\n% full line';
  assert.equal(stripLatexComments(source), 'Discount 50\\% off \nline two\\\\\n');
}

{
  assert.equal(hasDocumentClass('\\documentclass[11pt]{article}\n\\begin{document}'), true);
  assert.equal(hasDocumentClass('% \\documentclass{article}\n\\section{Intro}'), false);
  assert.equal(hasDocumentClass('\\chapter{Intro}\nText'), false);
}

{
  assert.equal(findMagicRoot('% !TEX root = ../main.tex\n\\section{A}'), '../main.tex');
  assert.equal(findMagicRoot('%!TeX root=thesis.tex'), 'thesis.tex');
  assert.equal(findMagicRoot('\\section{No magic}'), null);
}

{
  const source = [
    '\\input{chapters/intro}',
    '\\include{chapters/methods, chapters/results}',
    '% \\input{ignored}',
    '\\subfile{appendix/a.tex}',
    '\\import{parts/}{conclusion}',
    '\\input preamble',
  ].join('\n');
  assert.deepEqual(extractIncludes(source), [
    'chapters/intro',
    'chapters/methods',
    'chapters/results',
    'appendix/a.tex',
    'parts/conclusion',
    'preamble',
  ]);
}

{
  const labels = extractLabels('\\section{A}\\label{sec:a}\n% \\label{commented}\n\\begin{equation}\\label{eq:one}\\end{equation}');
  assert.deepEqual(labels, [
    { key: 'sec:a', line: 1 },
    { key: 'eq:one', line: 3 },
  ]);
}

{
  const bib = [
    '@string{acm = "ACM"}',
    '@Article{smith2020,',
    '  title = {Deep {LaTeX} Editing},',
    '  author = {Smith, Jane},',
    '}',
    '@book{knuth1984, title = "The TeXbook", year = 1984}',
    '@comment{not an entry}',
  ].join('\n');
  assert.deepEqual(extractBibEntries(bib), [
    { key: 'smith2020', type: 'article', title: 'Deep LaTeX Editing' },
    { key: 'knuth1984', type: 'book', title: 'The TeXbook' },
  ]);
}

{
  const result = parseLatexStructure([
    '\\documentclass{report}',
    '\\begin{document}',
    '\\chapter{Introduction}',
    '\\section*{Motivation}',
    '\\section[Short]{A \\textbf{bold} idea}',
    '% \\section{Commented out}',
    '\\subsection{Details}',
    '\\chapter{Results}',
    '\\end{document}',
  ].join('\n'));
  assert.equal(result.isValid, true);
  const chapters = result.structure!.children;
  assert.deepEqual(chapters.map(node => node.title), ['Introduction', 'Results']);
  assert.deepEqual(chapters[0].children.map(node => node.title), ['Motivation', 'A bold idea']);
  assert.equal(chapters[0].children[1].children[0].title, 'Details');
  assert.equal(chapters[0].children[1].lineNumber, 5);
}

{
  assert.equal(escapeLatexText('R&D 100% #1'), 'R\\&D 100\\% \\#1');
  assert.equal(escapeLatexText('a_b {c}'), 'a\\_b \\{c\\}');
  for (const template of PROJECT_TEMPLATES) {
    const files = template.files('Title');
    assert.ok(files['main.tex'], `${template.id} has main.tex`);
    assert.ok(hasDocumentClass(files['main.tex']), `${template.id} main.tex has a document class`);
  }
}

{
  const headings = extractHeadings([
    '\\chapter{Intro}',
    '% \\section{Hidden}',
    '\\section*{Setup with $x^2$}',
    '\\subsection[Short]{A \\emph{long} title}',
  ].join('\n'));
  assert.deepEqual(headings, [
    { kind: 'chapter', level: 1, title: 'Intro', line: 1 },
    { kind: 'section', level: 2, title: 'Setup with x^2', line: 3 },
    { kind: 'subsection', level: 3, title: 'A long title', line: 4 },
  ]);
}

{
  const uses = extractReferenceUses([
    'See \\ref{sec:a}, \\eqref{eq:1} and \\cref{fig:a,fig:b}.',
    'Link: \\href{https://example.com}{site}. % \\ref{commented}',
    'Cited \\citep[p.~3]{knuth1984, lamport1994} and \\nocite{*}.',
    '\\bibitem[Kn84]{knuth1984} D. Knuth.',
  ].join('\n'));
  assert.deepEqual(uses.refs.map(use => use.key), ['sec:a', 'eq:1', 'fig:a', 'fig:b']);
  assert.deepEqual(uses.cites.map(use => `${use.key}@${use.line}`), ['knuth1984@3', 'lamport1994@3']);
  assert.deepEqual(uses.bibitems.map(use => use.key), ['knuth1984']);
}

console.log('latexProject tests passed');
