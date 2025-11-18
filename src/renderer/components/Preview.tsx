import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { FiRefreshCw, FiZoomIn, FiZoomOut, FiDownload, FiAlertCircle } from 'react-icons/fi';
import NotificationDialog from './NotificationDialog';
import '../styles/Preview.css';
import '../styles/Preview-addon.css';

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

  useEffect(() => {
    // Only check LaTeX availability once per session; harmless if not a LaTeX file.
    checkLatexInstallation();
  }, []);

  useEffect(() => {
    // Listen for compilation status updates (font/package installation)
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

    return Array.from(packages);
  };

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

  // Trigger compilation when content, engine, or file changes
  useEffect(() => {
    if (isLatexFile && latexInstalled && compileNonce > 0) {
      compileLatex();
    } else if (!isLatexFile) {
      latestCompileRequestRef.current += 1;
      // Reset LaTeX-related state when switching to another file type.
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
          <iframe
            title="PDF Preview"
            src={`data:application/pdf;base64,${pdfData}`}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top left'
            }}
          />
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
