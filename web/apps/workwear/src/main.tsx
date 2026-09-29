import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import './index.css'
import { ApiProvider } from './lib/api'
import { applyTheme, loadTheme } from './lib/theme'

// index.html has set <html data-theme> already; this also colours the browser's bars.
applyTheme(loadTheme())

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <ApiProvider>
      <App />
    </ApiProvider>
  </StrictMode>,
)
