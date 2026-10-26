import React, { useRef, forwardRef, useImperativeHandle, useEffect, useCallback } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { Annotation, AnnotationRange } from '../../types/annotations';
import { extractLabels } from '../../shared/latexProject';
import '../styles/Editor.css';

// Configure Monaco to use local files instead of CDN
loader.config({ monaco });

// Snippet syntax note: a backslash only escapes `$`, `}` and `\`. LaTeX
// commands such as `\section` can therefore be written with a single
// backslash, while a LaTeX line break `\\` must be written as `\\\\`.
const LINE_BREAK = '\\\\\\\\';

// Environment templates offered when typing e.g. `\fig` or `\tab`.
const environmentSnippets = [
  {
    label: 'figure',
    detail: 'Figure environment with placeholder image',
    documentation: 'Insert a figure with centering, caption, and label.',
    insertText: [
      '\\begin{figure}[ht]',
      '\t\\centering',
      '\t\\includegraphics[width=\\linewidth]{${1:image.png}}',
      '\t\\caption{${2:Caption text}}',
      '\t\\label{fig:${3:label}}',
      '\\end{figure}',
    ].join('\n'),
  },
  {
    label: 'figure*',
    detail: 'Wide figure',
    documentation: 'Full-width figure for two-column layouts.',
    insertText: [
      '\\begin{figure*}[t]',
      '\t\\centering',
      '\t\\includegraphics[width=\\textwidth]{${1:image.png}}',
      '\t\\caption{${2:Caption text}}',
      '\t\\label{fig:${3:label}}',
      '\\end{figure*}',
    ].join('\n'),
  },
  {
    label: 'table',
    detail: 'Table with tabular and caption',
    documentation: 'Insert a basic table with two columns.',
    insertText: [
      '\\begin{table}[ht]',
      '\t\\centering',
      '\t\\begin{tabular}{${1:ll}}',
      '\t\t\\hline',
      `\t\t\${2:Column A} & \${3:Column B} ${LINE_BREAK}`,
      '\t\t\\hline',
      `\t\t\${4:Value 1} & \${5:Value 2} ${LINE_BREAK}`,
      '\t\t\\hline',
      '\t\\end{tabular}',
      '\t\\caption{${6:Caption text}}',
      '\t\\label{tab:${7:label}}',
      '\\end{table}',
    ].join('\n'),
  },
  {
    label: 'align',
    detail: 'Aligned equations',
    documentation: 'Multi-line aligned equations with labels.',
    insertText: [
      '\\begin{align}',
      `\t\${1:a} &= \${2:b} ${LINE_BREAK}`,
      '\t${3:c} &= ${4:d}',
      '\t\\label{eq:${5:label}}',
      '\\end{align}',
    ].join('\n'),
  },
  {
    label: 'equation',
    detail: 'Single equation',
    documentation: 'Equation environment with label.',
    insertText: [
      '\\begin{equation}',
      '\t${1:E = mc^2}',
      '\t\\label{eq:${2:label}}',
      '\\end{equation}',
    ].join('\n'),
  },
  {
    label: 'itemize',
    detail: 'Itemize list',
    documentation: 'Bulleted list with three items.',
    insertText: [
      '\\begin{itemize}',
      '\t\\item ${1:First item}',
      '\t\\item ${2:Second item}',
      '\t\\item ${3:Third item}',
      '\\end{itemize}',
    ].join('\n'),
  },
  {
    label: 'enumerate',
    detail: 'Enumerated list',
    documentation: 'Numbered list with three items.',
    insertText: [
      '\\begin{enumerate}',
      '\t\\item ${1:First item}',
      '\t\\item ${2:Second item}',
      '\t\\item ${3:Third item}',
      '\\end{enumerate}',
    ].join('\n'),
  },
  {
    label: 'theorem',
    detail: 'Theorem environment',
    documentation: 'Basic theorem statement with label.',
    insertText: [
      '\\begin{theorem}',
      '\t${1:Statement of the theorem.}',
      '\t\\label{thm:${2:label}}',
      '\\end{theorem}',
    ].join('\n'),
  },
  {
    label: 'proof',
    detail: 'Proof environment',
    documentation: 'Proof with placeholder text.',
    insertText: [
      '\\begin{proof}',
      '\t${1:Proof details go here.}',
      '\\end{proof}',
    ].join('\n'),
  },
  {
    label: 'frame',
    detail: 'Beamer slide',
    documentation: 'A Beamer frame with a title and bullet list.',
    insertText: [
      '\\begin{frame}{${1:Slide title}}',
      '\t\\begin{itemize}',
      '\t\t\\item ${2:Point}',
      '\t\\end{itemize}',
      '\\end{frame}',
    ].join('\n'),
  },
];

// Commands offered after typing a backslash. `snippet` is the text inserted
// after the backslash; it defaults to the plain command name.
const latexCommands: Array<{ name: string; snippet?: string; detail: string }> = [
  { name: 'documentclass', snippet: 'documentclass{${1:article}}', detail: 'Document class declaration' },
  { name: 'usepackage', snippet: 'usepackage{${1:package}}', detail: 'Load a package' },
  { name: 'begin', snippet: 'begin{${1:environment}}\n\t$0\n\\end{${1:environment}}', detail: 'Begin–end environment' },
  { name: 'part', snippet: 'part{${1:title}}', detail: 'Part heading' },
  { name: 'chapter', snippet: 'chapter{${1:title}}', detail: 'Chapter heading' },
  { name: 'section', snippet: 'section{${1:title}}', detail: 'Section heading' },
  { name: 'subsection', snippet: 'subsection{${1:title}}', detail: 'Subsection heading' },
  { name: 'subsubsection', snippet: 'subsubsection{${1:title}}', detail: 'Subsubsection heading' },
  { name: 'paragraph', snippet: 'paragraph{${1:title}}', detail: 'Paragraph heading' },
  { name: 'label', snippet: 'label{${1:key}}', detail: 'Label for cross-references' },
  { name: 'ref', snippet: 'ref{${1:key}}', detail: 'Cross-reference' },
  { name: 'eqref', snippet: 'eqref{${1:key}}', detail: 'Equation reference' },
  { name: 'pageref', snippet: 'pageref{${1:key}}', detail: 'Page reference' },
  { name: 'autoref', snippet: 'autoref{${1:key}}', detail: 'Reference with type name (hyperref)' },
  { name: 'cref', snippet: 'cref{${1:key}}', detail: 'Clever reference (cleveref)' },
  { name: 'cite', snippet: 'cite{${1:key}}', detail: 'Citation' },
  { name: 'citep', snippet: 'citep{${1:key}}', detail: 'Parenthetical citation (natbib)' },
  { name: 'citet', snippet: 'citet{${1:key}}', detail: 'Textual citation (natbib)' },
  { name: 'parencite', snippet: 'parencite{${1:key}}', detail: 'Parenthetical citation (biblatex)' },
  { name: 'textcite', snippet: 'textcite{${1:key}}', detail: 'Textual citation (biblatex)' },
  { name: 'footnote', snippet: 'footnote{${1:text}}', detail: 'Footnote' },
  { name: 'textbf', snippet: 'textbf{${1:text}}', detail: 'Bold text' },
  { name: 'textit', snippet: 'textit{${1:text}}', detail: 'Italic text' },
  { name: 'emph', snippet: 'emph{${1:text}}', detail: 'Emphasized text' },
  { name: 'underline', snippet: 'underline{${1:text}}', detail: 'Underlined text' },
  { name: 'texttt', snippet: 'texttt{${1:text}}', detail: 'Monospaced text' },
  { name: 'textsc', snippet: 'textsc{${1:text}}', detail: 'Small capitals' },
  { name: 'url', snippet: 'url{${1:https://}}', detail: 'URL (hyperref/url)' },
  { name: 'href', snippet: 'href{${1:https://}}{${2:text}}', detail: 'Hyperlink (hyperref)' },
  { name: 'includegraphics', snippet: 'includegraphics[width=${1:\\linewidth}]{${2:file}}', detail: 'Insert image (graphicx)' },
  { name: 'caption', snippet: 'caption{${1:text}}', detail: 'Caption' },
  { name: 'centering', detail: 'Center the current block' },
  { name: 'item', snippet: 'item ${1:text}', detail: 'List item' },
  { name: 'input', snippet: 'input{${1:file}}', detail: 'Input another file' },
  { name: 'include', snippet: 'include{${1:file}}', detail: 'Include a chapter file' },
  { name: 'title', snippet: 'title{${1:title}}', detail: 'Document title' },
  { name: 'author', snippet: 'author{${1:name}}', detail: 'Document author' },
  { name: 'date', snippet: 'date{${1:\\today}}', detail: 'Document date' },
  { name: 'maketitle', detail: 'Typeset the title block' },
  { name: 'tableofcontents', detail: 'Table of contents' },
  { name: 'listoffigures', detail: 'List of figures' },
  { name: 'listoftables', detail: 'List of tables' },
  { name: 'bibliography', snippet: 'bibliography{${1:references}}', detail: 'BibTeX bibliography file' },
  { name: 'bibliographystyle', snippet: 'bibliographystyle{${1:plain}}', detail: 'BibTeX style' },
  { name: 'addbibresource', snippet: 'addbibresource{${1:references.bib}}', detail: 'Bibliography file (biblatex)' },
  { name: 'printbibliography', detail: 'Print bibliography (biblatex)' },
  { name: 'newcommand', snippet: 'newcommand{\\\\${1:name}}[${2:0}]{${3:definition}}', detail: 'Define a command' },
  { name: 'renewcommand', snippet: 'renewcommand{\\\\${1:name}}{${2:definition}}', detail: 'Redefine a command' },
  { name: 'newpage', detail: 'Start a new page' },
  { name: 'clearpage', detail: 'Flush floats and start a new page' },
  { name: 'noindent', detail: 'Suppress paragraph indentation' },
  { name: 'vspace', snippet: 'vspace{${1:1em}}', detail: 'Vertical space' },
  { name: 'hspace', snippet: 'hspace{${1:1em}}', detail: 'Horizontal space' },
  { name: 'hline', detail: 'Horizontal table rule' },
  { name: 'toprule', detail: 'Top rule (booktabs)' },
  { name: 'midrule', detail: 'Middle rule (booktabs)' },
  { name: 'bottomrule', detail: 'Bottom rule (booktabs)' },
  { name: 'frac', snippet: 'frac{${1:num}}{${2:den}}', detail: 'Fraction' },
  { name: 'sqrt', snippet: 'sqrt{${1:x}}', detail: 'Square root' },
  { name: 'sum', snippet: 'sum_{${1:i=1}}^{${2:n}}', detail: 'Summation' },
  { name: 'prod', snippet: 'prod_{${1:i=1}}^{${2:n}}', detail: 'Product' },
  { name: 'int', snippet: 'int_{${1:a}}^{${2:b}}', detail: 'Integral' },
  { name: 'lim', snippet: 'lim_{${1:x \\to \\infty}}', detail: 'Limit' },
  { name: 'left', snippet: 'left( $1 \\right)', detail: 'Scaled delimiters' },
  { name: 'mathbb', snippet: 'mathbb{${1:R}}', detail: 'Blackboard bold' },
  { name: 'mathcal', snippet: 'mathcal{${1:A}}', detail: 'Calligraphic letter' },
  { name: 'mathbf', snippet: 'mathbf{${1:x}}', detail: 'Bold math' },
  { name: 'mathrm', snippet: 'mathrm{${1:text}}', detail: 'Upright math text' },
  { name: 'text', snippet: 'text{${1:text}}', detail: 'Text inside math (amsmath)' },
  { name: 'cdot', detail: 'Centered dot' },
  { name: 'times', detail: 'Multiplication sign' },
  { name: 'infty', detail: 'Infinity' },
  { name: 'partial', detail: 'Partial derivative' },
  { name: 'nabla', detail: 'Nabla' },
  { name: 'leq', detail: 'Less than or equal' },
  { name: 'geq', detail: 'Greater than or equal' },
  { name: 'neq', detail: 'Not equal' },
  { name: 'approx', detail: 'Approximately' },
  { name: 'rightarrow', detail: 'Right arrow' },
  { name: 'Rightarrow', detail: 'Implies arrow' },
  { name: 'alpha', detail: 'Greek letter' },
  { name: 'beta', detail: 'Greek letter' },
  { name: 'gamma', detail: 'Greek letter' },
  { name: 'delta', detail: 'Greek letter' },
  { name: 'epsilon', detail: 'Greek letter' },
  { name: 'theta', detail: 'Greek letter' },
  { name: 'lambda', detail: 'Greek letter' },
  { name: 'mu', detail: 'Greek letter' },
  { name: 'pi', detail: 'Greek letter' },
  { name: 'sigma', detail: 'Greek letter' },
  { name: 'phi', detail: 'Greek letter' },
  { name: 'omega', detail: 'Greek letter' },
];

const environmentNames = [
  'document', 'abstract', 'figure', 'figure*', 'table', 'table*', 'tabular', 'tabularx', 'itemize',
  'enumerate', 'description', 'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'array', 'theorem', 'lemma', 'corollary',
  'definition', 'proof', 'remark', 'example', 'center', 'flushleft', 'flushright', 'quote',
  'quotation', 'verbatim', 'lstlisting', 'minipage', 'subfigure', 'algorithm', 'algorithmic',
  'thebibliography', 'frame', 'columns', 'column', 'block', 'appendix',
];

// Project-wide labels and bibliography keys, shared by every editor instance.
const completionContext: { projectPath: string } = { projectPath: '' };
let referenceCache: {
  root: string;
  at: number;
  labels: Array<{ key: string; file: string; line: number }>;
  citations: Array<{ key: string; type: string; title?: string; file: string }>;
} | null = null;

const loadProjectReferences = async () => {
  const root = completionContext.projectPath;
  if (!root) {
    return { labels: [], citations: [] };
  }
  if (referenceCache && referenceCache.root === root && Date.now() - referenceCache.at < 3000) {
    return referenceCache;
  }
  try {
    const result = await (window as any).api.collectLatexReferences(root);
    referenceCache = {
      root,
      at: Date.now(),
      labels: Array.isArray(result?.labels) ? result.labels : [],
      citations: Array.isArray(result?.citations) ? result.citations : [],
    };
    return referenceCache;
  } catch {
    return { labels: [], citations: [] };
  }
};

const fileNameOf = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath;

const provideLatexCompletions = async (
  model: monaco.editor.ITextModel,
  position: monaco.Position
): Promise<monaco.languages.CompletionList> => {
  const linePrefix = model.getValueInRange(new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column));
  const lineText = model.getLineContent(position.lineNumber);
  const nextChar = lineText.charAt(position.column - 1);
  const rangeFrom = (startColumn: number, endColumn = position.column) => (
    new monaco.Range(position.lineNumber, startColumn, position.lineNumber, endColumn)
  );

  // \ref{...}, \eqref{...}, \cref{a,b...}
  const refMatch = linePrefix.match(/\\(?!href)[a-zA-Z]*ref\*?\{([^{}]*)$/);
  if (refMatch) {
    const partial = refMatch[1].slice(refMatch[1].lastIndexOf(',') + 1).trimStart();
    const range = rangeFrom(position.column - partial.length);
    const references = await loadProjectReferences();
    const seen = new Set<string>();
    const suggestions: monaco.languages.CompletionItem[] = [];
    extractLabels(model.getValue()).forEach(label => {
      seen.add(label.key);
      suggestions.push({
        label: label.key,
        kind: monaco.languages.CompletionItemKind.Reference,
        detail: `This file, line ${label.line}`,
        insertText: label.key,
        range,
      });
    });
    references.labels.forEach(label => {
      if (seen.has(label.key)) return;
      seen.add(label.key);
      suggestions.push({
        label: label.key,
        kind: monaco.languages.CompletionItemKind.Reference,
        detail: `${fileNameOf(label.file)}, line ${label.line}`,
        insertText: label.key,
        range,
      });
    });
    return { suggestions };
  }

  // \cite{...}, \citep[..]{...}, \parencite{a,b...}
  const citeMatch = linePrefix.match(/\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{([^{}]*)$/);
  if (citeMatch) {
    const partial = citeMatch[1].slice(citeMatch[1].lastIndexOf(',') + 1).trimStart();
    const range = rangeFrom(position.column - partial.length);
    const references = await loadProjectReferences();
    return {
      suggestions: references.citations.map(entry => ({
        label: entry.key,
        kind: monaco.languages.CompletionItemKind.Value,
        detail: entry.title ? `${entry.title}` : `@${entry.type}`,
        documentation: `@${entry.type} in ${fileNameOf(entry.file)}`,
        filterText: `${entry.key} ${entry.title ?? ''}`,
        insertText: entry.key,
        range,
      })),
    };
  }

  // \begin{env} -> inserts the matching \end{env}
  const beginMatch = linePrefix.match(/\\begin\{([a-zA-Z*]*)$/);
  if (beginMatch) {
    const startColumn = position.column - beginMatch[1].length;
    const range = rangeFrom(startColumn, nextChar === '}' ? position.column + 1 : position.column);
    return {
      suggestions: environmentNames.map(name => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Module,
        detail: 'Environment',
        insertText: `${name}}\n\t$0\n\\end{${name}}`,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      })),
    };
  }

  // \command
  const commandMatch = linePrefix.match(/\\([a-zA-Z@]*)$/);
  if (!commandMatch) {
    return { suggestions: [] };
  }
  const startColumn = position.column - commandMatch[1].length - 1;
  const range = rangeFrom(startColumn);
  const suggestions: monaco.languages.CompletionItem[] = latexCommands.map(command => ({
    label: `\\${command.name}`,
    kind: monaco.languages.CompletionItemKind.Function,
    detail: command.detail,
    filterText: `\\${command.name}`,
    insertText: `\\${command.snippet ?? command.name}`,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
  }));
  environmentSnippets.forEach(snippet => {
    suggestions.push({
      label: { label: snippet.label, description: 'environment' },
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: snippet.detail,
      documentation: snippet.documentation,
      filterText: `\\${snippet.label}`,
      insertText: snippet.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
    });
  });
  return { suggestions };
};

let languagesRegistered = false;
const registerLanguages = () => {
  if (languagesRegistered) return;
  languagesRegistered = true;

  const known = new Set(monaco.languages.getLanguages().map(language => language.id));
  if (!known.has('latex')) {
    monaco.languages.register({ id: 'latex', extensions: ['.tex', '.latex', '.ltx', '.sty', '.cls'], aliases: ['LaTeX'] });
  }
  if (!known.has('bibtex')) {
    monaco.languages.register({ id: 'bibtex', extensions: ['.bib'], aliases: ['BibTeX'] });
  }

  // Enables Ctrl+/ comment toggling, bracket matching and auto-closing.
  monaco.languages.setLanguageConfiguration('latex', {
    comments: { lineComment: '%' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/(\\(?:begin|end))(\s*)(\{)([a-zA-Z*]+)(\})/, ['keyword', '', 'delimiter.curly', 'type', 'delimiter.curly']],
        [/\\(?:\[|\]|\(|\))/, 'string.math'],
        [/\\[a-zA-Z@]+\*?/, 'keyword'],
        [/\\[^a-zA-Z@]/, 'keyword'],
        [/\$\$/, 'string.math.display'],
        [/\$/, 'string.math.inline'],
        [/[{}]/, 'delimiter.curly'],
        [/[[\]]/, 'delimiter.square'],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration('bibtex', {
    comments: { lineComment: '%' },
    brackets: [['{', '}'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('bibtex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/@[a-zA-Z]+/, 'keyword'],
        [/[a-zA-Z_-]+(?=\s*=)/, 'attribute.name'],
        [/"[^"]*"/, 'string'],
        [/\d+/, 'number'],
        [/[{}]/, 'delimiter.curly'],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider('latex', {
    triggerCharacters: ['\\', '{', ','],
    provideCompletionItems: (model, position) => provideLatexCompletions(model, position),
  });
};

registerLanguages();

const modelPathFor = (filePath: string) => monaco.Uri.file(filePath).toString();

const ensureGlyphStyle = () => {
  if (document.getElementById('annotation-glyph-style')) {
    return;
  }
  const glyphStyle = document.createElement('style');
  glyphStyle.id = 'annotation-glyph-style';
  glyphStyle.innerHTML = `
    .annotation-info-glyph {
      cursor: pointer !important;
      background: rgba(70, 130, 255, 0.85) !important;
      color: white !important;
      border-radius: 3px;
      width: 16px !important;
      height: 16px !important;
      display: flex !important;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      margin-left: 2px;
    }
    .annotation-info-glyph:hover {
      background: rgba(60, 115, 230, 1) !important;
    }
    .annotation-info-glyph::before {
      content: 'i';
    }
  `;
  document.head.appendChild(glyphStyle);
};

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  currentFile: any;
  projectPath?: string;
  openFilePaths?: string[];
  annotations: Annotation[];
  annotationsHidden: boolean;
  onAnnotate?: () => void;
  onRemoveAnnotation?: (id: string) => void;
  onEditAnnotation?: (annotation: Annotation) => void;
  onCursorChange?: (position: { lineNumber: number; column: number }) => void;
  onSyncTexForwardSearch?: () => void;
  theme: 'dark' | 'light';
}

export interface EditorHandle {
  triggerFind: () => void;
  triggerReplace: () => void;
  focus: () => void;
  getSelection: () => {
    text: string;
    range: AnnotationRange;
  } | null;
  getCursorPosition: () => { lineNumber: number; column: number } | null;
  revealRange: (range: AnnotationRange) => void;
  setCursorPosition: (position: { lineNumber: number; column: number }) => void;
  jumpToLine: (lineNumber: number) => void;
  refreshAnnotations: () => void;
}

const Editor = forwardRef<EditorHandle, EditorProps>(({
  content,
  onChange,
  currentFile,
  projectPath = '',
  openFilePaths,
  annotations,
  annotationsHidden,
  onAnnotate,
  onRemoveAnnotation,
  onEditAnnotation,
  onCursorChange,
  onSyncTexForwardSearch,
  theme
}, ref) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // Decorations belong to a model, and every open file has its own model.
  const decorationsByModelRef = useRef<Map<string, string[]>>(new Map());
  const colorClassMapRef = useRef<Map<string, string>>(new Map());
  const lastContextMenuPositionRef = useRef<{ lineNumber: number; column: number } | null>(null);

  // Updated during render so Monaco event handlers (registered once on
  // mount) and model-switch callbacks always see the latest values.
  const annotationsRef = useRef<Annotation[]>(annotations);
  annotationsRef.current = annotations;
  const annotationsHiddenRef = useRef(annotationsHidden);
  annotationsHiddenRef.current = annotationsHidden;
  const callbacksRef = useRef({ onAnnotate, onRemoveAnnotation, onEditAnnotation, onCursorChange, onSyncTexForwardSearch });
  callbacksRef.current = { onAnnotate, onRemoveAnnotation, onEditAnnotation, onCursorChange, onSyncTexForwardSearch };

  useEffect(() => {
    completionContext.projectPath = projectPath;
  }, [projectPath]);

  const ensureHighlightClass = (color: string) => {
    if (colorClassMapRef.current.has(color)) {
      return colorClassMapRef.current.get(color)!;
    }

    const safeId = color.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    const className = `annotation-highlight-${safeId || 'color'}-${colorClassMapRef.current.size}`;

    const toRgba = (value: string, alpha: number) => {
      if (/^#([0-9a-fA-F]{6})$/.test(value)) {
        const r = parseInt(value.slice(1, 3), 16);
        const g = parseInt(value.slice(3, 5), 16);
        const b = parseInt(value.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      return value;
    };

    const style = document.createElement('style');
    style.id = `style-${className}`;
    style.innerHTML = `
      .${className} {
        background-color: ${toRgba(color, 0.28)};
        border-bottom: 1px solid ${color};
        border-radius: 2px;
      }
    `;
    document.head.appendChild(style);
    colorClassMapRef.current.set(color, className);
    return className;
  };

  const applyDecorations = useCallback(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) {
      return;
    }
    const key = model.uri.toString();
    const previous = decorationsByModelRef.current.get(key) ?? [];
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];

    if (!annotationsHiddenRef.current) {
      ensureGlyphStyle();
      annotationsRef.current.forEach(annotation => {
        const className = ensureHighlightClass(annotation.color);
        const mainOptions: monaco.editor.IModelDecorationOptions = {
          inlineClassName: className,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        };
        if (annotation.comment) {
          mainOptions.hoverMessage = [
            { value: `**Comment:** ${annotation.comment.replace(/\r?\n/g, '  \n')}` },
          ];
        }
        decorations.push({
          range: new monaco.Range(
            annotation.range.startLineNumber,
            annotation.range.startColumn,
            annotation.range.endLineNumber,
            annotation.range.endColumn
          ),
          options: mainOptions,
        });
        decorations.push({
          range: new monaco.Range(annotation.range.startLineNumber, 1, annotation.range.startLineNumber, 1),
          options: {
            glyphMarginClassName: 'annotation-info-glyph',
            glyphMarginHoverMessage: annotation.comment
              ? { value: `**Comment:** ${annotation.comment.replace(/\r?\n/g, '  \n')}\n\n*Click to view or edit highlight*` }
              : { value: 'Click to view highlight options' },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        });
      });
    }

    decorationsByModelRef.current.set(key, editor.deltaDecorations(previous, decorations));
  }, []);

  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;

    const reportCursor = () => {
      const position = editor.getPosition();
      if (position) {
        callbacksRef.current.onCursorChange?.({ lineNumber: position.lineNumber, column: position.column });
      }
    };
    reportCursor();
    editor.onDidChangeCursorPosition(event => {
      callbacksRef.current.onCursorChange?.({
        lineNumber: event.position.lineNumber,
        column: event.position.column,
      });
    });

    // Switching tabs swaps the model; re-apply that file's highlights.
    editor.onDidChangeModel(() => applyDecorations());

    // Add click handler for glyph margin to edit or remove annotations
    editor.onMouseDown((e: any) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const lineNumber = e.target.position?.lineNumber;
        if (!lineNumber) return;

        const annotation = annotationsRef.current.find(
          ann => ann.range.startLineNumber === lineNumber
        );
        if (annotation) {
          const { onEditAnnotation: edit, onRemoveAnnotation: remove } = callbacksRef.current;
          if (edit) {
            edit(annotation);
          } else if (remove) {
            remove(annotation.id);
          }
        }
      }
    });

    editor.onContextMenu((event: any) => {
      const position = event.target?.position || editor.getPosition();
      if (!position) return;
      lastContextMenuPositionRef.current = {
        lineNumber: position.lineNumber,
        column: position.column,
      };
    });

    // Register context menu actions
    editor.addAction({
      id: 'annotate-selection',
      label: 'Highlight Section...',
      contextMenuGroupId: 'annotation',
      contextMenuOrder: 1,
      run: () => {
        callbacksRef.current.onAnnotate?.();
      }
    });

    editor.addAction({
      id: 'synctex-forward-search',
      label: 'Highlight in PDF',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: () => {
        const position = lastContextMenuPositionRef.current || editor.getPosition();
        if (position) {
          editor.setPosition(position);
          callbacksRef.current.onCursorChange?.({
            lineNumber: position.lineNumber,
            column: position.column,
          });
        }
        callbacksRef.current.onSyncTexForwardSearch?.();
      }
    });

    applyDecorations();
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      onChange(value);
    }
  };

  useImperativeHandle(ref, () => ({
    triggerFind: () => {
      if (!editorRef.current) return;
      editorRef.current.getAction('actions.find')?.run();
    },
    triggerReplace: () => {
      if (!editorRef.current) return;
      editorRef.current.getAction('editor.action.startFindReplaceAction')?.run();
    },
    focus: () => {
      editorRef.current?.focus();
    },
    getSelection: () => {
      if (!editorRef.current) return null;
      const selection = editorRef.current.getSelection();
      const model = editorRef.current.getModel();
      if (!selection || !model) return null;
      const text = model.getValueInRange(selection);
      return {
        text,
        range: {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn,
        },
      };
    },
    getCursorPosition: () => {
      const position = editorRef.current?.getPosition();
      if (!position) return null;
      return {
        lineNumber: position.lineNumber,
        column: position.column,
      };
    },
    revealRange: (range: AnnotationRange) => {
      if (!editorRef.current) return;
      const targetRange = new monaco.Range(
        range.startLineNumber,
        range.startColumn,
        range.endLineNumber,
        range.endColumn
      );
      editorRef.current.revealRangeInCenter(targetRange, monaco.editor.ScrollType.Smooth);
      editorRef.current.setSelection(targetRange);
      editorRef.current.focus();
    },
    setCursorPosition: (position: { lineNumber: number; column: number }) => {
      if (!editorRef.current) return;
      editorRef.current.setPosition({
        lineNumber: position.lineNumber,
        column: position.column,
      });
      editorRef.current.revealPositionInCenter(
        {
          lineNumber: position.lineNumber,
          column: position.column,
        },
        monaco.editor.ScrollType.Smooth
      );
    },
    jumpToLine: (lineNumber: number) => {
      if (!editorRef.current) return;
      editorRef.current.revealLineInCenter(lineNumber, monaco.editor.ScrollType.Smooth);
      editorRef.current.setPosition({
        lineNumber: lineNumber,
        column: 1,
      });
      editorRef.current.focus();
    },
    refreshAnnotations: () => {
      applyDecorations();
    }
  }));

  useEffect(() => {
    applyDecorations();
  }, [annotations, annotationsHidden, applyDecorations]);

  // Release the models (and their undo history) of tabs that were closed.
  useEffect(() => {
    if (!openFilePaths) {
      return;
    }
    const open = new Set(openFilePaths.map(modelPathFor));
    const current = editorRef.current?.getModel();
    monaco.editor.getModels().forEach(model => {
      if (model.uri.scheme !== 'file' || model === current) return;
      const key = model.uri.toString();
      if (!open.has(key)) {
        decorationsByModelRef.current.delete(key);
        model.dispose();
      }
    });
  }, [openFilePaths]);

  const getLanguage = () => {
    if (!currentFile) return 'plaintext';
    const ext = currentFile.name.split('.').pop()?.toLowerCase();
    if (ext === 'tex' || ext === 'latex' || ext === 'ltx' || ext === 'sty' || ext === 'cls') return 'latex';
    if (ext === 'bib') return 'bibtex';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    if (ext === 'json') return 'json';
    return 'plaintext';
  };

  return (
    <div className="editor-container">
      <div className="editor-header">
        <span className="editor-title" title={currentFile?.path}>
          {currentFile ? currentFile.name : 'No file selected'}
        </span>
      </div>
      <div className="editor-wrapper">
        {currentFile ? (
          <MonacoEditor
            height="100%"
            // One model per file keeps undo history, scroll position and
            // highlights separate for every tab.
            path={modelPathFor(currentFile.path)}
            language={getLanguage()}
            value={content}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
            options={{
              fontSize: 14,
              minimap: { enabled: true },
              wordWrap: 'on',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              glyphMargin: true,
              fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, monospace',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              // Umlauts and other non-ASCII letters are normal in LaTeX prose.
              unicodeHighlight: { ambiguousCharacters: false },
              readOnly: false,
              domReadOnly: false,
            }}
          />
        ) : (
          <div className="editor-empty">
            <p>Select a file to start editing</p>
          </div>
        )}
      </div>
    </div>
  );
});

Editor.displayName = 'Editor';

export default Editor;
