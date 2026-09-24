import { useCallback, useEffect, useState } from 'react'

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

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.'
}
