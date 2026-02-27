import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { FiRefreshCw, FiZoomIn, FiZoomOut, FiDownload, FiAlertCircle } from 'react-icons/fi';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import NotificationDialog from './NotificationDialog';
import '../styles/Preview.css';
import '../styles/Preview-addon.css';

// The worker is copied to the dist output folder by CopyWebpackPlugin.
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';

interface PreviewProps {
  content: string;
  compileNonce: number;
  currentFileExtension: string | null;
  currentFilePath: string | null;
  latexEngine?: 'pdflatex' | 'xelatex' | 'lualatex';
  onMissingPackages?: (packages: string[]) => void;
}

const Preview: React.FC<PreviewProps> = ({
  content,
  compileNonce,
  currentFileExtension,
  currentFilePath,
  latexEngine = 'pdflatex',
  onMissingPackages,
}) => {
  const [pdfData, setPdfData] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [compilationStatus, setCompilationStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [compilationLog, setCompilationLog] = useState<string>('');
  const [zoom, setZoom] = useState(100);
  const [latexInstalled, setLatexInstalled] = useState<boolean | null>(null);
  const [latexVersion, setLatexVersion] = useState<string>('');
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
  const isLatexFile = fileExtension === 'tex' || fileExtension === 'latex';
  const isMarkdownFile = fileExtension === 'md' || fileExtension === 'markdown';

  const latestCompileRequestRef = useRef(0);

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

  useEffect(() => {
    checkLatexInstallation();
  }, []);

  useEffect(() => {
    const dispose = (window as any).api.onCompilationStatus((status: { stage: string; message: string }) => {
      setCompilationStatus(status.message);
      if (status.stage === 'font-installation' || status.stage === 'package-installation') {
        setNotification({ isOpen: true, title: 'Installing Dependencies', message: status.message, type: 'info' });
      } else if (status.stage === 'retry') {
        setNotification({ isOpen: true, title: 'Retrying Compilation', message: status.message, type: 'success' });
      }
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

  // Render all pages of `doc` at the given zoom level into containerRef.
  // Saves the current scroll position before clearing, then restores it after
  // all pages are appended so the user's reading position is preserved.
  const renderAllPages = useCallback(async (doc: PDFDocumentProxy, zoomLevel: number) => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scrollToRestore = savedScrollRef.current;

    // Stamp this render; if it changes before we finish, we were superseded.
    const version = ++renderVersionRef.current;
    container.innerHTML = '';

    const scale = zoomLevel / 100;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      if (renderVersionRef.current !== version) return;

      const page = await doc.getPage(pageNum);
      if (renderVersionRef.current !== version) {
        page.cleanup();
        return;
      }

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = 'pdf-page-canvas';
      container.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      if (!ctx) { page.cleanup(); continue; }

      try {
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch {
        // Render was cancelled (new render started or zoom changed).
        page.cleanup();
        return;
      }
      page.cleanup();
    }

    // All pages are in the DOM — restore scroll position.
    if (renderVersionRef.current === version) {
      container.scrollTop = scrollToRestore;
    }
  }, []);

  // Load (or unload) the PDF document whenever the compiled pdfData changes.
  useEffect(() => {
    if (!pdfData) {
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
    loadingTask.promise
      .then(doc => {
        pdfDocRef.current?.destroy();
        pdfDocRef.current = doc;
        renderAllPages(doc, zoom);
      })
      .catch(err => console.error('Failed to load PDF:', err));

    return () => { loadingTask.destroy().catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfData, renderAllPages]);
  // Note: `zoom` is intentionally omitted — zoom changes are handled by the
  // separate effect below so we don't reload the document on every zoom.

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

    renderAllPages(doc, zoom);
  }, [zoom, renderAllPages]);

  const compileLatex = useCallback(async () => {
    if (!isLatexFile || !currentFilePath) {
      return;
    }

    const api = (window as any).api;
    const requestId = latestCompileRequestRef.current + 1;
    latestCompileRequestRef.current = requestId;

    setIsCompiling(true);
    setError('');
    setCompilationLog('');
    setCompilationStatus('Compiling...');

    try {
      const result = await api.compileLatex(currentFilePath, latexEngine);

      if (latestCompileRequestRef.current !== requestId) {
        return;
      }

      if (result.success) {
        setPdfData(result.pdfData);
        setCompilationLog(result.log);
        setError('');
        setCompilationStatus('Compilation successful');
      } else {
        setError(result.error || 'Compilation failed');
        setCompilationLog(result.log || '');
        setPdfData('');
        setCompilationStatus('');

        const fullLog = (result.log || '') + '\n' + (result.details || '');
        const missing = detectMissingPackages(fullLog);
        if (missing.length > 0 && onMissingPackages) {
          onMissingPackages(missing);
        }
      }
    } catch (err: any) {
      if (latestCompileRequestRef.current !== requestId) {
        return;
      }
      setError(`Compilation Error: ${err.message}`);
      console.error('Error compiling LaTeX:', err);
      setPdfData('');
      setCompilationStatus('');
    } finally {
      if (latestCompileRequestRef.current === requestId) {
        setIsCompiling(false);
      }
    }
  }, [isLatexFile, currentFilePath, latexEngine, onMissingPackages]);

  useEffect(() => {
    if (isLatexFile && latexInstalled && compileNonce > 0) {
      compileLatex();
    } else if (!isLatexFile) {
      latestCompileRequestRef.current += 1;
      setIsCompiling(false);
      setCompilationStatus('');
      setError('');
      setCompilationLog('');
      setPdfData('');
    }
  }, [compileNonce, latexInstalled, isLatexFile, latexEngine, compileLatex]);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 10, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 10, 50));
  };

  const handleRefresh = () => {
    if (latexInstalled && isLatexFile) {
      compileLatex();
    }
  };

  const handleExportPDF = async () => {
    if (!pdfData) {
      setNotification({
        isOpen: true,
        title: 'No PDF Available',
        message: 'Please compile your LaTeX document first before exporting.',
        type: 'info',
      });
      return;
    }

    try {
      const binary = atob(pdfData);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        array[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([array], { type: 'application/pdf' });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'document.pdf';
      a.click();
      URL.revokeObjectURL(url);

      setNotification({
        isOpen: true,
        title: 'Export Successful',
        message: 'PDF exported successfully!',
        type: 'success',
      });
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

  const handleInstallLatex = async () => {
    await (window as any).api.openLatexDownload();
  };

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
          <button type="button" className="latex-install-btn" onClick={handleInstallLatex}>
            Download LaTeX Distribution
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="preview">
      <div className="preview-header">
        <div className="preview-status">
          <span className="preview-title">
            Preview {latexVersion ? `(${latexVersion})` : ''}
          </span>
          {isCompiling && (
            <span className="preview-status-indicator">
              {compilationStatus || 'Compiling…'}
            </span>
          )}
        </div>
        <div className="preview-controls">
          <button type="button" title="Refresh" onClick={handleRefresh} disabled={isCompiling}>
            <FiRefreshCw size={16} />
          </button>
          <button type="button" title="Zoom In" onClick={handleZoomIn}>
            <FiZoomIn size={16} />
          </button>
          <button type="button" title="Zoom Out" onClick={handleZoomOut}>
            <FiZoomOut size={16} />
          </button>
          <span className="preview-zoom">{zoom}%</span>
          <button type="button" title="Export PDF" onClick={handleExportPDF}>
            <FiDownload size={16} />
          </button>
        </div>
      </div>
      <div className="preview-body">
        {pdfData ? (
          <div ref={containerRef} className="pdf-canvas-container" />
        ) : (
          <div className="preview-empty">
            <p>No PDF compiled yet.</p>
          </div>
        )}
      </div>
      {error && (
        <div className="preview-error">
          <h4>Compilation Error</h4>
          <pre>{error}</pre>
          <details>
            <summary>View Full Log</summary>
            <pre>{compilationLog}</pre>
          </details>
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
};

export default Preview;
