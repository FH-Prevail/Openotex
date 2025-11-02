import React, { useEffect, useRef, useState } from 'react';
import { FiTrash2, FiTerminal, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import '../styles/TerminalPanel.css';

interface TerminalPanelProps {
  isVisible: boolean;
  onToggle: () => void;
  projectPath: string;
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({ isVisible, onToggle, projectPath }) => {
  const [output, setOutput] = useState<string>('');
  const [inputValue, setInputValue] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [initialized, setInitialized] = useState<boolean>(false);
  const [shellName, setShellName] = useState<string>('Git Terminal');
  const outputRef = useRef<HTMLDivElement>(null);
  const prevProjectPathRef = useRef<string>('');
  const visibilityRef = useRef<boolean>(isVisible);

  const api = (window as any).api;

  useEffect(() => {
    const handleExit = (_event: any, code: number | null) => {
      setOutput(prev => prev + `\nProcess exited${code !== null ? ` with code ${code}` : ''}\n`);
      setInitialized(false);
      if (visibilityRef.current) {
        setTimeout(() => {
          startTerminal();
        }, 150);
      }
    };

    const disposeData = api.gitTerminal.onData((data: string) => {
      setOutput(prev => prev + data);
    });
    const disposeExit = api.gitTerminal.onExit((code: number | null) => handleExit(null as any, code));

    return () => {
      disposeData?.();
      disposeExit?.();
      api.gitTerminal.stop();
    };
  }, [api]);

  useEffect(() => {
    visibilityRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    if (isVisible && !initialized) {
      startTerminal();
    }
  }, [isVisible]);

  useEffect(() => {
    if (initialized && projectPath && projectPath !== prevProjectPathRef.current) {
      // cwd is set when starting the Git Terminal; no need to send cd
      prevProjectPathRef.current = projectPath;
    }
  }, [projectPath, initialized]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const startTerminal = async () => {
    const result = await api.gitTerminal.start({
      cwd: projectPath || undefined,
    });

    if (result.success) {
      setInitialized(true);
      setShellName(result.shell || 'Git Terminal');
      setOutput(prev => (prev ? `${prev}\n` : '') + `Connected to ${result.shell || 'Git Terminal'}\n`);
      if (projectPath) {
        prevProjectPathRef.current = projectPath;
      }
    } else {
      setOutput(prev => `${prev}\nFailed to start terminal: ${result.error}\n`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const command = inputValue;
    setHistory(prev => [...prev, command]);
    setHistoryIndex(-1);
    setOutput(prev => (prev ? `${prev}\n` : '') + `> ${command}\n`);
    if (!/^git(\s|$)/i.test(command)) {
      setOutput(prev => prev + 'Only git commands are allowed.\n');
      return;
    }
    await api.gitTerminal.run(command);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(historyIndex - 1, 0);
      setHistoryIndex(nextIndex);
      setInputValue(history[nextIndex] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setInputValue('');
      } else {
        setHistoryIndex(nextIndex);
        setInputValue(history[nextIndex]);
      }
    }
  };

  const handleClear = () => {
    setOutput('');
  };

  return (
    <div className="terminal-dock">
      <div className={`terminal-container ${isVisible ? 'open' : 'closed'}`}>
        <div className="terminal-header">
          <div className="terminal-title">
            <FiTerminal size={16} />
            <span>{shellName}</span>
            {projectPath && (
              <span className="terminal-path">{projectPath}</span>
            )}
          </div>
          <div className="terminal-actions">
            <button className="terminal-action-btn" onClick={handleClear} title="Clear terminal">
              <FiTrash2 size={14} />
            </button>
            <button className="terminal-action-btn" onClick={onToggle} title="Hide terminal">
              <FiChevronDown size={16} />
            </button>
          </div>
        </div>
        <div className="terminal-output" ref={outputRef}>
          <pre>{output}</pre>
        </div>
        <form className="terminal-input-area" onSubmit={handleSubmit}>
          <span className="prompt-symbol">git$</span>
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a git command (e.g., git status)"
            spellCheck={false}
          />
          <button type="submit" className="terminal-send-btn">
            Run
          </button>
        </form>
      </div>
      <div className="terminal-status-bar">
        <button
          className={`terminal-toggle ${isVisible ? 'active' : ''}`}
          onClick={onToggle}
          title="Toggle Git Terminal (Ctrl+`)"
        >
          <FiTerminal size={16} />
          <span>Git Terminal</span>
          {isVisible ? <FiChevronDown size={14} /> : <FiChevronUp size={14} />}
        </button>
      </div>
    </div>
  );
};

export default TerminalPanel;
