import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiFile,
  FiFileText,
  FiImage,
  FiFolder,
  FiChevronRight,
  FiChevronDown,
  FiPlus,
  FiTrash2,
  FiEdit2,
  FiFolderPlus,
  FiArchive,
  FiExternalLink,
  FiClock,
  FiMonitor,
} from 'react-icons/fi';
import InputDialog from './InputDialog';
import ConfirmDialog from './ConfirmDialog';
import ImagePreviewDialog from './ImagePreviewDialog';
import { isLikelyBinaryFile, isSameOrInside, samePath } from '../utils/paths';
import '../styles/FileExplorer.css';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  expanded?: boolean;
}

interface FileExplorerProps {
  onFileSelect: (file: FileNode) => void;
  projectPath: string;
  onZipFolder: (folderPath: string) => void;
  onVersionFreeze: (file: FileNode) => void;
  onPathRenamed?: (oldPath: string, newPath: string) => void;
  onPathDeleted?: (deletedPath: string) => void;
  refreshTrigger?: number;
  activeFilePath?: string | null;
}

// Hidden from the tree: VCS metadata, build output and Openotex bookkeeping.
const HIDDEN_DIRECTORIES = new Set(['.git', '.openotex']);
const TEXT_EXTENSIONS = new Set(['tex', 'latex', 'ltx', 'bib', 'sty', 'cls', 'bst', 'md', 'markdown', 'txt', 'json', 'yml', 'yaml', 'csv']);
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

const FileExplorer: React.FC<FileExplorerProps> = ({
  onFileSelect,
  projectPath,
  onZipFolder,
  onVersionFreeze,
  onPathRenamed,
  onPathDeleted,
  refreshTrigger,
  activeFilePath,
}) => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: FileNode | null;
    directoryPath: string;
    parentPath: string;
  } | null>(null);
  const [inputDialog, setInputDialog] = useState<{
    isOpen: boolean;
    title: string;
    label: string;
    placeholder: string;
    defaultValue: string;
    onConfirm: (value: string) => void;
  }>({
    isOpen: false,
    title: '',
    label: '',
    placeholder: '',
    defaultValue: '',
    onConfirm: () => {},
  });
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [imagePreview, setImagePreview] = useState<{
    isOpen: boolean;
    name: string;
    dataUrl: string;
  }>({
    isOpen: false,
    name: '',
    dataUrl: '',
  });
  const [dragDestination, setDragDestination] = useState<string | null>(null);
  const reloadTimeoutRef = useRef<number | null>(null);
  // Expanded folders survive refreshes (file watcher events, renames, ...).
  const expandedPathsRef = useRef<Set<string>>(new Set());
  const reloadRequestRef = useRef(0);

  const closeInputDialog = () => setInputDialog(prev => ({ ...prev, isOpen: false }));
  const closeConfirmDialog = () => setConfirmDialog(prev => ({ ...prev, isOpen: false }));

  const readChildren = useCallback(async (dirPath: string): Promise<FileNode[] | null> => {
    const result = await (window as any).api.readDirectory(dirPath);
    if (!result.success) {
      return null;
    }
    return result.files
      .filter((file: any) => {
        // Filter out metadata files, session files and hidden build folders
        if (file.name.endsWith('.metadata')) return false;
        if (file.name === '.openotex-session.yml') return false;
        if (file.isDirectory && HIDDEN_DIRECTORIES.has(file.name)) return false;
        return true;
      })
      .sort((a: any, b: any) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      })
      .map((file: any) => ({
        name: file.name,
        path: file.path,
        isDirectory: file.isDirectory,
        children: file.isDirectory ? [] : undefined,
        expanded: false
      }));
  }, []);

  const buildTree = useCallback(async (dirPath: string, depth = 0): Promise<FileNode[] | null> => {
    const nodes = await readChildren(dirPath);
    if (!nodes) {
      return null;
    }
    for (const node of nodes) {
      if (node.isDirectory && depth < 16 && expandedPathsRef.current.has(node.path)) {
        const children = await buildTree(node.path, depth + 1);
        if (children) {
          node.children = children;
          node.expanded = true;
        }
        else {
          expandedPathsRef.current.delete(node.path);
        }
      }
    }
    return nodes;
  }, [readChildren]);

  const reloadTree = useCallback(async () => {
    if (!projectPath) {
      setFiles([]);
      return;
    }
    const requestId = ++reloadRequestRef.current;
    const tree = await buildTree(projectPath);
    if (requestId !== reloadRequestRef.current) {
      return;
    }
    setFiles(tree ?? []);
    setHasLoaded(true);
  }, [buildTree, projectPath]);

  useEffect(() => {
    expandedPathsRef.current = new Set();
    setHasLoaded(false);
    void reloadTree();
  }, [projectPath, reloadTree]);

  // Refresh when refreshTrigger changes (e.g., after version freeze)
  useEffect(() => {
    if (projectPath && refreshTrigger && refreshTrigger > 0) {
      void reloadTree();
    }
  }, [refreshTrigger, projectPath, reloadTree]);

  useEffect(() => {
    const api = (window as any).api;
    if (!projectPath || !api?.onFilesystemEvent) {
      return;
    }

    const dispose = api.onFilesystemEvent((payload: { root?: string; path?: string; event?: string }) => {
      if (!payload || payload.root !== projectPath) {
        return;
      }
      // Content changes (every save) do not change the tree.
      if (payload.event === 'change') {
        return;
      }

      if (reloadTimeoutRef.current) {
        return;
      }
      reloadTimeoutRef.current = window.setTimeout(() => {
        reloadTimeoutRef.current = null;
        void reloadTree();
      }, 250);
    });

    return () => {
      if (reloadTimeoutRef.current) {
        window.clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      dispose?.();
    };
  }, [projectPath, reloadTree]);

  const setNodeState = (nodes: FileNode[], targetPath: string, update: Partial<FileNode>): FileNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return { ...node, ...update };
      }
      if (node.children) {
        return { ...node, children: setNodeState(node.children, targetPath, update) };
      }
      return node;
    });
  };

  const toggleDirectory = async (directory: FileNode) => {
    if (directory.expanded) {
      expandedPathsRef.current.delete(directory.path);
      setFiles(prev => setNodeState(prev, directory.path, { expanded: false }));
      return;
    }
    expandedPathsRef.current.add(directory.path);
    const children = await buildTree(directory.path);
    if (children) {
      setFiles(prev => setNodeState(prev, directory.path, { children, expanded: true }));
    }
  };

  const isImageFile = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext) return false;
    return ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'].includes(ext);
  };

  const handleFileClick = (file: FileNode) => {
    setSelectedFile(file);
    if (file.isDirectory) {
      void toggleDirectory(file);
      return;
    }
    // Images and other binary files only get selected; double-click opens them.
    if (!isImageFile(file.name) && !isLikelyBinaryFile(file.name)) {
      onFileSelect(file);
    }
  };

  const extractPathsFromEvent = (event: React.DragEvent): string[] => {
    const paths: string[] = [];
    const fileList = Array.from(event.dataTransfer?.files ?? []);

    fileList.forEach(file => {
      const filePath = (file as any)?.path;
      if (filePath && !paths.includes(filePath)) {
        paths.push(filePath);
      }
    });

    const items = Array.from(event.dataTransfer?.items ?? []);
    items.forEach(item => {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        const filePath = (file as any)?.path;
        if (filePath && !paths.includes(filePath)) {
          paths.push(filePath);
        }
      }
    });

    return paths;
  };

  const copyIntoDirectory = async (sourcePaths: string[], destination: string) => {
    if (!destination || sourcePaths.length === 0) {
      return;
    }

    try {
      const result = await (window as any).api.copyPaths(sourcePaths, destination);
      if (result?.success) {
        if (!samePath(destination, projectPath)) {
          expandedPathsRef.current.add(destination);
        }
        void reloadTree();
      } else if (result?.error) {
        alert(`Failed to copy files: ${result.error}`);
      }
    } catch (error) {
      console.error('Error copying files:', error);
      alert('Failed to copy files into the project.');
    }
  };

  const handleDragOverNode = (event: React.DragEvent<HTMLDivElement>, node: FileNode) => {
    if (!node.isDirectory) {
      return;
    }

    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDragDestination(node.path);
  };

  const handleDragEnterNode = (event: React.DragEvent<HTMLDivElement>, node: FileNode) => {
    event.stopPropagation();
    handleDragOverNode(event, node);
  };

  const handleDragLeaveNode = (event: React.DragEvent<HTMLDivElement>, node: FileNode) => {
    if (dragDestination !== node.path) {
      return;
    }

    const related = event.relatedTarget as Node | null;
    if (!related || !event.currentTarget.contains(related)) {
      setDragDestination(prev => (prev === node.path ? null : prev));
    }
    event.stopPropagation();
  };

  const handleDropOnNode = async (event: React.DragEvent<HTMLDivElement>, node: FileNode) => {
    if (!node.isDirectory) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const paths = extractPathsFromEvent(event);
    setDragDestination(null);

    if (paths.length === 0) {
      return;
    }

    await copyIntoDirectory(paths, node.path);
  };

  const handleRootDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!projectPath) {
      return;
    }

    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDragDestination(projectPath);
  };

  const handleRootDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (dragDestination !== projectPath) {
      return;
    }

    const related = event.relatedTarget as Node | null;
    if (!related || !event.currentTarget.contains(related)) {
      setDragDestination(prev => (prev === projectPath ? null : prev));
    }
    event.stopPropagation();
  };

  const handleRootDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!projectPath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const paths = extractPathsFromEvent(event);
    setDragDestination(null);

    if (paths.length === 0) {
      return;
    }

    await copyIntoDirectory(paths, projectPath);
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileNode) => {
    e.preventDefault();
    e.stopPropagation();

    const pathModule = (window as any).api.path;
    let directoryPath = file.isDirectory ? file.path : pathModule.dirname(file.path);
    let parentPath = file.isDirectory ? pathModule.dirname(file.path) : directoryPath;

    if (!parentPath || parentPath === '.' || parentPath === '') {
      parentPath = projectPath || directoryPath;
    }
    if (!directoryPath || directoryPath === '.' || directoryPath === '') {
      directoryPath = projectPath || '';
    }

    // Keep the menu inside the window.
    const x = Math.min(e.clientX, window.innerWidth - 230);
    const y = Math.min(e.clientY, window.innerHeight - 300);
    setContextMenu({
      x,
      y,
      target: file,
      directoryPath,
      parentPath,
    });
  };

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    if (!projectPath) return;
    e.preventDefault();
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 230),
      y: Math.min(e.clientY, window.innerHeight - 150),
      target: null,
      directoryPath: projectPath,
      parentPath: projectPath,
    });
  };

  const getMimeType = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'bmp':
        return 'image/bmp';
      case 'svg':
        return 'image/svg+xml';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/*';
    }
  };

  const validateName = (name: string): string | null => {
    if (!name || name === '.' || name === '..') {
      return 'Please enter a name.';
    }
    if (INVALID_NAME_CHARS.test(name)) {
      return 'Names cannot contain any of these characters: \\ / : * ? " < > |';
    }
    return null;
  };

  const handleCreateFile = async () => {
    if (!contextMenu) return;
    const parentPath = contextMenu.directoryPath;

    setContextMenu(null);

    setInputDialog({
      isOpen: true,
      title: 'Create New File',
      label: 'File name:',
      placeholder: 'chapter.tex',
      defaultValue: '',
      onConfirm: async (fileName: string) => {
        const invalid = validateName(fileName);
        if (invalid) {
          alert(invalid);
          return;
        }
        const path = (window as any).api.path;
        const newFilePath = path.join(parentPath, fileName);
        const result = await (window as any).api.createFile(newFilePath);

        closeInputDialog();
        if (result.success) {
          if (!samePath(parentPath, projectPath)) {
            expandedPathsRef.current.add(parentPath);
          }
          await reloadTree();
          if (!isLikelyBinaryFile(fileName)) {
            onFileSelect({ name: fileName, path: newFilePath, isDirectory: false });
          }
        } else {
          alert(`Error creating file: ${result.error}`);
        }
      },
    });
  };

  const handleZipFolder = () => {
    if (!contextMenu || !contextMenu.target || !contextMenu.target.isDirectory) {
      return;
    }
    onZipFolder(contextMenu.target.path);
    setContextMenu(null);
  };

  const handleCreateFolder = async () => {
    if (!contextMenu) return;
    const parentPath = contextMenu.directoryPath;

    setContextMenu(null);

    setInputDialog({
      isOpen: true,
      title: 'Create New Folder',
      label: 'Folder name:',
      placeholder: 'figures',
      defaultValue: '',
      onConfirm: async (folderName: string) => {
        const invalid = validateName(folderName);
        if (invalid) {
          alert(invalid);
          return;
        }
        const path = (window as any).api.path;
        const newFolderPath = path.join(parentPath, folderName);
        const result = await (window as any).api.createDirectory(newFolderPath);

        closeInputDialog();
        if (result.success) {
          if (!samePath(parentPath, projectPath)) {
            expandedPathsRef.current.add(parentPath);
          }
          void reloadTree();
        } else {
          alert(`Error creating folder: ${result.error}`);
        }
      },
    });
  };

  const handleDelete = () => {
    if (!contextMenu || !contextMenu.target) return;
    const fileToDelete = contextMenu.target;
    const isDirectory = fileToDelete.isDirectory;
    setContextMenu(null);

    setConfirmDialog({
      isOpen: true,
      title: isDirectory ? 'Delete Folder' : 'Delete File',
      message: `Are you sure you want to delete the ${isDirectory ? 'folder' : 'file'} "${fileToDelete.name}"? This action cannot be undone.`,
      onConfirm: async () => {
        closeConfirmDialog();
        const result = await (window as any).api.deletePath(fileToDelete.path);

        if (result.success) {
          Array.from(expandedPathsRef.current).forEach(expanded => {
            if (isSameOrInside(expanded, fileToDelete.path)) {
              expandedPathsRef.current.delete(expanded);
            }
          });
          onPathDeleted?.(fileToDelete.path);
          void reloadTree();
        } else {
          alert(`Failed to delete ${isDirectory ? 'folder' : 'file'}: ${result.error}`);
        }
      },
    });
  };

  const handleRename = () => {
    if (!contextMenu || !contextMenu.target) return;
    const fileToRename = contextMenu.target;
    setContextMenu(null);

    setInputDialog({
      isOpen: true,
      title: 'Rename',
      label: 'New name:',
      placeholder: fileToRename.name,
      defaultValue: fileToRename.name,
      onConfirm: async (newName: string) => {
        if (newName === fileToRename.name) {
          closeInputDialog();
          return;
        }
        const invalid = validateName(newName);
        if (invalid) {
          alert(invalid);
          return;
        }
        const path = (window as any).api.path;
        const actualParentPath = path.dirname(fileToRename.path);
        const newPath = path.join(actualParentPath, newName);

        const result = await (window as any).api.renamePath(fileToRename.path, newPath);

        closeInputDialog();
        if (result.success) {
          const remapped = new Set<string>();
          expandedPathsRef.current.forEach(expanded => {
            remapped.add(isSameOrInside(expanded, fileToRename.path)
              ? newPath + expanded.slice(fileToRename.path.length)
              : expanded);
          });
          expandedPathsRef.current = remapped;
          onPathRenamed?.(fileToRename.path, newPath);
          void reloadTree();
        } else {
          alert(`Error renaming: ${result.error}`);
        }
      },
    });
  };

  const handleShowInFileBrowser = async () => {
    if (!contextMenu || !contextMenu.target) return;
    const fileToShow = contextMenu.target;
    setContextMenu(null);

    try {
      const result = await (window as any).api.showInFileBrowser(fileToShow.path);

      if (!result.success) {
        alert(`Failed to show in file browser: ${result.error}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const handleOpenWithSystem = async (file?: FileNode | null) => {
    const target = file ?? contextMenu?.target;
    setContextMenu(null);
    if (!target) return;
    const result = await (window as any).api.openPath(target.path);
    if (!result?.success) {
      alert(`Could not open ${target.name}: ${result?.error || 'no application available'}`);
    }
  };

  const handleVersionFreezeFile = () => {
    if (!contextMenu || !contextMenu.target) return;
    const fileToFreeze = contextMenu.target;
    setContextMenu(null);

    if (!fileToFreeze.isDirectory) {
      onVersionFreeze(fileToFreeze);
    }
  };

  const handleFileDoubleClick = async (file: FileNode) => {
    if (file.isDirectory) {
      return;
    }

    if (isImageFile(file.name)) {
      try {
        const result = await (window as any).api.readBinaryFile(file.path);
        if (result.success) {
          const mimeType = getMimeType(file.name);
          setImagePreview({
            isOpen: true,
            name: file.name,
            dataUrl: `data:${mimeType};base64,${result.data}`,
          });
        } else {
          alert(`Error opening image: ${result.error}`);
        }
      } catch (error: any) {
        alert(`Error opening image: ${error.message}`);
      }
      return;
    }

    if (isLikelyBinaryFile(file.name)) {
      await handleOpenWithSystem(file);
      return;
    }

    onFileSelect(file);
  };

  const renderFileIcon = (node: FileNode) => {
    if (node.isDirectory) return <FiFolder size={16} />;
    if (isImageFile(node.name)) return <FiImage size={16} />;
    const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
    if (TEXT_EXTENSIONS.has(ext)) return <FiFileText size={16} />;
    return <FiFile size={16} />;
  };

  const renderFileTree = (nodes: FileNode[], depth: number = 0) => {
    return nodes.map(node => {
      const isActive = Boolean(activeFilePath && !node.isDirectory && samePath(node.path, activeFilePath));
      return (
        <div key={node.path}>
          <div
            className={`file-item ${selectedFile?.path === node.path ? 'selected' : ''} ${isActive ? 'active-file' : ''} ${dragDestination === node.path ? 'drop-target' : ''}`}
            data-path={node.path}
            data-is-directory={node.isDirectory}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            title={node.path}
            onClick={() => handleFileClick(node)}
            onDoubleClick={() => handleFileDoubleClick(node)}
            onContextMenu={e => handleContextMenu(e, node)}
            onDragOver={event => handleDragOverNode(event, node)}
            onDragEnter={event => handleDragEnterNode(event, node)}
            onDragLeave={event => handleDragLeaveNode(event, node)}
            onDrop={event => handleDropOnNode(event, node)}
          >
            {node.isDirectory && (
              <span className="expand-icon">
                {node.expanded ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
              </span>
            )}
            <span className="file-icon">
              {renderFileIcon(node)}
            </span>
            <span className="file-name">{node.name}</span>
          </div>
          {node.isDirectory && node.expanded && node.children && (
            <div className="file-children">
              {renderFileTree(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleZipProject = () => {
    if (!projectPath) return;
    onZipFolder(projectPath);
  };

  const getProjectFolderName = () => {
    if (!projectPath) return null;
    const pathModule = (window as any).api.path;
    return pathModule.basename(projectPath);
  };

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <div className="header-title-container">
          <h3>Files</h3>
          {projectPath && (
            <span className="project-folder-name" title={projectPath}>
              {getProjectFolderName()}
            </span>
          )}
        </div>
        {projectPath && (
          <button
            className="header-action-btn"
            onClick={handleZipProject}
            title="Save Project as ZIP"
          >
            <FiArchive size={16} />
          </button>
        )}
      </div>
      <div
        className={`file-tree ${dragDestination === projectPath ? 'drop-target' : ''}`}
        onContextMenu={handleEmptyContextMenu}
        onDragOver={handleRootDragOver}
        onDragEnter={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {files.length === 0 ? (
          <div className="empty-state">
            {projectPath && hasLoaded ? (
              <>
                <p>This folder is empty</p>
                <p className="hint">Right-click to create a file, or drop files here</p>
              </>
            ) : (
              <>
                <p>No project opened</p>
                <p className="hint">Click "Open Project" to get started</p>
              </>
            )}
          </div>
        ) : (
          renderFileTree(files)
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.target?.isDirectory && (
            <>
              <div className="context-menu-item" onClick={handleZipFolder}>
                <FiArchive size={14} />
                <span>Save Folder as ZIP</span>
              </div>
              <div className="context-menu-separator" />
            </>
          )}
          <div className="context-menu-item" onClick={handleCreateFile}>
            <FiPlus size={14} />
            <span>New File</span>
          </div>
          <div className="context-menu-item" onClick={handleCreateFolder}>
            <FiFolderPlus size={14} />
            <span>New Folder</span>
          </div>
          {contextMenu.target && (
            <>
              <div className="context-menu-separator" />
              {!contextMenu.target.isDirectory && (
                <div className="context-menu-item" onClick={handleVersionFreezeFile}>
                  <FiClock size={14} />
                  <span>Instant Backup</span>
                </div>
              )}
              {!contextMenu.target.isDirectory && (
                <div className="context-menu-item" onClick={() => handleOpenWithSystem()}>
                  <FiMonitor size={14} />
                  <span>Open with Default App</span>
                </div>
              )}
              <div className="context-menu-item" onClick={handleShowInFileBrowser}>
                <FiExternalLink size={14} />
                <span>Show in File Browser</span>
              </div>
              <div className="context-menu-item" onClick={handleRename}>
                <FiEdit2 size={14} />
                <span>Rename</span>
              </div>
              <div className="context-menu-item danger" onClick={handleDelete}>
                <FiTrash2 size={14} />
                <span>Delete</span>
              </div>
            </>
          )}
        </div>
      )}

      <InputDialog
        isOpen={inputDialog.isOpen}
        title={inputDialog.title}
        label={inputDialog.label}
        placeholder={inputDialog.placeholder}
        defaultValue={inputDialog.defaultValue}
        onConfirm={inputDialog.onConfirm}
        onCancel={closeInputDialog}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger={true}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />
      <ImagePreviewDialog
        isOpen={imagePreview.isOpen}
        name={imagePreview.name}
        dataUrl={imagePreview.dataUrl}
        onClose={() => setImagePreview({ isOpen: false, name: '', dataUrl: '' })}
      />
    </div>
  );
};

export default FileExplorer;
