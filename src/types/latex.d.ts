declare module 'latex.js' {
  export interface ParseOptions {
    generator?: any;
  }

  export interface GeneratorOptions {
    hyphenate?: boolean;
    languagePatterns?: any;
    styles?: string[];
  }

  export class HtmlGenerator {
    constructor(options?: GeneratorOptions);
  }

  export class LatexDocument {
    htmlDocument(): HTMLDocument;
    domFragment(): DocumentFragment;
  }

  export function parse(
    latex: string,
    options?: ParseOptions
  ): LatexDocument;

  export default {
    parse,
    HtmlGenerator,
  };
}
