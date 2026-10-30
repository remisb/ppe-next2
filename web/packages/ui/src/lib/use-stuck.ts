import { type RefObject, useEffect } from 'react'

/**
 * Marks a sticky row data-stuck while it is stuck: once the 1px mark placed
 * right above it has scrolled past the row's top, in the window or in the
 * pane that scrolls it. An observer, not a scroll listener; the row's look
 * changes (a rule, a shadow), never its height.
 */
export function useStuck(mark: RefObject<HTMLElement | null>, row: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = mark.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => {
      const bar = row.current
      if (!bar || !e) return
      bar.toggleAttribute('data-stuck', !e.isIntersecting && e.boundingClientRect.top < bar.getBoundingClientRect().top)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [mark, row])
}
