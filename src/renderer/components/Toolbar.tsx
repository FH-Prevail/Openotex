import React, { useState } from 'react';
import {
  FiPlay,
  FiFolder,
  FiHelpCircle,
  FiSearch,
  FiRepeat,
  FiEdit3,
  FiFilePlus,
  FiClock,
  FiMap,
} from 'react-icons/fi';
import HelpDialog from './HelpDialog';
import '../styles/Toolbar.css';

interface ToolbarProps {
  currentFile: any;
  onCompile: () => void;
  onNewProject: () => void | Promise<void>;
  onOpenProject: () => void | Promise<void>;
  onVersionFreeze: () => void | Promise<void>;
  onFind: () => void;
  onReplace: () => void;
  canCompile: boolean;
  onToggleAnnotations: () => void;
  areAnnotationsVisible: boolean;
  hasAnnotations: boolean;
  hasOpenFile: boolean;
  onToggleStructureMap: () => void;
  isStructureMapVisible: boolean;
  canShowStructureMap: boolean;
  latexEngine: 'pdflatex' | 'xelatex' | 'lualatex';
  onLatexEngineChange: (engine: 'pdflatex' | 'xelatex' | 'lualatex') => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  currentFile,
  onCompile,
  onNewProject,
  onOpenProject,
  onVersionFreeze,
  onFind,
  onReplace,
  canCompile,
  onToggleAnnotations,
  areAnnotationsVisible,
  hasAnnotations,
  hasOpenFile,
  onToggleStructureMap,
  isStructureMapVisible,
  canShowStructureMap,
  latexEngine,
  onLatexEngineChange,
}) => {
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="app-title">Openotex</div>
        <button className="toolbar-btn" onClick={onNewProject} title="New Project">
          <FiFilePlus size={18} />
          <span>New Project</span>
        </button>
        <button className="toolbar-btn" onClick={onOpenProject} title="Open Project">
          <FiFolder size={18} />
          <span>Open Project</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={() => onVersionFreeze()}
          title={hasOpenFile ? "Instant Backup - Save a snapshot of the current file (Ctrl+Shift+V)" : "Instant Backup - Open a file first"}
          disabled={!hasOpenFile}
        >
          <FiClock size={18} />
          <span>Instant Backup</span>
        </button>
      </div>

      <div className="toolbar-center">
        {currentFile && (
          <span className="current-file">{currentFile.name}</span>
        )}
      </div>

      <div className="toolbar-right">
        <button
          className="toolbar-btn"
          onClick={onFind}
          title="Find (Ctrl+F)"
        >
          <FiSearch size={18} />
          <span>Find</span>
        </button>
        <button
          className="toolbar-btn"
          onClick={onReplace}
          title="Find & Replace (Ctrl+H)"
        >
          <FiRepeat size={18} />
          <span>Replace</span>
        </button>
        <button
          className={`toolbar-btn ${areAnnotationsVisible ? 'active' : ''}`}
          onClick={onToggleAnnotations}
          title={hasAnnotations ? (areAnnotationsVisible ? 'Hide Highlights' : 'Show Highlights') : 'No highlights yet'}
          disabled={!hasAnnotations}
          aria-pressed={areAnnotationsVisible}
        >
          <FiEdit3 size={18} />
          <span>Highlights</span>
        </button>
        <button
          className={`toolbar-btn ${isStructureMapVisible ? 'active' : ''}`}
          onClick={onToggleStructureMap}
          title={canShowStructureMap ? (isStructureMapVisible ? 'Hide Structure Map' : 'Show Structure Map - Visualize document structure') : 'Structure Map only available for .tex files'}
          disabled={!canShowStructureMap}
          aria-pressed={isStructureMapVisible}
        >
          <FiMap size={18} />
          <span>Structure Map</span>
        </button>
        <div className="engine-selector">
          <label htmlFor="latex-engine" className="engine-label">Engine:</label>
          <select
            id="latex-engine"
            className="engine-select"
            value={latexEngine}
            onChange={(e) => onLatexEngineChange(e.target.value as 'pdflatex' | 'xelatex' | 'lualatex')}
            title="Select LaTeX compilation engine"
          >
            <option value="pdflatex">pdfLaTeX</option>
            <option value="xelatex">XeLaTeX</option>
            <option value="lualatex">LuaLaTeX</option>
          </select>
        </div>
        <button
          className="toolbar-btn compile-btn"
          onClick={onCompile}
          title={canCompile ? 'Compile LaTeX to PDF (Ctrl+Shift+C)' : 'Compile available only for LaTeX files'}
          disabled={!canCompile}
        >
          <FiPlay size={18} />
          <span>Compile</span>
        </button>
        <button className="toolbar-btn" onClick={() => setIsHelpOpen(true)} title="Help & Shortcuts">
          <FiHelpCircle size={18} />
        </button>
      </div>
      <HelpDialog isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
};

export default Toolbar;
