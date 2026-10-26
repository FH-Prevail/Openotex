import { stripLatexComments } from '../../shared/latexProject';

export interface StructureNode {
  id: string;
  title: string;
  level: number;
  type: 'title' | 'chapter' | 'section' | 'subsection' | 'subsubsection';
  children: StructureNode[];
  lineNumber: number;
}

export interface ParseResult {
  isValid: boolean;
  structure: StructureNode | null;
  error?: string;
}

/**
 * Parse LaTeX content to extract document structure
 */
export function parseLatexStructure(content: string): ParseResult {
  if (!content || content.trim().length === 0) {
    return {
      isValid: false,
      structure: null,
      error: 'Empty document'
    };
  }

  // Check if it's a valid LaTeX document
  if (!content.includes('\\documentclass') && !content.includes('\\begin{document}')) {
    return {
      isValid: false,
      structure: null,
      error: 'Not a valid LaTeX document'
    };
  }

  const lines = content.split('\n');
  const root: StructureNode = {
    id: 'root',
    title: 'Document',
    level: 0,
    type: 'title',
    children: [],
    lineNumber: 0
  };

  // Extract title if exists
  const titleMatch = content.match(/\\title\{([^}]+)\}/);
  if (titleMatch) {
    root.title = cleanLatexText(titleMatch[1]);
  }

  // Extract author if exists (optional, can be used for subtitle)
  const authorMatch = content.match(/\\author\{([^}]+)\}/);
  if (authorMatch) {
    const authorNode: StructureNode = {
      id: 'author',
      title: `By: ${cleanLatexText(authorMatch[1])}`,
      level: 1,
      type: 'section',
      children: [],
      lineNumber: 0
    };
    root.children.push(authorNode);
  }

  // Stack to maintain hierarchy
  const stack: StructureNode[] = [root];
  let nodeIdCounter = 0;

  // \part sits above chapters; it is drawn like a chapter node.
  const levels: Record<string, { type: StructureNode['type']; level: number }> = {
    part: { type: 'chapter', level: 0.5 },
    chapter: { type: 'chapter', level: 1 },
    section: { type: 'section', level: 2 },
    subsection: { type: 'subsection', level: 3 },
    subsubsection: { type: 'subsubsection', level: 4 },
  };
  // Matches \section, \section*, \section[short title] and so on.
  const headingPattern = /\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{/g;

  stripLatexComments(content).split('\n').forEach((line, lineIndex) => {
    headingPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = headingPattern.exec(line)) !== null) {
      const heading = levels[match[1]];
      const rawTitle = readBracedArgument(line, headingPattern.lastIndex);
      if (!heading || rawTitle === null) {
        continue;
      }
      const node: StructureNode = {
        id: `node-${nodeIdCounter++}`,
        title: cleanLatexText(rawTitle) || '(untitled)',
        level: heading.level,
        type: heading.type,
        children: [],
        lineNumber: lineIndex + 1
      };

      // Find the correct parent in the stack
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }

      // Add to parent
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      }

      // Push current node to stack
      stack.push(node);
    }
  });

  // Check if we found any structure
  if (root.children.length === 0) {
    return {
      isValid: false,
      structure: null,
      error: 'No document structure found (no sections/chapters)'
    };
  }

  return {
    isValid: true,
    structure: root
  };
}

// Read a balanced {...} argument whose content starts at `start` (just after
// the opening brace). Returns null when the brace is not closed on the line.
function readBracedArgument(line: string, start: number): string | null {
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
}

/**
 * Clean LaTeX text by removing common commands
 */
function cleanLatexText(text: string): string {
  return text
    // Remove common formatting commands
    .replace(/\\textbf\{([^}]+)\}/g, '$1')
    .replace(/\\textit\{([^}]+)\}/g, '$1')
    .replace(/\\emph\{([^}]+)\}/g, '$1')
    .replace(/\\texttt\{([^}]+)\}/g, '$1')
    // Remove citations and references
    .replace(/\\cite\{[^}]+\}/g, '')
    .replace(/\\ref\{[^}]+\}/g, '')
    .replace(/\\label\{[^}]+\}/g, '')
    // Remove math mode
    .replace(/\$([^$]+)\$/g, '$1')
    // Remove other common commands
    .replace(/\\[a-zA-Z]+\{([^}]+)\}/g, '$1')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Count total nodes in the structure
 */
export function countNodes(node: StructureNode): number {
  let count = 1;
  node.children.forEach(child => {
    count += countNodes(child);
  });
  return count;
}

/**
 * Get maximum depth of the structure
 */
export function getMaxDepth(node: StructureNode, currentDepth: number = 0): number {
  if (node.children.length === 0) {
    return currentDepth;
  }
  const childDepths = node.children.map(child => getMaxDepth(child, currentDepth + 1));
  return Math.max(...childDepths);
}
