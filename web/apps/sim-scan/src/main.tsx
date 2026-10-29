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

// The trial reports as the staff app, where its features will live: the Audit
// log's sources and Usage's apps stay as they are (docs/specs/asset-service.md).
createRoot(container).render(
  <StrictMode>
    <ApiProvider app="workwear" setLanguage={setLanguage}>
      <App />
    </ApiProvider>
  </StrictMode>,
)
