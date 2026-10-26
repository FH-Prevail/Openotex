import React, { useState, useEffect, useRef } from 'react';
import { FiX, FiFolder } from 'react-icons/fi';
import type { ProjectTemplate } from '../utils/projectTemplates';
import '../styles/NewProjectDialog.css';

interface NewProjectDialogProps {
  isOpen: boolean;
  defaultDirectory: string;
  templates: ProjectTemplate[];
  onConfirm: (projectName: string, directory: string, templateId: string) => void;
  onCancel: () => void;
}

const TEMPLATE_STORAGE_KEY = 'openotex:lastTemplate';

const NewProjectDialog: React.FC<NewProjectDialogProps> = ({
  isOpen,
  defaultDirectory,
  templates,
  onConfirm,
  onCancel,
}) => {
  const [projectName, setProjectName] = useState('');
  const [directory, setDirectory] = useState(defaultDirectory);
  const [templateId, setTemplateId] = useState<string>(() => {
    try {
      return localStorage.getItem(TEMPLATE_STORAGE_KEY) || templates[0]?.id || '';
    } catch {
      return templates[0]?.id || '';
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setProjectName('');
      setDirectory(defaultDirectory);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultDirectory]);

  if (!isOpen) return null;

  const selectedTemplate = templates.find(template => template.id === templateId) ?? templates[0];

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
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, selectedTemplate.id);
    } catch {}
    onConfirm(trimmedName, directory, selectedTemplate.id);
  };

  const handleChooseDirectory = async () => {
    const result = await (window as any).api.openDirectoryDialog();
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

  const projectLocation = directory
    ? (window as any).api.path.join(directory, projectName.trim() || 'ProjectName')
    : projectName.trim() || 'ProjectName';

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
              <label htmlFor="new-project-name">Project Name</label>
              <input
                id="new-project-name"
                ref={inputRef}
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Research Paper"
                onKeyDown={handleKeyDown}
              />
            </div>

            <div className="form-group">
              <label id="new-project-template">Template</label>
              <div className="template-grid" role="radiogroup" aria-labelledby="new-project-template">
                {templates.map(template => {
                  const selected = template.id === selectedTemplate.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`template-card ${selected ? 'selected' : ''}`}
                      onClick={() => setTemplateId(template.id)}
                    >
                      <span className="template-name">{template.name}</span>
                      <span className="template-description">{template.description}</span>
                    </button>
                  );
                })}
              </div>
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
                Project will be created at: <strong>{projectLocation}</strong>
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
