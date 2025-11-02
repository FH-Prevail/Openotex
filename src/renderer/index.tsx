import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

const rootEl = document.getElementById('root') as HTMLElement;
// Minimal sanity check so blank windows show a clear message
try {
  // Log whether preload bridge is available
  // eslint-disable-next-line no-console
  console.log('window.api available:', typeof (window as any).api);
} catch {}

const root = ReactDOM.createRoot(rootEl);

const apiOk = typeof (window as any).api === 'object';
if (!apiOk) {
  rootEl.innerHTML = '<div style="color:#bbb;font-family:sans-serif;padding:24px">Preload failed to initialize. Please rebuild and ensure sandbox is disabled for preload.</div>';
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
