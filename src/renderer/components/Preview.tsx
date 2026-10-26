import React, { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  FiRefreshCw,
  FiZoomIn,
  FiZoomOut,
  FiDownload,
  FiAlertCircle,
  FiAlertTriangle,
  FiHelpCircle,
  FiMaximize2,
  FiExternalLink,
  FiChevronDown,
  FiChevronRight,
} from 'react-icons/fi';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import NotificationDialog from './NotificationDialog';
import CommandSnippet from './CommandSnippet';
import type { LatexDiagnostic } from '../../shared/latexDiagnostics';
import '../styles/Preview.css';
import '../styles/Preview-addon.css';

// The worker is copied to the dist output folder by CopyWebpackPlugin.
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';

type SynctexRect = { page: number; h: number; v: number; W: number; H: number };

// One placeholder per PDF page. Canvases are only created for pages near the
// visible area and released again when scrolled far away, so long documents
// do not hold hundreds of full-resolution bitmaps.
type PageSlot = {
  pageNum: number;
  wrapper: HTMLDivElement;
  rendered: boolean;
  rendering: boolean;
  task: RenderTask | null;
};

const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const ZOOM_STORAGE_KEY = 'openotex:pdfZoom';

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)));

export interface PreviewHandle {
  forwardSearch: (line: number, column?: number) => Promise<void>;
}

interface PreviewProps {
  content: string;
  compileNonce: number;
  currentFileExtension: string | null;
  currentFilePath: string | null;
  projectPath?: string;
  latexEngine?: 'pdflatex' | 'xelatex' | 'lualatex';
  beforeCompile?: (explicit?: boolean) => Promise<void>;
  // `explicit` reopens the install dialog even if the user closed it.
  onMissingPackages?: (packages: string[], explicit?: boolean) => void;
  onSyncTexJump?: (target: { file: string; line: number; column: number }) => void;
}

const fileNameOf = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath;
const dirNameOf = (filePath: string) => filePath.replace(/[\\/][^\\/]*$/, '');

const Preview = forwardRef<PreviewHandle, PreviewProps>(({
  content,
  compileNonce,
  currentFileExtension,
  currentFilePath,
  projectPath,
  latexEngine = 'pdflatex',
  beforeCompile,
  onMissingPackages,
  onSyncTexJump,
}, ref) => {
  const [pdfData, setPdfData] = useState<string>('');
  const [pdfPath, setPdfPath] = useState<string>('');
  const [rootFile, setRootFile] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [compilationStatus, setCompilationStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  // 'info' when the file is not a compilable document (not a LaTeX error).
  const [errorKind, setErrorKind] = useState<'error' | 'info'>('error');
  const [compilationLog, setCompilationLog] = useState<string>('');
  const [diagnostics, setDiagnostics] = useState<LatexDiagnostic[]>([]);
  const [showWarnings, setShowWarnings] = useState(false);
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(ZOOM_STORAGE_KEY));
      return Number.isFinite(saved) && saved > 0 ? clampZoom(saved) : 100;
    } catch {
      return 100;
    }
  });
  const [latexInstalled, setLatexInstalled] = useState<boolean | null>(null);
  const [latexVersion, setLatexVersion] = useState<string>('');
  const [latexInstallSuggestion, setLatexInstallSuggestion] = useState<{ message: string; command?: string } | null>(null);
  // How to install what the last compilation was missing, and what that was.
  const [installHint, setInstallHint] = useState<{ message: string; command?: string } | null>(null);
  const [missingPackageNames, setMissingPackageNames] = useState<string[]>([]);
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
  });

  const fileExtension = useMemo(
    () => (currentFileExtension ? currentFileExtension.toLowerCase() : ''),
    [currentFileExtension]
  );
  const isLatexFile = fileExtension === 'tex' || fileExtension === 'latex' || fileExtension === 'ltx';
  const isMarkdownFile = fileExtension === 'md' || fileExtension === 'markdown';
  const engineSuggestion = useMemo(() => {
    if (!isLatexFile || latexEngine === 'pdflatex') return '';
    if (/\\documentclass(?:\[[^\]]*\])?\{IEEEtran\}/i.test(content)) {
      return 'IEEEtran templates are normally compiled with pdfLaTeX. Switch engines if you do not need Unicode or system fonts.';
    }
    return '';
  }, [content, isLatexFile, latexEngine]);

  const warningDiagnostics = useMemo(
    () => (error ? [] : diagnostics.filter(diagnostic => diagnostic.severity !== 'info')),
    [diagnostics, error]
  );

  const latestCompileRequestRef = useRef(0);
  // Root document of the PDF currently shown (the compiled main file).
  const lastSuccessfulRootRef = useRef<string | null>(null);

  // pdfjs state
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Scroll position to restore after re-render (pixels, saved before each render)
  const savedScrollRef = useRef(0);
  // Monotonically increasing counter; incremented on each render start so that
  // a superseded render can detect it has been cancelled.
  const renderVersionRef = useRef(0);
  // Previous zoom level, used to scale the saved scroll position proportionally.
  const prevZoomRef = useRef(zoom);
  // SyncTeX: per-page wrapper elements, indexed by pageNum (1-based).
  const pageWrappersRef = useRef<Array<HTMLDivElement | null>>([]);
  const slotsRef = useRef<PageSlot[]>([]);
  const observerRef = useRef<IntersectionObserver | null>(null);
  // Width of page 1 at 100%, used by "fit width".
  const baseWidthRef = useRef(0);
  // Mirror of the current zoom so imperative handle doesn't need stale closures.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
    } catch {}
  }, [zoom]);
  // Most-recent pdfPath, used inside click handlers.
  const pdfPathRef = useRef(pdfPath);
  useEffect(() => { pdfPathRef.current = pdfPath; }, [pdfPath]);
  const rootFileRef = useRef(rootFile);
  useEffect(() => { rootFileRef.current = rootFile; }, [rootFile]);
  const onSyncTexJumpRef = useRef(onSyncTexJump);
  useEffect(() => { onSyncTexJumpRef.current = onSyncTexJump; }, [onSyncTexJump]);
  const beforeCompileRef = useRef(beforeCompile);
  useEffect(() => { beforeCompileRef.current = beforeCompile; }, [beforeCompile]);

  useEffect(() => {
    checkLatexInstallation();
  }, []);

  useEffect(() => {
    // Install progress shows in the status line; a dialog here used to block
    // the editor until dismissed, even after the install had finished.
    const dispose = (window as any).api.onCompilationStatus((status: { stage: string; message: string }) => {
      setCompilationStatus(status.message);
    });
    return () => { dispose?.(); };
  }, []);

  const checkLatexInstallation = async () => {
    try {
      const result = await (window as any).api.checkLatexInstallation();
      if (result.success) {
        setLatexInstalled(result.installed);
        if (result.installed) {
          setLatexVersion(result.version);
        }
        setLatexInstallSuggestion(result.installed ? null : result.installSuggestion ?? null);
      }
    } catch (err) {
      console.error('Error checking LaTeX installation:', err);
      setLatexInstalled(false);
    }
  };

  const detectMissingPackages = (errorLog: string): string[] => {
    const packages: Set<string> = new Set();
    const pattern1 = /File `([^']+)\.sty' not found/gi;
    let match;
    while ((match = pattern1.exec(errorLog)) !== null) {
      packages.add(match[1]);
    }
    // Document classes keep their extension (IEEEtran.cls).
    const classPattern = /File `([^']+\.cls)' not found/gi;
    while ((match = classPattern.exec(errorLog)) !== null) {
      packages.add(match[1]);
    }
    const pattern2 = /Missing \\usepackage\{([^}]+)\}/gi;
    while ((match = pattern2.exec(errorLog)) !== null) {
      packages.add(match[1]);
    }
    const pattern3 = /Package ([a-zA-Z0-9\-]+) not found/gi;
    while ((match = pattern3.exec(errorLog)) !== null) {
      packages.add(match[1]);
    }
    return Array.from(packages);
  };

  const releaseSlot = (slot: PageSlot) => {
    slot.task?.cancel();
    slot.task = null;
    slot.wrapper.querySelector('canvas')?.remove();
    slot.rendered = false;
  };

  // Render one page into its wrapper at the device pixel ratio so text stays
  // crisp on high-DPI screens.
  const renderSlot = useCallback(async (doc: PDFDocumentProxy, slot: PageSlot, scale: number, version: number) => {
    if (slot.rendered || slot.rendering) return;
    slot.rendering = true;
    try {
      const page = await doc.getPage(slot.pageNum);
      if (renderVersionRef.current !== version) return;
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 3);
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const task = page.render({
        canvasContext: ctx,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });
      slot.task = task;
      await task.promise;
      if (renderVersionRef.current !== version) return;
      slot.wrapper.querySelector('canvas')?.remove();
      slot.wrapper.insertBefore(canvas, slot.wrapper.firstChild);
      slot.rendered = true;
      page.cleanup();
    } catch {
      // Render was cancelled (new render started, zoom changed, page released).
    } finally {
      slot.rendering = false;
      slot.task = null;
    }
  }, []);

  // Lay out every page of `doc` at the given zoom. The pages that are visible
  // right now are rendered before the old pages are swapped out, so a
  // recompile updates the view without flashing or losing the scroll position.
  const renderDocument = useCallback(async (doc: PDFDocumentProxy, zoomLevel: number) => {
    const container = containerRef.current;
    if (!container) return;
    const version = ++renderVersionRef.current;
    const scale = zoomLevel / 100;
    const scrollToRestore = savedScrollRef.current;

    let pages;
    try {
      pages = await Promise.all(
        Array.from({ length: doc.numPages }, (_, index) => doc.getPage(index + 1))
      );
    } catch (err) {
      console.error('Failed to read PDF pages:', err);
      return;
    }
    if (renderVersionRef.current !== version || !containerRef.current) return;

    baseWidthRef.current = pages[0]?.getViewport({ scale: 1 }).width ?? 0;

    // Page numbers visible in the current layout (before the swap).
    const visiblePages: number[] = [];
    const containerBox = container.getBoundingClientRect();
    container.querySelectorAll<HTMLDivElement>('.pdf-page-wrapper').forEach(wrapper => {
      const box = wrapper.getBoundingClientRect();
      if (box.bottom >= containerBox.top && box.top <= containerBox.bottom) {
        visiblePages.push(Number(wrapper.dataset.pageNum));
      }
    });
    if (visiblePages.length === 0) {
      visiblePages.push(1, 2);
    }

    const slots: PageSlot[] = pages.map((page, index) => {
      const viewport = page.getViewport({ scale });
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-wrapper synctex-enabled';
      wrapper.dataset.pageNum = String(index + 1);
      wrapper.style.width = `${Math.floor(viewport.width)}px`;
      wrapper.style.height = `${Math.floor(viewport.height)}px`;
      return { pageNum: index + 1, wrapper, rendered: false, rendering: false, task: null };
    });

    await Promise.all(
      visiblePages
        .filter(pageNum => pageNum >= 1 && pageNum <= slots.length)
        .map(pageNum => renderSlot(doc, slots[pageNum - 1], scale, version))
    );
    if (renderVersionRef.current !== version || !containerRef.current) return;

    observerRef.current?.disconnect();
    slotsRef.current.forEach(slot => slot.task?.cancel());

    const target = containerRef.current;
    target.replaceChildren(...slots.map(slot => slot.wrapper));
    target.scrollTop = scrollToRestore;
    slotsRef.current = slots;
    pageWrappersRef.current = [];
    slots.forEach(slot => { pageWrappersRef.current[slot.pageNum] = slot.wrapper; });

    const slotByWrapper = new Map(slots.map(slot => [slot.wrapper as Element, slot]));
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const slot = slotByWrapper.get(entry.target);
        if (!slot) return;
        if (entry.isIntersecting) {
          void renderSlot(doc, slot, scale, version);
        } else if (slot.rendered || slot.rendering) {
          releaseSlot(slot);
        }
      });
    }, { root: target, rootMargin: '150% 0px' });
    slots.forEach(slot => observer.observe(slot.wrapper));
    observerRef.current = observer;
  }, [renderSlot]);

  useEffect(() => () => {
    observerRef.current?.disconnect();
    pdfDocRef.current?.destroy();
  }, []);

  // Load (or unload) the PDF document whenever the compiled pdfData changes.
  useEffect(() => {
    if (!pdfData) {
      observerRef.current?.disconnect();
      observerRef.current = null;
      slotsRef.current = [];
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
      renderVersionRef.current++; // cancel any ongoing render
      if (containerRef.current) containerRef.current.innerHTML = '';
      return;
    }

    // Save the current scroll position before we start re-rendering.
    if (containerRef.current) {
      savedScrollRef.current = containerRef.current.scrollTop;
    }

    const bytes = atob(pdfData);
    const data = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) data[i] = bytes.charCodeAt(i);

    const loadingTask = pdfjsLib.getDocument({ data });
    let cancelled = false;
    loadingTask.promise
      .then(doc => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        const previous = pdfDocRef.current;
        pdfDocRef.current = doc;
        void renderDocument(doc, zoomRef.current).finally(() => {
          // The old document can go once the new pages are on screen.
          if (previous && previous !== doc) previous.destroy();
        });
      })
      .catch(err => {
        if (!cancelled) console.error('Failed to load PDF:', err);
      });

    return () => {
      cancelled = true;
      loadingTask.destroy().catch(() => {});
    };
  }, [pdfData, renderDocument]);

  // Re-render at the new zoom level whenever the user zooms in/out.
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc) {
      prevZoomRef.current = zoom;
      return;
    }

    // Scale the saved scroll position proportionally so the same document
    // region stays visible after the canvas sizes change.
    if (containerRef.current) {
      const ratio = zoom / (prevZoomRef.current || zoom);
      savedScrollRef.current = containerRef.current.scrollTop * ratio;
    }
    prevZoomRef.current = zoom;

    void renderDocument(doc, zoom);
  }, [zoom, renderDocument]);

  const compileLatex = useCallback(async (options: { force?: boolean; explicit?: boolean } = {}) => {
    if (!isLatexFile || !currentFilePath) {
      return;
    }

    const api = (window as any).api;
    const requestId = latestCompileRequestRef.current + 1;
    latestCompileRequestRef.current = requestId;

    setIsCompiling(true);
    setCompilationStatus('Compiling...');

    try {
      await beforeCompileRef.current?.(Boolean(options.explicit));
      if (latestCompileRequestRef.current !== requestId) {
        return;
      }
      const result = await api.compileLatex(currentFilePath, latexEngine, {
        projectRoot: projectPath || undefined,
        force: Boolean(options.force),
      });

      if (latestCompileRequestRef.current !== requestId || result?.cancelled) {
        return;
      }

      const resultRoot: string = result.rootFile || currentFilePath;
      if (result.success) {
        setPdfData(result.pdfData);
        setPdfPath(result.pdfPath || '');
        setRootFile(resultRoot);
        setCompilationLog([result.log, result.warnings].filter(Boolean).join('\n'));
        setDiagnostics(result.diagnostics || []);
        setError('');
        setInstallHint(null);
        setMissingPackageNames([]);
        setCompilationStatus('Compilation successful');
        lastSuccessfulRootRef.current = resultRoot;
      } else {
        setError(result.error || 'Compilation failed');
        setErrorKind(result.notDocument ? 'info' : 'error');
        const fullLog = [result.log, result.details].filter(Boolean).join('\n');
        setCompilationLog(fullLog);
        setDiagnostics(result.diagnostics || []);
        // Keep showing the last good PDF of the same document while fixing
        // an error; a PDF of a different document would be misleading.
        if (lastSuccessfulRootRef.current !== resultRoot) {
          setPdfData('');
          setPdfPath('');
          setRootFile('');
          lastSuccessfulRootRef.current = null;
        }
        setCompilationStatus('');

        setInstallHint(result.installHint ?? null);
        const missing = detectMissingPackages(fullLog);
        setMissingPackageNames(missing);
        if (missing.length > 0 && onMissingPackages) {
          onMissingPackages(missing, Boolean(options.explicit));
        }
      }
    } catch (err: any) {
      if (latestCompileRequestRef.current !== requestId) {
        return;
      }
      setError(`Compilation Error: ${err.message}`);
      setErrorKind('error');
      console.error('Error compiling LaTeX:', err);
      setDiagnostics([]);
      setCompilationStatus('');
    } finally {
      if (latestCompileRequestRef.current === requestId) {
        setIsCompiling(false);
      }
    }
  }, [isLatexFile, currentFilePath, latexEngine, onMissingPackages, projectPath]);

  // A different project: nothing from the previous one belongs on screen.
  const previousProjectRef = useRef(projectPath);
  useEffect(() => {
    if (previousProjectRef.current === projectPath) return;
    previousProjectRef.current = projectPath;
    setError('');
    setCompilationLog('');
    setDiagnostics([]);
    setPdfData('');
    setPdfPath('');
    setRootFile('');
    lastSuccessfulRootRef.current = null;
  }, [projectPath]);

  useEffect(() => {
    if (isLatexFile && latexInstalled && compileNonce > 0) {
      compileLatex();
    } else if (!isLatexFile) {
      latestCompileRequestRef.current += 1;
      setIsCompiling(false);
      setCompilationStatus('');
      setError('');
      setCompilationLog('');
      setDiagnostics([]);
      setPdfData('');
      setPdfPath('');
      setRootFile('');
      lastSuccessfulRootRef.current = null;
    }
  }, [compileNonce, latexInstalled, isLatexFile, latexEngine, compileLatex]);

  // Flash a pulsing rectangle overlay on the given pages. Auto-removed after animation.
  const flashSynctexRects = useCallback((rects: SynctexRect[]) => {
    if (!rects.length) return;
    const scale = zoomRef.current / 100;
    const createdEls: HTMLDivElement[] = [];
    let firstEl: HTMLDivElement | null = null;

    rects.forEach(rect => {
      const wrapper = pageWrappersRef.current[rect.page];
      if (!wrapper) return;
      const el = document.createElement('div');
      el.className = 'pdf-synctex-highlight';
      // Pad a little so the highlight doesn't sit flush against the text.
      const pad = 2;
      el.style.left = `${Math.max(0, rect.h * scale - pad)}px`;
      el.style.top = `${Math.max(0, rect.v * scale - rect.H * scale - pad)}px`;
      el.style.width = `${Math.max(4, rect.W * scale + pad * 2)}px`;
      el.style.height = `${Math.max(4, rect.H * scale + pad * 2)}px`;
      wrapper.appendChild(el);
      createdEls.push(el);
      if (!firstEl) firstEl = el;
    });

    if (firstEl) {
      (firstEl as HTMLDivElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    window.setTimeout(() => {
      createdEls.forEach(el => { try { el.remove(); } catch {} });
    }, 2000);
  }, []);

  // Ctrl/Cmd + click on the PDF → inverse search (jump to source).
  // Ctrl/Cmd + mouse wheel → zoom.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = async (ev: MouseEvent) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const wrapper = target.closest('.pdf-page-wrapper') as HTMLDivElement | null;
      if (!wrapper) return;
      const pageNumStr = wrapper.dataset.pageNum;
      const pageNum = pageNumStr ? parseInt(pageNumStr, 10) : NaN;
      if (!Number.isFinite(pageNum) || pageNum <= 0) return;
      const currentPdfPath = pdfPathRef.current;
      if (!currentPdfPath) return;

      ev.preventDefault();
      ev.stopPropagation();

      const rect = wrapper.getBoundingClientRect();
      const scale = zoomRef.current / 100;
      const h = (ev.clientX - rect.left) / scale;
      const v = (ev.clientY - rect.top) / scale;

      try {
        const api = (window as any).api;
        const result = await api.synctex.inverse(currentPdfPath, pageNum, h, v, rootFileRef.current || undefined);
        if (result?.success && result.file && result.line) {
          onSyncTexJumpRef.current?.({
            file: result.file,
            line: result.line,
            column: result.column || 1,
          });
        } else if (result?.error) {
          console.warn('SyncTeX inverse search failed:', result.error);
        }
      } catch (err) {
        console.error('SyncTeX inverse search error:', err);
      }
    };

    const handleWheel = (ev: WheelEvent) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(prev => clampZoom(prev * factor));
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('click', handleClick);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [pdfData]);

  useImperativeHandle(ref, () => ({
    forwardSearch: async (line: number, column?: number) => {
      if (!currentFilePath) return;
      try {
        const api = (window as any).api;
        const result = await api.synctex.forward(
          currentFilePath,
          line,
          column ?? 1,
          pdfPathRef.current || undefined,
          rootFileRef.current || undefined
        );
        if (result?.success && result.rects && result.rects.length > 0) {
          flashSynctexRects(result.rects);
        } else if (result?.error) {
          setNotification({
            isOpen: true,
            title: 'SyncTeX Forward Search',
            message: result.error,
            type: 'info',
          });
        }
      } catch (err: any) {
        console.error('SyncTeX forward search error:', err);
        setNotification({
          isOpen: true,
          title: 'SyncTeX Forward Search',
          message: err?.message || 'Forward search failed.',
          type: 'error',
        });
      }
    },
  }), [currentFilePath, flashSynctexRects]);

  const handleZoomIn = () => {
    setZoom(prev => clampZoom(prev + 10));
  };

  const handleZoomOut = () => {
    setZoom(prev => clampZoom(prev - 10));
  };

  const handleFitWidth = () => {
    const container = containerRef.current;
    if (!container || !baseWidthRef.current) return;
    // Leave room for the vertical scrollbar and page shadow.
    const available = container.clientWidth - 32;
    setZoom(clampZoom((available / baseWidthRef.current) * 100));
  };

  const handleRefresh = () => {
    if (latexInstalled && isLatexFile) {
      compileLatex({ force: true, explicit: true });
    }
  };

  const handleExportPDF = async () => {
    if (!pdfPath) {
      setNotification({
        isOpen: true,
        title: 'No PDF Available',
        message: 'Please compile your LaTeX document first before exporting.',
        type: 'info',
      });
      return;
    }

    try {
      const sourceRoot = rootFile || currentFilePath || pdfPath;
      const defaultName = `${fileNameOf(sourceRoot).replace(/\.[^.]+$/, '')}.pdf`;
      const result = await (window as any).api.savePdfAs({
        sourcePath: pdfPath,
        defaultPath: `${dirNameOf(sourceRoot)}/${defaultName}`,
      });
      if (result?.success) {
        setNotification({
          isOpen: true,
          title: 'Export Successful',
          message: `PDF saved to ${result.filePath}`,
          type: 'success',
        });
      } else if (!result?.canceled) {
        throw new Error(result?.error || 'Unknown error');
      }
    } catch (exportError) {
      console.error('PDF export error:', exportError);
      setNotification({
        isOpen: true,
        title: 'Export Failed',
        message: 'Failed to export PDF. Please try again.',
        type: 'error',
      });
    }
  };

  const handleOpenExternally = async () => {
    if (!pdfPath) return;
    const result = await (window as any).api.openPath(pdfPath);
    if (!result?.success) {
      setNotification({
        isOpen: true,
        title: 'Cannot Open PDF',
        message: result?.error || 'No PDF viewer is available.',
        type: 'error',
      });
    }
  };

  const handleInstallLatex = async () => {
    await (window as any).api.openLatexDownload();
  };

  const handleDiagnosticClick = (diagnostic: LatexDiagnostic) => {
    if (!diagnostic.line) return;
    const file = diagnostic.file || rootFile || currentFilePath;
    if (!file) return;
    onSyncTexJumpRef.current?.({
      file,
      line: diagnostic.line,
      column: diagnostic.column || 1,
    });
  };

  const renderDiagnostics = (items: LatexDiagnostic[]) => (
    <div className="preview-diagnostics">
      {items.map((diagnostic, index) => {
        const canJump = Boolean(diagnostic.line);
        const location = diagnostic.line ? `${diagnostic.file ? fileNameOf(diagnostic.file) : 'Source'}:${diagnostic.line}` : '';
        return (
          <button
            type="button"
            key={`${diagnostic.severity}-${diagnostic.line || index}-${diagnostic.message}`}
            className={`preview-diagnostic preview-diagnostic-${diagnostic.severity}`}
            onClick={() => handleDiagnosticClick(diagnostic)}
            disabled={!canJump}
            title={canJump ? 'Jump to source line' : undefined}
          >
            <span className="preview-diagnostic-severity">{diagnostic.severity}</span>
            {location && <span className="preview-diagnostic-location">{location}</span>}
            <span className="preview-diagnostic-message">{diagnostic.message}</span>
          </button>
        );
      })}
    </div>
  );

  if (isMarkdownFile) {
    return (
      <div className="preview markdown-preview">
        <div className="markdown-header">
          <span>Markdown Preview</span>
        </div>
        <div className="markdown-body">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>
    );
  }

  if (!isLatexFile) {
    return (
      <div className="preview placeholder-preview">
        <div className="placeholder-message">
          <FiAlertCircle size={20} />
          <span>Select a LaTeX or Markdown file to see a preview.</span>
        </div>
      </div>
    );
  }

  if (latexInstalled === false) {
    return (
      <div className="preview latex-install">
        <div className="latex-status">
          <FiAlertCircle size={28} />
          <h3>LaTeX Distribution Not Found</h3>
          <p>
            Openotex requires a LaTeX distribution (MiKTeX, TeX Live, MacTeX) to compile documents.
          </p>
          {latexInstallSuggestion && (
            <div className="latex-install-suggestion">
              <p>{latexInstallSuggestion.message}</p>
              {latexInstallSuggestion.command && <CommandSnippet command={latexInstallSuggestion.command} />}
            </div>
          )}
          <button type="button" className="latex-install-btn" onClick={handleInstallLatex}>
            Download LaTeX Distribution
          </button>
          <button type="button" className="latex-recheck-btn" onClick={checkLatexInstallation}>
            I installed it – check again
          </button>
        </div>
      </div>
    );
  }

  const showingOtherRoot = Boolean(rootFile && currentFilePath && rootFile !== currentFilePath);

  return (
    <div className="preview">
      <div className="preview-header">
        <div className="preview-status">
          <span className="preview-title" title={latexVersion}>
            Preview
            {showingOtherRoot && (
              <span className="preview-root" title={rootFile}> · {fileNameOf(rootFile)}</span>
            )}
          </span>
          {isCompiling && (
            <span className="preview-status-indicator">
              {compilationStatus || 'Compiling…'}
            </span>
          )}
        </div>
        <div className="preview-controls">
          <button type="button" title="Recompile (full rebuild)" onClick={handleRefresh} disabled={isCompiling}>
            <FiRefreshCw size={16} />
          </button>
          <button type="button" title="Zoom Out (Ctrl+Wheel)" onClick={handleZoomOut}>
            <FiZoomOut size={16} />
          </button>
          <span className="preview-zoom">{zoom}%</span>
          <button type="button" title="Zoom In (Ctrl+Wheel)" onClick={handleZoomIn}>
            <FiZoomIn size={16} />
          </button>
          <button type="button" title="Fit page width" onClick={handleFitWidth} disabled={!pdfData}>
            <FiMaximize2 size={16} />
          </button>
          <button
            type="button"
            title={'SyncTeX shortcuts:\n  • Ctrl+Click in PDF → jump to source\n  • Ctrl+Alt+J in editor → jump to PDF'}
            onClick={() => setNotification({
              isOpen: true,
              title: 'SyncTeX Shortcuts',
              message:
                'Ctrl+Click on the PDF to jump to the matching source line.\n\n' +
                'Place the cursor in the editor and press Ctrl+Alt+J to jump to the matching location in the PDF (with a pulsing highlight).',
              type: 'info',
            })}
          >
            <FiHelpCircle size={16} />
          </button>
          <button type="button" title="Open PDF in the system viewer" onClick={handleOpenExternally} disabled={!pdfPath}>
            <FiExternalLink size={16} />
          </button>
          <button type="button" title="Export PDF…" onClick={handleExportPDF} disabled={!pdfPath}>
            <FiDownload size={16} />
          </button>
        </div>
      </div>
      {engineSuggestion && (
        <div className="preview-engine-warning">
          <FiAlertCircle size={14} />
          <span>{engineSuggestion}</span>
        </div>
      )}
      <div className="preview-body">
        {pdfData ? (
          <div ref={containerRef} className="pdf-canvas-container" />
        ) : (
          <div className="preview-empty">
            <p>{isCompiling ? 'Compiling…' : 'No PDF compiled yet.'}</p>
          </div>
        )}
      </div>
      {warningDiagnostics.length > 0 && (
        <div className="preview-warnings">
          <button
            type="button"
            className="preview-warnings-toggle"
            onClick={() => setShowWarnings(prev => !prev)}
            aria-expanded={showWarnings}
          >
            {showWarnings ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
            <FiAlertTriangle size={14} />
            <span>
              {warningDiagnostics.length} warning{warningDiagnostics.length !== 1 ? 's' : ''} in the last compilation
            </span>
          </button>
          {showWarnings && renderDiagnostics(warningDiagnostics)}
        </div>
      )}
      {error && (
        <div className={`preview-error ${errorKind === 'info' ? 'preview-info' : ''}`}>
          <h4>{errorKind === 'info' ? 'Nothing to compile' : 'Compilation Error'}</h4>
          <pre>{error}</pre>
          {(installHint || (missingPackageNames.length > 0 && onMissingPackages)) && (
            <div className="preview-install-hint">
              {installHint && <p>{installHint.message}</p>}
              {installHint?.command && <CommandSnippet command={installHint.command} />}
              {missingPackageNames.length > 0 && onMissingPackages && (
                <button type="button" className="preview-install-hint-btn" onClick={() => onMissingPackages(missingPackageNames, true)}>
                  <FiDownload size={13} />
                  Install missing packages…
                </button>
              )}
            </div>
          )}
          {diagnostics.length > 0 && renderDiagnostics(diagnostics)}
          {compilationLog && (
            <details>
              <summary>View Full Log</summary>
              <pre>{compilationLog}</pre>
            </details>
          )}
        </div>
      )}
      <NotificationDialog
        isOpen={notification.isOpen}
        title={notification.title}
        message={notification.message}
        type={notification.type}
        onClose={() => setNotification(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
});

Preview.displayName = 'Preview';

export default Preview;
