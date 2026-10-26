export {}; // ensure this is a module

declare global {
  interface Window {
    api: {
      readFile: (filePath: string) => Promise<any>;
      readFileBase64: (filePath: string) => Promise<any>;
      writeFile: (filePath: string, content: string) => Promise<any>;
      pathExists: (targetPath: string) => Promise<{ success: boolean; exists: boolean }>;
      saveZipFile: (opts: { defaultPath: string; data: string }) => Promise<any>;
      savePdfAs: (opts: { sourcePath: string; defaultPath?: string }) => Promise<any>;
      createFile: (filePath: string) => Promise<any>;
      deletePath: (filePath: string) => Promise<any>;
      renamePath: (oldPath: string, newPath: string) => Promise<any>;
      readDirectory: (dirPath: string) => Promise<any>;
      createDirectory: (dirPath: string) => Promise<any>;
      copyPaths: (sources: string[], destination: string) => Promise<any>;
      readBinaryFile: (filePath: string) => Promise<any>;
      watchPath: (projectRoot: string) => Promise<any>;
      unwatchPath: () => Promise<any>;
      openDirectoryDialog: () => Promise<any>;
      getDefaultProjectsDirectory: () => Promise<any>;
      showInFileBrowser: (filePath: string) => Promise<any>;
      openExternal: (url: string) => Promise<any>;
      openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
      showUnsavedDialog: (fileNames: string[]) => Promise<'save' | 'discard' | 'cancel'>;
      copyText: (text: string) => void;
      getMcpSetup: () => Promise<{
        success: boolean;
        name: string;
        command: string;
        args: string[];
        env: Record<string, string>;
        scriptPath: string;
        platform: string;
      }>;
      takePendingOpenRequest: () => Promise<{ file: string; line?: number; project?: string; isDirectory?: boolean } | null>;
      onOpenRequest: (listener: (request: { file: string; line?: number; project?: string; isDirectory?: boolean }) => void) => () => void;
      onCloseRequested: (listener: () => void) => () => void;
      acknowledgeClose: () => void;
      confirmClose: () => Promise<any>;
      cancelClose: () => Promise<any>;
      checkLatexInstallation: () => Promise<any>;
      checkPackageInstalled: (packageName: string) => Promise<any>;
      installLatexPackage: (packageName: string) => Promise<any>;
      openLatexDownload: () => Promise<any>;
      compileLatex: (
        texFilePath: string,
        engine: 'pdflatex' | 'xelatex' | 'lualatex',
        options?: { projectRoot?: string; force?: boolean }
      ) => Promise<any>;
      resolveRootDocument: (texFile: string, projectRoot?: string) => Promise<{ success: boolean; rootFile?: string; error?: string }>;
      collectLatexReferences: (projectRoot: string) => Promise<{
        success: boolean;
        labels: Array<{ key: string; file: string; line: number }>;
        citations: Array<{ key: string; type: string; title?: string; file: string }>;
      }>;
      onCompilationStatus: (listener: (status: { stage: string; message: string }) => void) => () => void;
      onFilesystemEvent: (listener: (payload: { event: string; path: string; root: string }) => void) => () => void;
      synctex: {
        forward: (
          texFile: string,
          line: number,
          column: number,
          pdfFile?: string,
          texRoot?: string
        ) => Promise<{
          success: boolean;
          rects?: Array<{ page: number; h: number; v: number; W: number; H: number }>;
          pdfFile?: string;
          error?: string;
        }>;
        inverse: (
          pdfFile: string,
          page: number,
          h: number,
          v: number,
          texRoot?: string
        ) => Promise<{
          success: boolean;
          file?: string;
          line?: number;
          column?: number;
          error?: string;
        }>;
      };
      gitTerminal: {
        start: (options?: { cwd?: string }) => Promise<{ success: boolean; shell?: string; cwd?: string; error?: string }>;
        stop: () => Promise<any>;
        run: (command: string) => Promise<any>;
        onData: (listener: (data: string) => void) => () => void;
        onExit: (listener: (code: number | null) => void) => () => void;
      };
      git: {
        status: (cwd: string) => Promise<any>;
        commit: (payload: { cwd: string; message: string }) => Promise<any>;
        pull: (cwd: string) => Promise<any>;
        push: (cwd: string) => Promise<any>;
        init: (cwd: string) => Promise<any>;
        check: () => Promise<any>;
      };
      path: {
        basename: (p: string, ext?: string) => string;
        dirname: (p: string) => string;
        join: (...parts: string[]) => string;
        extname: (p: string) => string;
        relative: (from: string, to: string) => string;
        sep: string;
      };
      platform: string;
    };
  }
}
