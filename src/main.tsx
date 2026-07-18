import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ToastProvider } from './components/ui/toast'
import { I18nProvider } from './i18n/I18nProvider'

// A stale client whose cached index references a chunk that a newer deploy has
// removed will fail the dynamic import (the server serves index.html for the
// missing asset). Vite fires `vite:preloadError` for exactly this — reload once
// to pull the current shell. The sessionStorage guard stops a reload loop if
// the chunk is genuinely gone (network, not staleness).
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('chunk-reload')) return;
  sessionStorage.setItem('chunk-reload', '1');
  window.location.reload();
});
window.addEventListener('load', () => sessionStorage.removeItem('chunk-reload'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
)
