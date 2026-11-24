import { useEffect, useRef } from 'react'

/** From lg (64rem) a record opens beside its list; below it, in the list's place. */
export function besideList(): boolean {
  return globalThis.matchMedia?.('(min-width: 64rem)').matches ?? false
}

/** Whether a key press belongs to a field (or other editable content) rather than to the app. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
}

/**
 * The record in a list after or before the open one: J the next, K the
 * previous; undefined at either end or when the open one is not listed.
 */
export function stepTo(ids: readonly string[], selected: string, key: 'j' | 'k'): string | undefined {
  const at = ids.indexOf(selected)
  return at < 0 ? undefined : ids[at + (key === 'j' ? 1 : -1)]
}

/**
 * The row a list marks (`data-state="selected"`): the open record's, and once it is
 * closed (✕, Esc, Back) the one that was open, so the user sees where they were
 * (WARE-25, ui-ux-guidelines.md §2 "When the list changes"). A change of `filters`
 * (the same key as useCloseFilteredOut's) while nothing is open clears it; opening
 * another record moves it. Only the open row is `aria-current`.
 */
export function useMarkedRow(selected: string | undefined, filters: string): string | undefined {
  const last = useRef({ id: selected, filters })
  // Derived during render from the props alone, so every render of the same props agrees.
  if (selected !== undefined) last.current = { id: selected, filters }
  else if (last.current.filters !== filters) last.current = { id: undefined, filters }
  return last.current.id
}

/**
 * The open record follows the list's filters (WARE-42, ui-ux-guidelines.md §2 "When the
 * list changes"): once the user has changed the filters, the search or the tab and the
 * list for them is shown, a record it does not show closes, its row mark with it.
 * Nothing opens in its place; another record opens only when the user opens it.
 *
 * `filters` is the list's filters as a key, never its sort or page (paging and sorting
 * close nothing). `current` says the list shown (`ids`) is the one for those filters,
 * not the one before them still on screen while they load; a list filtered in the
 * browser is current as soon as it has loaded. The filters the screen opened with are
 * never checked, so a record opened by a link or ⌘K stays open beside a list that does
 * not show it, as does a record whose own change moves it out of the list.
 */
export function useCloseFilteredOut({
  filters,
  current,
  ids,
  selected,
  onClose,
}: {
  filters: string
  current: boolean
  ids: readonly string[] | undefined
  selected: string | undefined
  onClose: () => void
}): void {
  const checked = useRef(filters)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!current || !ids || checked.current === filters) return
    checked.current = filters
    if (selected !== undefined && !ids.includes(selected)) close.current()
  }, [filters, current, ids, selected])
}

/**
 * The keys of a list with a record open (ListDetail): J and K open the next
 * or previous record of the list as shown, Escape closes the one beside the
 * list; none while typing, with a modifier, with a dialog open or once
 * something else has handled the key (preventDefault). The open
 * row (`aria-current`) stays in view as they move through the list.
 */
export function useListKeys({
  ids,
  selected,
  onOpen,
  onClose,
}: {
  ids: readonly string[] | undefined
  selected: string | undefined
  onOpen: (id: string) => void
  onClose: () => void
}): void {
  // The latest handlers, so a screen's new closures each render do not listen again.
  const handlers = useRef({ onOpen, onClose })
  handlers.current = { onOpen, onClose }
  useEffect(() => {
    if (!selected || !ids) return
    const onKey = (e: KeyboardEvent) => {
      // A key something on the page already handled (an edit in place cancelled by Escape) is not the list's.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return
      if (e.key === 'Escape' && besideList()) {
        e.preventDefault()
        handlers.current.onClose()
        return
      }
      const key = e.key.toLowerCase()
      if (key !== 'j' && key !== 'k') return
      const next = stepTo(ids, selected, key)
      if (next) {
        e.preventDefault()
        handlers.current.onOpen(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, ids])

  useEffect(() => {
    if (!selected || !besideList()) return
    // One frame later: a closing dialog (⌘K) gives focus back to what had it, which scrolls that away again.
    const frame = requestAnimationFrame(() =>
      document.querySelector('[data-slot=table-row][aria-current=true]')?.scrollIntoView({ block: 'nearest' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [selected, ids])
}
