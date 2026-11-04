import { ApiProvider, type Session, applyTheme, loadTheme } from '@ppe/app-shell'
import { hasSeveralApps } from '@ppe/launcher'
import { launcherHref } from '@ppe/routing'
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

/**
 * Someone who signs in at the staff app's start with more than one app lands
 * on App Launcher (ADR 0006, decisions D1 and D10); a deep link, a reload or
 * someone with one app stays here.
 */
function signedInHere(s: Session): boolean {
  if (window.location.pathname !== '/' || !hasSeveralApps(s.can)) return false
  window.location.replace(launcherHref('/'))
  return true
}

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    {/* Sign out drops the user's Create Order draft and printed Give forms from this device. */}
    <ApiProvider app="workwear" setLanguage={setLanguage} onSignOut={signOutHere} onSignedIn={signedInHere}>
      <App />
    </ApiProvider>
  </StrictMode>,
)
