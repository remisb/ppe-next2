import type { Client, LauncherList } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { useEffect, useState } from 'react'

/**
 * One GET /api/v1/launcher per signed-in user and page: every app's frame
 * asks (for its Apps entry), the staff app at sign-in, and the launcher, so
 * the answer is kept here, as employee-photo.tsx keeps pictures. A failure is
 * dropped, so the next ask tries again.
 */
const lists = new Map<string, Promise<LauncherList>>()

export function loadLauncher(client: Client, userId: string): Promise<LauncherList> {
  let list = lists.get(userId)
  if (!list) {
    list = client.launcher.get()
    lists.set(userId, list)
    list.catch(() => lists.delete(userId))
  }
  return list
}

/** Keeps the pins the API answered with, so the frames read them too. */
export function rememberPins(userId: string, pins: string[]): void {
  const list = lists.get(userId)
  if (list) lists.set(userId, list.then((l) => ({ ...l, pins })))
}

/** Keeps the channel the user chose for an app ('stable': none), so the frames read it too. */
export function rememberChoice(userId: string, slug: string, channel: string): void {
  const list = lists.get(userId)
  if (!list) return
  lists.set(
    userId,
    list.then((l) => {
      const choices = { ...l.choices }
      if (channel === 'stable') delete choices[slug]
      else choices[slug] = channel
      return { ...l, choices }
    }),
  )
}

export interface Launcher {
  /** The user's launcher once loaded; null while loading or after a failure. */
  list: LauncherList | null
  failed: boolean
  retry: () => void
}

/** The signed-in user's launcher list (null for no one). */
export function useLauncher(): Launcher {
  const { client, session } = useApi()
  const userId = session?.userId
  const [state, setState] = useState<{ list: LauncherList | null; failed: boolean }>({ list: null, failed: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!userId) return
    let live = true
    setState((s) => (s.failed ? { list: null, failed: false } : s))
    loadLauncher(client, userId).then(
      (list) => live && setState({ list, failed: false }),
      () => live && setState({ list: null, failed: true }),
    )
    return () => {
      live = false
    }
  }, [client, userId, attempt])
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}
