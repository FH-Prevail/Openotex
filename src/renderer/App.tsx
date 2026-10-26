import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import Split from 'react-split';
import FileExplorer from './components/FileExplorer';
import Editor, { EditorHandle } from './components/Editor';
import Preview, { PreviewHandle } from './components/Preview';
import StructureMap from './components/StructureMap';
import Toolbar from './components/Toolbar';
import MenuBar from './components/MenuBar';
import NotificationDialog from './components/NotificationDialog';
import TerminalPanel from './components/TerminalPanel';
import AnnotationPanel from './components/AnnotationPanel';
import TabBar from './components/TabBar';
import PackageInstallDialog, { PackageInstallResult } from './components/PackageInstallDialog';
import AboutDialog from './components/AboutDialog';
import McpDialog from './components/McpDialog';
import AnnotationDialog from './components/AnnotationDialog';
import NewProjectDialog from './components/NewProjectDialog';
import StatusBar from './components/StatusBar';
import GitPanel from './components/GitPanel';
import { Annotation, AnnotationRange } from '../types/annotations';
import { CursorPosition, FileNode, ProjectProvider, useProject } from './ProjectContext';
import { APP_VERSION, APP_VERSION_LABEL } from '../shared/appInfo';
import { escapeLatexText, PROJECT_TEMPLATES, DEFAULT_TEMPLATE_ID } from './utils/projectTemplates';
import { fileNameOf, isSameOrInside, samePath } from './utils/paths';
import './styles/App.css';

type ThemePreference = 'system' | 'dark' | 'light';
type NotificationType = 'success' | 'error' | 'info';

interface SelectionResult {
    text: string;
    range: AnnotationRange;
}

interface HighlightDialogState {
    isOpen: boolean;
    mode: 'create' | 'edit';
    annotationId: string | null;
    snippet: string;
    defaultColor: string;
    defaultComment: string;
}

interface NotificationState {
    isOpen: boolean;
    title: string;
    message: string;
    type: NotificationType;
}

interface Position {
    line: number;
    column: number;
}

const SESSION_FILENAME = '.openotex-session.yml';
// Auto Save writes shortly after typing pauses instead of on every keystroke.
const AUTO_SAVE_DELAY_MS = 700;
const AUTO_COMPILE_DELAY_MS = 2500;
// Folders that never belong in an exported project archive.
const ZIP_EXCLUDED_DIRECTORIES = new Set(['.git', '.openotex', 'node_modules']);

const isLatexFileName = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return ext === 'tex' || ext === 'latex' || ext === 'ltx';
};

const AppContent: React.FC = () => {
    const {
        currentFile,
        setCurrentFile,
        openTabs,
        setOpenTabs,
        tabContents,
        setTabContents,
        editorContent,
        setEditorContent,
        projectPath,
        setProjectPath,
        tabAnnotations,
        setTabAnnotations,
        annotations,
        setAnnotations,
        annotationsHidden,
        setAnnotationsHidden,
        fileExplorerRefreshTrigger,
        setFileExplorerRefreshTrigger,
        cursorPositionsRef,
        pendingCursorRef,
        persistSessionTimeoutRef,
        restoredSessionProjectRef,
    } = useProject();
    const [compileNonce, setCompileNonce] = useState(0);
    const [autoCompile, setAutoCompile] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('openotex:autoCompile');
            return saved !== null ? JSON.parse(saved) : true;
        }
        catch {
            return true;
        }
    });
    const [autoSave, setAutoSave] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('openotex:autoSave');
            return saved !== null ? JSON.parse(saved) : true;
        }
        catch {
            return true;
        }
    });
    const [latexEngine, setLatexEngine] = useState<'pdflatex' | 'xelatex' | 'lualatex'>(() => {
        try {
            const saved = localStorage.getItem('openotex:latexEngine');
            return saved !== null ? JSON.parse(saved) : 'pdflatex';
        }
        catch {
            return 'pdflatex';
        }
    });
    const [isTerminalVisible, setIsTerminalVisible] = useState(false);
    const [notification, setNotification] = useState<NotificationState>({
        isOpen: false,
        title: '',
        message: '',
        type: 'info',
    });
    const autoCompileTimeout = useRef<NodeJS.Timeout | null>(null);
    const editorRef = useRef<EditorHandle | null>(null);
    const previewRef = useRef<PreviewHandle | null>(null);
    const cursorPositionRef = useRef<{ lineNumber: number; column: number }>({ lineNumber: 1, column: 1 });
    const annotationsRef = useRef<Annotation[]>([]);
    const [highlightColor, setHighlightColor] = useState<string>(() => {
        try {
            return localStorage.getItem('openotex:highlightColor') || '#f8e71c';
        }
        catch {
            return '#f8e71c';
        }
    });

    // Unsaved-change tracking. `latestContentRef` always holds the newest
    // text of every open file; `lastWrittenRef` what Openotex last wrote.
    const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(() => new Set());
    const dirtyPathsRef = useRef<Set<string>>(new Set());
    const latestContentRef = useRef<Map<string, string>>(new Map());
    const lastWrittenRef = useRef<Map<string, string>>(new Map());
    const autoSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Mirrors of state for callbacks that outlive a render (IPC listeners,
    // timers, Monaco actions).
    const currentFileRef = useRef<FileNode | null>(currentFile);
    currentFileRef.current = currentFile;
    const openTabsRef = useRef<FileNode[]>(openTabs);
    openTabsRef.current = openTabs;
    const autoSaveRef = useRef(autoSave);
    autoSaveRef.current = autoSave;
    const flushOnNextCompileRef = useRef(false);
    // Project whose saved session has been restored (or found absent).
    const sessionReadyProjectRef = useRef<string | null>(null);
    const [sessionReadyProject, setSessionReadyProject] = useState<string | null>(null);
    const markSessionReady = useCallback((projectRoot: string | null) => {
        sessionReadyProjectRef.current = projectRoot;
        setSessionReadyProject(projectRoot);
    }, []);
    // A file to show once its project is open (from `Openotex --open=<file>`, e.g.
    // the open_in_openotex MCP tool).
    const [pendingOpen, setPendingOpen] = useState<{ file: string; line?: number } | null>(null);
    const [showMcpDialog, setShowMcpDialog] = useState(false);
    const autoCompileRef = useRef(autoCompile);
    autoCompileRef.current = autoCompile;

    const triggerCompile = useCallback(() => {
        setCompileNonce(prev => prev + 1);
    }, []);
    const resetCompileNonce = useCallback(() => {
        setCompileNonce(0);
    }, []);
    const pendingHighlightRef = useRef<SelectionResult | null>(null);
    const [highlightDialog, setHighlightDialog] = useState<HighlightDialogState>({
        isOpen: false,
        mode: 'create',
        annotationId: null,
        snippet: '',
        defaultColor: highlightColor,
        defaultComment: '',
    });
    const [showAnnotationsPanel, setShowAnnotationsPanel] = useState<boolean>(false);
    const [missingPackages, setMissingPackages] = useState<string[]>([]);
    const [showPackageDialog, setShowPackageDialog] = useState<boolean>(false);
    const [showAboutDialog, setShowAboutDialog] = useState<boolean>(false);
    const [showNewProjectDialog, setShowNewProjectDialog] = useState<boolean>(false);
    const [defaultProjectsDirectory, setDefaultProjectsDirectory] = useState<string>('');
    const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = localStorage.getItem('openotex:theme');
                if (stored === 'dark' || stored === 'light' || stored === 'system') {
                    return stored;
                }
            }
            catch (error) {
                console.error('Error loading theme preference:', error);
            }
        }
        return 'system';
    });
    const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() => {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'dark';
    });
    const [statusMessage, setStatusMessage] = useState<string>('');
    const statusMessageTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [showStructureMap, setShowStructureMap] = useState<boolean>(false);
    const [leftPanelTab, setLeftPanelTab] = useState<'files' | 'git'>('files');
    const currentFileExtension = useMemo(() => {
        if (!currentFile || currentFile.isDirectory) {
            return null;
        }
        const parts = currentFile.name.split('.');
        if (parts.length < 2) {
            return null;
        }
        return parts.pop()?.toLowerCase() ?? null;
    }, [currentFile]);
    const isCurrentFileLatex = useMemo(() => {
        return currentFileExtension === 'tex' || currentFileExtension === 'latex' || currentFileExtension === 'ltx';
    }, [currentFileExtension]);
    const openFilePaths = useMemo(() => openTabs.map(tab => tab.path), [openTabs]);
    annotationsRef.current = annotations;
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) {
            return;
        }
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const updateSystemTheme = (event: MediaQueryListEvent | MediaQueryList) => {
            const matches = 'matches' in event ? event.matches : false;
            setSystemTheme(matches ? 'dark' : 'light');
        };
        updateSystemTheme(mediaQuery);
        const listenerSupportsAddEvent = typeof mediaQuery.addEventListener === 'function';
        if (listenerSupportsAddEvent) {
            mediaQuery.addEventListener('change', updateSystemTheme);
            return () => mediaQuery.removeEventListener('change', updateSystemTheme);
        }
        else {
            // Fallback for older Electron versions
            mediaQuery.addListener(updateSystemTheme);
            return () => mediaQuery.removeListener(updateSystemTheme);
        }
    }, []);
    const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference;
    useEffect(() => {
        if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', resolvedTheme);
        }
        try {
            localStorage.setItem('openotex:theme', themePreference);
        }
        catch (error) {
            console.error('Error saving theme preference:', error);
        }
    }, [resolvedTheme, themePreference]);
    const positionIsBeforeOrEqual = (a: Position, b: Position) => {
        if (a.line < b.line)
            return true;
        if (a.line > b.line)
            return false;
        return a.column <= b.column;
    };
    const rangesOverlap = (a: AnnotationRange, b: AnnotationRange) => {
        // Check if ranges are exactly the same or overlap
        if (a.startLineNumber === b.startLineNumber &&
            a.startColumn === b.startColumn &&
            a.endLineNumber === b.endLineNumber &&
            a.endColumn === b.endColumn) {
            return true; // Exact match
        }
        const aStart = { line: a.startLineNumber, column: a.startColumn };
        const aEnd = { line: a.endLineNumber, column: a.endColumn };
        const bStart = { line: b.startLineNumber, column: b.startColumn };
        const bEnd = { line: b.endLineNumber, column: b.endColumn };
        return (positionIsBeforeOrEqual(aStart, bEnd) &&
            positionIsBeforeOrEqual(bStart, aEnd));
    };
    const positionIsInRange = (position: Position, range: AnnotationRange) => {
        const rangeStart = { line: range.startLineNumber, column: range.startColumn };
        const rangeEnd = { line: range.endLineNumber, column: range.endColumn };
        return (positionIsBeforeOrEqual(rangeStart, position) &&
            positionIsBeforeOrEqual(position, rangeEnd));
    };
    const findAnnotationAtCursor = (selection: SelectionResult, annotationsList: Annotation[]) => {
        // Check if it's just a cursor position (no selection)
        const isCursorOnly = selection.range.startLineNumber === selection.range.endLineNumber &&
            selection.range.startColumn === selection.range.endColumn;
        if (isCursorOnly) {
            // Find annotation containing the cursor position
            return (annotationsList.find(annotation => positionIsInRange({ line: selection.range.startLineNumber, column: selection.range.startColumn }, annotation.range)) || null);
        }
        else {
            // Find annotation overlapping with selection
            return annotationsList.find(annotation => rangesOverlap(selection.range, annotation.range)) || null;
        }
    };
    // Save annotations to metadata file
    const saveAnnotationsToFile = useCallback(async (filePath: string, annotationsToSave: Annotation[]) => {
        try {
            // Don't create metadata for metadata files or system files
            if (filePath.endsWith('.metadata') || filePath.endsWith('.openotex-session.yml')) {
                return;
            }

            // Only create metadata for LaTeX-related files
            const pathModule = (window as any).api.path;
            const fileExt = pathModule.extname(filePath).toLowerCase();
            const latexExtensions = ['.tex', '.latex', '.bib', '.cls', '.sty', '.bst', '.dtx', '.ins'];
            if (!latexExtensions.includes(fileExt)) {
                return;
            }

            const api = (window as any).api;
            const metadataPath = `${filePath}.metadata`;
            if (annotationsToSave.length === 0) {
                // Avoid creating empty metadata files next to every opened file.
                const exists = await api.pathExists(metadataPath);
                if (!exists?.exists) {
                    return;
                }
            }
            const metadata = {
                version: '1.0',
                annotations: annotationsToSave.map(ann => ({
                    id: ann.id,
                    color: ann.color,
                    range: ann.range,
                    text: ann.text,
                    comment: ann.comment,
                    createdAt: ann.createdAt,
                })),
            };
            await api.writeFile( metadataPath, JSON.stringify(metadata, null, 2));
        }
        catch (error) {
            console.error('Error saving metadata:', error);
        }
    }, []);
    // Load annotations from metadata file
    const loadAnnotationsFromFile = useCallback(async (filePath: string): Promise<Annotation[]> => {
        try {
            // Don't load metadata for metadata files or system files
            if (filePath.endsWith('.metadata') || filePath.endsWith('.openotex-session.yml')) {
                return [];
            }

            // Only load metadata for LaTeX-related files
            const pathModule = (window as any).api.path;
            const fileExt = pathModule.extname(filePath).toLowerCase();
            const latexExtensions = ['.tex', '.latex', '.bib', '.cls', '.sty', '.bst', '.dtx', '.ins'];
            if (!latexExtensions.includes(fileExt)) {
                return [];
            }

            const api = (window as any).api;
            const metadataPath = `${filePath}.metadata`;
            const result = await api.readFile( metadataPath);
            if (result.success && result.content) {
                const metadata = JSON.parse(result.content);
                return metadata.annotations || [];
            }
        }
        catch (error) {
            // Metadata file doesn't exist or is invalid - that's okay
            console.debug('No metadata file found for:', filePath);
        }
        return [];
    }, []);
    const updateAnnotations = useCallback((compute: (previous: Annotation[]) => Annotation[]) => {
        if (!currentFile) {
            return false;
        }
        const previous = annotationsRef.current;
        const next = compute(previous);
        if (next === previous) {
            return false;
        }
        annotationsRef.current = next;
        setAnnotations(next);
        editorRef.current?.refreshAnnotations();
        setTabAnnotations(prevTab => {
            const newMap = new Map(prevTab);
            newMap.set(currentFile.path, next);
            return newMap;
        });
        void saveAnnotationsToFile(currentFile.path, next);
        return true;
    }, [currentFile, saveAnnotationsToFile]);
    const handleThemeChange = useCallback((next: ThemePreference) => {
        setThemePreference(next);
    }, []);
    const showNotification = useCallback((title: string, message: string, type: NotificationType = 'info') => {
        setNotification({
            isOpen: true,
            title,
            message,
            type,
        });
    }, [setNotification]);
    const showStatusMessage = useCallback((message: string, duration: number = 4000) => {
        if (statusMessageTimeoutRef.current) {
            clearTimeout(statusMessageTimeoutRef.current);
        }
        setStatusMessage(message);
        statusMessageTimeoutRef.current = setTimeout(() => {
            setStatusMessage('');
            statusMessageTimeoutRef.current = null;
        }, duration);
    }, []);

    // --- Saving -------------------------------------------------------------

    const markDirty = useCallback((filePath: string, dirty: boolean) => {
        if (dirtyPathsRef.current.has(filePath) === dirty) {
            return;
        }
        const next = new Set(dirtyPathsRef.current);
        if (dirty) {
            next.add(filePath);
        }
        else {
            next.delete(filePath);
        }
        dirtyPathsRef.current = next;
        setDirtyPaths(next);
    }, []);

    const cancelAutoSave = useCallback((filePath: string) => {
        const timer = autoSaveTimersRef.current.get(filePath);
        if (timer) {
            clearTimeout(timer);
            autoSaveTimersRef.current.delete(filePath);
        }
    }, []);

    // Remember the on-disk content of a file that was just opened.
    const trackOpenedFile = useCallback((filePath: string, content: string) => {
        latestContentRef.current.set(filePath, content);
        lastWrittenRef.current.set(filePath, content);
    }, []);

    const forgetFile = useCallback((filePath: string) => {
        cancelAutoSave(filePath);
        latestContentRef.current.delete(filePath);
        lastWrittenRef.current.delete(filePath);
        markDirty(filePath, false);
    }, [cancelAutoSave, markDirty]);

    const forgetAllFiles = useCallback(() => {
        autoSaveTimersRef.current.forEach(timer => clearTimeout(timer));
        autoSaveTimersRef.current.clear();
        latestContentRef.current.clear();
        lastWrittenRef.current.clear();
        dirtyPathsRef.current = new Set();
        setDirtyPaths(new Set());
    }, []);

    const writeFileContent = useCallback(async (filePath: string, content: string): Promise<boolean> => {
        try {
            const result = await (window as any).api.writeFile(filePath, content);
            if (!result?.success) {
                console.error('Failed to save', filePath, result?.error);
                return false;
            }
            lastWrittenRef.current.set(filePath, content);
            if (latestContentRef.current.get(filePath) === content) {
                markDirty(filePath, false);
            }
            return true;
        }
        catch (error) {
            console.error('Failed to save', filePath, error);
            return false;
        }
    }, [markDirty]);

    // Write a file's latest content to disk now. Unless `force` is set, files
    // without unsaved changes are skipped.
    const flushFile = useCallback(async (filePath: string, force = false): Promise<boolean> => {
        cancelAutoSave(filePath);
        const content = latestContentRef.current.get(filePath);
        if (content === undefined) {
            return true;
        }
        if (!force && !dirtyPathsRef.current.has(filePath)) {
            return true;
        }
        return writeFileContent(filePath, content);
    }, [cancelAutoSave, writeFileContent]);

    // Returns the paths that could not be saved.
    const flushDirtyFiles = useCallback(async (filter?: (filePath: string) => boolean): Promise<string[]> => {
        const failed: string[] = [];
        for (const filePath of Array.from(dirtyPathsRef.current)) {
            if (filter && !filter(filePath)) {
                continue;
            }
            if (!(await flushFile(filePath))) {
                failed.push(filePath);
            }
        }
        return failed;
    }, [flushFile]);

    const scheduleAutoSave = useCallback((filePath: string) => {
        cancelAutoSave(filePath);
        autoSaveTimersRef.current.set(filePath, setTimeout(() => {
            autoSaveTimersRef.current.delete(filePath);
            void flushFile(filePath).then(ok => {
                if (!ok) {
                    showStatusMessage(`Auto Save failed for ${fileNameOf(filePath)}`, 6000);
                }
            });
        }, AUTO_SAVE_DELAY_MS));
    }, [cancelAutoSave, flushFile, showStatusMessage]);

    // Make sure unsaved changes are saved or explicitly discarded before tabs
    // close or the project changes. Resolves to false when the user cancels.
    const resolveUnsavedChanges = useCallback(async (paths?: string[]): Promise<boolean> => {
        const targets = (paths ?? Array.from(dirtyPathsRef.current)).filter(filePath => dirtyPathsRef.current.has(filePath));
        if (targets.length === 0) {
            return true;
        }
        const inTargets = (filePath: string) => targets.includes(filePath);
        if (autoSaveRef.current) {
            const failed = await flushDirtyFiles(inTargets);
            if (failed.length === 0) {
                return true;
            }
        }
        const choice = await (window as any).api.showUnsavedDialog(targets.map(fileNameOf));
        if (choice === 'cancel') {
            return false;
        }
        if (choice === 'discard') {
            targets.forEach(filePath => {
                cancelAutoSave(filePath);
                markDirty(filePath, false);
            });
            return true;
        }
        const failed = await flushDirtyFiles(inTargets);
        if (failed.length > 0) {
            showNotification('Save Failed', `Could not save ${failed.map(fileNameOf).join(', ')}.`, 'error');
            return false;
        }
        return true;
    }, [cancelAutoSave, flushDirtyFiles, markDirty, showNotification]);

    const resetWorkspace = useCallback(() => {
        forgetAllFiles();
        restoredSessionProjectRef.current = null;
        cursorPositionsRef.current = new Map();
        pendingCursorRef.current = null;
        setCurrentFile(null);
        setOpenTabs([]);
        setTabContents(new Map());
        setTabAnnotations(new Map());
        setEditorContent('');
        resetCompileNonce();
        setAnnotations([]);
        setShowAnnotationsPanel(false);
        setAnnotationsHidden(true);
    }, [forgetAllFiles, resetCompileNonce]);

    const handleOpenProject = async () => {
        const api = (window as any).api;
        const result = await api.openDirectoryDialog();
        if (result.success && !result.canceled && result.filePaths.length > 0) {
            if (!(await resolveUnsavedChanges())) {
                return;
            }
            if (currentFile) {
                await saveAnnotationsToFile(currentFile.path, annotationsRef.current);
            }
            resetWorkspace();
            setProjectPath(result.filePaths[0]);
        }
    };

    const handleNewProject = () => {
        setShowNewProjectDialog(true);
    };

    const handleCreateNewProject = async (projectName: string, directory: string, templateId: string = DEFAULT_TEMPLATE_ID) => {
        try {
            const api = (window as any).api;
            const pathModule = (window as any).api.path;
            const template = PROJECT_TEMPLATES.find(item => item.id === templateId) ?? PROJECT_TEMPLATES[0];

            const newProjectPath = pathModule.join(directory, projectName);
            // Never write template files into an existing, non-empty folder.
            const existing = await api.readDirectory(newProjectPath);
            if (existing?.success && Array.isArray(existing.files) && existing.files.length > 0) {
                showNotification('Folder Not Empty', `"${newProjectPath}" already exists and contains files. Choose another project name or location.`, 'error');
                return;
            }

            if (!(await resolveUnsavedChanges())) {
                return;
            }

            const createDirResult = await api.createDirectory(newProjectPath);
            if (!createDirResult.success) {
                showNotification('Error', `Failed to create project directory: ${createDirResult.error}`, 'error');
                return;
            }

            const files = template.files(escapeLatexText(projectName));
            for (const [relativePath, fileContent] of Object.entries(files)) {
                const filePath = pathModule.join(newProjectPath, ...relativePath.split('/'));
                const parent = pathModule.dirname(filePath);
                if (parent !== newProjectPath) {
                    await api.createDirectory(parent);
                }
                const writeResult = await api.writeFile(filePath, fileContent);
                if (!writeResult.success) {
                    showNotification('Error', `Failed to create ${relativePath}: ${writeResult.error}`, 'error');
                    return;
                }
            }

            if (currentFile) {
                await saveAnnotationsToFile(currentFile.path, annotationsRef.current);
            }
            resetWorkspace();
            setProjectPath(newProjectPath);
            // The new project has no session file yet; skip restoring one.
            restoredSessionProjectRef.current = newProjectPath;
            markSessionReady(newProjectPath);

            const mainTexPath = pathModule.join(newProjectPath, 'main.tex');
            const mainTexContent = files['main.tex'] ?? '';
            const mainTexFile: FileNode = {
                name: 'main.tex',
                path: mainTexPath,
                isDirectory: false,
            };

            trackOpenedFile(mainTexPath, mainTexContent);
            setOpenTabs([mainTexFile]);
            setCurrentFile(mainTexFile);
            setEditorContent(mainTexContent);
            triggerCompile();
            setTabContents(new Map([[mainTexPath, mainTexContent]]));
            setAnnotations([]);

            setShowNewProjectDialog(false);
            showStatusMessage(`Created project "${projectName}" from the ${template.name} template`);
        } catch (error) {
            console.error('Error creating new project:', error);
            showNotification('Error', `Failed to create project: ${error}`, 'error');
        }
    };
    const handleSaveFolderAsZip = useCallback(async (folderPath: string) => {
        try {
            const api = (window as any).api;
            const path = (window as any).api.path;
            const folderName = path.basename(folderPath);
            const zip = new JSZip();
            const rootFolder = zip.folder(folderName) ?? zip;
            const addFilesToZip = async (sourcePath: string, destination: JSZip) => {
                const result = await api.readDirectory( sourcePath);
                if (!result.success) {
                    return;
                }
                for (const file of result.files) {
                    if (file.isDirectory) {
                        if (ZIP_EXCLUDED_DIRECTORIES.has(file.name)) {
                            continue;
                        }
                        const childFolder = destination.folder(file.name) ?? destination;
                        await addFilesToZip(file.path, childFolder);
                    }
                    else {
                        if (file.name === SESSION_FILENAME) {
                            continue;
                        }
                        const fileResult = await api.readFileBase64( file.path);
                        if (fileResult.success && fileResult.data) {
                            destination.file(file.name, fileResult.data, { base64: true });
                        }
                    }
                }
            };
            await flushDirtyFiles();
            await addFilesToZip(folderPath, rootFolder);
            const zipContent = await zip.generateAsync({ type: 'base64' });
            const defaultPath = path.join(path.dirname(folderPath), `${folderName}.zip`);
            const saveResult = await (window as any).api.saveZipFile({
                defaultPath,
                data: zipContent,
            });
            if (saveResult.success) {
                showStatusMessage(`Saved ${fileNameOf(saveResult.filePath || `${folderName}.zip`)}`);
            }
            else if (!saveResult.canceled) {
                throw new Error(saveResult.error || 'Unknown error while saving ZIP');
            }
        }
        catch (error) {
            console.error('ZIP export error:', error);
            showNotification('Export Failed', 'Failed to export folder as ZIP. Please try again.', 'error');
        }
    }, [flushDirtyFiles, showNotification, showStatusMessage]);
    const handleFind = () => {
        editorRef.current?.focus();
        editorRef.current?.triggerFind();
    };
    const handleReplace = () => {
        editorRef.current?.focus();
        editorRef.current?.triggerReplace();
    };
    const handleToggleTerminal = useCallback(() => {
        setIsTerminalVisible(prev => !prev);
    }, []);

    const toggleAutoCompile = useCallback(() => {
        setAutoCompile(prev => !prev);
    }, []);
    const toggleAutoSave = useCallback(() => {
        const next = !autoSaveRef.current;
        setAutoSave(next);
        if (next) {
            // Turning Auto Save on saves everything that is pending.
            void flushDirtyFiles();
        }
    }, [flushDirtyFiles]);
    const handleToggleAnnotationsVisibility = useCallback(() => {
        setAnnotationsHidden(prev => !prev);
    }, []);
    const handleToggleStructureMap = useCallback(() => {
        setShowStructureMap(prev => !prev);
    }, []);
    const handleStructureMapNodeClick = useCallback((lineNumber: number) => {
        if (editorRef.current) {
            editorRef.current.jumpToLine(lineNumber);
        }
    }, []);
    const handleLatexEngineChange = useCallback((engine: 'pdflatex' | 'xelatex' | 'lualatex') => {
        setLatexEngine(engine);
    }, []);
    const focusEditor = useCallback(() => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => editorRef.current?.focus());
        }
        else {
            editorRef.current?.focus();
        }
    }, []);
    const persistSession = useCallback(async () => {
        // Never write (or delete) the session file before the previous
        // session of this project has been read back.
        if (!projectPath || sessionReadyProjectRef.current !== projectPath) {
            return;
        }
        try {
            const pathModule = (window as any).api.path;
            const api = (window as any).api;
            const sessionPath = pathModule.join(projectPath, SESSION_FILENAME);
            if (openTabs.length === 0) {
                const exists = await api.pathExists(sessionPath);
                if (exists?.exists) {
                    await api.deletePath( sessionPath);
                }
                cursorPositionsRef.current = new Map();
                return;
            }
            const payload = {
                version: 1,
                tabs: openTabs.map(tab => tab.path),
                active: currentFile?.path ?? null,
                cursors: Array.from(cursorPositionsRef.current.entries()).map(([path, position]) => ({
                    path,
                    line: position.lineNumber,
                    column: position.column,
                })),
            };
            const yamlString = yamlDump(payload, { skipInvalid: true }) || '';
            await api.writeFile( sessionPath, yamlString);
        }
        catch (error) {
            console.warn('Unable to persist session state', error);
        }
    }, [currentFile, openTabs, projectPath]);
    const restoreSession = useCallback(async (projectRoot: string) => {
        if (!projectRoot) {
            return;
        }
        if (restoredSessionProjectRef.current === projectRoot) {
            return;
        }
        if (openTabs.length > 0 || currentFile) {
            markSessionReady(projectRoot);
            return;
        }
        restoredSessionProjectRef.current = projectRoot;
        markSessionReady(null);
        try {
            await readSessionIntoWorkspace(projectRoot);
        }
        finally {
            markSessionReady(projectRoot);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFile, openTabs]);
    const readSessionIntoWorkspace = async (projectRoot: string) => {
        const pathModule = (window as any).api.path;
        const api = (window as any).api;
        const sessionPath = pathModule.join(projectRoot, SESSION_FILENAME);
        let yamlText = null;
        try {
            const result = await api.readFile( sessionPath);
            if (!result.success || !result.content) {
                cursorPositionsRef.current = new Map();
                return;
            }
            yamlText = result.content;
        }
        catch (error) {
            console.warn('Unable to read session file', error);
            cursorPositionsRef.current = new Map();
            return;
        }
        let parsed: any = {};
        try {
            parsed = yamlLoad(yamlText || '') || {};
        }
        catch (error) {
            console.warn('Invalid session file', error);
            cursorPositionsRef.current = new Map();
            return;
        }
        const tabPaths = Array.isArray(parsed?.tabs)
            ? parsed.tabs.filter((value: any) => typeof value === 'string')
            : [];
        if (tabPaths.length === 0) {
            cursorPositionsRef.current = new Map();
            return;
        }
        const restoredTabs: FileNode[] = [];
        const restoredContents = new Map<string, string>();
        const restoredAnnotations = new Map<string, Annotation[]>();
        const missingPaths: string[] = [];
        for (const filePath of tabPaths) {
            try {
                const result = await api.readFile( filePath);
                if (!result.success) {
                    missingPaths.push(filePath);
                    continue;
                }
                restoredContents.set(filePath, result.content);
                const loadedAnnotations = await loadAnnotationsFromFile(filePath);
                restoredAnnotations.set(filePath, loadedAnnotations);
                restoredTabs.push({
                    name: pathModule.basename(filePath),
                    path: filePath,
                    isDirectory: false,
                });
            }
            catch (error) {
                console.warn('Failed to restore tab', filePath, error);
            }
        }
        if (restoredTabs.length === 0) {
            cursorPositionsRef.current = new Map();
            if (missingPaths.length > 0) {
                const message = missingPaths.length === 1
                    ? `Skipped missing file: ${missingPaths[0]}`
                    : `Skipped ${missingPaths.length} missing files from the previous session.`;
                showNotification('Files Missing', message, 'info');
            }
            return;
        }
        const cursorEntries = Array.isArray(parsed?.cursors)
            ? parsed.cursors.filter((entry: any) => entry &&
                typeof entry.path === 'string' &&
                (typeof entry.line === 'number' || typeof entry.lineNumber === 'number') &&
                typeof entry.column === 'number')
            : [];
        const restoredCursorMap = new Map();
        for (const entry of cursorEntries) {
            const lineValue = typeof entry.line === 'number'
                ? entry.line
                : entry.lineNumber;
            restoredCursorMap.set(entry.path, {
                lineNumber: lineValue,
                column: entry.column,
            });
        }
        cursorPositionsRef.current = restoredCursorMap;
        restoredContents.forEach((content, filePath) => trackOpenedFile(filePath, content));
        setOpenTabs(restoredTabs);
        setTabContents(restoredContents);
        setTabAnnotations(restoredAnnotations);
        const activePath = typeof parsed?.active === 'string' ? parsed.active : null;
        const activeFile = restoredTabs.find(tab => tab.path === activePath) ?? restoredTabs[0];
        const activeContent = restoredContents.get(activeFile.path) ?? '';
        const activeAnnotations = restoredAnnotations.get(activeFile.path) ?? [];
        const storedPosition = restoredCursorMap.get(activeFile.path);
        pendingCursorRef.current = {
            path: activeFile.path,
            position: storedPosition ?? { lineNumber: 1, column: 1 },
        };
        setCurrentFile(activeFile);
        setEditorContent(activeContent);
        if (isLatexFileName(activeFile.name)) {
            triggerCompile();
        }
        else {
            resetCompileNonce();
        }
        setAnnotations(activeAnnotations);
        if (missingPaths.length > 0) {
            const message = missingPaths.length === 1
                ? `Skipped missing file: ${missingPaths[0]}`
                : `Skipped ${missingPaths.length} missing files from the previous session.`;
            showNotification('Files Missing', message, 'info');
        }
    };
    const schedulePersistSession = useCallback(() => {
        if (persistSessionTimeoutRef.current) {
            return;
        }
        persistSessionTimeoutRef.current = setTimeout(() => {
            void persistSession().finally(() => {
                persistSessionTimeoutRef.current = null;
            });
        }, 200);
    }, [persistSession]);
    useEffect(() => {
        void persistSession();
    }, [persistSession]);

    // Show `file` in the editor, using its in-memory content.
    const activateOpenTab = useCallback(async (file: FileNode | null) => {
        if (!file) {
            setCurrentFile(null);
            setEditorContent('');
            resetCompileNonce();
            setAnnotations([]);
            setShowAnnotationsPanel(false);
            setAnnotationsHidden(true);
            pendingCursorRef.current = null;
            return;
        }
        const storedPosition = cursorPositionsRef.current.get(file.path);
        pendingCursorRef.current = {
            path: file.path,
            position: storedPosition ?? { lineNumber: 1, column: 1 },
        };
        setCurrentFile(file);
        setEditorContent(latestContentRef.current.get(file.path) ?? tabContents.get(file.path) ?? '');
        if (isLatexFileName(file.name)) {
            triggerCompile();
        }
        else {
            resetCompileNonce();
        }
        const savedAnnotations = tabAnnotations.get(file.path);
        if (savedAnnotations) {
            setAnnotations(savedAnnotations);
        }
        else {
            const loadedAnnotations = await loadAnnotationsFromFile(file.path);
            setAnnotations(loadedAnnotations);
            setTabAnnotations(prev => {
                const newMap = new Map(prev);
                newMap.set(file.path, loadedAnnotations);
                return newMap;
            });
        }
        focusEditor();
    }, [focusEditor, loadAnnotationsFromFile, resetCompileNonce, tabAnnotations, tabContents, triggerCompile]);

    // Leaving a tab: persist its highlights and, with Auto Save, its text.
    const leaveCurrentTab = useCallback(async () => {
        const leaving = currentFileRef.current;
        if (!leaving) {
            return;
        }
        if (autoSaveRef.current) {
            void flushFile(leaving.path);
        }
        await saveAnnotationsToFile(leaving.path, annotationsRef.current);
    }, [flushFile, saveAnnotationsToFile]);

    const handleFileSelect = async (file: FileNode) => {
        if (file.isDirectory) {
            return;
        }
        if (currentFile && samePath(currentFile.path, file.path)) {
            focusEditor();
            return;
        }
        // Check if file is already open in a tab
        const existingTab = openTabs.find(tab => samePath(tab.path, file.path));
        if (existingTab) {
            await leaveCurrentTab();
            await activateOpenTab(existingTab);
            return;
        }
        // Open new tab
        const api = (window as any).api;
        const result = await api.readFile( file.path);
        if (!result.success) {
            pendingCursorRef.current = null;
            if (result.binary) {
                // PDFs, images, archives: hand them to the system viewer.
                const opened = await api.openPath(file.path);
                if (opened?.success) {
                    showStatusMessage(`Opened ${file.name} with the system viewer`);
                }
                else {
                    showNotification('Cannot Open File', `${file.name} is not a text file and could not be opened.`, 'info');
                }
            }
            else {
                showNotification('Cannot Open File', result.error || `Unable to open ${file.name}.`, 'error');
            }
            return;
        }
        await leaveCurrentTab();
        // Load annotations from metadata file
        const loadedAnnotations = await loadAnnotationsFromFile(file.path);
        const storedPosition = cursorPositionsRef.current.get(file.path);
        pendingCursorRef.current = {
            path: file.path,
            position: storedPosition ?? { lineNumber: 1, column: 1 },
        };
        trackOpenedFile(file.path, result.content);
        setOpenTabs(prev => [...prev, file]);
        setCurrentFile(file);
        setEditorContent(result.content);
        if (isLatexFileName(file.name)) {
            triggerCompile();
        }
        else {
            resetCompileNonce();
        }
        setTabContents(prev => {
            const newMap = new Map(prev);
            newMap.set(file.path, result.content);
            return newMap;
        });
        setAnnotations(loadedAnnotations);
        setTabAnnotations(prev => {
            const newMap = new Map(prev);
            newMap.set(file.path, loadedAnnotations);
            return newMap;
        });
        focusEditor();
    };
    const handleFileSelectRef = useRef(handleFileSelect);
    handleFileSelectRef.current = handleFileSelect;

    const handleTabClick = async (file: FileNode) => {
        if (currentFile?.path === file.path) {
            return;
        }
        await leaveCurrentTab();
        await activateOpenTab(file);
    };
    const handleTabClose = async (file: FileNode, event?: React.MouseEvent) => {
        event?.stopPropagation();
        if (!(await resolveUnsavedChanges([file.path]))) {
            return;
        }
        // Save annotations before closing if this is the current file
        if (currentFile?.path === file.path) {
            await saveAnnotationsToFile(file.path, annotationsRef.current);
        }
        else {
            // Save from tab annotations map
            const tabAnns = tabAnnotations.get(file.path);
            if (tabAnns) {
                await saveAnnotationsToFile(file.path, tabAnns);
            }
        }
        const tabIndex = openTabs.findIndex(tab => tab.path === file.path);
        const newTabs = openTabs.filter(tab => tab.path !== file.path);
        setOpenTabs(newTabs);
        cursorPositionsRef.current.delete(file.path);
        // Clean up tab content and annotations
        setTabContents(prev => {
            const newMap = new Map(prev);
            newMap.delete(file.path);
            return newMap;
        });
        setTabAnnotations(prev => {
            const newMap = new Map(prev);
            newMap.delete(file.path);
            return newMap;
        });
        // If closing the current tab, switch to another tab
        if (currentFile?.path === file.path) {
            // Switch to the tab to the left, or the first tab if closing the leftmost
            const newIndex = tabIndex > 0 ? tabIndex - 1 : 0;
            await activateOpenTab(newTabs.length > 0 ? newTabs[newIndex] : null);
        }
        forgetFile(file.path);
    };

    // Keep open tabs in sync with renames and deletions in the file tree.
    const handlePathRenamed = useCallback((oldPath: string, newPath: string) => {
        const remap = (filePath: string): string | null => {
            if (samePath(filePath, oldPath)) return newPath;
            if (isSameOrInside(filePath, oldPath)) return newPath + filePath.slice(oldPath.length);
            return null;
        };
        const affected = openTabsRef.current.filter(tab => remap(tab.path));
        if (affected.length === 0) {
            return;
        }
        const moveKeys = <T,>(map: Map<string, T>) => {
            const next = new Map<string, T>();
            map.forEach((value, key) => next.set(remap(key) ?? key, value));
            return next;
        };
        affected.forEach(tab => cancelAutoSave(tab.path));
        latestContentRef.current = moveKeys(latestContentRef.current);
        lastWrittenRef.current = moveKeys(lastWrittenRef.current);
        cursorPositionsRef.current = moveKeys(cursorPositionsRef.current);
        const nextDirty = new Set(Array.from(dirtyPathsRef.current).map(filePath => remap(filePath) ?? filePath));
        dirtyPathsRef.current = nextDirty;
        setDirtyPaths(nextDirty);
        const renameNode = (tab: FileNode): FileNode => {
            const nextPath = remap(tab.path);
            return nextPath ? { ...tab, path: nextPath, name: fileNameOf(nextPath) } : tab;
        };
        setOpenTabs(tabs => tabs.map(renameNode));
        setTabContents(moveKeys);
        setTabAnnotations(moveKeys);
        const current = currentFileRef.current;
        if (current && remap(current.path)) {
            const renamed = renameNode(current);
            const cursor = editorRef.current?.getCursorPosition();
            if (cursor) {
                pendingCursorRef.current = { path: renamed.path, position: cursor };
            }
            setCurrentFile(renamed);
        }
        if (autoSaveRef.current) {
            affected.forEach(tab => {
                const nextPath = remap(tab.path);
                if (nextPath && dirtyPathsRef.current.has(nextPath)) {
                    void flushFile(nextPath);
                }
            });
        }
    }, [cancelAutoSave, flushFile]);

    const handlePathDeleted = useCallback((deletedPath: string) => {
        const removed = openTabsRef.current.filter(tab => isSameOrInside(tab.path, deletedPath));
        if (removed.length === 0) {
            return;
        }
        const remaining = openTabsRef.current.filter(tab => !isSameOrInside(tab.path, deletedPath));
        removed.forEach(tab => {
            forgetFile(tab.path);
            cursorPositionsRef.current.delete(tab.path);
        });
        const removedKeys = new Set(removed.map(tab => tab.path));
        setOpenTabs(remaining);
        setTabContents(prev => new Map(Array.from(prev.entries()).filter(([key]) => !removedKeys.has(key))));
        setTabAnnotations(prev => new Map(Array.from(prev.entries()).filter(([key]) => !removedKeys.has(key))));
        const current = currentFileRef.current;
        if (current && removedKeys.has(current.path)) {
            void activateOpenTab(remaining[0] ?? null);
        }
    }, [activateOpenTab, forgetFile]);

    useEffect(() => {
        if (!currentFile || !editorRef.current) {
            return;
        }
        const pending = pendingCursorRef.current;
        if (!pending || pending.path !== currentFile.path) {
            return;
        }
        pendingCursorRef.current = null;
        editorRef.current.setCursorPosition(pending.position);
        focusEditor();
    }, [currentFile, editorContent, focusEditor]);
    const handleAddHighlightAnnotation = useCallback(() => {
        if (!editorRef.current || !currentFile) {
            showNotification('No Document', 'Open a file to highlight text.', 'info');
            return;
        }
        const selection = editorRef.current.getSelection();
        if (!selection || !selection.text.trim()) {
            showNotification('No Selection', 'Select text in the editor to highlight.', 'info');
            return;
        }
        const existing = findAnnotationAtCursor(selection, annotations);
        if (existing) {
            showNotification('Already Highlighted', 'This selection already has a highlight. Remove it first or edit the existing annotation.', 'info');
            return;
        }
        pendingHighlightRef.current = selection;
        const condensed = selection.text.replace(/\s+/g, ' ').trim();
        const snippetPreview = condensed.length > 120 ? `${condensed.slice(0, 117)}...` : condensed;
        setHighlightDialog({
            isOpen: true,
            mode: 'create',
            annotationId: null,
            snippet: snippetPreview,
            defaultColor: highlightColor,
            defaultComment: '',
        });
    }, [annotations, currentFile, highlightColor, showNotification]);
    const resetHighlightDialog = useCallback(() => {
        pendingHighlightRef.current = null;
        setHighlightDialog({
            isOpen: false,
            mode: 'create',
            annotationId: null,
            snippet: '',
            defaultColor: highlightColor,
            defaultComment: '',
        });
    }, [highlightColor]);
    const handleHighlightDialogCancel = useCallback(() => {
        resetHighlightDialog();
    }, [resetHighlightDialog]);
    const handleHighlightDialogConfirm = useCallback(({ color, comment }: { color: string; comment: string }) => {
        if (!currentFile) {
            resetHighlightDialog();
            return;
        }
        const trimmedComment = comment.trim();
        if (highlightDialog.mode === 'edit' && highlightDialog.annotationId) {
            const targetId = highlightDialog.annotationId;
            const updated = updateAnnotations(prev => {
                let changed = false;
                const next = prev.map(annotation => {
                    if (annotation.id !== targetId) {
                        return annotation;
                    }
                    const nextComment = trimmedComment ? trimmedComment : undefined;
                    if (annotation.color === color && annotation.comment === nextComment) {
                        return annotation;
                    }
                    changed = true;
                    return { ...annotation, color, comment: nextComment };
                });
                return changed ? next : prev;
            });
            if (updated) {
                setHighlightColor(color);
                showStatusMessage(trimmedComment ? 'Annotation updated' : 'Highlight updated');
            }
            resetHighlightDialog();
            return;
        }
        if (!pendingHighlightRef.current) {
            resetHighlightDialog();
            return;
        }
        const selection = pendingHighlightRef.current;
        const selectionRange = selection.range;
        const overlapNow = annotations.some(annotation => rangesOverlap(annotation.range, selectionRange));
        if (overlapNow) {
            showNotification('Already Highlighted', 'Another highlight was added to this area. Remove it before adding a new one.', 'info');
            resetHighlightDialog();
            return;
        }
        const id = typeof window !== 'undefined' &&
            window.crypto &&
            typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : `annotation-${Date.now()}-${Math.round(Math.random() * 1000)}`;
        const newAnnotation: Annotation = {
            id,
            color,
            range: selectionRange,
            text: selection.text,
            createdAt: Date.now(),
            comment: trimmedComment || undefined,
        };
        const updated = updateAnnotations(prev => [...prev, newAnnotation]);
        if (updated) {
            setHighlightColor(color);
            setAnnotationsHidden(false);
            if (highlightDialog.mode === 'create') {
                setShowAnnotationsPanel(true);
            }
            showStatusMessage(trimmedComment ? 'Highlight and comment saved' : 'Highlight saved');
        }
        resetHighlightDialog();
    }, [annotations, currentFile, highlightDialog, resetHighlightDialog, setHighlightColor, showNotification, showStatusMessage, updateAnnotations]);
    const handleEditAnnotation = useCallback((annotation: Annotation) => {
        pendingHighlightRef.current = null;
        const condensed = annotation.text.replace(/\s+/g, ' ').trim();
        const snippetPreview = condensed.length > 120 ? `${condensed.slice(0, 117)}...` : condensed;
        setHighlightDialog({
            isOpen: true,
            mode: 'edit',
            annotationId: annotation.id,
            snippet: snippetPreview,
            defaultColor: annotation.color,
            defaultComment: annotation.comment ?? '',
        });
    }, []);
    const handleRemoveAnnotation = useCallback((id: string) => {
        if (!currentFile)
            return;
        const existed = annotations.some(annotation => annotation.id === id);
        if (!existed) {
            return;
        }
        const updated = updateAnnotations(prev => prev.filter(annotation => annotation.id !== id));
        if (updated) {
            showStatusMessage('Highlight removed');
        }
    }, [annotations, currentFile, showStatusMessage, updateAnnotations]);
    const handleDeleteAnnotationFromDialog = useCallback(() => {
        if (highlightDialog.mode === 'edit' && highlightDialog.annotationId) {
            handleRemoveAnnotation(highlightDialog.annotationId);
        }
        resetHighlightDialog();
    }, [handleRemoveAnnotation, highlightDialog, resetHighlightDialog]);
    const handleCursorChange = useCallback((position: CursorPosition) => {
        cursorPositionRef.current = position;
        if (!currentFile) {
            return;
        }
        cursorPositionsRef.current.set(currentFile.path, position);
        schedulePersistSession();
    }, [currentFile, schedulePersistSession]);
    const handleFocusAnnotation = useCallback((annotation: Annotation) => {
        editorRef.current?.revealRange(annotation.range);
    }, []);
    const handleSyncTexJump = useCallback((target: { file: string; line: number; column: number }) => {
        if (!target?.file || !target.line) {
            return;
        }
        const current = currentFileRef.current;
        if (current && samePath(current.path, target.file)) {
            editorRef.current?.setCursorPosition({ lineNumber: target.line, column: target.column || 1 });
            return;
        }
        const openTab = openTabsRef.current.find(tab => samePath(tab.path, target.file));
        const filePath = openTab?.path ?? target.file;
        pendingCursorRef.current = {
            path: filePath,
            position: { lineNumber: target.line, column: target.column || 1 },
        };
        cursorPositionsRef.current.set(filePath, { lineNumber: target.line, column: target.column || 1 });
        void handleFileSelectRef.current(openTab ?? { name: fileNameOf(target.file), path: target.file, isDirectory: false });
    }, [pendingCursorRef]);
    const handleForwardSearch = useCallback(() => {
        if (!currentFile) return;
        if (!isLatexFileName(currentFile.name)) return;
        const livePosition = editorRef.current?.getCursorPosition();
        const { lineNumber, column } = livePosition || cursorPositionRef.current;
        void previewRef.current?.forwardSearch(lineNumber, column);
    }, [currentFile]);
    const handleInstallPackages = async (packageNames: string[]): Promise<PackageInstallResult> => {
        const api = (window as any).api;
        const label = packageNames.join(', ');
        // System package managers can take minutes (download + password prompt).
        showStatusMessage(`Installing ${label}...`, 30 * 60 * 1000);
        try {
            const result: PackageInstallResult = await api.installLatexPackage(packageNames);
            if (result.success) {
                showStatusMessage(`Installed ${label}`);
                const remaining = missingPackages.filter(pkg => !packageNames.includes(pkg));
                setMissingPackages(remaining);
                if (remaining.length === 0) {
                    setShowPackageDialog(false);
                    triggerCompile();
                }
            }
            else {
                showStatusMessage('Package installation failed');
            }
            return result;
        }
        catch (error) {
            showStatusMessage('Package installation failed');
            return { success: false, error: String(error) };
        }
    };
    // A closed dialog stays closed for the same missing packages until the
    // user compiles explicitly; auto-compile would otherwise reopen it on
    // every keystroke.
    const dismissedPackagesRef = useRef('');
    const handleMissingPackages = useCallback((packages: string[], explicit?: boolean) => {
        setMissingPackages(packages);
        if (explicit || packages.join('\n') !== dismissedPackagesRef.current) {
            setShowPackageDialog(true);
        }
    }, []);
    const handleClosePackageDialog = useCallback(() => {
        dismissedPackagesRef.current = missingPackages.join('\n');
        setShowPackageDialog(false);
    }, [missingPackages]);
    useEffect(() => {
        const api = (window as any).api;
        let disposed = false;
        const validateDirectory = async (dirPath: string | undefined): Promise<string | null> => {
            if (!dirPath)
                return null;
            try {
                const result = await api.readDirectory( dirPath);
                if (result.success) {
                    return dirPath;
                }
            }
            catch (error) {
                console.warn('Unable to access directory:', dirPath, error);
            }
            return null;
        };
        const initializeProjectPath = async () => {
            const storedPath = (() => {
                try {
                    return localStorage.getItem('openotex:lastProjectPath');
                }
                catch (error) {
                    console.warn('Unable to read stored project path', error);
                    return null;
                }
            })();
            // In a sandboxed renderer there is no process.cwd().
            // Use stored path first, then fall back to the OS default projects directory.
            let defaultDir: string | null = null;
            try {
                const def = await (window as any).api.getDefaultProjectsDirectory();
                if (def?.success) defaultDir = def.path;
            } catch {}
            // Started with `Openotex --open=<file>`: open that file's project.
            let openRequest: { file: string; line?: number; project?: string; isDirectory?: boolean } | null = null;
            try {
                openRequest = await api.takePendingOpenRequest?.();
            } catch {}
            if (openRequest) {
                const requestedProject = openRequest.isDirectory
                    ? openRequest.file
                    : (openRequest.project ?? api.path.dirname(openRequest.file));
                const validProject = await validateDirectory(requestedProject);
                if (validProject && !disposed) {
                    setProjectPath(validProject);
                    setShowAnnotationsPanel(false);
                    setAnnotationsHidden(true);
                    if (!openRequest.isDirectory) {
                        setPendingOpen({ file: openRequest.file, line: openRequest.line });
                    }
                    return;
                }
            }
            const candidates = [storedPath, defaultDir];
            for (const candidate of candidates) {
                const validPath = await validateDirectory(candidate || undefined);
                if (validPath && !disposed) {
                    setProjectPath(validPath);
                    setShowAnnotationsPanel(false);
                    setAnnotationsHidden(true);
                    return;
                }
            }
        };
        initializeProjectPath();
        return () => {
            disposed = true;
        };
    }, []);

    // Load default projects directory
    useEffect(() => {
        const loadDefaultProjectsDirectory = async () => {
            try {
                // First, try to load the user's preferred directory from localStorage
                const savedDirectory = localStorage.getItem('openotex:preferredProjectsDirectory');

                if (savedDirectory) {
                    // Use the saved directory if it exists
                    setDefaultProjectsDirectory(savedDirectory);
                } else {
                    // Otherwise, get the OS default
                    const api = (window as any).api;
                    const result = await api.getDefaultProjectsDirectory();
                    if (result.success) {
                        setDefaultProjectsDirectory(result.path);
                    }
                }
            } catch (error) {
                console.error('Failed to get default projects directory:', error);
            }
        };
        loadDefaultProjectsDirectory();
    }, []);

    // Check for updates on startup
    useEffect(() => {
        const checkForUpdatesOnStartup = async () => {
            try {
                const checkOnStartup = localStorage.getItem('checkUpdateOnStartup');

                // Default to true if not set, or if explicitly set to 'true'
                if (checkOnStartup === null || checkOnStartup === 'true') {
                    // Delay the check by 3 seconds to let the app fully load
                    setTimeout(async () => {
                        try {
                            const CURRENT_VERSION = APP_VERSION;
                            const VERSION_CHECK_URL = 'https://openotex.com/downloads/Openotex-Setup-';
                            const DOWNLOAD_PAGE_URL = 'https://openotex.com/#download';

                            let latestVersion = CURRENT_VERSION;
                            let foundUpdate = false;

                            const compareVersions = (v1: string, v2: string): number => {
                                const parts1 = v1.replace(/^v/i, '').split('.').map(Number);
                                const parts2 = v2.replace(/^v/i, '').split('.').map(Number);

                                for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                                    const part1 = parts1[i] || 0;
                                    const part2 = parts2[i] || 0;

                                    if (part1 > part2) return 1;
                                    if (part1 < part2) return -1;
                                }

                                return 0;
                            };

                            try {
                                const versionResponse = await fetch('https://openotex.com/version.json', { cache: 'no-cache' });
                                if (versionResponse.ok) {
                                    const versionData = await versionResponse.json();
                                    latestVersion = versionData.version || versionData.latest || CURRENT_VERSION;
                                    foundUpdate = compareVersions(latestVersion, CURRENT_VERSION) > 0;
                                }
                            } catch (error) {
                                console.log('version.json not found, trying alternative method');

                                const currentParts = CURRENT_VERSION.split('.').map(Number);
                                const versionsToCheck = [];

                                for (let i = 1; i <= 10; i++) {
                                    versionsToCheck.push(`${currentParts[0]}.${currentParts[1]}.${currentParts[2] + i}`);
                                }

                                for (let i = 1; i <= 5; i++) {
                                    versionsToCheck.push(`${currentParts[0]}.${currentParts[1] + i}.0`);
                                }

                                for (let i = 1; i <= 2; i++) {
                                    versionsToCheck.push(`${currentParts[0] + i}.0.0`);
                                }

                                for (const version of versionsToCheck) {
                                    try {
                                        const testUrl = `${VERSION_CHECK_URL}${version}.exe`;
                                        const response = await fetch(testUrl, { method: 'HEAD' });

                                        if (response.ok) {
                                            latestVersion = version;
                                            foundUpdate = true;
                                            break;
                                        }
                                    } catch (error) {
                                        continue;
                                    }
                                }
                            }

                            if (foundUpdate) {
                                const userWantsUpdate = window.confirm(
                                    `A new version (${latestVersion}) of Openotex is available!\n\nYou are currently running version ${APP_VERSION_LABEL}.\n\nWould you like to visit the download page?\n\n(You can disable automatic update checks in Help > About)`
                                );

                                if (userWantsUpdate) {

                                    await (window as any).api.openExternal(DOWNLOAD_PAGE_URL);
                                }
                            }
                        } catch (error) {
                            console.error('Error checking for updates on startup:', error);
                        }
                    }, 3000);
                }
            } catch (error) {
                console.error('Error in startup update check:', error);
            }
        };

        checkForUpdatesOnStartup();
    }, []);
    useEffect(() => {
        if (!projectPath)
            return;
        try {
            localStorage.setItem('openotex:lastProjectPath', projectPath);
        }
        catch (error) {
            console.warn('Unable to persist project path', error);
        }
    }, [projectPath]);
    useEffect(() => {
        if (!projectPath) {
            return;
        }
        if (restoredSessionProjectRef.current === projectPath) {
            return;
        }
        void restoreSession(projectPath);
    }, [projectPath, restoreSession]);
    useEffect(() => {
        const api = (window as any).api;
        if (!api?.watchPath) {
            return;
        }
        const configureWatcher = async () => {
            try {
                if (projectPath) {
                    await api.watchPath(projectPath);
                }
                else {
                    await api.unwatchPath();
                }
            }
            catch (error) {
                console.warn('Unable to configure project watcher', error);
            }
        };
        void configureWatcher();
        return () => {
            if (api?.unwatchPath) {
                void api.unwatchPath();
            }
        };
    }, [projectPath]);

    // Reload open files that were changed by another program (git pull, a
    // second editor, a sync client) unless they have unsaved edits here.
    useEffect(() => {
        const api = (window as any).api;
        if (!api?.onFilesystemEvent) {
            return;
        }
        return api.onFilesystemEvent(async (payload: { event: string; path: string }) => {
            if (!payload || (payload.event !== 'change' && payload.event !== 'add')) {
                return;
            }
            const tab = openTabsRef.current.find(item => samePath(item.path, payload.path));
            if (!tab) {
                return;
            }
            const result = await api.readFile(tab.path);
            if (!result?.success || typeof result.content !== 'string') {
                return;
            }
            const disk: string = result.content;
            const latest = latestContentRef.current.get(tab.path);
            if (disk === latest) {
                lastWrittenRef.current.set(tab.path, disk);
                return;
            }
            if (disk === lastWrittenRef.current.get(tab.path)) {
                // Our own earlier write; newer edits are still pending.
                return;
            }
            if (dirtyPathsRef.current.has(tab.path)) {
                showStatusMessage(`${tab.name} changed on disk. Your unsaved edits were kept.`, 8000);
                return;
            }
            latestContentRef.current.set(tab.path, disk);
            lastWrittenRef.current.set(tab.path, disk);
            setTabContents(prev => {
                const next = new Map(prev);
                next.set(tab.path, disk);
                return next;
            });
            if (currentFileRef.current && samePath(currentFileRef.current.path, tab.path)) {
                setEditorContent(disk);
            }
            showStatusMessage(`Reloaded ${tab.name} (changed outside Openotex)`);
            // Keep the PDF in step with sources changed by e.g. git pull.
            if (autoCompileRef.current && currentFileRef.current && isLatexFileName(currentFileRef.current.name)) {
                triggerCompile();
            }
        });
    }, [showStatusMessage, triggerCompile]);

    const handleContentChange = (content: string) => {
        setEditorContent(content);
        if (!currentFile || currentFile.isDirectory) {
            return;
        }
        const filePath = currentFile.path;
        latestContentRef.current.set(filePath, content);
        // Update tab content map
        setTabContents(prev => {
            const newMap = new Map(prev);
            newMap.set(filePath, content);
            return newMap;
        });
        markDirty(filePath, true);
        if (autoSave) {
            scheduleAutoSave(filePath);
        }
        if (!isCurrentFileLatex) {
            if (autoCompileTimeout.current) {
                clearTimeout(autoCompileTimeout.current);
                autoCompileTimeout.current = null;
            }
            resetCompileNonce();
            return;
        }
        // Auto-compile with debounce. Without Auto Save the document compiles
        // when it is saved instead (Ctrl+S), so the PDF matches the file.
        if (autoCompile && autoSave) {
            if (autoCompileTimeout.current) {
                clearTimeout(autoCompileTimeout.current);
            }
            autoCompileTimeout.current = setTimeout(() => {
                triggerCompile();
            }, AUTO_COMPILE_DELAY_MS);
        }
    };
    const handleCompile = useCallback(() => {
        if (!isCurrentFileLatex) {
            return;
        }
        flushOnNextCompileRef.current = true;
        triggerCompile();
    }, [isCurrentFileLatex, triggerCompile]);

    // Compiling reads files from disk, so pending edits are written first:
    // always with Auto Save, otherwise only for an explicit Compile/Refresh
    // (switching tabs must not silently save files).
    const flushBeforeCompile = useCallback(async (explicit = false) => {
        const shouldFlush = explicit || autoSaveRef.current || flushOnNextCompileRef.current;
        flushOnNextCompileRef.current = false;
        if (!shouldFlush) {
            return;
        }
        const failed = await flushDirtyFiles();
        if (failed.length > 0) {
            showStatusMessage(`Could not save ${failed.map(fileNameOf).join(', ')} before compiling`, 6000);
        }
    }, [flushDirtyFiles, showStatusMessage]);

    const handleSaveCurrentFile = useCallback(async () => {
        if (!currentFile || currentFile.isDirectory) {
            showStatusMessage('Open a file to save it.');
            return;
        }

        const saved = await flushFile(currentFile.path, true);
        if (!saved) {
            showNotification('Save Failed', `Failed to save ${currentFile.name}.`, 'error');
            return;
        }
        showStatusMessage(`Saved ${currentFile.name}`);
        if (autoCompile && isLatexFileName(currentFile.name)) {
            triggerCompile();
        }
    }, [autoCompile, currentFile, flushFile, showNotification, showStatusMessage, triggerCompile]);

    const handleSaveAllFiles = useCallback(async () => {
        if (openTabs.length === 0) {
            showStatusMessage('No files to save.');
            return;
        }
        const pending = dirtyPathsRef.current.size;
        const failed = await flushDirtyFiles();
        if (failed.length > 0) {
            showNotification('Save Failed', `Failed to save ${failed.map(fileNameOf).join(', ')}.`, 'error');
            return;
        }
        showStatusMessage(pending === 0 ? 'All files are already saved' : `Saved ${pending} file${pending !== 1 ? 's' : ''}`);
        if (pending > 0 && autoCompile && currentFile && isLatexFileName(currentFile.name)) {
            triggerCompile();
        }
    }, [autoCompile, currentFile, flushDirtyFiles, openTabs, showNotification, showStatusMessage, triggerCompile]);

    const handleVersionFreeze = useCallback(async (fileToFreeze?: FileNode) => {
        const targetFile = fileToFreeze || currentFile;

        if (!targetFile || targetFile.isDirectory) {
            showNotification('No File Selected', 'Select a file to create a version freeze.', 'info');
            return;
        }

        // Validate that the file has a valid path
        if (!targetFile.path || typeof targetFile.path !== 'string') {
            showNotification('Invalid File', 'The selected file does not have a valid path.', 'error');
            return;
        }

        try {
            const api = (window as any).api;
            const pathModule = (window as any).api.path;

            // Get file info
            const fileDir = pathModule.dirname(targetFile.path);
            const fileName = pathModule.basename(targetFile.path);
            const fileExt = pathModule.extname(fileName);
            const fileNameWithoutExt = pathModule.basename(fileName, fileExt);

            // Create backup folder name
            const timelineFolderName = `${fileName}_backups_`;
            const timelineFolderPath = pathModule.join(fileDir, timelineFolderName);

            // Create timeline folder if it doesn't exist
            const createDirResult = await api.createDirectory( timelineFolderPath);
            if (!createDirResult.success && !createDirResult.error?.includes('already exists')) {
                showNotification('Instant Backup Failed', `Failed to create backup folder: ${createDirResult.error}`, 'error');
                return;
            }

            // Get current timestamp
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;

            // Create versioned file name
            const versionedFileName = `${fileNameWithoutExt}_backup_${timestamp}${fileExt}`;
            const versionedFilePath = pathModule.join(timelineFolderPath, versionedFileName);

            // Use the newest in-memory text for open files, otherwise read from disk
            let contentToSave: string;
            const inMemory = latestContentRef.current.get(targetFile.path);
            if (targetFile.path === currentFile?.path) {
                contentToSave = editorContent;
            } else if (inMemory !== undefined) {
                contentToSave = inMemory;
            } else {
                const readResult = await api.readFile( targetFile.path);
                if (!readResult.success) {
                    showNotification('Instant Backup Failed', `Failed to read file: ${readResult.error}`, 'error');
                    return;
                }
                contentToSave = readResult.content;
            }

            // Save versioned file
            const writeResult = await api.writeFile( versionedFilePath, contentToSave);
            if (!writeResult.success) {
                showNotification('Instant Backup Failed', `Failed to save backup: ${writeResult.error}`, 'error');
                return;
            }

            // Show success message in status bar
            showStatusMessage(`Instant Backup: ${versionedFileName} saved successfully`);

            // Trigger FileExplorer refresh to show the new timeline folder
            setFileExplorerRefreshTrigger(prev => prev + 1);
        } catch (error) {
            console.error('Instant Backup error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            showNotification('Instant Backup Failed', `Error: ${errorMessage}`, 'error');
        }
    }, [currentFile, editorContent, showNotification, showStatusMessage]);

    // `Openotex --open=<file>` while Openotex is running (e.g. from a coding
    // agent through the MCP server): show the file, switching project if needed.
    const openRequestHandlerRef = useRef<(request: { file: string; line?: number; project?: string; isDirectory?: boolean }) => Promise<void>>(async () => {});
    openRequestHandlerRef.current = async request => {
        const pathModule = (window as any).api.path;
        const targetProject = request.isDirectory
            ? request.file
            : (request.project ?? (projectPath && isSameOrInside(request.file, projectPath) ? projectPath : pathModule.dirname(request.file)));
        if (projectPath && samePath(targetProject, projectPath)) {
            if (!request.isDirectory) {
                handleSyncTexJump({ file: request.file, line: request.line ?? 1, column: 1 });
            }
            return;
        }
        if (!(await resolveUnsavedChanges())) {
            return;
        }
        if (currentFile) {
            await saveAnnotationsToFile(currentFile.path, annotationsRef.current);
        }
        resetWorkspace();
        markSessionReady(null);
        setProjectPath(targetProject);
        if (!request.isDirectory) {
            setPendingOpen({ file: request.file, line: request.line });
        }
    };
    useEffect(() => {
        const api = (window as any).api;
        if (!api?.onOpenRequest) {
            return;
        }
        return api.onOpenRequest((request: { file: string; line?: number; project?: string; isDirectory?: boolean }) => {
            void openRequestHandlerRef.current(request);
        });
    }, []);
    useEffect(() => {
        if (!pendingOpen || !projectPath || sessionReadyProject !== projectPath) {
            return;
        }
        const request = pendingOpen;
        setPendingOpen(null);
        handleSyncTexJump({ file: request.file, line: request.line ?? 1, column: 1 });
    }, [pendingOpen, projectPath, sessionReadyProject, handleSyncTexJump]);

    // Window close: save (Auto Save) or ask about unsaved files first.
    const closeHandlerRef = useRef<() => Promise<void>>(async () => {});
    closeHandlerRef.current = async () => {
        const api = (window as any).api;
        api.acknowledgeClose?.();
        try {
            const proceed = await resolveUnsavedChanges();
            if (!proceed) {
                await api.cancelClose?.();
                return;
            }
            const current = currentFileRef.current;
            if (current) {
                await saveAnnotationsToFile(current.path, annotationsRef.current);
            }
            await persistSession();
        }
        catch (error) {
            console.error('Error while preparing to close:', error);
        }
        await api.confirmClose?.();
    };
    useEffect(() => {
        const api = (window as any).api;
        if (!api?.onCloseRequested) {
            return;
        }
        return api.onCloseRequested(() => {
            void closeHandlerRef.current();
        });
    }, []);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (autoCompileTimeout.current) {
                clearTimeout(autoCompileTimeout.current);
            }
        };
    }, []);
    useEffect(() => {
        return () => {
            if (persistSessionTimeoutRef.current) {
                clearTimeout(persistSessionTimeoutRef.current);
            }
        };
    }, []);
    useEffect(() => {
        return () => {
            if (statusMessageTimeoutRef.current) {
                clearTimeout(statusMessageTimeoutRef.current);
            }
        };
    }, []);
    // Save user preferences
    useEffect(() => {
        try {
            localStorage.setItem('openotex:autoCompile', JSON.stringify(autoCompile));
        }
        catch (error) {
            console.error('Error saving autoCompile preference:', error);
        }
    }, [autoCompile]);
    useEffect(() => {
        try {
            localStorage.setItem('openotex:autoSave', JSON.stringify(autoSave));
        }
        catch (error) {
            console.error('Error saving autoSave preference:', error);
        }
    }, [autoSave]);
    useEffect(() => {
        try {
            localStorage.setItem('openotex:latexEngine', JSON.stringify(latexEngine));
        }
        catch (error) {
            console.error('Error saving latexEngine preference:', error);
        }
    }, [latexEngine]);
    useEffect(() => {
        try {
            localStorage.setItem('openotex:highlightColor', highlightColor);
        }
        catch (error) {
            console.error('Error saving highlightColor preference:', error);
        }
    }, [highlightColor]);
    useEffect(() => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => editorRef.current?.refreshAnnotations());
        } else {
            editorRef.current?.refreshAnnotations();
        }
    }, [annotationsHidden, annotations]);
    const keyboardActionsRef = useRef<Record<string, () => void>>({});
    keyboardActionsRef.current = {
        newProject: handleNewProject,
        openProject: () => { void handleOpenProject(); },
    };
    useEffect(() => {
        const handleKeydown = (event: KeyboardEvent) => {
            const primary = event.ctrlKey || event.metaKey;
            // Ctrl+` to toggle terminal
            if (primary && event.key === '`') {
                event.preventDefault();
                handleToggleTerminal();
            }
            // Ctrl+Shift+C to compile (keyboard layout independent)
            if (primary && event.shiftKey && event.code === 'KeyC') {
                event.preventDefault();
                if (isCurrentFileLatex) {
                    handleCompile();
                }
            }
            // Ctrl+S to save current file
            if (primary && !event.shiftKey && event.code === 'KeyS') {
                event.preventDefault();
                handleSaveCurrentFile();
            }
            // Ctrl+Shift+S to save all files
            if (primary && event.shiftKey && event.code === 'KeyS') {
                event.preventDefault();
                handleSaveAllFiles();
            }
            // Ctrl+Shift+V to create version freeze
            if (primary && event.shiftKey && event.code === 'KeyV') {
                event.preventDefault();
                handleVersionFreeze();
            }
            // Ctrl+Alt+J: SyncTeX forward search (source -> PDF)
            if (primary && event.altKey && event.code === 'KeyJ') {
                event.preventDefault();
                handleForwardSearch();
            }
            // Ctrl+N / Ctrl+O: new and open project (shown in the File menu)
            if (primary && !event.shiftKey && !event.altKey && event.code === 'KeyN') {
                event.preventDefault();
                keyboardActionsRef.current.newProject?.();
            }
            if (primary && !event.shiftKey && !event.altKey && event.code === 'KeyO') {
                event.preventDefault();
                keyboardActionsRef.current.openProject?.();
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [isCurrentFileLatex, handleCompile, handleToggleTerminal, handleSaveCurrentFile, handleSaveAllFiles, handleVersionFreeze, handleForwardSearch]);

    return (
        <div className="app">
        <MenuBar
            onNewProject={handleNewProject}
            onOpenProject={handleOpenProject}
            onSave={handleSaveCurrentFile}
            onSaveAll={handleSaveAllFiles}
            onCompile={handleCompile}
            canCompile={isCurrentFileLatex}
            onFind={handleFind}
            onReplace={handleReplace}
            onToggleTerminal={handleToggleTerminal}
            isTerminalVisible={isTerminalVisible}
            onToggleAutoCompile={toggleAutoCompile}
            isAutoCompileEnabled={autoCompile}
            themePreference={themePreference}
            resolvedTheme={resolvedTheme}
            onThemeChange={handleThemeChange}
            onToggleAutoSave={toggleAutoSave}
            isAutoSaveEnabled={autoSave}
            onShowAbout={() => setShowAboutDialog(true)}
            onShowMcp={() => setShowMcpDialog(true)}
        />
        <Toolbar
            currentFile={currentFile}
            onCompile={handleCompile}
            onNewProject={handleNewProject}
            onOpenProject={handleOpenProject}
            onVersionFreeze={handleVersionFreeze}
            onFind={handleFind}
            onReplace={handleReplace}
            canCompile={isCurrentFileLatex}
            onToggleAnnotations={handleToggleAnnotationsVisibility}
            areAnnotationsVisible={!annotationsHidden}
            hasAnnotations={annotations.length > 0}
            hasOpenFile={Boolean(currentFile && !currentFile.isDirectory)}
            onToggleStructureMap={handleToggleStructureMap}
            isStructureMapVisible={showStructureMap}
            canShowStructureMap={isCurrentFileLatex}
            latexEngine={latexEngine}
            onLatexEngineChange={handleLatexEngineChange}
        />
        <div className="workspace">
            <div className="main-container">
                <Split
                    className="split-container"
                    sizes={[20, 40, 40]}
                    minSize={[200, 400, 400]}
                    gutterSize={6}
                    gutterAlign="center"
                    direction="horizontal"
                    cursor="col-resize"
                >
                    <div className="panel file-explorer-panel">
                        <div className="panel-toggle">
                            <button
                                className={leftPanelTab === 'files' ? 'active' : ''}
                                onClick={() => setLeftPanelTab('files')}
                            >
                                Files
                            </button>
                            <button
                                className={leftPanelTab === 'git' ? 'active' : ''}
                                onClick={() => setLeftPanelTab('git')}
                            >
                                Git
                            </button>
                        </div>
                        <div className="panel-body">
                            {leftPanelTab === 'files' ? (
                                <FileExplorer
                                    onFileSelect={handleFileSelect}
                                    projectPath={projectPath}
                                    onZipFolder={handleSaveFolderAsZip}
                                    onVersionFreeze={handleVersionFreeze}
                                    onPathRenamed={handlePathRenamed}
                                    onPathDeleted={handlePathDeleted}
                                    refreshTrigger={fileExplorerRefreshTrigger}
                                    activeFilePath={currentFile?.path ?? null}
                                />
                            ) : (
                                <GitPanel projectPath={projectPath} />
                            )}
                        </div>
                    </div>
                    <div className="panel editor-panel">
                        <div className="editor-stack">
                            <TabBar
                                openTabs={openTabs}
                                activeTab={currentFile}
                                dirtyPaths={dirtyPaths}
                                onTabClick={handleTabClick}
                                onTabClose={handleTabClose}
                            />
                            <Editor
                                ref={editorRef}
                                content={editorContent}
                                onChange={handleContentChange}
                                currentFile={currentFile}
                                projectPath={projectPath}
                                openFilePaths={openFilePaths}
                                annotations={annotations}
                                annotationsHidden={annotationsHidden}
                                onAnnotate={handleAddHighlightAnnotation}
                                onRemoveAnnotation={handleRemoveAnnotation}
                                onEditAnnotation={handleEditAnnotation}
                                onCursorChange={handleCursorChange}
                                onSyncTexForwardSearch={handleForwardSearch}
                                theme={resolvedTheme}
                            />
                            {showAnnotationsPanel && (
                                <AnnotationPanel
                                    selectedColor={highlightColor}
                                    onColorChange={setHighlightColor}
                                    onAddHighlight={handleAddHighlightAnnotation}
                                    annotations={annotations}
                                    onRemoveAnnotation={handleRemoveAnnotation}
                                    onEditAnnotation={handleEditAnnotation}
                                    onFocusAnnotation={handleFocusAnnotation}
                                    canAnnotate={Boolean(currentFile && !currentFile.isDirectory)}
                                    annotationsHidden={annotationsHidden}
                                    onToggleVisibility={handleToggleAnnotationsVisibility}
                                    onRequestHide={() => setShowAnnotationsPanel(false)}
                                />
                            )}
                        </div>
                    </div>
                    <div className="panel preview-panel">
                        <div className="preview-layer" hidden={showStructureMap} style={{ height: '100%' }}>
                            <Preview
                                ref={previewRef}
                                content={editorContent}
                                compileNonce={compileNonce}
                                currentFileExtension={currentFileExtension}
                                currentFilePath={currentFile?.path ?? null}
                                projectPath={projectPath}
                                latexEngine={latexEngine}
                                beforeCompile={flushBeforeCompile}
                                onMissingPackages={handleMissingPackages}
                                onSyncTexJump={handleSyncTexJump}
                            />
                        </div>
                        <div className="structure-layer" hidden={!showStructureMap} style={{ height: '100%' }}>
                            {showStructureMap && (
                                <StructureMap
                                    content={editorContent}
                                    currentFileExtension={currentFileExtension}
                                    onNodeClick={handleStructureMapNodeClick}
                                />
                            )}
                        </div>
                    </div>
                </Split>
            </div>
        </div>
        <TerminalPanel
            isVisible={isTerminalVisible}
            onToggle={handleToggleTerminal}
            projectPath={projectPath}
        />
        <AnnotationDialog
            isOpen={highlightDialog.isOpen}
            title={highlightDialog.mode === 'edit' ? 'Edit Highlight' : 'Add Highlight'}
            snippet={highlightDialog.snippet}
            initialColor={highlightDialog.defaultColor}
            initialComment={highlightDialog.defaultComment}
            confirmLabel={highlightDialog.mode === 'edit' ? 'Save Changes' : 'Save Highlight'}
            deleteLabel="Delete Highlight"
            onConfirm={handleHighlightDialogConfirm}
            onCancel={handleHighlightDialogCancel}
            onDelete={highlightDialog.mode === 'edit' ? handleDeleteAnnotationFromDialog : undefined}
        />
            <NotificationDialog
                isOpen={notification.isOpen}
                title={notification.title}
                message={notification.message}
                type={notification.type}
                onClose={() => setNotification(prev => ({ ...prev, isOpen: false }))}
            />
        <PackageInstallDialog
            isOpen={showPackageDialog}
            missingPackages={missingPackages}
            onInstall={handleInstallPackages}
            onClose={handleClosePackageDialog}
        />
        <AboutDialog isOpen={showAboutDialog} onClose={() => setShowAboutDialog(false)} />
        <McpDialog isOpen={showMcpDialog} onClose={() => setShowMcpDialog(false)} />
        <NewProjectDialog
            isOpen={showNewProjectDialog}
            defaultDirectory={defaultProjectsDirectory}
            templates={PROJECT_TEMPLATES}
            onConfirm={handleCreateNewProject}
            onCancel={() => setShowNewProjectDialog(false)}
        />
        <StatusBar
            autoCompile={autoCompile}
            autoSave={autoSave}
            unsavedCount={dirtyPaths.size}
            onToggleAutoCompile={toggleAutoCompile}
            onToggleAutoSave={toggleAutoSave}
            statusMessage={statusMessage}
        />
    </div>
    );
};

const App: React.FC = () => (
    <ProjectProvider>
        <AppContent />
    </ProjectProvider>
);

export default App;
