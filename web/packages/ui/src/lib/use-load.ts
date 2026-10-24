import { ApiError, RECENT_SIGN_IN_REQUIRED } from '@ppe/api-client'
import { useCallback, useEffect, useState } from 'react'

import { uiText } from '../text.ts'

export interface Loaded<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => void
}

/**
 * Run load on mount, whenever a value in deps changes, and on reload(). A
 * result that arrives after a newer load started is dropped.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[] = []): Loaded<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined,
    error: undefined,
    loading: true,
  })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    setState((s) => ({ ...s, loading: true, error: undefined }))
    load().then(
      (data) => current && setState({ data, error: undefined, loading: false }),
      (error: unknown) => current && setState((s) => ({ ...s, error, loading: false })),
    )
    return () => {
      current = false
    }
  }, [tick, ...deps])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { ...state, reload }
}

/**
 * Several loads as one, for a screen that needs them all: its data once every
 * one has arrived, the first error, and a reload that loads again the ones that
 * failed (all of them when none did).
 */
export function combineLoads<T extends readonly unknown[]>(...loads: { [K in keyof T]: Loaded<T[K]> }): Loaded<T> {
  const all = loads as readonly Loaded<unknown>[]
  const failed = all.filter((l) => l.error !== undefined)
  return {
    data: all.every((l) => l.data !== undefined) ? (all.map((l) => l.data) as unknown as T) : undefined,
    error: failed[0]?.error,
    loading: all.some((l) => l.loading),
    reload: () => (failed.length > 0 ? failed : all).forEach((l) => l.reload()),
  }
}

export function errorText(err: unknown): string {
  // An action that needed the password again, when the user cancelled the prompt.
  if (err instanceof ApiError && err.status === 403 && err.message === RECENT_SIGN_IN_REQUIRED) return uiText().passwordNotConfirmed
  // The server's own failure: its words are not for people, its reference is.
  if (err instanceof ApiError && err.status >= 500) {
    const ref = err.shortReference
    return ref ? `${uiText().serverError} ${uiText().reference(ref)}` : uiText().serverError
  }
  return err instanceof Error ? err.message : uiText().somethingWentWrong
}
