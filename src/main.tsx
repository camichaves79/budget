import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { StoreProvider } from './state/store';
import { EntitlementProvider } from './state/entitlement';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <EntitlementProvider>
        <App />
      </EntitlementProvider>
    </StoreProvider>
  </StrictMode>,
);
