import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { StoreProvider } from './state/store';
import { EntitlementProvider } from './state/entitlement';

// PWA service worker (install-app-signal): production builds only, so local
// dev never serves stale cached modules. Network-first with no pre-cache —
// see public/sw.js. Its registration is also what makes Chromium treat the
// app as installable; the worker itself is non-fatal if it fails.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* non-fatal: installability and the app itself don't depend on it */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <EntitlementProvider>
        <App />
      </EntitlementProvider>
    </StoreProvider>
  </StrictMode>,
);
