/**
 * The MRZ reader (@ppe/mrz/reader), loaded on first use, not with the app:
 * with its files it is several megabytes, needed only once a document is
 * photographed. Its files are this app's own (@ppe/mrz/reader-files).
 */
import type { MrzReader } from '@ppe/mrz/reader'
import { filesBase } from '@ppe/routing'

let loading: Promise<MrzReader> | undefined

export function loadReader(): Promise<MrzReader> {
  loading ??= import('@ppe/mrz/reader').then((r) => r.createMrzReader({ base: `${filesBase}readers/` }))
  loading.catch(() => {
    loading = undefined
  })
  return loading
}

/** Today in this browser, ISO: the parser's centuries and "expired" (the API checks with its own). */
export function todayHere(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
