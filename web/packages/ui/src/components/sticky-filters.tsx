import { type ComponentProps, useEffect, useRef } from 'react'

import { cn } from '../lib/utils.ts'
import { useStuck } from '../lib/use-stuck.ts'

/**
 * A long log's filter bar that sticks under the screen's header (Option C,
 * docs/ux/screen-header-toolbar.md): the Audit log alone, where people filter
 * while deep in the list. It sticks only where the list is at least 56rem wide
 * (a container query: the list's wrapper is `@container`, and this its direct
 * child, so it sticks the list's length), where its controls fit one row;
 * narrower, and on a phone, it scrolls with the list and the header's Filters
 * reaches it. Stuck, it gains a rule, never height; the column heads
 * (`Table stickyHead`) stick and J / K scroll below it (--filter-bar).
 */
export function StickyFilters({ className, ...props }: ComponentProps<'section'>) {
  const mark = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLElement>(null)
  useStuck(mark, bar)
  useEffect(() => {
    const el = bar.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    // Its height while it sticks, else none: what goes below it moves down only then.
    const measure = () => root.style.setProperty('--filter-bar', getComputedStyle(el).position === 'sticky' ? `${el.offsetHeight}px` : '0px')
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // A window made taller or shorter (the short-window rule) changes whether it sticks, not its size.
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      root.style.removeProperty('--filter-bar')
    }
  }, [])
  return (
    <>
      {/* Drawn as high above as the header is tall, so it leaves the window just as the bar sticks. */}
      <div ref={mark} aria-hidden className="relative -top-(--header-offset) -mb-px h-px print:hidden" />
      <section
        ref={bar}
        {...props}
        className={cn(
          className,
          // Full width of main, as the header, with as much space above and below as it had at rest.
          '@4xl:sticky @4xl:top-(--header-offset) @4xl:z-20 @4xl:-mx-6 @4xl:-mt-3 @4xl:mb-1 @4xl:bg-background @4xl:px-6 @4xl:py-3',
          '@4xl:border-b @4xl:border-transparent @4xl:transition-[border-color] @4xl:data-stuck:border-border',
          '[@media(height<30rem)]:static print:static',
        )}
      />
    </>
  )
}
