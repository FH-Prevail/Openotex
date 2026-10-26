import React from 'react';
import '../styles/StatusBar.css';

interface StatusBarProps {
  autoCompile: boolean;
  autoSave: boolean;
  unsavedCount?: number;
  onToggleAutoCompile: () => void;
  onToggleAutoSave: () => void;
  statusMessage?: string;
}

const StatusBar: React.FC<StatusBarProps> = ({
  autoCompile,
  autoSave,
  unsavedCount = 0,
  onToggleAutoCompile,
  onToggleAutoSave,
  statusMessage,
}) => {
  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <button
          className={`status-item ${autoSave ? 'active' : 'inactive'}`}
          onClick={onToggleAutoSave}
          title={`Auto Save is ${autoSave ? 'ON' : 'OFF'} - Click to toggle`}
        >
          <span className="status-label">Auto Save:</span>
          <span className={`status-value ${autoSave ? 'on' : 'off'}`}>
            {autoSave ? 'ON' : 'OFF'}
          </span>
        </button>
        <button
          className={`status-item ${autoCompile ? 'active' : 'inactive'}`}
          onClick={onToggleAutoCompile}
          title={autoSave
            ? `Auto Compile is ${autoCompile ? 'ON' : 'OFF'} - Click to toggle`
            : `Auto Compile is ${autoCompile ? 'ON (compiles when you save)' : 'OFF'} - Click to toggle`}
        >
          <span className="status-label">Auto Compile:</span>
          <span className={`status-value ${autoCompile ? 'on' : 'off'}`}>
            {autoCompile ? 'ON' : 'OFF'}
          </span>
        </button>
        {unsavedCount > 0 && !autoSave && (
          <span className="status-unsaved" title="Press Ctrl+Shift+S to save all files">
            {unsavedCount} unsaved
          </span>
        )}
      </div>
      <div className="status-bar-center">
        {statusMessage && (
          <span className="status-message">{statusMessage}</span>
        )}
      </div>
      <div className="status-bar-right">
        <span className="status-info">Ctrl+S: Save | Ctrl+Shift+C: Compile | Ctrl+Alt+J: Find in PDF</span>
      </div>
    </div>
  );
};

export default StatusBar;
