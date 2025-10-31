import React, { useState, useEffect, useRef } from 'react';
import { FiX, FiFolder } from 'react-icons/fi';
import '../styles/NewProjectDialog.css';

interface NewProjectDialogProps {
  isOpen: boolean;
  defaultDirectory: string;
  onConfirm: (projectName: string, directory: string) => void;
  onCancel: () => void;
}

const NewProjectDialog: React.FC<NewProjectDialogProps> = ({
  isOpen,
  defaultDirectory,
  onConfirm,
  onCancel,
}) => {
  const [projectName, setProjectName] = useState('');
  const [directory, setDirectory] = useState(defaultDirectory);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setProjectName('');
      setDirectory(defaultDirectory);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultDirectory]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      return;
    }
    // Validate project name (no invalid characters)
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(trimmedName)) {
      alert('Project name contains invalid characters. Please use only letters, numbers, spaces, hyphens, and underscores.');
      return;
    }
    onConfirm(trimmedName, directory);
    setProjectName('');
  };

  const handleChooseDirectory = async () => {
    const { ipcRenderer } = window.require('electron');
    const result = await ipcRenderer.invoke('open-directory-dialog');
    if (result.success && !result.canceled && result.filePaths.length > 0) {
      const selectedDir = result.filePaths[0];
      setDirectory(selectedDir);

      // Save the user's preferred directory to localStorage
      try {
        localStorage.setItem('openotex:preferredProjectsDirectory', selectedDir);
      } catch (error) {
        console.error('Failed to save preferred projects directory:', error);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="new-project-dialog-overlay" onClick={onCancel}>
      <div className="new-project-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="new-project-dialog-header">
          <h3>New LaTeX Project</h3>
          <button className="new-project-dialog-close" onClick={onCancel}>
            <FiX size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="new-project-dialog-body">
            <div className="form-group">
              <label>Project Name</label>
              <input
                ref={inputRef}
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Research Paper"
                onKeyDown={handleKeyDown}
              />
            </div>

            <div className="form-group">
              <label>Project Location</label>
              <div className="directory-selector">
                <input
                  type="text"
                  value={directory}
                  readOnly
                  className="directory-input"
                  title={directory}
                />
                <button
                  type="button"
                  className="choose-directory-btn"
                  onClick={handleChooseDirectory}
                  title="Choose Directory"
                >
                  <FiFolder size={18} />
                </button>
              </div>
              <div className="directory-hint">
                Project will be created at: <strong>{directory}/{projectName || 'ProjectName'}</strong>
              </div>
            </div>
          </div>
          <div className="new-project-dialog-footer">
            <button type="button" className="btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-confirm"
              disabled={!projectName.trim()}
            >
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewProjectDialog;
