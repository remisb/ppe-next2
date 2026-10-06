import { ApiProvider, applyTheme, loadTheme } from '@ppe/app-shell'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { setLanguage } from '@/i18n'
import { clearDraft } from '@/lib/working-order'

import { App } from './app'
import './index.css'

// index.html has set <html data-theme> already; this also colours the browser's bars.
applyTheme(loadTheme())

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    {/* Sign out drops the user's Create Order draft from this device. */}
    <ApiProvider setLanguage={setLanguage} onSignOut={clearDraft}>
      <App />
    </ApiProvider>
  </StrictMode>,
)
