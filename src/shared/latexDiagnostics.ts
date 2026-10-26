export type LatexDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface LatexDiagnostic {
  severity: LatexDiagnosticSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
}

const uniqueKey = (diagnostic: LatexDiagnostic): string => (
  `${diagnostic.severity}|${diagnostic.file || ''}|${diagnostic.line || ''}|${diagnostic.code || ''}|${diagnostic.message}`
);

const pushUnique = (items: LatexDiagnostic[], seen: Set<string>, diagnostic: LatexDiagnostic) => {
  const key = uniqueKey(diagnostic);
  if (seen.has(key)) return;
  seen.add(key);
  items.push(diagnostic);
};

export const detectMissingLatexPackage = (output: string): string | null => {
  const packagePatterns = [
    /! LaTeX Error: File `([^']+\.sty)' not found/,
    /! Package .* Error:.*package `([^']+)'/,
    /LaTeX Error: File `([^']+\.sty)' not found/,
    /Cannot find file `([^']+\.sty)'/
  ];

  for (const pattern of packagePatterns) {
    const match = output.match(pattern);
    if (match && match[1]) {
      return match[1].replace(/\.sty$/, '');
    }
  }
  return null;
};

// TeX wraps its console output and .log at 79 characters (max_print_line),
// splitting file names and long warnings. Re-join those physical lines.
const TEX_LINE_WIDTH = 79;
const joinWrappedLines = (rawLines: string[]): string[] => {
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    while (line.length > 0 && line.length % TEX_LINE_WIDTH === 0 && i + 1 < rawLines.length && rawLines[i + 1].length > 0) {
      line += rawLines[++i];
    }
    lines.push(line);
  }
  return lines;
};

const TEX_SOURCE_FILE = /\.(?:tex|ltx|latex)$/i;

// LaTeX reports "(file" when it starts reading a file and ")" when done.
// Following that nesting tells which source file an "on input line N"
// warning belongs to, e.g. a chapter pulled in with \include.
const createInputFileTracker = () => {
  const stack: Array<string | null> = [];
  return {
    reset: () => { stack.length = 0; },
    current: (): string | undefined => {
      for (let i = stack.length - 1; i >= 0; i--) {
        const entry = stack[i];
        if (entry && TEX_SOURCE_FILE.test(entry)) return entry;
      }
      return undefined;
    },
    consume: (line: string) => {
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '(') {
          const rest = line.slice(i + 1);
          const match = rest.match(/^"([^"]+)"/)
            || rest.match(/^((?:[A-Za-z]:)?[^\s()"{}[\]]*\.[A-Za-z]{1,8})(?=[\s()[\]{}]|$)/);
          if (match) {
            stack.push(match[1]);
            i += match[0].length;
          } else {
            stack.push(null);
          }
        } else if (char === ')') {
          stack.pop();
        }
      }
    },
  };
};

export const parseLatexDiagnostics = (output: string, texFilePath?: string): LatexDiagnostic[] => {
  const normalized = output.replace(/\r\n/g, '\n');
  const lines = joinWrappedLines(normalized.split('\n'));
  const diagnostics: LatexDiagnostic[] = [];
  const seen = new Set<string>();
  const inputFiles = createInputFileTracker();

  const missingPackage = detectMissingLatexPackage(output);
  if (missingPackage) {
    pushUnique(diagnostics, seen, {
      severity: 'error',
      message: `Missing LaTeX package: ${missingPackage}`,
      file: texFilePath,
      code: 'missing-package'
    });
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Every TeX run starts with a banner; the file nesting starts over.
    if (/^This is (?:pdf|Xe|Lua|e-)?(?:Hi)?TeX/i.test(line)) {
      inputFiles.reset();
    }
    const currentFile = inputFiles.current() ?? texFilePath;
    inputFiles.consume(rawLine);
    if (!line) continue;

    const fileLine = line.match(/^(.+?\.tex):(\d+):\s*(.+)$/i);
    if (fileLine) {
      // The follow-up "==> Fatal error occurred" line repeats the location.
      if (/^==> Fatal error occurred/i.test(fileLine[3].trim())) {
        continue;
      }
      pushUnique(diagnostics, seen, {
        severity: /warning/i.test(fileLine[3]) ? 'warning' : 'error',
        file: fileLine[1],
        line: Number(fileLine[2]),
        message: fileLine[3].trim(),
        code: 'latex-file-line'
      });
      continue;
    }

    const missingImage = line.match(/LaTeX Warning: File `([^']+)' not found on input line (\d+)/i);
    if (missingImage) {
      pushUnique(diagnostics, seen, {
        severity: 'error',
        file: currentFile,
        line: Number(missingImage[2]),
        message: `Missing image or input file: ${missingImage[1]}`,
        code: 'missing-file'
      });
      continue;
    }

    const citation = line.match(/LaTeX Warning: Citation `([^']+)' .*undefined on input line (\d+)/i);
    if (citation) {
      pushUnique(diagnostics, seen, {
        severity: 'warning',
        file: currentFile,
        line: Number(citation[2]),
        message: `Undefined citation: ${citation[1]}`,
        code: 'undefined-citation'
      });
      continue;
    }

    const reference = line.match(/LaTeX Warning: Reference `([^']+)' .*undefined on input line (\d+)/i);
    if (reference) {
      pushUnique(diagnostics, seen, {
        severity: 'warning',
        file: currentFile,
        line: Number(reference[2]),
        message: `Undefined reference: ${reference[1]}`,
        code: 'undefined-reference'
      });
      continue;
    }

    if (/^! LaTeX Error:/i.test(line) || /^! Package .* Error:/i.test(line) || /^! Undefined control sequence/i.test(line) || /^! Emergency stop/i.test(line)) {
      pushUnique(diagnostics, seen, {
        severity: 'error',
        file: currentFile,
        message: line.replace(/^!\s*/, ''),
        code: 'latex-error'
      });
    }
  }

  return diagnostics;
};

export const summarizeLatexError = (output: string, texFilePath?: string): string => {
  const diagnostics = parseLatexDiagnostics(output, texFilePath);
  const firstError = diagnostics.find(diagnostic => diagnostic.severity === 'error') || diagnostics[0];

  if (firstError) {
    // Only the file name: full paths make the summary hard to read.
    const locationFile = (firstError.file || texFilePath || 'LaTeX').split(/[\\/]/).pop();
    const location = firstError.line ? `${locationFile}:${firstError.line}: ` : '';
    return `${location}${firstError.message}`;
  }

  const normalized = output.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const fatal = lines.find(line => /^! /i.test(line));
  if (fatal) {
    return fatal.replace(/^!\s*/, '');
  }

  return 'Compilation failed. See the full log for details.';
};

