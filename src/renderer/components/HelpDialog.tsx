import React from 'react';
import { FiX, FiZoomIn, FiZoomOut, FiRefreshCw, FiDownload, FiArchive, FiPlay } from 'react-icons/fi';
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
                  <p>Runs pdfLaTeX to generate PDF from your LaTeX code</p>
                </div>
              </div>
              <div className="button-item">
                <FiRefreshCw size={18} color="#d4d4d4" />
                <div>
                  <strong>Refresh</strong>
                  <p>Re-compiles the document manually</p>
                </div>
              </div>
              <div className="button-item">
                <FiZoomIn size={18} color="#d4d4d4" />
                <div>
                  <strong>Zoom In</strong>
                  <p>Makes the PDF preview larger (up to 200%)</p>
                </div>
              </div>
              <div className="button-item">
                <FiZoomOut size={18} color="#d4d4d4" />
                <div>
                  <strong>Zoom Out</strong>
                  <p>Makes the PDF preview smaller (down to 50%)</p>
                </div>
              </div>
              <div className="button-item">
                <FiDownload size={18} color="#4ec9b0" />
                <div>
                  <strong>Export PDF</strong>
                  <p>Downloads the compiled PDF file</p>
                </div>
              </div>
              <div className="button-item">
                <FiArchive size={18} color="#d4d4d4" />
                <div>
                  <strong>Save as ZIP</strong>
                  <p>Exports entire project folder as ZIP archive</p>
                </div>
              </div>
            </div>
          </section>

          <section className="help-section">
            <h3>⌨️ Keyboard Shortcuts</h3>
            <div className="shortcut-grid">
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
                <span>Save file (auto-save is always on)</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>Space</kbd>
                <span>Trigger LaTeX autocomplete</span>
              </div>
              <div className="shortcut-item">
                <kbd>Ctrl</kbd> + <kbd>/</kbd>
                <span>Toggle comment</span>
              </div>
              <div className="shortcut-item">
                <kbd>F12</kbd>
                <span>Open Developer Tools (debugging)</span>
              </div>
            </div>
          </section>

          <section className="help-section">
            <h3>🖱️ Panel Resizing</h3>
            <p className="help-info">
              Hover between panels to see the resize handle (turns <span className="highlight">green</span>)
            </p>
            <p className="help-info">
              Click and drag to make any panel wider or narrower
            </p>
          </section>

          <section className="help-section">
            <h3>⚡ Auto-Compilation</h3>
            <p className="help-info">
              Your document automatically compiles <strong>1 second</strong> after you stop typing
            </p>
            <p className="help-info">
              You can also click the <span className="highlight">Compile</span> button to compile immediately
            </p>
          </section>

          <section className="help-section">
            <h3>📁 File Operations</h3>
            <p className="help-info">
              <strong>Right-click</strong> in the file explorer to:
            </p>
            <ul className="help-list">
              <li>Create new files</li>
              <li>Create new folders</li>
              <li>Rename items</li>
              <li>Delete items</li>
            </ul>
          </section>

          <section className="help-section">
            <h3>⚠️ LaTeX Not Installed?</h3>
            <p className="help-info">
              Openotex requires a LaTeX distribution:
            </p>
            <ul className="help-list">
              <li><strong>Windows:</strong> MiKTeX or TeX Live</li>
              <li><strong>Mac:</strong> MacTeX</li>
              <li><strong>Linux:</strong> TeX Live</li>
            </ul>
            <p className="help-info">
              If not installed, you'll see installation instructions in the preview panel
            </p>
          </section>
        </div>

        <div className="help-footer">
          <p>Press <kbd>?</kbd> or click Settings → Help to open this dialog</p>
        </div>
      </div>
    </div>
  );
};

export default HelpDialog;
