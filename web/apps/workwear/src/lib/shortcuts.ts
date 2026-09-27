import { useEffect, useRef } from 'react'

/**
 * Keyboard shortcuts for people who use the app all day on a desktop. None
 * fires while typing in a field, except the palette's ⌘K / Ctrl+K; a letter
 * never steals a keystroke meant for text.
 */
export const shortcutList: { keys: string; does: string }[] = [
  { keys: '⌘K / Ctrl+K', does: 'Search employees, items and screens, and jump to them' },
  { keys: '/', does: 'Go to the search or Add Item field on this screen' },
  { keys: 'N', does: 'New order' },
  { keys: 'G then D, O, H, E, C, S, U', does: 'Go to Dashboard, Create Order, History, Employees, Catalogue, Item Sets, Users' },
  { keys: 'J / K', does: 'History: the next or previous order, beside the list' },
  { keys: '⌘Enter / Ctrl+Enter', does: 'Create Order: review the order before Mark as Ordered' },
  { keys: '?', does: 'Show these shortcuts' },
]

/** Whether a key press belongs to a field (or other editable content) rather than to the app. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** The key a "G then …" sequence goes on to, from the letter pressed after G. */
export type GoTarget = 'd' | 'o' | 'h' | 'e' | 'c' | 's' | 'u'

export interface ShortcutHandlers {
  palette: () => void
  search: () => void
  newOrder: () => void
  go: (to: GoTarget) => void
  help: () => void
}

/** Wires the app-wide shortcuts to handlers; G waits a second for its letter. */
export function useShortcuts(h: ShortcutHandlers, enabled: boolean): void {
  const handlers = useRef(h)
  handlers.current = h
  useEffect(() => {
    if (!enabled) return
    let pendingG = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        handlers.current.palette()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return
      // A modal (a sheet, the palette, hand-over) owns the keyboard while open.
      if (document.querySelector('dialog[open]')) return
      const key = e.key.toLowerCase()
      if (pendingG && Date.now() - pendingG < 1000 && 'dohecsu'.includes(key)) {
        pendingG = 0
        e.preventDefault()
        handlers.current.go(key as GoTarget)
        return
      }
      pendingG = 0
      if (key === 'g') pendingG = Date.now()
      else if (e.key === '/') {
        e.preventDefault()
        handlers.current.search()
      } else if (key === 'n') {
        e.preventDefault()
        handlers.current.newOrder()
      } else if (e.key === '?') {
        e.preventDefault()
        handlers.current.help()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
