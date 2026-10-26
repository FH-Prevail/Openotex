// Starter projects offered by the New Project dialog. Every template has a
// main.tex; some add supporting files such as a bibliography.

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  files: (title: string) => Record<string, string>;
}

// Escape characters that have a special meaning in LaTeX text.
export const escapeLatexText = (text: string): string => (
  text.replace(/[\\{}$&#^_%~]/g, char => {
    switch (char) {
      case '\\': return '\\textbackslash{}';
      case '~': return '\\textasciitilde{}';
      case '^': return '\\textasciicircum{}';
      default: return `\\${char}`;
    }
  })
);

const sampleBibliography = `@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}

@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {{\\LaTeX}: A Document Preparation System},
  publisher = {Addison-Wesley},
  edition   = {2},
  year      = {1994}
}
`;

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'article',
    name: 'Article',
    description: 'Paper with abstract, sections and a BibTeX bibliography',
    files: title => ({
      'main.tex': `\\documentclass[11pt,a4paper]{article}

% Essential packages
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

% Document metadata
\\title{${title}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
A short summary of the document.
\\end{abstract}

\\section{Introduction}
\\label{sec:introduction}

Write your content here. Cite sources from \\texttt{references.bib},
for example~\\cite{knuth1984,lamport1994}.

\\section{Conclusion}
\\label{sec:conclusion}

Section~\\ref{sec:introduction} introduced the topic.

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`,
      'references.bib': sampleBibliography,
    }),
  },
  {
    id: 'report',
    name: 'Report / Thesis',
    description: 'Chapters in separate files with a table of contents',
    files: title => ({
      'main.tex': `\\documentclass[12pt,a4paper]{report}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{${title}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle
\\tableofcontents

% Each chapter lives in its own file. Compiling a chapter file
% automatically builds this main document.
\\include{chapters/introduction}
\\include{chapters/conclusion}

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`,
      'chapters/introduction.tex': `\\chapter{Introduction}
\\label{chap:introduction}

Start writing your first chapter here~\\cite{lamport1994}.
`,
      'chapters/conclusion.tex': `\\chapter{Conclusion}
\\label{chap:conclusion}

Chapter~\\ref{chap:introduction} introduced the topic.
`,
      'references.bib': sampleBibliography,
    }),
  },
  {
    id: 'beamer',
    name: 'Presentation',
    description: 'Beamer slides with a title page and sections',
    files: title => ({
      'main.tex': `\\documentclass{beamer}

\\usetheme{Madrid}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}

\\title{${title}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\begin{frame}
  \\titlepage
\\end{frame}

\\section{Introduction}

\\begin{frame}{Motivation}
  \\begin{itemize}
    \\item First point
    \\item Second point
  \\end{itemize}
\\end{frame}

\\section{Results}

\\begin{frame}{Results}
  Present your results here.
\\end{frame}

\\end{document}
`,
    }),
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'A minimal document to start from scratch',
    files: title => ({
      'main.tex': `\\documentclass{article}

\\title{${title}}

\\begin{document}

\\maketitle

\\end{document}
`,
    }),
  },
];

export const DEFAULT_TEMPLATE_ID = 'article';
