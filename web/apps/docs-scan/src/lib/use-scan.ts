import { useApi } from '@ppe/app-shell'
import { useEffect, useState } from 'react'

import { reopenScan } from './pages'
import { type Session, useSessions } from './sessions'

/**
 * The scan a screen is about: the one held in this tab, else the kept scan read again from
 * its pages (a reload, or a scan opened from Scans in another tab). Gone (expired, deleted,
 * another user's) is an error the screen says.
 */
export function useScan(id: string): { scan: Session | undefined; error: unknown; loading: boolean } {
  const { client } = useApi()
  const sessions = useSessions()
  const held = sessions.get(id)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(!held)

  useEffect(() => {
    if (held) return
    let live = true
    setLoading(true)
    client.personnel.scans
      .list()
      .then(async (all) => {
        const kept = all.find((s) => s.id === id)
        if (!kept) throw new Error('gone')
        const s = await reopenScan(client, kept)
        if (live) sessions.put(s)
      })
      .catch((e: unknown) => live && setError(e))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // Once per scan: putting it in the store makes `held` true.
  }, [id, client])

  return { scan: held, error, loading: loading && !held }
}
