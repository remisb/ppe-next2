import { useApi } from '@ppe/app-shell'
import { CornerEditor } from '@ppe/id-docs/corner-editor'
import { todayHere } from '@ppe/id-docs/reader'
import { ActionError, ErrorState, Loading } from '@ppe/ui/components/states'
import { useState } from 'react'

import { t } from '@/i18n'
import { parseDraft } from '@/lib/flow'
import { keepScan, readingOf, remakePage } from '@/lib/pages'
import { useRouter } from '@/lib/router'
import { useSessions } from '@/lib/sessions'
import { useScan } from '@/lib/use-scan'

/**
 * Adjust Corners (DS-4): the page's photo with its 4 corners to drag or move with the arrow
 * keys (@ppe/id-docs' editor); Done makes the page again from them and keeps the scan again,
 * in its own place. Only a scan taken in this tab has its photos.
 */
export function AdjustScreen({ id, page }: { id: string; page: number }) {
  const { client } = useApi()
  const { navigate } = useRouter()
  const sessions = useSessions()
  const { scan, error, loading } = useScan(id)
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState<unknown>(null)
  if (loading) return <Loading label={t.scans.opening} />
  if (!scan) return <ErrorState title={t.problems.scanGone} error={error} />
  const target = scan.pages[page - 1]
  if (!target?.source || !target.corners || !target.size || target.turn === undefined) return <ErrorState title={t.adjust.notHere} error={null} />
  if (working) return <Loading label={t.adjust.working} />

  return (
    <>
      <ActionError error={failed} />
      <CornerEditor
        photo={target.source}
        turn={target.turn}
        corners={target.corners}
        size={target.size}
        onCancel={() => navigate({ name: 'scan', id }, { replace: true })}
        onDone={(corners) => {
          setWorking(true)
          setFailed(null)
          void (async () => {
            try {
              const made = await remakePage(target, corners, scan.kind)
              const pages = scan.pages.map((p) => (p.key === target.key ? made : p))
              const m = readingOf(pages) ?? parseDraft(scan.draft, todayHere())
              const s = await keepScan(client, scan.kind, pages, scan.draft, m, scan.id)
              sessions.put({ ...s, ...(scan.candidates ? { candidates: scan.candidates } : {}) })
              sessions.drop(scan.id)
              navigate({ name: 'scan', id: s.id }, { replace: true })
            } catch (e) {
              setFailed(e)
              setWorking(false)
            }
          })()
        }}
        words={t.adjust}
      />
    </>
  )
}
