import { type ReactNode, useEffect, useRef } from 'react'

import type { Selection } from '../lib/use-selection.ts'
import { useSelectModeEscape } from '../lib/use-selection.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { Button } from './button.tsx'

const box = 'size-4 align-middle accent-primary pointer-coarse:size-5'

/**
 * The checkbox column's cell (header or row) in select mode. Where the table
 * stacks into a list (a phone) the cell sits on the row's left, over the
 * padding `selectRowClass` gives the row, so every list's own grid stays as it is.
 */
export const selectCellClass = 'w-10 stacked:absolute stacked:inset-y-0 stacked:left-0 stacked:flex stacked:w-10 stacked:items-center stacked:justify-center stacked:p-0'

/** A row's classes in select mode: room on the left for the stacked checkbox, and the tint of a ticked row. */
export function selectRowClass(selection: Pick<Selection, 'active' | 'has'>, id: string) {
  if (!selection.active) return undefined
  return cn('stacked:relative stacked:pl-10', selection.has(id) && 'bg-primary/5 stacked:bg-primary/5')
}

/** The header's checkbox: ticks or clears every row shown; a dash while some are ticked. */
export function SelectAllCheckbox({ selection, label }: { selection: Selection; label?: string | undefined }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selection.state === 'some'
  }, [selection.state])
  return (
    <input
      ref={ref}
      type="checkbox"
      className={box}
      aria-label={label ?? uiText().selectAllShown}
      checked={selection.state === 'all'}
      onChange={(e) => selection.setAll(e.target.checked)}
    />
  )
}

/**
 * A row's checkbox, named by the row (its name, number). Its click reaches the
 * row's own handler (selectRowProps), which ticks it, so it is only drawn here.
 */
export function RowCheckbox({ selection, id, name }: { selection: Selection; id: string; name: string }) {
  return (
    <input
      type="checkbox"
      className={box}
      aria-label={uiText().selectRow(name)}
      checked={selection.has(id)}
      // The row's click handler ticks it (selectRowProps); a keyboard's Space clicks it too.
      onChange={() => {}}
    />
  )
}

/**
 * Select mode's bar (WARE-45): what the ticks are for, how many, the action's
 * buttons (`children`), then Cancel. Above the list from md, sticky under the
 * header; on a phone at the bottom, above the tab bar, in thumb reach.
 * Escape leaves the mode, and focus starts on the bar so a screen reader hears it.
 */
export function SelectModeBar({
  selection,
  title,
  hint,
  children,
  className,
}: {
  selection: Selection
  title: string
  hint?: string | undefined
  children?: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useSelectModeEscape(selection)
  const active = selection.active
  useEffect(() => {
    if (active) ref.current?.focus({ preventScroll: true })
  }, [active])
  if (!active) return null
  const t = uiText()
  const count = t.selectedRows(selection.count)
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label={title}
      data-slot="select-mode-bar"
      className={cn(
        'z-20 flex flex-wrap items-center gap-x-2 gap-y-1 border-primary/25 bg-accent px-3 py-2 outline-none',
        // Phone: pinned above the tab bar, with 44px buttons.
        'max-md:fixed max-md:inset-x-0 max-md:bottom-[var(--bottom-nav)] max-md:border-t max-md:pb-3 max-md:shadow-[0_-6px_14px_-8px_rgb(0_0_0/0.25)]',
        // From md: a band above the list, under the screen's sticky header.
        'md:sticky md:top-[var(--header-offset,0px)] md:-mx-1 md:mb-3 md:rounded-md md:border',
        className,
      )}
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="mr-auto text-sm font-medium text-primary" aria-live="polite">
        {count}
      </span>
      <div className="flex flex-wrap items-center gap-2 max-md:order-last max-md:w-full max-md:[&>*]:min-h-11 max-md:[&>*]:flex-1">{children}</div>
      <Button size="sm" variant="ghost" onClick={selection.end}>
        {t.cancel}
      </Button>
      {hint ? <p className="basis-full text-xs text-muted-foreground max-md:hidden">{hint}</p> : null}
    </div>
  )
}
