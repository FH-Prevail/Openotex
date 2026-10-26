import React, { useEffect, useState } from 'react';
import { FiPackage, FiDownload, FiX, FiAlertCircle, FiShield } from 'react-icons/fi';
import CommandSnippet from './CommandSnippet';
import '../styles/PackageInstallDialog.css';

export type PackageInstallResult = {
  success: boolean;
  error?: string;
  message?: string;
  manualCommand?: string;
};

type InstallPlan = {
  manager: string;
  packages: string[];
  elevated: boolean;
  manualCommand?: string;
};

interface PackageInstallDialogProps {
  isOpen: boolean;
  missingPackages: string[];
  onInstall: (packageNames: string[]) => Promise<PackageInstallResult>;
  onClose: () => void;
}

const MANAGER_LABELS: Record<string, string> = {
  apt: 'APT (Debian/Ubuntu)',
  dnf: 'DNF (Fedora)',
  zypper: 'Zypper (openSUSE)',
  pacman: 'pacman (Arch Linux)',
  'tlmgr-root': 'a TeX Live installation owned by the administrator',
};

const displayName = (name: string) => (/\.(sty|cls)$/i.test(name) ? name : `${name}.sty`);

const PackageInstallDialog: React.FC<PackageInstallDialogProps> = ({
  isOpen,
  missingPackages,
  onInstall,
  onClose,
}) => {
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  // The package being installed, or '*' for all of them.
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<PackageInstallResult | null>(null);
  const packagesKey = missingPackages.join('\n');

  useEffect(() => {
    if (!isOpen || missingPackages.length === 0) return;
    let cancelled = false;
    setPlan(null);
    setFailure(null);
    (window as any).api.planLatexPackageInstall(missingPackages)
      .then((next: InstallPlan) => { if (!cancelled) setPlan(next); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen, packagesKey]);

  if (!isOpen || missingPackages.length === 0) {
    return null;
  }

  const install = async (packageNames: string[], key: string) => {
    setBusy(key);
    setFailure(null);
    try {
      const result = await onInstall(packageNames);
      if (!result.success) {
        setFailure(result);
      }
    } finally {
      setBusy(null);
    }
  };

  const elevated = Boolean(plan?.elevated);
  const unsupported = plan !== null && plan.packages.length === 0;
  const managerLabel = plan ? MANAGER_LABELS[plan.manager] ?? plan.manager : '';

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
            {unsupported
              ? 'These files are required but not installed. Openotex could not tell how your LaTeX installation adds packages; please install them with your distribution\'s tools.'
              : elevated
                ? `These files are required but not installed. Your LaTeX installation is managed by ${managerLabel}, so installing needs administrator rights.`
                : 'The following packages are required but not installed. Would you like to install them?'}
          </p>
          <div className="package-list">
            {missingPackages.map(pkg => (
              <div key={pkg} className="package-item">
                <div className="package-info">
                  <FiPackage size={16} />
                  <span className="package-name">{displayName(pkg)}</span>
                </div>
                {!elevated && !unsupported && (
                  <button
                    className="package-install-btn"
                    onClick={() => install([pkg], pkg)}
                    disabled={busy !== null}
                  >
                    {busy === pkg || busy === '*' ? (
                      <>Installing...</>
                    ) : (
                      <>
                        <FiDownload size={14} />
                        Install
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
          {elevated && plan && (
            <p className="package-install-note">
              <FiShield size={14} />
              <span>
                Openotex will install <strong>{plan.packages.join(', ')}</strong> and your system will ask for
                your password. This can take a few minutes.
              </span>
            </p>
          )}
          {failure && (
            <div className="package-install-failure" role="alert">
              {failure.error || failure.message || 'The installation failed.'}
            </div>
          )}
          {(failure?.manualCommand || plan?.manualCommand) && (
            <div className="package-install-manual">
              <span>{failure ? 'Run this command in a terminal instead, then compile again:' : 'Or run this command in a terminal:'}</span>
              <CommandSnippet command={(failure?.manualCommand || plan?.manualCommand)!} />
            </div>
          )}
        </div>
        <div className="package-install-footer">
          <button className="package-cancel-btn" onClick={onClose}>
            {unsupported ? 'Close' : 'Cancel'}
          </button>
          {!unsupported && (
            <button
              className="package-install-all-btn"
              onClick={() => install(missingPackages, '*')}
              disabled={busy !== null}
            >
              {busy === '*' ? 'Installing...' : elevated ? 'Install with administrator rights' : 'Install All'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PackageInstallDialog;
