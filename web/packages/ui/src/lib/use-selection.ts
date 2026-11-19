import { useCallback, useMemo, useState } from 'react'

/** How much of what is shown is ticked: the header checkbox's state. */
export type SelectionState = 'none' | 'some' | 'all'

/** Which of `shownIds` are ticked, given the ids ticked so far: a row the screen no longer shows (a search, a tab) is not. */
export function selectedAmong(ticked: ReadonlySet<string>, shownIds: readonly string[]): string[] {
  return shownIds.filter((id) => ticked.has(id))
}

export function selectionState(selected: number, shown: number): SelectionState {
  if (selected === 0 || shown === 0) return 'none'
  return selected >= shown ? 'all' : 'some'
}

/**
 * The rows ticked in a list, for actions on several at once (Export, Change
 * Status). Only rows the screen shows count, so searching narrows the
 * selection with the list; clearing the search brings the rest back.
 */
export function useSelection(shownIds: readonly string[]) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  const ids = useMemo(() => selectedAmong(ticked, shownIds), [ticked, shownIds])
  const set = useMemo(() => new Set(ids), [ids])
  const toggle = useCallback((id: string, on: boolean) => {
    setTicked((cur) => {
      const next = new Set(cur)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const setAll = useCallback(
    (on: boolean) =>
      setTicked((cur) => {
        const next = new Set(cur)
        for (const id of shownIds) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      }),
    [shownIds],
  )
  const clear = useCallback(() => setTicked(new Set()), [])
  return { ids, has: (id: string) => set.has(id), count: ids.length, state: selectionState(ids.length, shownIds.length), toggle, setAll, clear }
}

export type Selection = ReturnType<typeof useSelection>
