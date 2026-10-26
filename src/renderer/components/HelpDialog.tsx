import React from 'react';
import { FiX, FiZoomIn, FiAlertTriangle, FiRefreshCw, FiDownload, FiArchive, FiPlay, FiMaximize2, FiExternalLink } from 'react-icons/fi';
import '../styles/HelpDialog.css';

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const HelpDialog: React.FC<HelpDialogProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2>Openotex - Quick Guide</h2>
          <button className="help-close-btn" onClick={onClose}>
            <FiX size={20} />
          </button>
        </div>

        <div className="help-content">
          <section className="help-section">
            <h3>🎯 What Each Button Does</h3>
            <div className="button-grid">
              <div className="button-item">
                <FiPlay size={18} color="#4ec9b0" />
                <div>
                  <strong>Compile</strong>
                  <p>Saves your changes and builds the PDF with the selected engine (pdfLaTeX, XeLaTeX or LuaLaTeX)</p>
                </div>
              </div>
              <div className="button-item">
                <FiRefreshCw size={18} color="#d4d4d4" />
                <div>
                  <strong>Recompile</strong>
                  <p>Forces a full rebuild of the document</p>
                </div>
              </div>
              <div className="button-item">
                <FiZoomIn size={18} color="#d4d4d4" />
                <div>
                  <strong>Zoom In / Out</strong>
                  <p>Scales the PDF between 25% and 400% (also Ctrl+mouse wheel)</p>
                </div>
              </div>
              <div className="button-item">
                <FiMaximize2 size={18} color="#d4d4d4" />
                <div>
                  <strong>Fit Width</strong>
                  <p>Fits the page to the width of the preview panel</p>
                </div>
              </div>
              <div className="button-item">
                <FiExternalLink size={18} color="#d4d4d4" />
                <div>
                  <strong>Open Externally</strong>
                  <p>Opens the PDF in your system viewer (for printing)</p>
                </div>
              </div>
              <div className="button-item">
                <FiDownload size={18} color="#4ec9b0" />
                <div>
                  <strong>Export PDF</strong>
                  <p>Saves a copy of the compiled PDF wherever you choose</p>
                </div>
              </div>
              <div className="button-item">
                <FiArchive size={18} color="#d4d4d4" />
                <div>
                  <strong>Save as ZIP</strong>
                  <p>Exports the project folder as a ZIP archive (without .git and build files)</p>
                </div>
              </div>
              <div className="button-item">
                <FiAlertTriangle size={18} color="#f6c56f" />
                <div>
                  <strong>Warnings</strong>
                  <p>Undefined references and citations appear below the PDF; click one to jump to it</p>
                </div>
              </div>
            </div>
          </section>

          <section className="help-section">
            <h3>⌨️ Keyboard Shortcuts</h3>
            <div className="shortcut-grid">
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
                <span>Save file</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>
                <span>Save all files</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>
                <span>Compile</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Space</kbd>
                <span>Trigger autocomplete (also after <code>\ref{'{'}</code> and <code>\cite{'{'}</code>)</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>/</kbd>
                <span>Toggle comment</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>J</kbd>
                <span>Highlight the matching PDF location</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Click</kbd>
                <span>On the PDF: jump to the source line</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>N</kbd> / <kbd>O</kbd>
                <span>New project / open project</span>
              </div>
              <div className="shortcut-item">
                <kbd>Middle-click</kbd>
                <span>Close a tab</span>
              </div>
            </div>
          </section>

          <section className="help-section">
            <h3>📚 Multi-file Projects</h3>
            <p className="help-info">
              Split long documents with <code>\input</code> or <code>\include</code>. When you compile a
              chapter file, Openotex finds and builds the main document that includes it.
            </p>
            <p className="help-info">
              To choose the main file yourself, put <code>% !TEX root = main.tex</code> in the first lines
              of a chapter file.
            </p>
          </section>

          <section className="help-section">
            <h3>⚡ Saving and Auto-Compilation</h3>
            <p className="help-info">
              With <strong>Auto Save</strong> on, changes are saved as you type and the document compiles
              about <strong>2.5 seconds</strong> after you stop typing.
            </p>
            <p className="help-info">
              With Auto Save off, unsaved tabs show a dot, the document compiles when you save, and
              Openotex asks before closing anything with unsaved changes.
            </p>
          </section>

          <section className="help-section">
            <h3>🖱️ Panel Resizing</h3>
            <p className="help-info">
              Drag the handles between the panels to make any panel wider or narrower
            </p>
          </section>

          <section className="help-section">
            <h3>📁 File Operations</h3>
            <p className="help-info">
              <strong>Right-click</strong> in the file explorer to:
            </p>
            <ul className="help-list">
              <li>Create new files and folders</li>
              <li>Rename or delete items (open tabs follow automatically)</li>
              <li>Create an Instant Backup of a file</li>
              <li>Open PDFs and images with the default app</li>
            </ul>
            <p className="help-info">
              Drag files from your desktop onto a folder to copy them into the project.
            </p>
          </section>

          <section className="help-section">
            <h3>⚠️ LaTeX Not Installed?</h3>
            <p className="help-info">
              Openotex requires a LaTeX distribution:
            </p>
            <ul className="help-list">
              <li><strong>Windows:</strong> MiKTeX or TeX Live</li>
              <li><strong>Mac:</strong> MacTeX</li>
              <li><strong>Linux:</strong> TeX Live (for example <code>sudo apt install texlive-full latexmk</code>)</li>
            </ul>
            <p className="help-info">
              Installing <code>latexmk</code> is recommended; it handles bibliographies and reruns automatically.
            </p>
          </section>
        </div>

        <div className="help-footer">
          <p>Open this guide any time with the <strong>?</strong> button in the toolbar</p>
        </div>
      </div>
    </div>
  );
};

export default HelpDialog;
