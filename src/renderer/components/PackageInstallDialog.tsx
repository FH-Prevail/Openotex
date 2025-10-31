import React, { useState } from 'react';
import { FiPackage, FiDownload, FiX, FiAlertCircle } from 'react-icons/fi';
import '../styles/PackageInstallDialog.css';

interface PackageInstallDialogProps {
  isOpen: boolean;
  missingPackages: string[];
  onInstall: (packageName: string) => Promise<void>;
  onClose: () => void;
  onInstallAll: () => Promise<void>;
}

const PackageInstallDialog: React.FC<PackageInstallDialogProps> = ({
  isOpen,
  missingPackages,
  onInstall,
  onClose,
  onInstallAll,
}) => {
  const [installingPackages, setInstallingPackages] = useState<Set<string>>(new Set());
  const [installingAll, setInstallingAll] = useState(false);

  if (!isOpen || missingPackages.length === 0) {
    return null;
  }

  const handleInstall = async (packageName: string) => {
    setInstallingPackages(prev => new Set(prev).add(packageName));
    try {
      await onInstall(packageName);
    } finally {
      setInstallingPackages(prev => {
        const next = new Set(prev);
        next.delete(packageName);
        return next;
      });
    }
  };

  const handleInstallAll = async () => {
    setInstallingAll(true);
    try {
      await onInstallAll();
    } finally {
      setInstallingAll(false);
    }
  };

  return (
    <div className="package-install-overlay">
      <div className="package-install-dialog">
        <div className="package-install-header">
          <div className="package-install-title">
            <FiAlertCircle size={20} />
            <h2>Missing LaTeX Packages</h2>
          </div>
          <button className="package-install-close" onClick={onClose} title="Close">
            <FiX size={20} />
          </button>
        </div>
        <div className="package-install-content">
          <p className="package-install-message">
            The following packages are required but not installed. Would you like to install them?
          </p>
          <div className="package-list">
            {missingPackages.map(pkg => (
              <div key={pkg} className="package-item">
                <div className="package-info">
                  <FiPackage size={16} />
                  <span className="package-name">{pkg}</span>
                </div>
                <button
                  className="package-install-btn"
                  onClick={() => handleInstall(pkg)}
                  disabled={installingPackages.has(pkg) || installingAll}
                >
                  {installingPackages.has(pkg) ? (
                    <>Installing...</>
                  ) : (
                    <>
                      <FiDownload size={14} />
                      Install
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="package-install-footer">
          <button className="package-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="package-install-all-btn"
            onClick={handleInstallAll}
            disabled={installingAll}
          >
            {installingAll ? 'Installing All...' : 'Install All'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PackageInstallDialog;
