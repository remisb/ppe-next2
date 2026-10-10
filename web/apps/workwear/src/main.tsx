import { ApiProvider, applyTheme, loadTheme } from '@ppe/app-shell'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { setLanguage } from '@/i18n'
import { forgetAllPrinted } from '@/lib/assets'
import { clearDraft } from '@/lib/working-order'

import { App } from './app'
import './index.css'

// index.html has set <html data-theme> already; this also colours the browser's bars.
applyTheme(loadTheme())

function signOutHere(userId: string) {
  clearDraft(userId)
  forgetAllPrinted(userId)
}

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    {/* Sign out drops the user's Create Order draft and printed Give forms from this device. */}
    <ApiProvider app="workwear" setLanguage={setLanguage} onSignOut={signOutHere}>
      <App />
    </ApiProvider>
  </StrictMode>,
)
