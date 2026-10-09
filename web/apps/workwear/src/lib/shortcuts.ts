import { useEffect, useRef } from 'react'

import { t } from '@/i18n'

/**
 * Keyboard shortcuts for people who use the app all day on a desktop. None
 * fires while typing in a field, except the palette's ⌘K / Ctrl+K; a letter
 * never steals a keystroke meant for text.
 */
export function shortcutList(): { keys: string; does: string }[] {
  const d = t.shell.shortcuts
  return [
    { keys: '⌘K / Ctrl+K', does: d.palette },
    { keys: '/', does: d.search },
    { keys: 'N', does: d.newOrder },
    { keys: d.goToKeys, does: d.goTo },
    { keys: 'J / K', does: d.nextPrevious },
    { keys: 'Esc', does: d.closeOrder },
    { keys: '⌘Enter / Ctrl+Enter', does: d.review },
    { keys: '↑ / ↓', does: d.quantity },
    { keys: '?', does: d.help },
  ]
}

/** Whether a key press belongs to a field (or other editable content) rather than to the app. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/** The key a "G then …" sequence goes on to, from the letter pressed after G. */
export type GoTarget = 'd' | 'o' | 'h' | 'e' | 'a' | 'c' | 's' | 'u'

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
      if (pendingG && Date.now() - pendingG < 1000 && 'doheacsu'.includes(key)) {
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
