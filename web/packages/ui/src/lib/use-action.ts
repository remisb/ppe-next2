import { useCallback, useState } from 'react'

export interface ActionOptions {
  /** The question asked first (ask first); the action runs only on OK. */
  confirm?: string | undefined
  /** The error to show in place of the one thrown, as a refusal the screen can word better. */
  mapError?: ((err: unknown) => unknown) | undefined
}

export interface Action {
  /** The last run's failure, shown with ActionError until the next run. */
  error: unknown
  pending: boolean
  /** Runs fn after asking first when told to; resolves true when it ran and did not fail. */
  run: (fn: () => Promise<unknown>, options?: ActionOptions) => Promise<boolean>
  /** Shows a failure caught elsewhere, as a queued move's. */
  fail: (err: unknown) => void
  clear: () => void
}

/**
 * A screen's actions (Delete, Deactivate, Change Status…): one error at a
 * time, cleared when the next starts, and whether one is running.
 */
export function useAction(): Action {
  const [state, setState] = useState<{ error: unknown; pending: boolean }>({ error: undefined, pending: false })
  const run = useCallback(async (fn: () => Promise<unknown>, { confirm, mapError }: ActionOptions = {}) => {
    if (confirm !== undefined && !window.confirm(confirm)) return false
    setState({ error: undefined, pending: true })
    try {
      await fn()
      setState({ error: undefined, pending: false })
      return true
    } catch (err) {
      setState({ error: mapError ? mapError(err) : err, pending: false })
      return false
    }
  }, [])
  const fail = useCallback((error: unknown) => setState((s) => ({ ...s, error })), [])
  const clear = useCallback(() => setState((s) => ({ ...s, error: undefined })), [])
  return { ...state, run, fail, clear }
}
