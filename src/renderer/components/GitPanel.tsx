import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiRefreshCw, FiUploadCloud, FiDownloadCloud, FiCheckCircle } from 'react-icons/fi';
import '../styles/GitPanel.css';

interface GitChange {
  path: string;
  status: string;
}

interface GitPanelProps {
  projectPath: string;
}

const statusLabels: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Updated',
  '?': 'Untracked',
};

const GitPanel: React.FC<GitPanelProps> = ({ projectPath }) => {
  const api = (window as any).api;
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [gitAvailable, setGitAvailable] = useState<'unknown' | 'available' | 'missing'>('unknown');
  const [repoState, setRepoState] = useState<'unknown' | 'repo' | 'not-repo' | 'inactive'>('unknown');
  const [commitMessage, setCommitMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'status' | 'commit' | 'pull' | 'push' | null>(null);

  const isReady = useMemo(() => Boolean(projectPath && projectPath.trim().length > 0), [projectPath]);

  const refreshStatus = useCallback(async () => {
    if (!isReady) {
      setChanges([]);
      setRepoState('unknown');
      return;
    }
    setBusyAction('status');
    setError(null);
    setInfo(null);
    try {
      const gitCheck = await api.git.check();
      if (!gitCheck?.success) {
        setGitAvailable('missing');
        setRepoState('inactive');
        setError('Git is not available. Install Git to use this panel.');
        setChanges([]);
        return;
      }
      setGitAvailable('available');

      const result = await api.git.status(projectPath);
      if (!result?.success) {
        if (result?.notRepo) {
          setRepoState('not-repo');
        } else {
          setRepoState('unknown');
        }
        setError(result?.error || 'Failed to load status.');
        setChanges([]);
      } else {
        setRepoState('repo');
        setChanges(result.files || []);
      }
    } catch (err: any) {
      setRepoState('unknown');
      setError(err?.message || 'Failed to load status.');
      setChanges([]);
    } finally {
      setBusyAction(null);
    }
  }, [api, isReady, projectPath]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const runGitAction = useCallback(async (action: 'commit' | 'pull' | 'push', fn: () => Promise<void>) => {
    setBusyAction(action);
    setError(null);
    setInfo(null);
    try {
      await fn();
      await refreshStatus();
      if (action === 'commit') {
        setCommitMessage('');
        setInfo('Commit created.');
      } else if (action === 'pull') {
        setInfo('Pulled latest changes from the remote tracking branch.');
      } else if (action === 'push') {
        setInfo('Push sent local commits to the remote tracking branch.');
      }
    } catch (err: any) {
      setError(err?.message || 'Git command failed.');
    } finally {
      setBusyAction(null);
    }
  }, [refreshStatus]);

  const handleInitRepo = async () => {
    setBusyAction('status');
    setError(null);
    setInfo(null);
    try {
      const result = await api.git.init(projectPath);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to initialize repository.');
      }
      setRepoState('repo');
      setInfo('Initialized a new Git repository.');
      await refreshStatus();
    } catch (err: any) {
      setError(err?.message || 'Failed to initialize repository.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeactivate = () => {
    setRepoState('inactive');
    setChanges([]);
    setInfo('Git panel deactivated for this folder.');
    setError(null);
  };

  const handleInstallGit = () => {
    api.openExternal?.('https://git-scm.com/downloads');
  };

  const handleCommit = () => {
    const message = commitMessage.trim();
    if (!message) {
      setError('Add a commit message first.');
      return;
    }
    runGitAction('commit', async () => {
      const result = await api.git.commit({ cwd: projectPath, message });
      if (!result?.success) {
        throw new Error(result?.error || 'Commit failed.');
      }
    });
  };

  const handlePull = () => {
    runGitAction('pull', async () => {
      const result = await api.git.pull(projectPath);
      if (!result?.success) {
        throw new Error(result?.error || 'Pull failed.');
      }
    });
  };

  const handlePush = () => {
    runGitAction('push', async () => {
      const result = await api.git.push(projectPath);
      if (!result?.success) {
        throw new Error(result?.error || 'Push failed.');
      }
    });
  };

  return (
    <div className="git-panel">
      <div className="git-panel__header">
        <div>
          <div className="git-panel__title">Git</div>
          <div className="git-panel__subtitle">
            {isReady ? projectPath : 'Open a project to use Git'}
          </div>
        </div>
        <button
          className="git-panel__icon-btn"
          onClick={() => refreshStatus()}
          disabled={!isReady || busyAction === 'status'}
          title="Refresh status"
        >
          <FiRefreshCw />
        </button>
      </div>

      {!isReady && (
        <div className="git-panel__empty">
          Select or create a project to enable Git.
        </div>
      )}

      {isReady && gitAvailable === 'missing' && (
        <div className="git-panel__empty">
          <div>Git is not installed or not on PATH.</div>
          <div className="git-panel__actions">
            <button className="git-panel__primary" onClick={handleInstallGit}>
              Install Git
            </button>
            <button className="git-panel__secondary" onClick={() => refreshStatus()}>
              Retry
            </button>
          </div>
        </div>
      )}

      {isReady && gitAvailable !== 'missing' && repoState === 'not-repo' && (
        <div className="git-panel__empty">
          <div>This folder is not a Git repository.</div>
          <div className="git-panel__actions">
            <button
              className="git-panel__primary"
              onClick={handleInitRepo}
              disabled={busyAction === 'status'}
            >
              Initialize Git
            </button>
            <button
              className="git-panel__secondary"
              onClick={handleDeactivate}
              disabled={busyAction === 'status'}
            >
              Keep Inactive
            </button>
          </div>
        </div>
      )}

      {isReady && gitAvailable !== 'missing' && repoState === 'inactive' && (
        <div className="git-panel__empty">
          Git panel deactivated. Refresh to retry initialization.
        </div>
      )}

      {isReady && gitAvailable !== 'missing' && repoState !== 'not-repo' && repoState !== 'inactive' && (
        <>
          <div className="git-panel__section git-panel__section--changes">
            <div className="git-panel__section-title">Changes</div>
            <div className="git-panel__changes-scroll">
              {changes.length === 0 && (
                <div className="git-panel__empty">No pending changes.</div>
              )}
              {changes.length > 0 && (
                <ul className="git-panel__list">
                  {changes.map(change => (
                    <li key={`${change.status}-${change.path}`} className="git-panel__list-item">
                      <span className="git-panel__badge">{statusLabels[change.status] || change.status}</span>
                      <span className="git-panel__path">{change.path}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="git-panel__section">
            <div className="git-panel__section-title">Commit</div>
            <textarea
              className="git-panel__input"
              placeholder="Commit message"
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              disabled={!isReady || busyAction === 'commit'}
            />
            <button
              className="git-panel__primary"
              onClick={handleCommit}
              disabled={!isReady || busyAction === 'commit'}
            >
              <FiCheckCircle />
              Commit and Stage All
            </button>
          </div>

          <div className="git-panel__section git-panel__actions">
            <button
              className="git-panel__secondary"
              onClick={handlePull}
              disabled={!isReady || busyAction === 'pull' || repoState !== 'repo'}
            >
              <FiDownloadCloud />
              Pull
            </button>
            <button
              className="git-panel__secondary"
              onClick={handlePush}
              disabled={!isReady || busyAction === 'push' || repoState !== 'repo'}
            >
              <FiUploadCloud />
              Push
            </button>
          </div>
        </>
      )}

      {(error || info) && (
        <div className={`git-panel__banner ${error ? 'git-panel__banner--error' : 'git-panel__banner--info'}`}>
          {error || info}
        </div>
      )}
    </div>
  );
};

export default GitPanel;
