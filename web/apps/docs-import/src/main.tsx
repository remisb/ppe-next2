import { ApiProvider, applyTheme, loadTheme } from '@ppe/app-shell'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { setLanguage } from '@/i18n'

import { App } from './app'
import './index.css'

// index.html has set <html data-theme> already; this also colours the browser's bars.
applyTheme(loadTheme())

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

// The app reports by its slug, registered in App Launcher (its tile in
// internal/domain/launcher/defaults.go): the Audit log, System's errors and
// Usage name it by its tile.
createRoot(container).render(
  <StrictMode>
    <ApiProvider app="docs-import" setLanguage={setLanguage}>
      <App />
    </ApiProvider>
  </StrictMode>,
)
