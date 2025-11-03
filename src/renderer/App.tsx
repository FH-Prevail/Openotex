import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import Split from 'react-split';
import FileExplorer from './components/FileExplorer';
import Editor, { EditorHandle } from './components/Editor';
import Preview from './components/Preview';
import StructureMap from './components/StructureMap';
import Toolbar from './components/Toolbar';
import MenuBar from './components/MenuBar';
import NotificationDialog from './components/NotificationDialog';
import TerminalPanel from './components/TerminalPanel';
import AnnotationPanel from './components/AnnotationPanel';
import TabBar from './components/TabBar';
import PackageInstallDialog from './components/PackageInstallDialog';
import AboutDialog from './components/AboutDialog';
import AnnotationDialog from './components/AnnotationDialog';
import NewProjectDialog from './components/NewProjectDialog';
import StatusBar from './components/StatusBar';
import { Annotation, AnnotationRange } from '../types/annotations';
import './styles/App.css';

type ThemePreference = 'system' | 'dark' | 'light';
type NotificationType = 'success' | 'error' | 'info';

interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    content?: string;
}

interface CursorPosition {
    lineNumber: number;
    column: number;
}

interface PendingCursor {
    path: string;
    position: CursorPosition;
}

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

const App: React.FC = () => {
    const [currentFile, setCurrentFile] = useState<FileNode | null>(null);
    const [openTabs, setOpenTabs] = useState<FileNode[]>([]);
    const [tabContents, setTabContents] = useState<Map<string, string>>(new Map());
    const [editorContent, setEditorContent] = useState('');
    const [compiledOutput, setCompiledOutput] = useState('');
    const [projectPath, setProjectPath] = useState('');
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
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [annotationsHidden, setAnnotationsHidden] = useState<boolean>(true);
    const annotationsRef = useRef<Annotation[]>([]);
    const cursorPositionsRef = useRef<Map<string, CursorPosition>>(new Map());
    const pendingCursorRef = useRef<PendingCursor | null>(null);
    const persistSessionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const restoredSessionProjectRef = useRef<string | null>(null);
    const [tabAnnotations, setTabAnnotations] = useState<Map<string, Annotation[]>>(new Map());
    const [highlightColor, setHighlightColor] = useState<string>(() => {
        try {
            return localStorage.getItem('openotex:highlightColor') || '#f8e71c';
        }
        catch {
            return '#f8e71c';
        }
    });
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
    const [fileExplorerRefreshTrigger, setFileExplorerRefreshTrigger] = useState<number>(0);
    const [showStructureMap, setShowStructureMap] = useState<boolean>(false);
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
        return currentFileExtension === 'tex' || currentFileExtension === 'latex';
    }, [currentFileExtension]);
    useEffect(() => {
        annotationsRef.current = annotations;
    }, [annotations]);
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
    const detectMissingPackages = (errorLog: string): string[] => {
        const packages = new Set();
        // Pattern: ! LaTeX Error: File `package.sty' not found.
        const pattern1 = /File `([^']+)\.sty' not found/gi;
        let match;
        while ((match = pattern1.exec(errorLog)) !== null) {
            packages.add(match[1]);
        }
        // Pattern: ! LaTeX Error: Missing \usepackage{package}
        const pattern2 = /Missing \\usepackage\{([^}]+)\}/gi;
        while ((match = pattern2.exec(errorLog)) !== null) {
            packages.add(match[1]);
        }
        // Pattern: Package package not found
        const pattern3 = /Package ([a-zA-Z0-9\-]+) not found/gi;
        while ((match = pattern3.exec(errorLog)) !== null) {
            packages.add(match[1]);
        }
        return Array.from(packages) as string[];
    };
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
    const handleOpenProject = async () => {
        const api = (window as any).api;
        const result = await api.openDirectoryDialog();
        if (result.success && !result.canceled && result.filePaths.length > 0) {
            restoredSessionProjectRef.current = null;
            cursorPositionsRef.current = new Map();
            pendingCursorRef.current = null;
            setProjectPath(result.filePaths[0]);
            setCurrentFile(null);
            setOpenTabs([]);
            setTabContents(new Map());
            setTabAnnotations(new Map());
            setEditorContent('');
            setCompiledOutput('');
            setAnnotations([]);
            setShowAnnotationsPanel(false);
            setAnnotationsHidden(true);
        }
    };

    const handleNewProject = async () => {
        // Save and close all open files
        if (currentFile && openTabs.length > 0) {
            // Save current file
            const api = (window as any).api;
            if (autoSave) {
                await api.writeFile( currentFile.path, editorContent);
            }

            // Save all tab contents
            for (const [filePath, content] of tabContents.entries()) {
                await api.writeFile( filePath, content);
            }

            // Save annotations
            if (currentFile) {
                await saveAnnotationsToFile(currentFile.path, annotations);
            }
        }

        // Close all tabs
        setOpenTabs([]);
        setCurrentFile(null);
        setTabContents(new Map());
        setTabAnnotations(new Map());
        setEditorContent('');
        setCompiledOutput('');
        setAnnotations([]);
        setShowAnnotationsPanel(false);
        setAnnotationsHidden(true);

        // Show new project dialog
        setShowNewProjectDialog(true);
    };

    const handleCreateNewProject = async (projectName: string, directory: string) => {
        try {
            const api = (window as any).api;
            const pathModule = (window as any).api.path;

            // Create project directory
            const projectPath = pathModule.join(directory, projectName);
            const createDirResult = await api.createDirectory( projectPath);

            if (!createDirResult.success) {
                showNotification('Error', `Failed to create project directory: ${createDirResult.error}`, 'error');
                return;
            }

            // Create main.tex with basic template
            const mainTexPath = pathModule.join(projectPath, 'main.tex');
            const latexTemplate = `\\documentclass[12pt,a4paper]{article}

% Essential packages
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{hyperref}

% Document metadata
\\title{${projectName}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Write your content here.

\\section{Conclusion}

Your conclusions go here.

\\end{document}
`;

            const writeResult = await api.writeFile( mainTexPath, latexTemplate);

            if (!writeResult.success) {
                showNotification('Error', `Failed to create main.tex: ${writeResult.error}`, 'error');
                return;
            }

            // Set the project path and open main.tex
            restoredSessionProjectRef.current = null;
            cursorPositionsRef.current = new Map();
            pendingCursorRef.current = null;
            setProjectPath(projectPath);

            // Open main.tex file
            const mainTexFile: FileNode = {
                name: 'main.tex',
                path: mainTexPath,
                isDirectory: false,
            };

            setOpenTabs([mainTexFile]);
            setCurrentFile(mainTexFile);
            setEditorContent(latexTemplate);
            setCompiledOutput(latexTemplate);
            setTabContents(new Map([[mainTexPath, latexTemplate]]));
            setAnnotations([]);

            setShowNewProjectDialog(false);
            showNotification('Project Created', `Successfully created project "${projectName}"`, 'success');
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
                        const childFolder = destination.folder(file.name) ?? destination;
                        await addFilesToZip(file.path, childFolder);
                    }
                    else {
                        const fileResult = await api.readFileBase64( file.path);
                        if (fileResult.success && fileResult.data) {
                            destination.file(file.name, fileResult.data, { base64: true });
                        }
                    }
                }
            };
            await addFilesToZip(folderPath, rootFolder);
            const zipContent = await zip.generateAsync({ type: 'base64' });
            const defaultPath = path.join(path.dirname(folderPath), `${folderName}.zip`);
            const saveResult = await (window as any).api.saveZipFile({
                defaultPath,
                data: zipContent,
            });
            if (saveResult.success) {
                showNotification('Folder Archived', `Saved ${folderName}.zip`, 'success');
            }
            else if (!saveResult.canceled) {
                throw new Error(saveResult.error || 'Unknown error while saving ZIP');
            }
        }
        catch (error) {
            console.error('ZIP export error:', error);
            showNotification('Export Failed', 'Failed to export folder as ZIP. Please try again.', 'error');
        }
    }, [showNotification]);
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
        setAutoSave(prev => !prev);
    }, []);
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
        if (!projectPath) {
            return;
        }
        try {
            const pathModule = (window as any).api.path;
            const api = (window as any).api;
            const sessionPath = pathModule.join(projectPath, SESSION_FILENAME);
            if (openTabs.length === 0) {
                await api.deletePath( sessionPath);
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
            return;
        }
        restoredSessionProjectRef.current = projectRoot;
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
        const restoredTabs = [];
        const restoredContents = new Map();
        const restoredAnnotations = new Map();
        const missingPaths = [];
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
        const activeExt = pathModule.extname(activeFile.path).toLowerCase();
        const activeIsLatex = activeExt === '.tex' || activeExt === '.latex';
        setCompiledOutput(activeIsLatex ? activeContent : '');
        setAnnotations(activeAnnotations);
        if (missingPaths.length > 0) {
            const message = missingPaths.length === 1
                ? `Skipped missing file: ${missingPaths[0]}`
                : `Skipped ${missingPaths.length} missing files from the previous session.`;
            showNotification('Files Missing', message, 'info');
        }
    }, [currentFile, loadAnnotationsFromFile, openTabs, showNotification]);
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
    const handleFileSelect = async (file: FileNode) => {
        if (file.isDirectory) {
            return;
        }
        const fileExt = file.name.split('.').pop()?.toLowerCase() ?? '';
        const fileIsLatex = fileExt === 'tex' || fileExt === 'latex';
        // Save current tab content and annotations before switching
        if (currentFile) {
            setTabContents(prev => {
                const newMap = new Map(prev);
                newMap.set(currentFile.path, editorContent);
                return newMap;
            });
            setTabAnnotations(prev => {
                const newMap = new Map(prev);
                newMap.set(currentFile.path, annotations);
                return newMap;
            });
            // Save current annotations to metadata file
            await saveAnnotationsToFile(currentFile.path, annotations);
        }
        // Check if file is already open in a tab
        const existingTab = openTabs.find(tab => tab.path === file.path);
        const storedPosition = cursorPositionsRef.current.get(file.path);
        pendingCursorRef.current = {
            path: file.path,
            position: storedPosition ?? { lineNumber: 1, column: 1 },
        };
        if (existingTab) {
            // Switch to existing tab
            setCurrentFile(file);
            const savedContent = tabContents.get(file.path);
            const savedAnnotations = tabAnnotations.get(file.path);
            if (savedContent !== undefined) {
                setEditorContent(savedContent);
                setCompiledOutput(fileIsLatex ? savedContent : '');
            }
            if (savedAnnotations) {
                setAnnotations(savedAnnotations);
            }
            else {
                // Load from metadata file if not in memory
                const loadedAnnotations = await loadAnnotationsFromFile(file.path);
                setAnnotations(loadedAnnotations);
                setTabAnnotations(prev => {
                    const newMap = new Map(prev);
                    newMap.set(file.path, loadedAnnotations);
                    return newMap;
                });
            }
            focusEditor();
            return;
        }
        else {
            // Open new tab
            const api = (window as any).api;
            const result = await api.readFile( file.path);
            if (result.success) {
                // Load annotations from metadata file
                const loadedAnnotations = await loadAnnotationsFromFile(file.path);
                setOpenTabs(prev => [...prev, file]);
                setCurrentFile(file);
                setEditorContent(result.content);
                setCompiledOutput(fileIsLatex ? result.content : '');
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
            }
            else {
                pendingCursorRef.current = null;
            }
        }
    };
    const handleTabClick = async (file: FileNode) => {
        if (currentFile?.path === file.path) {
            return;
        }
        const fileExt = file.name.split('.').pop()?.toLowerCase() ?? '';
        const fileIsLatex = fileExt === 'tex' || fileExt === 'latex';
        // Save current tab content and annotations
        if (currentFile) {
            setTabContents(prev => {
                const newMap = new Map(prev);
                newMap.set(currentFile.path, editorContent);
                return newMap;
            });
            setTabAnnotations(prev => {
                const newMap = new Map(prev);
                newMap.set(currentFile.path, annotations);
                return newMap;
            });
            // Save to metadata file
            await saveAnnotationsToFile(currentFile.path, annotations);
        }
        const storedPosition = cursorPositionsRef.current.get(file.path);
        pendingCursorRef.current = {
            path: file.path,
            position: storedPosition ?? { lineNumber: 1, column: 1 },
        };
        // Switch to clicked tab
        setCurrentFile(file);
        const savedContent = tabContents.get(file.path) || '';
        const savedAnnotations = tabAnnotations.get(file.path);
        setEditorContent(savedContent);
        setCompiledOutput(fileIsLatex ? savedContent : '');
        if (savedAnnotations) {
            setAnnotations(savedAnnotations);
        }
        else {
            // Load from metadata file if not in memory
            const loadedAnnotations = await loadAnnotationsFromFile(file.path);
            setAnnotations(loadedAnnotations);
            setTabAnnotations(prev => {
                const newMap = new Map(prev);
                newMap.set(file.path, loadedAnnotations);
                return newMap;
            });
        }
        focusEditor();
    };
    const handleTabClose = async (file: FileNode, event: React.MouseEvent) => {
        event.stopPropagation();
        // Save annotations before closing if this is the current file
        if (currentFile?.path === file.path) {
            await saveAnnotationsToFile(file.path, annotations);
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
            if (newTabs.length > 0) {
                // Switch to the tab to the left, or the first tab if closing the leftmost
                const newIndex = tabIndex > 0 ? tabIndex - 1 : 0;
                const newCurrentFile = newTabs[newIndex];
                const storedPosition = cursorPositionsRef.current.get(newCurrentFile.path);
                pendingCursorRef.current = {
                    path: newCurrentFile.path,
                    position: storedPosition ?? { lineNumber: 1, column: 1 },
                };
                setCurrentFile(newCurrentFile);
                const savedContent = tabContents.get(newCurrentFile.path) || '';
                const savedAnnotations = tabAnnotations.get(newCurrentFile.path);
                setEditorContent(savedContent);
                const newExt = newCurrentFile.name.split('.').pop()?.toLowerCase() ?? '';
                const newIsLatex = newExt === 'tex' || newExt === 'latex';
                setCompiledOutput(newIsLatex ? savedContent : '');
                if (savedAnnotations) {
                    setAnnotations(savedAnnotations);
                }
                else {
                    // Load from metadata file
                    const loadedAnnotations = await loadAnnotationsFromFile(newCurrentFile.path);
                    setAnnotations(loadedAnnotations);
                }
                focusEditor();
            }
            else {
                // No more tabs open
                setCurrentFile(null);
                setEditorContent('');
                setCompiledOutput('');
                setAnnotations([]);
                setShowAnnotationsPanel(false);
                setAnnotationsHidden(true);
                pendingCursorRef.current = null;
            }
        }
    };
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
                showNotification(trimmedComment ? 'Annotation Updated' : 'Highlight Updated', trimmedComment
                    ? 'Saved your updated comment and highlight color.'
                    : 'Saved your updated highlight color.', 'success');
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
            if (highlightDialog.mode === 'create') {
                setShowAnnotationsPanel(true);
            }
            showNotification(trimmedComment ? 'Highlight & Comment Saved' : 'Highlight Saved', trimmedComment
                ? 'Stored your highlight and comment in the project metadata.'
                : 'Stored your highlight in the project metadata.', 'success');
        }
        resetHighlightDialog();
    }, [annotations, currentFile, highlightDialog, resetHighlightDialog, setHighlightColor, showNotification, updateAnnotations]);
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
            showNotification('Highlight Removed', 'Removed the highlight and updated the metadata.', 'success');
        }
    }, [annotations, currentFile, showNotification, updateAnnotations]);
    const handleDeleteAnnotationFromDialog = useCallback(() => {
        if (highlightDialog.mode === 'edit' && highlightDialog.annotationId) {
            handleRemoveAnnotation(highlightDialog.annotationId);
        }
        resetHighlightDialog();
    }, [handleRemoveAnnotation, highlightDialog, resetHighlightDialog]);
    const handleRemoveSelectionHighlight = useCallback(() => {
        if (!editorRef.current || !currentFile) {
            showNotification('No Editor', 'Open a file to remove highlights.', 'info');
            return;
        }
        const selection = editorRef.current.getSelection();
        if (!selection) {
            showNotification('No Selection', 'Click on or select highlighted text to remove the highlight.', 'info');
            return;
        }
        const match = findAnnotationAtCursor(selection, annotations);
        if (!match) {
            showNotification('No Highlight Found', 'The current selection is not highlighted.', 'info');
            return;
        }
        const updated = updateAnnotations(prev => prev.filter(annotation => annotation.id !== match.id));
        if (updated) {
            showNotification('Highlight Removed', 'Removed the highlight and updated the metadata.', 'success');
        }
    }, [annotations, currentFile, showNotification, updateAnnotations]);
    const handleCursorChange = useCallback((position: CursorPosition) => {
        if (!currentFile) {
            return;
        }
        cursorPositionsRef.current.set(currentFile.path, position);
        schedulePersistSession();
    }, [currentFile, schedulePersistSession]);
    const handleFocusAnnotation = useCallback((annotation: Annotation) => {
        editorRef.current?.revealRange(annotation.range);
    }, []);
    const handleInstallPackage = async (packageName: string): Promise<void> => {
        const api = (window as any).api;
        try {
            showNotification('Installing Package', `Installing ${packageName}...`, 'info');
            const result = await api.installLatexPackage( packageName);
            if (result.success) {
                showNotification('Package Installed', `${packageName} installed successfully!`, 'success');
                setMissingPackages(prev => prev.filter(pkg => pkg !== packageName));
            }
            else {
                showNotification('Installation Failed', result.error || `Failed to install ${packageName}`, 'error');
            }
        }
        catch (error) {
            showNotification('Installation Error', `Error installing ${packageName}: ${error}`, 'error');
        }
    };
    const handleInstallAllPackages = async (): Promise<void> => {
        const api = (window as any).api;
        const remaining = new Set(missingPackages);
        for (const pkg of missingPackages) {
            try {
                showNotification('Installing Package', `Installing ${pkg}...`, 'info');
                const result = await api.installLatexPackage( pkg);
                if (result.success) {
                    remaining.delete(pkg);
                }
                else {
                    showNotification('Installation Failed', result.error || `Failed to install ${pkg}`, 'error');
                    break;
                }
            }
            catch (error) {
                showNotification('Installation Error', `Error installing ${pkg}: ${error}`, 'error');
                break;
            }
        }
        const remainingList = Array.from(remaining);
        setMissingPackages(remainingList);
        if (remainingList.length === 0) {
            showNotification('All Packages Installed', 'All packages installed successfully!', 'success');
            setShowPackageDialog(false);
        }
    };
    const handleMissingPackages = useCallback((packages: string[]) => {
        setMissingPackages(packages);
        setShowPackageDialog(true);
    }, []);
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
                            const CURRENT_VERSION = '1.0.1';
                            const VERSION_CHECK_URL = 'https://openotex.com/downloads/Openotex-Setup-';
                            const DOWNLOAD_PAGE_URL = 'https://openotex.com/#download';

                            let latestVersion = CURRENT_VERSION;
                            let foundUpdate = false;

                            const compareVersions = (v1: string, v2: string): number => {
                                const parts1 = v1.split('.').map(Number);
                                const parts2 = v2.split('.').map(Number);

                                for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                                    const part1 = parts1[i] || 0;
                                    const part2 = parts2[i] || 0;

                                    if (part1 > part2) return 1;
                                    if (part1 < part2) return -1;
                                }

                                return 0;
                            };

                            try {
                                const versionResponse = await fetch('https://openotex.com/version.json');
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
                                    `A new version (${latestVersion}) of Openotex is available!\n\nYou are currently running version ${CURRENT_VERSION}.\n\nWould you like to visit the download page?\n\n(You can disable automatic update checks in Help > About)`
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
    const handleContentChange = (content: string) => {
        setEditorContent(content);
        // Update tab content map
        if (currentFile) {
            setTabContents(prev => {
                const newMap = new Map(prev);
                newMap.set(currentFile.path, content);
                return newMap;
            });
        }
        // Auto-save
        if (autoSave && currentFile && !currentFile.isDirectory) {
            const api = (window as any).api;
            api.writeFile( currentFile.path, content);
        }
        if (!isCurrentFileLatex) {
            if (autoCompileTimeout.current) {
                clearTimeout(autoCompileTimeout.current);
                autoCompileTimeout.current = null;
            }
            setCompiledOutput('');
            return;
        }
        // Auto-compile with debounce
        if (autoCompile) {
            if (autoCompileTimeout.current) {
                clearTimeout(autoCompileTimeout.current);
            }
            autoCompileTimeout.current = setTimeout(() => {
                setCompiledOutput(content);
            }, 3000); // Compile after 3 seconds of inactivity
        }
    };
    const handleCompile = useCallback(() => {
        if (!isCurrentFileLatex) {
            return;
        }
        setCompiledOutput(editorContent);
    }, [editorContent, isCurrentFileLatex]);

    const handleSaveCurrentFile = useCallback(async () => {
        if (!currentFile || currentFile.isDirectory) {
            showNotification('No File Open', 'Open a file to save it.', 'info');
            return;
        }

        try {
            const api = (window as any).api;
            await api.writeFile( currentFile.path, editorContent);
            showNotification('File Saved', `Saved ${currentFile.name}`, 'success');
        } catch (error) {
            showNotification('Save Failed', `Failed to save ${currentFile.name}: ${error}`, 'error');
        }
    }, [currentFile, editorContent, showNotification]);

    const handleSaveAllFiles = useCallback(async () => {
        if (openTabs.length === 0) {
            showNotification('No Files Open', 'No files to save.', 'info');
            return;
        }

        try {
            const api = (window as any).api;
            let savedCount = 0;

            // Save current file first
            if (currentFile && !currentFile.isDirectory) {
                await api.writeFile( currentFile.path, editorContent);
                savedCount++;
            }

            // Save all other open tabs
            for (const [filePath, content] of tabContents.entries()) {
                if (filePath !== currentFile?.path) {
                    await api.writeFile( filePath, content);
                    savedCount++;
                }
            }

            showNotification('All Files Saved', `Saved ${savedCount} file${savedCount !== 1 ? 's' : ''}`, 'success');
        } catch (error) {
            showNotification('Save Failed', `Failed to save files: ${error}`, 'error');
        }
    }, [currentFile, editorContent, openTabs, tabContents, showNotification]);

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

            // Create timeline folder name
            const timelineFolderName = `${fileName}_timeline_`;
            const timelineFolderPath = pathModule.join(fileDir, timelineFolderName);

            // Create timeline folder if it doesn't exist
            const createDirResult = await api.createDirectory( timelineFolderPath);
            if (!createDirResult.success && !createDirResult.error?.includes('already exists')) {
                showNotification('Version Freeze Failed', `Failed to create timeline folder: ${createDirResult.error}`, 'error');
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
            const versionedFileName = `${fileNameWithoutExt}_${timestamp}${fileExt}`;
            const versionedFilePath = pathModule.join(timelineFolderPath, versionedFileName);

            // Get content to save (from editor if it's the current file, otherwise read from disk)
            let contentToSave: string;
            if (targetFile.path === currentFile?.path) {
                contentToSave = editorContent;
            } else {
                const readResult = await api.readFile( targetFile.path);
                if (!readResult.success) {
                    showNotification('Version Freeze Failed', `Failed to read file: ${readResult.error}`, 'error');
                    return;
                }
                contentToSave = readResult.content;
            }

            // Save versioned file
            const writeResult = await api.writeFile( versionedFilePath, contentToSave);
            if (!writeResult.success) {
                showNotification('Version Freeze Failed', `Failed to save version: ${writeResult.error}`, 'error');
                return;
            }

            // Show success message in status bar
            showStatusMessage(`Version Freeze: ${versionedFileName} saved successfully`);

            // Trigger FileExplorer refresh to show the new timeline folder
            setFileExplorerRefreshTrigger(prev => prev + 1);
        } catch (error) {
            console.error('Version Freeze error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            showNotification('Version Freeze Failed', `Error: ${errorMessage}`, 'error');
        }
    }, [currentFile, editorContent, showNotification, showStatusMessage]);

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
    useEffect(() => {
        const handleKeydown = (event: KeyboardEvent) => {
            // Ctrl+` to toggle terminal
            if ((event.ctrlKey || event.metaKey) && event.key === '`') {
                event.preventDefault();
                handleToggleTerminal();
            }
            // Ctrl+Shift+C to compile (keyboard layout independent)
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyC') {
                event.preventDefault();
                if (isCurrentFileLatex) {
                    handleCompile();
                }
            }
            // Ctrl+S to save current file
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.code === 'KeyS') {
                event.preventDefault();
                handleSaveCurrentFile();
            }
            // Ctrl+Shift+S to save all files
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyS') {
                event.preventDefault();
                handleSaveAllFiles();
            }
            // Ctrl+Shift+V to create version freeze
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyV') {
                event.preventDefault();
                handleVersionFreeze();
            }
        };
        window.addEventListener('keydown', handleKeydown);
        return () => window.removeEventListener('keydown', handleKeydown);
    }, [isCurrentFileLatex, handleCompile, handleToggleTerminal, handleSaveCurrentFile, handleSaveAllFiles, handleVersionFreeze]);
    // Auto-save effect
    useEffect(() => {
        if (!autoSave || !projectPath)
            return;
        const autoSaveInterval = setInterval(async () => {
            const api = (window as any).api;
            const path = (window as any).api.path;
            try {
                // Get all LaTeX-related files in the project directory
                const getAllFiles = async (dirPath: string): Promise<string[]> => {
                    const result = await api.readDirectory( dirPath);
                    if (!result.success)
                        return [];
                    const files: string[] = [];
                    for (const file of result.files) {
                        if (file.isDirectory) {
                            // Recursively get files from subdirectories
                            const subFiles = await getAllFiles(file.path);
                            files.push(...subFiles);
                        }
                        else {
                            // Check if it's a LaTeX-related file
                            const ext = path.extname(file.name).toLowerCase();
                            if (['.tex', '.bib', '.cls', '.sty', '.bst', '.dtx', '.ins'].includes(ext)) {
                                files.push(file.path);
                            }
                        }
                    }
                    return files;
                };
                const latexFiles = await getAllFiles(projectPath);
                // Save all files that are currently open in tabs
                for (const [filePath, content] of tabContents.entries()) {
                    if (latexFiles.includes(filePath)) {
                        await api.writeFile( filePath, content);
                    }
                }
                // Also save the current file if it's not already saved
                if (currentFile && !currentFile.isDirectory) {
                    const ext = path.extname(currentFile.name).toLowerCase();
                    if (['.tex', '.bib', '.cls', '.sty', '.bst', '.dtx', '.ins'].includes(ext)) {
                        await api.writeFile( currentFile.path, editorContent);
                    }
                }
            }
            catch (error) {
                console.error('Auto-save error:', error);
            }
        }, 60000); // 1 minute = 60000ms
        return () => clearInterval(autoSaveInterval);
    }, [autoSave, projectPath, tabContents, currentFile, editorContent]);

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
                        <FileExplorer
                            onFileSelect={handleFileSelect}
                            projectPath={projectPath}
                            onZipFolder={handleSaveFolderAsZip}
                            onVersionFreeze={handleVersionFreeze}
                            refreshTrigger={fileExplorerRefreshTrigger}
                        />
                    </div>
                    <div className="panel editor-panel">
                        <div className="editor-stack">
                            <TabBar
                                openTabs={openTabs}
                                activeTab={currentFile}
                                onTabClick={handleTabClick}
                                onTabClose={handleTabClose}
                            />
                            <Editor
                                ref={editorRef}
                                content={editorContent}
                                onChange={handleContentChange}
                                currentFile={currentFile}
                                annotations={annotations}
                                annotationsHidden={annotationsHidden}
                                onAnnotate={handleAddHighlightAnnotation}
                                onRemoveAnnotation={handleRemoveAnnotation}
                                onEditAnnotation={handleEditAnnotation}
                                onCursorChange={handleCursorChange}
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
                        {showStructureMap ? (
                            <StructureMap
                                content={editorContent}
                                currentFileExtension={currentFileExtension}
                                onNodeClick={handleStructureMapNodeClick}
                            />
                        ) : (
                            <Preview
                                content={editorContent}
                                compiledOutput={compiledOutput}
                                currentFileExtension={currentFileExtension}
                                currentFilePath={currentFile?.path ?? null}
                                latexEngine={latexEngine}
                                onMissingPackages={handleMissingPackages}
                            />
                        )}
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
            onInstall={handleInstallPackage}
            onInstallAll={handleInstallAllPackages}
            onClose={() => setShowPackageDialog(false)}
        />
        <AboutDialog isOpen={showAboutDialog} onClose={() => setShowAboutDialog(false)} />
        <NewProjectDialog
            isOpen={showNewProjectDialog}
            defaultDirectory={defaultProjectsDirectory}
            onConfirm={handleCreateNewProject}
            onCancel={() => setShowNewProjectDialog(false)}
        />
        <StatusBar
            autoCompile={autoCompile}
            autoSave={autoSave}
            onToggleAutoCompile={toggleAutoCompile}
            onToggleAutoSave={toggleAutoSave}
            statusMessage={statusMessage}
        />
    </div>
    );
};

export default App;

