import type { Employee } from '@ppe/api-client'
import { Search, UserPlus } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

import { Input } from '@/components/ui/field'
import { useApi } from '@/lib/api'

/** The minimum a picker needs to show the chosen employee. */
export interface PickedEmployee {
  id: string
  full_name: string
  code: string | null
}

/**
 * Searchable employee selector showing name and code. Create Order's Assigned
 * to passes onAddNew so + Add New Employee is always available; History passes
 * onClear so the filter can be removed.
 */
export function EmployeePicker({
  label,
  selected,
  disabled = false,
  onSelect,
  onAddNew,
  onClear,
}: {
  label: string
  selected: PickedEmployee | null
  disabled?: boolean
  onSelect: (e: Employee) => void
  onAddNew?: () => void
  onClear?: () => void
}) {
  const { client } = useApi()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Employee[]>([])
  const [error, setError] = useState<unknown>()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    let current = true
    const t = setTimeout(() => {
      ;(term ? client.employees.search(term) : client.employees.list()).then(
        (r) => current && (setResults(r.slice(0, 50)), setError(undefined)),
        (err: unknown) => current && setError(err),
      )
    }, 200)
    return () => {
      current = false
      clearTimeout(t)
    }
  }, [q, open, client])

  // pointerdown, not mousedown: one event for mouse, touch and pen.
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  /** Escape closes; the arrow keys move between the input and the choices. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation() // inside a FormSheet, close the list, not the sheet
      setOpen(false)
      box.current?.querySelector('input')?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[role=listbox] button') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, items.length - 1) : at - 1
    if (next < 0) box.current?.querySelector('input')?.focus()
    else items[next]?.focus()
  }

  const selectedLabel = useMemo(
    () => (selected ? `${selected.full_name}${selected.code ? ` · ${selected.code}` : ''}` : ''),
    [selected],
  )

  return (
    <div ref={box} className="relative" onKeyDown={onKeyDown}>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          role="combobox"
          autoComplete="off"
          enterKeyHint="search"
          aria-expanded={open}
          aria-label={label}
          className="pl-9"
          disabled={disabled}
          placeholder={selectedLabel || 'Search employees…'}
          value={open ? q : selectedLabel}
          onFocus={() => {
            setOpen(true)
            setQ('')
          }}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {open ? (
        <ul
          role="listbox"
          className="absolute z-40 mt-1 max-h-[min(18rem,50dvh)] w-full overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {onAddNew ? (
            <li>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 rounded px-2 py-2 text-left text-sm font-medium text-primary outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  setOpen(false)
                  onAddNew()
                }}
              >
                <UserPlus aria-hidden className="size-4" /> + Add New Employee
              </button>
            </li>
          ) : null}
          {onClear && selected ? (
            <li>
              <button
                type="button"
                className="flex min-h-11 w-full items-center rounded px-2 py-2 text-left text-sm text-muted-foreground outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  setOpen(false)
                  onClear()
                }}
              >
                All employees
              </button>
            </li>
          ) : null}
          {error ? <li className="px-2 py-2 text-sm text-destructive">Could not search employees.</li> : null}
          {results.map((e) => (
            <li key={e.id} role="option" aria-selected={selected?.id === e.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                  setOpen(false)
                  onSelect(e)
                }}
              >
                <span>{e.full_name}</span>
                {e.code ? <span className="text-muted-foreground">{e.code}</span> : null}
              </button>
            </li>
          ))}
          {!error && results.length === 0 ? <li className="px-2 py-2 text-sm text-muted-foreground">No matching employees.</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

