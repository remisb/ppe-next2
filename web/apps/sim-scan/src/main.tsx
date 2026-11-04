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

// The trial reports by its slug, registered in App Launcher (ADR 0006): the
// Audit log, System's errors and Usage name it Scan SIMs.
createRoot(container).render(
  <StrictMode>
    <ApiProvider app="sim-scan" setLanguage={setLanguage}>
      <App />
    </ApiProvider>
  </StrictMode>,
)
