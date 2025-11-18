import React from 'react';
import { FiX } from 'react-icons/fi';
import '../styles/AboutDialog.css';

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const CURRENT_VERSION = '1.0.2';
const VERSION_CHECK_URL = 'https://openotex.com/downloads/Openotex-Setup-';
const DOWNLOAD_PAGE_URL = 'https://openotex.com/#download';

const AboutDialog: React.FC<AboutDialogProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  // Use static asset path (bundled to dist/assets)
  const [iconSrc, setIconSrc] = React.useState<string>('assets/openotex-icon.png');
  const [isCheckingUpdate, setIsCheckingUpdate] = React.useState(false);
  const [updateStatus, setUpdateStatus] = React.useState<string>('');
  const [checkOnStartup, setCheckOnStartup] = React.useState<boolean>(true);

  React.useEffect(() => {
    // Load user preference for auto-update check
    const savedPreference = localStorage.getItem('checkUpdateOnStartup');
    if (savedPreference !== null) {
      setCheckOnStartup(savedPreference === 'true');
    }
  }, []);

  const handleCheckOnStartupChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setCheckOnStartup(newValue);
    localStorage.setItem('checkUpdateOnStartup', newValue.toString());
  };

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

  const checkForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus('Checking for updates...');

    try {
      // First, try to fetch a version.json file from the server (recommended approach)
      // If the server doesn't have this file, we'll fall back to checking download URLs
      let latestVersion = CURRENT_VERSION;
      let foundUpdate = false;

      try {
        const versionResponse = await fetch('https://openotex.com/version.json');
        if (versionResponse.ok) {
          const versionData = await versionResponse.json();
          latestVersion = versionData.version || versionData.latest || CURRENT_VERSION;
          foundUpdate = compareVersions(latestVersion, CURRENT_VERSION) > 0;
        }
      } catch (error) {
        // version.json doesn't exist, try alternative method
        console.log('version.json not found, trying alternative method');

        // Try to detect newer versions by checking if download URLs exist
        // This checks common version increments
        const currentParts = CURRENT_VERSION.split('.').map(Number);
        const versionsToCheck = [];

        // Check patch increments (e.g., 1.0.1, 1.0.2, ..., 1.0.10)
        for (let i = 1; i <= 10; i++) {
          versionsToCheck.push(`${currentParts[0]}.${currentParts[1]}.${currentParts[2] + i}`);
        }

        // Check minor increments (e.g., 1.1.0, 1.2.0, ..., 1.5.0)
        for (let i = 1; i <= 5; i++) {
          versionsToCheck.push(`${currentParts[0]}.${currentParts[1] + i}.0`);
        }

        // Check major increment (e.g., 2.0.0, 3.0.0)
        for (let i = 1; i <= 2; i++) {
          versionsToCheck.push(`${currentParts[0] + i}.0.0`);
        }

        // Check each version URL
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
            // Continue to next version
            continue;
          }
        }
      }

      if (foundUpdate) {
        const userWantsUpdate = window.confirm(
          `A new version (${latestVersion}) is available!\n\nYou are currently running version ${CURRENT_VERSION}.\n\nWould you like to visit the download page?`
        );

        if (userWantsUpdate) {
          await (window as any).api.openExternal(DOWNLOAD_PAGE_URL);
          setUpdateStatus(`Opened download page for version ${latestVersion}`);
        } else {
          setUpdateStatus('Update cancelled.');
        }
      } else {
        setUpdateStatus('You are using the latest version!');
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      setUpdateStatus('Unable to check for updates. Please try again later.');
    } finally {
      setIsCheckingUpdate(false);

      // Clear status after 5 seconds
      setTimeout(() => {
        setUpdateStatus('');
      }, 5000);
    }
  };

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="about-header">
          <h2>About Openotex</h2>
          <button className="about-close" onClick={onClose} title="Close">
            <FiX size={20} />
          </button>
        </div>
        <div className="about-content">
          <div className="about-logo">
            {iconSrc ? (
              <img
                src={iconSrc}
                alt="Openotex Logo"
                className="logo-image"
              />
            ) : (
              <div className="logo-circle-placeholder">
                <span style={{ fontSize: '32px', fontWeight: 'bold' }}>O</span>
              </div>
            )}
          </div>
          <h3 className="about-title">Openotex</h3>
          <p className="about-version">Version {CURRENT_VERSION}</p>
          <button
            className="check-update-button"
            onClick={checkForUpdates}
            disabled={isCheckingUpdate}
          >
            {isCheckingUpdate ? 'Checking...' : 'Check for Updates'}
          </button>
          <div className="check-startup-container">
            <label className="check-startup-label">
              <input
                type="checkbox"
                checked={checkOnStartup}
                onChange={handleCheckOnStartupChange}
                className="check-startup-checkbox"
              />
              <span>Check for updates when the program starts</span>
            </label>
          </div>
          {updateStatus && (
            <p className="update-status">{updateStatus}</p>
          )}
          <p className="about-description">
            A modern, clean LaTeX editor for desktop.
          </p>
          <p className="about-team">Developed by the Openotex team.</p>

          <div className="about-section">
            <h4>Features</h4>
            <ul>
              <li>Live preview of LaTeX documents</li>
              <li>Syntax highlighting and autocomplete</li>
              <li>Integrated terminal</li>
              <li>Annotations and comments</li>
              <li>Auto-save and auto-compile</li>
              <li>MiKTeX/TinyTeX package management</li>
            </ul>
          </div>

          <div className="about-disclaimer">
            <h4>Disclaimer</h4>
            <p>
              This application is <strong>free to use</strong> and comes with <strong>no warranty</strong>.
            </p>
            <p>
              The software is provided "as is", without warranty of any kind, express or implied,
              including but not limited to the warranties of merchantability, fitness for a particular
              purpose and noninfringement.
            </p>
          </div>

          <div className="about-footer">
            <p>&copy; 2025 Openotex team.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutDialog;
