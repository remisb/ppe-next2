import { X } from 'lucide-react'
import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { besideList } from '../lib/list-keys.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { BackButton } from './back-button.tsx'
import { Button } from './button.tsx'
import { Kbd } from './kbd.tsx'

const paneWidths = {
  /** Orders, the registers, the Audit log, System's errors. */
  md: 'lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]',
  /** A record with more to show beside its list: an item, an employee. */
  lg: 'lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]',
}

/**
 * List and detail (ui-language.md): a list whose record opens beside it from
 * lg and in its place below, at the record's own address. Narrow, the list is
 * only hidden, so it keeps its filters, page and scroll behind the record.
 */
export function ListDetail({
  pane,
  width = 'md',
  children,
}: {
  /** The open record (a DetailPane), or null when none is open. */
  pane: ReactNode
  width?: keyof typeof paneWidths
  /** The list: its header, filters, table and pages. */
  children: ReactNode
}) {
  const open = pane !== null && pane !== undefined && pane !== false
  useListPlace(open)
  return (
    <div className={cn(open && 'lg:grid lg:items-start lg:gap-6', open && paneWidths[width])}>
      <div className={cn('min-w-0', open && 'max-lg:hidden')}>{children}</div>
      {pane}
    </div>
  )
}

/**
 * The list keeps its place when its record closes (WARE-25): below lg, where
 * the record took the list's place and the window's scroll, the list's own
 * scroll comes back; at any width the marked row (useMarkedRow) is then
 * brought into view if the list's new layout moved it out.
 */
function useListPlace(open: boolean): void {
  // Where the list was last scrolled to while it showed, read from its scroll events: by the time
  // a record opens, the window has already gone to its top for it.
  const listScroll = useRef(0)
  const wasOpen = useRef(open)
  useLayoutEffect(() => {
    const closed = wasOpen.current && !open
    wasOpen.current = open
    if (!closed) return
    if (!besideList()) window.scrollTo(0, listScroll.current)
    // One frame later, once the list has its full width again.
    const frame = requestAnimationFrame(() =>
      document.querySelector('[data-slot=table-row][data-state=selected]')?.scrollIntoView({ block: 'nearest' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [open])
  // After the restore above, so it starts from the list's place, not the record's.
  useLayoutEffect(() => {
    if (open) return
    listScroll.current = window.scrollY
    const onScroll = () => {
      listScroll.current = window.scrollY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [open])
}

/**
 * The open record beside its list: a card that stays in view as the list
 * scrolls (from lg), with, where there is a keyboard, a line saying J / K
 * steps through the list and Esc closes it (useListKeys). Below lg it is the
 * whole screen, without a card.
 */
export function DetailPane({ label, next, children }: { label: string; /** "next or previous order" */ next?: string | undefined; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      // Its top edge is the screen header's, the top of the window at rest (-mt-8, main's padding) and stuck, so their rows line up;
      // 2rem shorter than the window, main's padding below it, so it still fits at the end of the list.
      className="relative lg:sticky lg:top-0 lg:-mt-8 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-4"
    >
      {children}
      {next ? (
        // Beside the list only, and only where there is a keyboard.
        <p className="mt-3 hidden border-t border-border pt-3 text-xs text-muted-foreground lg:block pointer-coarse:hidden">
          <Kbd>J</Kbd> / <Kbd>K</Kbd> {next} · <Kbd>Esc</Kbd> {uiText().closeHint}
        </p>
      ) : null}
    </aside>
  )
}

/**
 * The way out of an open record while it loads or fails: below lg, Back to
 * the list on its own row; beside the list, Close in the pane's corner. Once
 * the record's RecordHeader is there (with `nav`), its row holds both and
 * this is hidden (styles.css).
 */
export function PaneBar({
  backLabel,
  closeLabel,
  onClose,
  className,
}: {
  /** The list's name: "Orders". */
  backLabel: string
  /** "Close order" */
  closeLabel: string
  onClose: () => void
  /** The Back row's spacing in its pane. */
  className?: string | undefined
}) {
  return (
    <>
      <BackButton data-slot="pane-bar" className={cn('lg:hidden', className)} onClick={onClose}>
        {backLabel}
      </BackButton>
      <Button data-slot="pane-close" variant="ghost" size="icon" className="absolute top-2 right-2 max-lg:hidden" aria-label={closeLabel} onClick={onClose}>
        <X aria-hidden />
      </Button>
    </>
  )
}
