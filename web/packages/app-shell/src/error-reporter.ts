import type { ClientErrorReport } from '@ppe/api-client'

/** The most errors one page load reports: a loop must not flood the list. */
export const MAX_REPORTS = 10

/**
 * Turns what the browser caught into a report, or null for what is not the
 * app's to report: a browser extension's script, a cross-origin script's
 * opaque "Script error.", or a cancelled request.
 */
export function reportOf(error: unknown, message: string, path: string): ClientErrorReport | null {
  const err = error instanceof Error ? error : null
  const text = (err ? `${err.name}: ${err.message}` : message).trim()
  if (!text || text === 'Script error.' || err?.name === 'AbortError') return null
  const stack = err?.stack ?? ''
  if (/(chrome|moz|safari(-web)?)-extension:\/\//.test(stack)) return null
  return { message: text.slice(0, 1000), stack: stack.slice(0, 8000), path }
}

/**
 * Sends the page's uncaught errors and unhandled rejections to System's error
 * list (POST /api/v1/client-errors), each message once and at most
 * MAX_REPORTS a page load, while someone is signed in. A report that fails is
 * dropped. Returns the function that stops it.
 */
export function reportErrors(send: (r: ClientErrorReport) => Promise<void>): () => void {
  const sent = new Set<string>()
  const report = (error: unknown, message: string) => {
    const r = reportOf(error, message, window.location.pathname)
    if (!r || sent.has(r.message) || sent.size >= MAX_REPORTS) return
    sent.add(r.message)
    void send(r).catch(() => {})
  }
  const onError = (e: ErrorEvent) => report(e.error, e.message)
  const onRejection = (e: PromiseRejectionEvent) => report(e.reason, String(e.reason))
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
