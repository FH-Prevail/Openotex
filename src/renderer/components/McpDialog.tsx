import React, { useEffect, useMemo, useState } from 'react';
import { FiX, FiCopy, FiCheck, FiCpu } from 'react-icons/fi';
import '../styles/McpDialog.css';

interface McpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface McpSetup {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  scriptPath: string;
  platform: string;
}

type ClientId = 'claude-code' | 'json' | 'vscode' | 'codex';

const CLIENTS: Array<{ id: ClientId; label: string; hint: string }> = [
  { id: 'claude-code', label: 'Claude Code', hint: 'Run this once in a terminal. It adds Openotex for all your projects.' },
  { id: 'json', label: 'Claude Desktop / Cursor', hint: 'Add this to claude_desktop_config.json, ~/.cursor/mcp.json, or any client that uses "mcpServers".' },
  { id: 'vscode', label: 'VS Code', hint: 'Save as .vscode/mcp.json in your project, or add it to your user MCP configuration.' },
  { id: 'codex', label: 'Codex CLI', hint: 'Append this to ~/.codex/config.toml.' },
];

const TOOLS = [
  ['compile_document', 'Compile and get errors/warnings with file and line'],
  ['check_references', 'Find undefined \\ref and \\cite keys without compiling'],
  ['get_document_outline', 'Chapters and sections across all included files'],
  ['find_root_document', 'Which main file a chapter belongs to'],
  ['list_labels_and_citations', 'All labels and bibliography keys'],
  ['source_to_pdf / pdf_to_source', 'Map lines to PDF pages and back (SyncTeX)'],
  ['open_in_openotex', 'Show a file at a line in this editor'],
  ['get_latex_environment', 'Installed TeX distribution and tools'],
];

// Quote one shell argument (works in PowerShell, cmd and POSIX shells for
// paths without double quotes).
const shellArg = (value: string) => (/[\s"'&()]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
const tomlString = (value: string) => (value.includes("'") ? JSON.stringify(value) : `'${value}'`);

const buildSnippet = (client: ClientId, setup: McpSetup): string => {
  const server = { command: setup.command, args: setup.args, env: setup.env };
  switch (client) {
    case 'claude-code':
      return [
        'claude mcp add --transport stdio --scope user',
        setup.name,
        ...Object.entries(setup.env).map(([key, value]) => `--env ${shellArg(`${key}=${value}`)}`),
        '--',
        shellArg(setup.command),
        ...setup.args.map(shellArg),
      ].join(' ');
    case 'json':
      return JSON.stringify({ mcpServers: { [setup.name]: server } }, null, 2);
    case 'vscode':
      return JSON.stringify({ servers: { [setup.name]: { type: 'stdio', ...server } } }, null, 2);
    case 'codex':
      return [
        `[mcp_servers.${setup.name}]`,
        `command = ${tomlString(setup.command)}`,
        `args = [${setup.args.map(tomlString).join(', ')}]`,
        `env = { ${Object.entries(setup.env).map(([key, value]) => `${key} = ${tomlString(value)}`).join(', ')} }`,
      ].join('\n');
    default:
      return '';
  }
};

const McpDialog: React.FC<McpDialogProps> = ({ isOpen, onClose }) => {
  const [setup, setSetup] = useState<McpSetup | null>(null);
  const [error, setError] = useState('');
  const [client, setClient] = useState<ClientId>('claude-code');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);
    (window as any).api.getMcpSetup()
      .then((result: any) => {
        if (result?.success) {
          setSetup(result);
          setError('');
        } else {
          setError('The MCP server could not be prepared.');
        }
      })
      .catch((err: any) => setError(err?.message || 'The MCP server could not be prepared.'));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const snippet = useMemo(() => (setup ? buildSnippet(client, setup) : ''), [client, setup]);
  const activeClient = CLIENTS.find(item => item.id === client)!;

  if (!isOpen) return null;

  const handleCopy = () => {
    (window as any).api.copyText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mcp-overlay" onClick={onClose}>
      <div className="mcp-dialog" role="dialog" aria-labelledby="mcp-dialog-title" onClick={event => event.stopPropagation()}>
        <div className="mcp-header">
          <div className="mcp-title">
            <FiCpu size={18} />
            <h2 id="mcp-dialog-title">Connect a Coding Agent (MCP)</h2>
          </div>
          <button className="mcp-close" onClick={onClose} title="Close" aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        <div className="mcp-content">
          <p className="mcp-intro">
            Openotex includes a Model Context Protocol server. Connect it to Claude Code, Claude Desktop,
            Cursor, VS Code or Codex and your agent can compile your LaTeX project, read the errors and
            open files here, while you watch the PDF update.
          </p>

          <div className="mcp-tabs" role="tablist">
            {CLIENTS.map(item => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={client === item.id}
                className={`mcp-tab ${client === item.id ? 'active' : ''}`}
                onClick={() => { setClient(item.id); setCopied(false); }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <p className="mcp-hint">{activeClient.hint}</p>
          {error ? (
            <p className="mcp-error">{error}</p>
          ) : (
            <div className="mcp-snippet">
              <pre>{snippet || 'Preparing…'}</pre>
              <button type="button" className="mcp-copy" onClick={handleCopy} disabled={!snippet}>
                {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}
          <p className="mcp-note">
            The Openotex program itself runs the server (<code>ELECTRON_RUN_AS_NODE=1</code>), so no separate
            Node.js installation is needed. Start the agent from your project folder: relative paths are
            resolved against it.
          </p>

          <h3 className="mcp-subtitle">What your agent can do</h3>
          <ul className="mcp-tools">
            {TOOLS.map(([name, description]) => (
              <li key={name}>
                <code>{name}</code>
                <span>{description}</span>
              </li>
            ))}
          </ul>

          {setup && (
            <p className="mcp-path" title={setup.scriptPath}>
              Server script: <code>{setup.scriptPath}</code>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default McpDialog;
