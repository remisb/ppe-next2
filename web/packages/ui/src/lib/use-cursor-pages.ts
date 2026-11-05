import { useMemo, useState } from 'react'

import { useLoad, type Loaded } from './use-load.ts'

/** One page of a list read newest first: its rows, and the cursor of the next (older) page. */
export interface CursorPage<T> {
  items: T[]
  next: string | null
}

export interface CursorPages<T> extends Loaded<T[]> {
  /** The cursor of the next older page; null once the list is complete. */
  next: string | null
  /** Loading an older page: whether it is on its way, and why it failed. */
  older: { loading: boolean; error: unknown }
  loadOlder: () => void
}

/**
 * A list read a page at a time, newest first (the Audit log, Sign-ins, Errors):
 * the first page loads as useLoad does, whenever a value in deps changes, and
 * loadOlder() appends the next older one. Older pages belong to the deps they
 * were loaded for, so a change of filter drops them; reload() drops them too
 * and loads the first page again.
 */
export function useCursorPages<T>(load: (after: string | undefined) => Promise<CursorPage<T>>, deps: readonly unknown[]): CursorPages<T> {
  const key = JSON.stringify(deps)
  const first = useLoad(() => load(undefined), [key])
  const [older, setOlder] = useState<{ key: string; items: T[]; next: string | null } | null>(null)
  const [olderState, setOlderState] = useState<{ loading: boolean; error: unknown }>({ loading: false, error: undefined })
  const pages = older?.key === key ? older : null
  const data = useMemo(() => (first.data ? [...first.data.items, ...(pages?.items ?? [])] : undefined), [first.data, pages])
  const next = pages ? pages.next : (first.data?.next ?? null)

  const loadOlder = () => {
    if (!next || olderState.loading) return
    setOlderState({ loading: true, error: undefined })
    load(next).then(
      (page) => {
        setOlder({ key, items: [...(pages?.items ?? []), ...page.items], next: page.next })
        setOlderState({ loading: false, error: undefined })
      },
      (error: unknown) => setOlderState({ loading: false, error }),
    )
  }

  return {
    data,
    error: first.error,
    loading: first.loading,
    reload: () => {
      setOlder(null)
      setOlderState({ loading: false, error: undefined })
      first.reload()
    },
    next,
    older: olderState,
    loadOlder,
  }
}
