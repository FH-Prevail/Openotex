// Pure helpers for understanding multi-file LaTeX projects. They are shared by
// the main process (root-document detection, reference scanning) and tests.

export interface LatexLabel {
  key: string;
  line: number;
}

export interface BibEntry {
  key: string;
  type: string;
  title?: string;
}

const IGNORED_BIB_TYPES = new Set(['comment', 'string', 'preamble']);

// Remove `%` comments while keeping line structure, so line numbers stay valid.
// A `%` only starts a comment when it is preceded by an even number of
// backslashes (`\%` is a literal percent sign, `\\%` is a line break + comment).
export const stripLatexComments = (source: string): string => {
  return source
    .split('\n')
    .map(line => {
      let backslashes = 0;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '\\') {
          backslashes++;
          continue;
        }
        if (char === '%' && backslashes % 2 === 0) {
          return line.slice(0, i);
        }
        backslashes = 0;
      }
      return line;
    })
    .join('\n');
};

export const hasDocumentClass = (source: string): boolean => (
  /\\documentclass\s*(?:\[[^\]]*\])?\s*\{/.test(stripLatexComments(source))
);

// Supports the `% !TEX root = main.tex` magic comment used by TeXstudio,
// TeXShop and LaTeX Workshop. Only the first lines of a file are inspected.
export const findMagicRoot = (source: string): string | null => {
  const head = source.split('\n').slice(0, 40);
  for (const line of head) {
    const match = line.match(/^\s*%\s*!\s*TeX\s+root\s*=\s*(.+?)\s*$/i);
    if (match && match[1]) {
      return match[1].replace(/^["']|["']$/g, '');
    }
  }
  return null;
};

// Relative paths of files pulled in with \input, \include, \subfile, \import,
// \subimport and friends. Returned paths use forward slashes and may lack an
// extension; callers resolve them against the including file or root folder.
export const extractIncludes = (source: string): string[] => {
  const text = stripLatexComments(source);
  const targets: string[] = [];
  const add = (value: string) => {
    const cleaned = value.trim().replace(/^["']|["']$/g, '');
    if (cleaned && !targets.includes(cleaned)) {
      targets.push(cleaned);
    }
  };

  const braced = /\\(?:input|include|subfile|InputIfFileExists|includeonly)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = braced.exec(text)) !== null) {
    match[1].split(',').forEach(add);
  }

  const imported = /\\(?:sub)?(?:import|inputfrom|includefrom)\*?\s*\{([^}]*)\}\s*\{([^}]+)\}/g;
  while ((match = imported.exec(text)) !== null) {
    const dir = match[1].trim().replace(/\\/g, '/');
    const file = match[2].trim();
    add(dir ? `${dir.replace(/\/+$/, '')}/${file}` : file);
  }

  // Plain TeX syntax: \input chapter1
  const bare = /\\input\s+([^\s{}\\%]+)/g;
  while ((match = bare.exec(text)) !== null) {
    add(match[1]);
  }

  return targets;
};

export const extractLabels = (source: string): LatexLabel[] => {
  const labels: LatexLabel[] = [];
  const seen = new Set<string>();
  stripLatexComments(source).split('\n').forEach((line, index) => {
    const pattern = /\\label\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const key = match[1].trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        labels.push({ key, line: index + 1 });
      }
    }
  });
  return labels;
};

export interface LatexHeading {
  kind: 'part' | 'chapter' | 'section' | 'subsection' | 'subsubsection' | 'paragraph';
  level: number;
  title: string;
  line: number;
}

const HEADING_LEVELS: Record<LatexHeading['kind'], number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
};

// Read a balanced {...} argument whose content starts at `start` (just after
// the opening brace). Returns null when the brace is not closed on the line.
const readBracedArgument = (line: string, start: number): string | null => {
  let depth = 1;
  for (let i = start; i < line.length; i++) {
    const char = line[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        return line.slice(start, i);
      }
    }
  }
  return null;
};

const plainTitle = (title: string): string => (
  title
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?/g, '')
    .replace(/[{}$]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
);

// \part ... \paragraph headings (starred and with short titles too).
export const extractHeadings = (source: string): LatexHeading[] => {
  const headings: LatexHeading[] = [];
  const pattern = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/g;
  stripLatexComments(source).split('\n').forEach((line, index) => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const raw = readBracedArgument(line, pattern.lastIndex);
      if (raw === null) continue;
      const kind = match[1] as LatexHeading['kind'];
      headings.push({ kind, level: HEADING_LEVELS[kind], title: plainTitle(raw) || '(untitled)', line: index + 1 });
    }
  });
  return headings;
};

export interface LatexKeyUse {
  key: string;
  line: number;
}

// Cross-reference commands (\href is a link, not a reference).
const REF_COMMANDS = 'ref|eqref|pageref|autoref|Autoref|nameref|vref|vpageref|cref|Cref|cpageref|Cpageref|labelcref|subref|fullref';

// Keys used by \ref-like and \cite-like commands, and keys defined with
// \bibitem in a hand-written thebibliography environment.
export const extractReferenceUses = (source: string): { refs: LatexKeyUse[]; cites: LatexKeyUse[]; bibitems: LatexKeyUse[] } => {
  const refs: LatexKeyUse[] = [];
  const cites: LatexKeyUse[] = [];
  const bibitems: LatexKeyUse[] = [];
  const refPattern = new RegExp(`\\\\(?:${REF_COMMANDS})\\*?\\s*\\{([^{}]*)\\}`, 'g');
  const citePattern = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^{}]*)\}/g;
  const bibitemPattern = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g;
  const addKeys = (target: LatexKeyUse[], list: string, line: number) => {
    list.split(',').map(key => key.trim()).filter(key => key && key !== '*').forEach(key => target.push({ key, line }));
  };
  stripLatexComments(source).split('\n').forEach((line, index) => {
    let match: RegExpExecArray | null;
    refPattern.lastIndex = 0;
    while ((match = refPattern.exec(line)) !== null) addKeys(refs, match[1], index + 1);
    citePattern.lastIndex = 0;
    while ((match = citePattern.exec(line)) !== null) addKeys(cites, match[1], index + 1);
    bibitemPattern.lastIndex = 0;
    while ((match = bibitemPattern.exec(line)) !== null) addKeys(bibitems, match[1], index + 1);
  });
  return { refs, cites, bibitems };
};

const cleanBibValue = (value: string): string => (
  value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
);

export const extractBibEntries = (source: string): BibEntry[] => {
  const entries: BibEntry[] = [];
  const seen = new Set<string>();
  const pattern = /@\s*([a-zA-Z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/g;
  const matches: Array<{ type: string; key: string; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    matches.push({ type: match[1].toLowerCase(), key: match[2], index: match.index, end: pattern.lastIndex });
  }

  matches.forEach((entry, i) => {
    if (IGNORED_BIB_TYPES.has(entry.type) || seen.has(entry.key)) {
      return;
    }
    seen.add(entry.key);
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : source.length;
    const body = source.slice(entry.end, Math.min(bodyEnd, entry.end + 4000));
    const titleMatch = body.match(/\btitle\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)")/i);
    const title = titleMatch ? cleanBibValue(titleMatch[1] ?? titleMatch[2] ?? '') : undefined;
    entries.push({ key: entry.key, type: entry.type, title: title || undefined });
  });

  return entries;
};
