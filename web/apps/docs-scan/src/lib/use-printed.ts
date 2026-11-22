import { readPrintedPages } from '@ppe/id-docs/printed-reader'
import { todayHere } from '@ppe/id-docs/reader'
import { useEffect, useRef } from 'react'

import { parseDraft, withPrinted } from './flow'
import { type Session, useSessions } from './sessions'

/**
 * Once a scan's MRZ passes, its printed text is read in the background (DS-14), once: the
 * names offered over the MRZ's, the date of issue by its rule. Find Employee does not wait.
 */
export function usePrinted(scan: Session): void {
  const sessions = useSessions()
  const started = useRef<string | null>(null)
  const m = parseDraft(scan.draft, todayHere())
  const due = !!m?.valid && scan.state !== 'saved' && !scan.printed
  useEffect(() => {
    if (!due || !m || started.current === scan.id) return
    started.current = scan.id
    sessions.update(scan.id, (s) => ({ ...s, printed: { state: 'reading' } }))
    readPrintedPages(
      scan.pages.map((p) => p.blob),
      m,
    ).then(
      (r) =>
        sessions.update(scan.id, (s) => ({
          ...s,
          draft: withPrinted(s.draft, m, r.fields),
          printed: {
            state: 'done',
            ...(r.namesPage !== undefined ? { namesPage: r.namesPage } : {}),
            ...(r.fields.surname ? { surname: r.fields.surname } : {}),
            ...(r.fields.givenNames ? { givenNames: r.fields.givenNames } : {}),
            ...(r.fields.issuedOn ? { issuedOn: r.fields.issuedOn } : {}),
          },
        })),
      () => sessions.update(scan.id, (s) => ({ ...s, printed: { state: 'failed' } })),
    )
  }, [due, scan.id])
}
