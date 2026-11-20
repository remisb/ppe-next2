import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'

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
 * The rows ticked, in order: those shown first, in the screen's order, then
 * (`acrossPages`) those kept from other pages, in the order they were ticked.
 */
export function tickedRows<T>(kept: ReadonlyMap<string, T>, shown: readonly T[], idOf: (row: T) => string, acrossPages: boolean): T[] {
  const here = shown.filter((r) => kept.has(idOf(r)))
  if (!acrossPages) return here
  const onPage = new Set(here.map(idOf))
  return [...here, ...[...kept].filter(([id]) => !onPage.has(id)).map(([, row]) => row)]
}

/**
 * Select mode (WARE-45): a list's rows are ticked only while an action that
 * needs them (Export, Change Status) is under way. `start(action)` shows the
 * checkboxes, `end()` hides them and clears the ticks; `mode` names the action.
 *
 * Only rows the screen shows count, so a search narrows the selection with
 * the list; a list loaded page by page (`acrossPages`) keeps the rows ticked
 * on other pages too, as they were when ticked.
 */
export function useSelection<T>(shown: readonly T[], idOf: (row: T) => string, options: { acrossPages?: boolean } = {}) {
  const acrossPages = options.acrossPages ?? false
  const [mode, setMode] = useState<string | null>(null)
  const [kept, setKept] = useState<ReadonlyMap<string, T>>(() => new Map())
  const shownIds = useMemo(() => shown.map(idOf), [shown, idOf])
  const rows = useMemo(() => tickedRows(kept, shown, idOf, acrossPages), [kept, shown, idOf, acrossPages])
  const ids = useMemo(() => rows.map(idOf), [rows, idOf])
  const set = useMemo(() => new Set(ids), [ids])
  const onPage = useMemo(() => shownIds.filter((id) => set.has(id)).length, [shownIds, set])

  const toggle = useCallback(
    (id: string, on?: boolean) =>
      setKept((cur) => {
        const next = new Map(cur)
        const tick = on ?? !next.has(id)
        const row = shown.find((r) => idOf(r) === id)
        if (tick && row !== undefined) next.set(id, row)
        else next.delete(id)
        return next
      }),
    [shown, idOf],
  )
  const setAll = useCallback(
    (on: boolean) =>
      setKept((cur) => {
        const next = new Map(cur)
        for (const r of shown) {
          if (on) next.set(idOf(r), r)
          else next.delete(idOf(r))
        }
        return next
      }),
    [shown, idOf],
  )
  const clear = useCallback(() => setKept(new Map()), [])
  const start = useCallback((action: string) => {
    setKept(new Map())
    setMode(action)
  }, [])
  const end = useCallback(() => {
    setMode(null)
    setKept(new Map())
  }, [])

  return {
    /** The action under way (its key), or null while browsing: no checkboxes then. */
    mode,
    active: mode !== null,
    start,
    end,
    ids,
    rows,
    has: (id: string) => set.has(id),
    count: ids.length,
    /** The header checkbox's state, over the rows shown. */
    state: selectionState(onPage, shownIds.length),
    toggle,
    setAll,
    clear,
  }
}

export type Selection = ReturnType<typeof useSelection<unknown>>

/** Escape leaves select mode, unless something on top of the list (a sheet, a menu) takes it first. */
export function useSelectModeEscape(selection: Pick<Selection, 'active' | 'end'>) {
  const { active, end } = selection
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // A dialog or menu open over the list closes first.
      if (document.querySelector('dialog[open], [role=menu]')) return
      end()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, end])
}

/**
 * A row's props in select mode: a click anywhere on it (its links and the
 * checkbox included) ticks or unticks it instead of opening its record. A
 * ⌘/Ctrl- or Shift-click on a link still opens it in a new tab or window.
 * While browsing it adds nothing, so the row opens as before.
 */
export function selectRowProps(selection: Pick<Selection, 'active' | 'has' | 'toggle'>, id: string) {
  if (!selection.active) return {}
  return {
    'aria-selected': selection.has(id),
    'data-ticked': selection.has(id) ? '' : undefined,
    onClickCapture: (ev: MouseEvent) => {
      const target = ev.target as Element
      const link = target.closest('a')
      if (link && (ev.metaKey || ev.ctrlKey || ev.shiftKey)) return
      // The row's own checkbox toggles natively: cancelling its click would make the
      // browser put its old look back after React has drawn the new one.
      if (!(target instanceof HTMLInputElement && target.type === 'checkbox')) ev.preventDefault()
      ev.stopPropagation()
      selection.toggle(id)
    },
  }
}
