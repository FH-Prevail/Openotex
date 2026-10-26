import React from 'react';
import { FiX } from 'react-icons/fi';
import '../styles/TabBar.css';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  content?: string;
}

interface TabBarProps {
  openTabs: FileNode[];
  activeTab: FileNode | null;
  dirtyPaths?: Set<string>;
  onTabClick: (file: FileNode) => void;
  onTabClose: (file: FileNode, event: React.MouseEvent) => void;
}

const TabBar: React.FC<TabBarProps> = ({ openTabs, activeTab, dirtyPaths, onTabClick, onTabClose }) => {
  if (openTabs.length === 0) {
    return null;
  }

  return (
    <div className="tab-bar">
      {openTabs.map((tab) => {
        const isDirty = Boolean(dirtyPaths?.has(tab.path));
        return (
          <div
            key={tab.path}
            className={`tab ${activeTab?.path === tab.path ? 'active' : ''} ${isDirty ? 'dirty' : ''}`}
            title={isDirty ? `${tab.path} (unsaved changes)` : tab.path}
            onClick={() => onTabClick(tab)}
            onAuxClick={(e) => {
              // Middle click closes the tab, as in browsers and code editors.
              if (e.button === 1) {
                e.preventDefault();
                onTabClose(tab, e);
              }
            }}
          >
            <span className="tab-name">{tab.name}</span>
            <button
              className="tab-close"
              onClick={(e) => onTabClose(tab, e)}
              title={isDirty ? 'Close (unsaved changes)' : 'Close'}
              aria-label={`Close ${tab.name}`}
            >
              <span className="tab-dirty-dot" aria-hidden="true" />
              <FiX size={14} className="tab-close-icon" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default TabBar;
