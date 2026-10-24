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
    if (selected && besideList()) document.querySelector('[data-slot=table-row][aria-current=true]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, ids])
}
