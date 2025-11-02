export {}; // ensure this is a module

declare global {
  interface Window {
    api: {
      readFile: (filePath: string) => Promise<any>;
      readFileBase64: (filePath: string) => Promise<any>;
      writeFile: (filePath: string, content: string) => Promise<any>;
      saveZipFile: (opts: { defaultPath: string; data: string }) => Promise<any>;
      createFile: (filePath: string) => Promise<any>;
      deletePath: (filePath: string) => Promise<any>;
      renamePath: (oldPath: string, newPath: string) => Promise<any>;
      readDirectory: (dirPath: string) => Promise<any>;
      createDirectory: (dirPath: string) => Promise<any>;
      copyPaths: (sources: string[], destination: string) => Promise<any>;
      readBinaryFile: (filePath: string) => Promise<any>;
      openDirectoryDialog: () => Promise<any>;
      getDefaultProjectsDirectory: () => Promise<any>;
      showInFileBrowser: (filePath: string) => Promise<any>;
      openExternal: (url: string) => Promise<any>;
      checkLatexInstallation: () => Promise<any>;
      checkPackageInstalled: (packageName: string) => Promise<any>;
      installLatexPackage: (packageName: string) => Promise<any>;
      openLatexDownload: () => Promise<any>;
      compileLatex: (texFilePath: string, engine: 'pdflatex' | 'xelatex' | 'lualatex') => Promise<any>;
      onCompilationStatus: (listener: (status: { stage: string; message: string }) => void) => () => void;
      gitTerminal: {
        start: (options?: { cwd?: string }) => Promise<{ success: boolean; shell?: string; error?: string }>;
        stop: () => Promise<any>;
        run: (command: string) => Promise<any>;
        onData: (listener: (data: string) => void) => () => void;
        onExit: (listener: (code: number | null) => void) => () => void;
      };
      path: {
        basename: (p: string) => string;
        dirname: (p: string) => string;
        join: (...parts: string[]) => string;
        extname: (p: string) => string;
      };
    };
  }
}

