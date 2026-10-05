import { ApiError, RECENT_SIGN_IN_REQUIRED } from '@ppe/api-client'
import { useCallback, useEffect, useState } from 'react'

import { t } from '@/i18n'

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

export function errorText(err: unknown): string {
  // An action that needed the password again, when the user cancelled the prompt.
  if (err instanceof ApiError && err.status === 403 && err.message === RECENT_SIGN_IN_REQUIRED) return t.shell.passwordNotConfirmed
  return err instanceof Error ? err.message : t.common.somethingWentWrong
}
