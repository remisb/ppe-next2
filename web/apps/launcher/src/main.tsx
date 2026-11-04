import { ApiProvider, applyTheme, loadTheme } from '@ppe/app-shell'
import { applyLanguage } from '@ppe/i18n'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import './index.css'

// index.html has set <html data-theme> already; this also colours the browser's bars.
applyTheme(loadTheme())

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

// The launcher's words are @ppe/launcher's, which follow the shared language
// (applyLanguage). It reports as "launcher" (ADR 0006).
createRoot(container).render(
  <StrictMode>
    <ApiProvider app="launcher" setLanguage={applyLanguage}>
      <App />
    </ApiProvider>
  </StrictMode>,
)
