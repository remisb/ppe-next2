import { type ReactNode, useEffect, useRef } from 'react'

import type { Selection } from '../lib/use-selection.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { Button } from './button.tsx'

const box = 'size-4 align-middle accent-primary pointer-coarse:size-5'

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

/** A row's checkbox, named by the row (its name, number). The row's own click handler should skip inputs. */
export function RowCheckbox({ selection, id, name }: { selection: Selection; id: string; name: string }) {
  return (
    <input
      type="checkbox"
      className={box}
      aria-label={uiText().selectRow(name)}
      checked={selection.has(id)}
      onChange={(e) => selection.toggle(id, e.target.checked)}
    />
  )
}

/**
 * Above a list while rows are ticked: how many, the actions on them
 * (`children`, small buttons), then Clear selection.
 */
export function SelectionBar({ selection, children, className }: { selection: Selection; children?: ReactNode; className?: string }) {
  if (selection.count === 0) return null
  const t = uiText()
  const count = t.selectedRows(selection.count)
  return (
    <div role="group" aria-label={count} data-slot="selection-bar" className={cn('mb-3 flex flex-wrap items-center gap-2 border-y border-border py-2', className)}>
      <span className="text-sm font-medium" aria-live="polite">
        {count}
      </span>
      {children}
      <Button size="sm" variant="ghost" onClick={selection.clear}>
        {t.clearSelection}
      </Button>
    </div>
  )
}
