import type { CatalogueItem } from '@ppe/api-client'
import { Plus } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'

import { Input } from '@/components/ui/field'
import { matchItems } from '@/lib/items'
import { cn, formatEuro } from '@/lib/utils'

/**
 * Add Item: a search over the active catalogue. Typing narrows the list by
 * name or manufacturer/model; Enter adds the first match, so a known item is
 * a few letters and Enter. Each choice shows its price, and an item without a
 * price or service period says so before it is added.
 */
export function ItemPicker({
  items,
  disabled = false,
  onPick,
}: {
  items: readonly CatalogueItem[] | undefined
  disabled?: boolean
  onPick: (item: CatalogueItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()
  const shown = useMemo(() => matchItems(items ?? [], q), [items, q])

  // pointerdown, not mousedown: one event for mouse, touch and pen.
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const pick = (item: CatalogueItem) => {
    setOpen(false)
    setQ('')
    onPick(item)
  }

  /** Enter adds the first match; Escape closes; the arrow keys move between the field and the choices. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      box.current?.querySelector('input')?.focus()
      return
    }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      const first = shown[0]
      if (open && first) {
        e.preventDefault()
        pick(first)
      }
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    setOpen(true)
    const choices = Array.from(box.current?.querySelectorAll<HTMLElement>('[role=listbox] button') ?? [])
    if (choices.length === 0) return
    e.preventDefault()
    const at = choices.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, choices.length - 1) : at - 1
    if (next < 0) box.current?.querySelector('input')?.focus()
    else choices[next]?.focus()
  }

  return (
    <div ref={box} className="relative" onKeyDown={onKeyDown}>
      <Plus aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        role="combobox"
        autoComplete="off"
        enterKeyHint="done"
        aria-label="Add Item"
        aria-expanded={open}
        aria-controls={listId}
        className="pl-9"
        disabled={disabled}
        placeholder="Add an item…"
        value={q}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Items"
          className="absolute z-40 mt-1 max-h-[min(20rem,50dvh)] w-full overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {shown.map((i) => {
            const incomplete = i.unit_price_cents === null || i.service_period_months === null
            return (
              <li key={i.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => pick(i)}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{i.name}</span>
                    {i.details ? <span className="block truncate text-xs text-muted-foreground">{i.details}</span> : null}
                  </span>
                  <span className={cn('shrink-0 text-xs tabular-nums', incomplete ? 'text-destructive' : 'text-muted-foreground')}>
                    {incomplete ? 'No price' : formatEuro(i.unit_price_cents)}
                  </span>
                </button>
              </li>
            )
          })}
          {shown.length === 0 ? (
            <li className="px-2 py-2 text-sm text-muted-foreground">{items ? `No item matches “${q.trim()}”.` : 'Loading items…'}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
