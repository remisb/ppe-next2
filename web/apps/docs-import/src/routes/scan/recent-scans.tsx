import type { KeptScan } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { ActionError, ErrorState } from '@ppe/ui/components/states'
import { saveFile } from '@ppe/ui/lib/save-file'
import { Download, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { t } from '@/i18n'

/** Whole days until iso, rounded up: 2.1 days is "in 3 days". */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000))
}

/**
 * Recent scans: the signed-in user's own archives the server still keeps,
 * newest first, each downloaded again or removed (asked first). They are
 * deleted by the server once expired; refresh changes after Download Archive.
 */
export function RecentScans({ refresh }: { refresh: number }) {
  const { client } = useApi()
  const [scans, setScans] = useState<KeptScan[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [error, setError] = useState<unknown>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoadError(null)
    client.personnel.scans.list().then(setScans, setLoadError)
  }, [client])
  useEffect(load, [load, refresh])

  const download = async (s: KeptScan) => {
    setBusy(s.id)
    setError(null)
    try {
      const { blob, fileName } = await client.personnel.scans.download(s.id)
      saveFile(blob, fileName)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (s: KeptScan) => {
    setBusy(s.id)
    setError(null)
    try {
      await client.personnel.scans.remove(s.id)
      setAsking(null)
      setScans((cur) => (cur ? cur.filter((x) => x.id !== s.id) : cur))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="recent-scans" className="flex flex-col gap-2 border-t border-border pt-5">
      <h2 id="recent-scans" className="text-base font-semibold">
        {t.scan.recentTitle}
      </h2>
      <p className="text-sm text-muted-foreground">{t.scan.recentHint}</p>
      {loadError ? <ErrorState error={loadError} onRetry={load} /> : null}
      <ActionError error={error} />
      {scans && scans.length === 0 ? <p className="text-sm text-muted-foreground">{t.scan.recentEmpty}</p> : null}
      {scans && scans.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {scans.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-sm break-all">{s.file_name}</p>
                <p className="text-sm text-muted-foreground">
                  {t.scan.pages(s.pages)} · {t.scan.deletedIn(daysUntil(s.expires_at))}
                </p>
              </div>
              {asking === s.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{t.scan.removeAsk}</span>
                  <Button variant="destructive" size="sm" onClick={() => void remove(s)} disabled={busy === s.id}>
                    {t.scan.removeYes}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setAsking(null)} disabled={busy === s.id}>
                    {t.scan.cancel}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void download(s)} disabled={busy === s.id}>
                    <Download aria-hidden className="size-4" />
                    {t.scan.downloadAgain}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAsking(s.id)} disabled={busy === s.id}>
                    <Trash2 aria-hidden className="size-4" />
                    {t.scan.remove}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
