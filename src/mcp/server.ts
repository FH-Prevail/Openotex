// Openotex MCP server: lets coding agents (Claude Code, Claude Desktop,
// Cursor, VS Code, ...) compile LaTeX projects, read structured errors,
// inspect references and outlines, map PDF pages to source lines, and open
// files in the Openotex editor.
//
// Transport: Model Context Protocol over stdio (newline-delimited JSON-RPC).
// It runs as plain Node.js — inside the Openotex executable with
// ELECTRON_RUN_AS_NODE=1, or with any Node.js >= 18.
import * as path from 'path';
import { format } from 'util';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { APP_EDITION, APP_VERSION } from '../shared/appInfo';
import {
  extractHeadings,
  extractIncludes,
  extractReferenceUses,
  LatexHeading,
} from '../shared/latexProject';
import type { LatexDiagnostic } from '../shared/latexDiagnostics';
import {
  augmentPathWithTexDistributions,
  collectLatexReferences,
  collectProjectFiles,
  compileLatexDocument,
  detectTexSetup,
  execFileAsync,
  isInsideDirectory,
  isLatexmkAvailable,
  LatexEngine,
  pathExists,
  readTextFile,
  resolveRootDocument,
  synctexForward,
  synctexInverse,
  TEX_EXTENSIONS,
} from '../main/latexService';

type Json = Record<string, any>;

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = [
  'Openotex tools work on LaTeX projects on this computer.',
  'Paths may be absolute or relative to project_root (default: the server working directory).',
  'Typical loop: edit .tex files with your own file tools, then call compile_document and fix the reported errors (file + line).',
  'compile_document finds the main document automatically when you pass a chapter file.',
  'Use check_references before compiling to catch undefined \\ref/\\cite keys, and pdf_to_source to locate text a reviewer cites by page.',
].join(' ');

const log = (...args: unknown[]) => {
  // stdout carries protocol messages only.
  process.stderr.write(`[openotex-mcp] ${args.map(String).join(' ')}\n`);
};

class ToolError extends Error {}

// --- Helpers ------------------------------------------------------------------

const projectRootOf = (args: Json): string => (
  typeof args.project_root === 'string' && args.project_root.trim()
    ? path.resolve(args.project_root)
    : process.cwd()
);

const resolveInput = (value: unknown, args: Json, name: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolError(`"${name}" is required.`);
  }
  return path.resolve(projectRootOf(args), value);
};

const requireFile = async (filePath: string) => {
  if (!(await pathExists(filePath))) {
    throw new ToolError(`File not found: ${filePath}`);
  }
};

const relativeTo = (root: string, filePath: string) => {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replace(/\\/g, '/') : filePath;
};

// Where the last successful build of `rootFile` left its PDF.
const findCompiledPdf = async (rootFile: string): Promise<string | null> => {
  const dir = path.dirname(rootFile);
  const name = path.basename(rootFile, path.extname(rootFile));
  const candidates = [
    path.join(dir, '.openotex', 'build', name, `${name}.view.pdf`),
    path.join(dir, '.openotex', 'build', name, `${name}.pdf`),
    path.join(dir, `${name}.pdf`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
};

const formatDiagnostic = (diagnostic: LatexDiagnostic, root: string) => ({
  severity: diagnostic.severity,
  file: diagnostic.file ? relativeTo(root, diagnostic.file) : undefined,
  line: diagnostic.line,
  message: diagnostic.message,
});

const toolVersion = async (command: string, args = ['--version']): Promise<string | null> => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 15000 });
    const first = `${stdout}\n${stderr}`.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    return first || 'available';
  } catch {
    return null;
  }
};

// The command that starts the Openotex desktop app, for open_in_openotex.
const appLaunchCommand = (): { command: string; args: string[] } | null => {
  if (process.env.OPENOTEX_APP) {
    let args: string[] = [];
    try {
      const parsed = JSON.parse(process.env.OPENOTEX_APP_ARGS || '[]');
      if (Array.isArray(parsed)) args = parsed.map(String);
    } catch {}
    return { command: process.env.OPENOTEX_APP, args };
  }
  if (process.env.APPIMAGE) {
    return { command: process.env.APPIMAGE, args: [] };
  }
  if (/openotex/i.test(path.basename(process.execPath))) {
    // Linux packages start openotex.bin through the "openotex" launcher.
    const launcher = process.execPath.replace(/\.bin$/, '');
    return { command: launcher !== process.execPath && existsSync(launcher) ? launcher : process.execPath, args: [] };
  }
  return null;
};

// --- Tools ----------------------------------------------------------------------

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
  run: (args: Json, context: { progress: (message: string) => void }) => Promise<Json>;
};

const engineSchema = {
  type: 'string',
  enum: ['pdflatex', 'xelatex', 'lualatex'],
  description: 'LaTeX engine. Default: pdflatex. Use xelatex/lualatex for fontspec or Unicode fonts.',
};
const projectRootSchema = {
  type: 'string',
  description: 'Project folder. Relative paths are resolved against it. Default: the server working directory.',
};

const tools: Tool[] = [
  {
    name: 'get_latex_environment',
    title: 'LaTeX environment',
    description: 'Report the installed LaTeX distribution and which tools (engines, latexmk, BibTeX, Biber, SyncTeX) are available.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async () => {
      const names = ['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'bibtex', 'biber', 'synctex'];
      const versions = await Promise.all(names.map(name => toolVersion(name, name === 'latexmk' ? ['-v'] : ['--version'])));
      const toolsFound: Json = {};
      names.forEach((name, index) => { toolsFound[name] = versions[index]; });
      const setup = await detectTexSetup();
      return {
        openotex: `${APP_VERSION} (${APP_EDITION})`,
        distribution: setup.distribution,
        // miktex/tlmgr install missing packages on their own; tlmgr-root and
        // apt/dnf/zypper/pacman need the user (administrator rights).
        package_manager: setup.manager,
        latexmk_available: await isLatexmkAvailable(),
        tools: toolsFound,
        platform: process.platform,
      };
    },
  },
  {
    name: 'find_root_document',
    title: 'Find main document',
    description: 'Find the main document that is compiled for a .tex file: a "% !TEX root" comment, the file itself if it has \\documentclass, or the document that \\input/\\include-s it.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'A .tex file of the project.' },
        project_root: projectRootSchema,
      },
      required: ['file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async args => {
      const root = projectRootOf(args);
      const file = resolveInput(args.file, args, 'file');
      await requireFile(file);
      const rootFile = await resolveRootDocument(file, root);
      return { file: relativeTo(root, file), root_document: relativeTo(root, rootFile), is_main_document: rootFile === file };
    },
  },
  {
    name: 'compile_document',
    title: 'Compile LaTeX',
    description: 'Compile a LaTeX document to PDF (latexmk when available, including BibTeX/Biber and reruns). Pass any .tex file; chapter files compile their main document. Returns success, the PDF path, and errors/warnings with file and line.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'The .tex file to compile (a chapter file is fine).' },
        engine: engineSchema,
        project_root: projectRootSchema,
        force_full_rebuild: { type: 'boolean', description: 'Rebuild everything instead of only what changed. Default: false.' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args, context) => {
      const root = projectRootOf(args);
      const file = resolveInput(args.file, args, 'file');
      await requireFile(file);
      const engine: LatexEngine = ['pdflatex', 'xelatex', 'lualatex'].includes(args.engine) ? args.engine : 'pdflatex';
      const result = await compileLatexDocument(file, engine, {
        projectRoot: root,
        force: Boolean(args.force_full_rebuild),
        includePdfData: false,
      }, {
        onStatus: status => context.progress(status.message),
      });
      const diagnostics = (result.diagnostics || []).map(diagnostic => formatDiagnostic(diagnostic, root));
      const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error');
      const warnings = diagnostics.filter(diagnostic => diagnostic.severity !== 'error');
      const output: Json = {
        success: result.success,
        root_document: relativeTo(root, result.rootFile),
        engine,
      };
      if (result.success) {
        output.pdf = result.pdfPath;
      } else {
        output.error = result.error;
        if (result.notDocument) output.not_a_document = true;
        if (result.installHint) {
          output.install_hint = result.installHint.command
            ? `${result.installHint.message} ${result.installHint.command}`
            : result.installHint.message;
        }
        const logLines = `${result.log || ''}\n${result.details || ''}`.split(/\r?\n/).filter(line => line.trim());
        if (logLines.length) output.log_tail = logLines.slice(-60).join('\n');
      }
      output.errors = errors.slice(0, 50);
      output.warnings = warnings.slice(0, 50);
      if (warnings.length > 50) output.warnings_truncated = warnings.length - 50;
      return output;
    },
  },
  {
    name: 'get_document_outline',
    title: 'Document outline',
    description: 'Outline of a LaTeX document: parts, chapters, sections and subsections in reading order, following \\input/\\include, each with file and line.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'The main document or any file of it.' },
        project_root: projectRootSchema,
      },
      required: ['file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async args => {
      const root = projectRootOf(args);
      const file = resolveInput(args.file, args, 'file');
      await requireFile(file);
      const rootFile = await resolveRootDocument(file, root);
      const outline: Array<LatexHeading & { file: string }> = [];
      const visited = new Set<string>();
      const walk = async (current: string, depth: number) => {
        const key = path.resolve(current).toLowerCase();
        if (visited.has(key) || depth > 12 || outline.length > 2000) return;
        visited.add(key);
        const source = await readTextFile(current);
        if (source === null) return;
        // Interleave headings and included files in source order.
        const events: Array<{ line: number; heading?: LatexHeading; include?: string }> = [];
        extractHeadings(source).forEach(heading => events.push({ line: heading.line, heading }));
        source.split('\n').forEach((text, index) => {
          extractIncludes(text).forEach(target => events.push({ line: index + 1, include: target }));
        });
        events.sort((a, b) => a.line - b.line);
        for (const event of events) {
          if (event.heading) {
            outline.push({ ...event.heading, file: relativeTo(root, current) });
          } else if (event.include) {
            const base = path.extname(event.include) ? event.include : `${event.include}.tex`;
            const candidates = [path.resolve(path.dirname(rootFile), base), path.resolve(path.dirname(current), base)];
            for (const candidate of candidates) {
              if (await pathExists(candidate)) {
                await walk(candidate, depth + 1);
                break;
              }
            }
          }
        }
      };
      await walk(rootFile, 0);
      return { root_document: relativeTo(root, rootFile), headings: outline };
    },
  },
  {
    name: 'list_labels_and_citations',
    title: 'Labels and bibliography',
    description: 'All \\label keys (with file and line) and all bibliography entries from .bib files in the project.',
    inputSchema: {
      type: 'object',
      properties: { project_root: projectRootSchema },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async args => {
      const root = projectRootOf(args);
      const references = await collectLatexReferences(root, 0);
      return {
        labels: references.labels.map(label => ({ ...label, file: relativeTo(root, label.file) })),
        bibliography: references.citations.map(entry => ({ ...entry, file: relativeTo(root, entry.file) })),
      };
    },
  },
  {
    name: 'check_references',
    title: 'Check references',
    description: 'Static check without compiling: \\ref keys with no matching \\label, \\cite keys missing from the .bib files/\\bibitem entries, and labels defined more than once.',
    inputSchema: {
      type: 'object',
      properties: { project_root: projectRootSchema },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async args => {
      const root = projectRootOf(args);
      const references = await collectLatexReferences(root, 0);
      const files = await collectProjectFiles(root, TEX_EXTENSIONS);
      const labels = new Map<string, Array<{ file: string; line: number }>>();
      references.labels.forEach(label => {
        const list = labels.get(label.key) ?? [];
        list.push({ file: relativeTo(root, label.file), line: label.line });
        labels.set(label.key, list);
      });
      const bibKeys = new Set(references.citations.map(entry => entry.key));
      const undefinedRefs: Json[] = [];
      const undefinedCites: Json[] = [];
      const uses: Array<{ file: string; refs: Json[]; cites: Json[] }> = [];
      for (const file of files) {
        const source = await readTextFile(file);
        if (source === null) continue;
        const found = extractReferenceUses(source);
        found.bibitems.forEach(item => bibKeys.add(item.key));
        uses.push({ file: relativeTo(root, file), refs: found.refs, cites: found.cites });
      }
      uses.forEach(({ file, refs, cites }) => {
        refs.forEach(use => { if (!labels.has(use.key)) undefinedRefs.push({ key: use.key, file, line: use.line }); });
        cites.forEach(use => { if (!bibKeys.has(use.key)) undefinedCites.push({ key: use.key, file, line: use.line }); });
      });
      const duplicateLabels = Array.from(labels.entries())
        .filter(([, places]) => places.length > 1)
        .map(([key, places]) => ({ key, places }));
      return {
        ok: undefinedRefs.length === 0 && undefinedCites.length === 0 && duplicateLabels.length === 0,
        undefined_references: undefinedRefs,
        undefined_citations: undefinedCites,
        duplicate_labels: duplicateLabels,
        counts: { labels: labels.size, bibliography_entries: bibKeys.size, tex_files: files.length },
      };
    },
  },
  {
    name: 'source_to_pdf',
    title: 'Source line to PDF',
    description: 'SyncTeX forward search: which PDF page and position a source line ends up on. Compile the document first.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'The .tex file containing the line.' },
        line: { type: 'integer', minimum: 1 },
        project_root: projectRootSchema,
      },
      required: ['file', 'line'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async args => {
      const root = projectRootOf(args);
      const file = resolveInput(args.file, args, 'file');
      await requireFile(file);
      const rootFile = await resolveRootDocument(file, root);
      const pdf = await findCompiledPdf(rootFile);
      if (!pdf) throw new ToolError('No compiled PDF found. Run compile_document first.');
      const result = await synctexForward({ texFile: file, line: Number(args.line) || 1, pdfFile: pdf, texRoot: rootFile });
      if (!result.success || !result.rects?.length) throw new ToolError(result.error || 'No PDF location found for that line.');
      return {
        pdf,
        locations: result.rects.map(rect => ({ page: rect.page, x: rect.h, y: rect.v, width: rect.W, height: rect.H })),
        units: 'PDF points from the top-left corner of the page',
      };
    },
  },
  {
    name: 'pdf_to_source',
    title: 'PDF page to source',
    description: 'SyncTeX inverse search: the source file and line for a position on a PDF page, e.g. to find text a reviewer refers to by page. Positions are PDF points from the top-left (A4 is 595 x 842).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Any .tex file of the document (used to find the compiled PDF).' },
        page: { type: 'integer', minimum: 1 },
        y: { type: 'number', description: 'Vertical position in points from the top. Default 300.' },
        x: { type: 'number', description: 'Horizontal position in points from the left. Default 300 (middle of the text block).' },
        project_root: projectRootSchema,
      },
      required: ['file', 'page'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async args => {
      const root = projectRootOf(args);
      const file = resolveInput(args.file, args, 'file');
      await requireFile(file);
      const rootFile = await resolveRootDocument(file, root);
      const pdf = await findCompiledPdf(rootFile);
      if (!pdf) throw new ToolError('No compiled PDF found. Run compile_document first.');
      const result = await synctexInverse({
        pdfFile: pdf,
        page: Number(args.page) || 1,
        h: Number.isFinite(Number(args.x)) ? Number(args.x) : 300,
        v: Number.isFinite(Number(args.y)) ? Number(args.y) : 300,
        texRoot: rootFile,
      });
      if (!result.success || !result.file) throw new ToolError(result.error || 'No source location found.');
      return { file: relativeTo(root, result.file), line: result.line, column: result.column };
    },
  },
  {
    name: 'open_in_openotex',
    title: 'Open in Openotex',
    description: 'Show a file (optionally at a line) in the Openotex desktop editor, starting it if needed, so the user can review changes with the live PDF preview.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to open.' },
        line: { type: 'integer', minimum: 1 },
        project_root: { type: 'string', description: 'Project folder to open in Openotex. Default: the current project if it contains the file, otherwise the server working directory or the file\'s folder.' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async args => {
      const root = projectRootOf(args);
      const file = resolveInput(args.file, args, 'file');
      await requireFile(file);
      const launch = appLaunchCommand();
      if (!launch) {
        throw new ToolError('Openotex was not found. Set the OPENOTEX_APP environment variable of this MCP server to the Openotex executable.');
      }
      const project = typeof args.project_root === 'string' || isInsideDirectory(file, root) ? root : path.dirname(file);
      // `--flag=value` form: Chromium reorders `--flag value` pairs when it
      // forwards the command line to an already running Openotex.
      const launchArgs = [...launch.args, `--open=${file}`, `--project=${project}`];
      if (Number(args.line) > 0) launchArgs.push(`--line=${Math.floor(Number(args.line))}`);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(launch.command, launchArgs, { detached: true, stdio: 'ignore', env });
      child.on('error', error => log('Failed to start Openotex:', error.message));
      child.unref();
      return { opened: relativeTo(root, file), line: Number(args.line) || undefined, project };
    },
  },
];

// --- JSON-RPC / MCP plumbing ----------------------------------------------------

const send = (message: Json) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const sendResult = (id: unknown, result: Json) => send({ jsonrpc: '2.0', id, result });
const sendError = (id: unknown, code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });

const callTool = async (id: unknown, params: Json) => {
  const tool = tools.find(item => item.name === params?.name);
  if (!tool) {
    sendError(id, -32602, `Unknown tool: ${params?.name}`);
    return;
  }
  const progressToken = params?._meta?.progressToken;
  let progressCount = 0;
  const progress = (message: string) => {
    if (progressToken === undefined || progressToken === null) return;
    progressCount += 1;
    send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: progressCount, message } });
  };
  try {
    const output = await tool.run(params?.arguments ?? {}, { progress });
    sendResult(id, {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof ToolError)) log(`Tool ${tool.name} failed:`, error instanceof Error && error.stack ? error.stack : message);
    sendResult(id, { content: [{ type: 'text', text: message }], isError: true });
  }
};

const handleMessage = async (message: Json) => {
  const { id, method, params } = message ?? {};
  const isRequest = id !== undefined && id !== null;
  if (typeof method !== 'string') {
    // A response to something we never sent, or garbage.
    return;
  }
  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      sendResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'openotex', title: 'Openotex', version: APP_VERSION },
        instructions: INSTRUCTIONS,
      });
      return;
    }
    case 'ping':
      if (isRequest) sendResult(id, {});
      return;
    case 'tools/list':
      sendResult(id, {
        tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
      });
      return;
    case 'tools/call':
      await callTool(id, params);
      return;
    case 'resources/list':
      sendResult(id, { resources: [] });
      return;
    case 'prompts/list':
      sendResult(id, { prompts: [] });
      return;
    default:
      if (method.startsWith('notifications/')) return;
      if (isRequest) sendError(id, -32601, `Method not found: ${method}`);
  }
};

const start = () => {
  // stdout is the protocol channel; send all console output to stderr.
  const toStderr = (...args: unknown[]) => {
    process.stderr.write(`${format(...args)}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.warn = toStderr;
  console.debug = toStderr;
  augmentPathWithTexDistributions();
  log(`Openotex ${APP_VERSION} MCP server ready (cwd: ${process.cwd()})`);
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        sendError(null, -32700, 'Parse error');
        continue;
      }
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      messages.forEach(message => {
        void handleMessage(message as Json).catch(error => {
          log('Unhandled error:', error instanceof Error ? error.stack : String(error));
          const requestId = (message as Json)?.id;
          if (requestId !== undefined && requestId !== null) sendError(requestId, -32603, 'Internal error');
        });
      });
    }
  });
  process.stdin.on('end', () => process.exit(0));
};

start();
