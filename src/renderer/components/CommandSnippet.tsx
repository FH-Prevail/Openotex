import React, { useEffect, useRef, useState } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';
import '../styles/CommandSnippet.css';

// A terminal command the user can copy (install hints and the like).
const CommandSnippet: React.FC<{ command: string }> = ({ command }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const handleCopy = () => {
    (window as any).api.copyText(command);
    setCopied(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="command-snippet">
      <pre>{command}</pre>
      <button type="button" className="command-snippet-copy" onClick={handleCopy} title="Copy command">
        {copied ? <FiCheck size={13} /> : <FiCopy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
};

export default CommandSnippet;
