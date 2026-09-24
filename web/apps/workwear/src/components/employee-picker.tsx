import type { Employee } from '@ppe/api-client'
import { Search, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

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

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const selectedLabel = useMemo(
    () => (selected ? `${selected.full_name}${selected.code ? ` · ${selected.code}` : ''}` : ''),
    [selected],
  )

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          role="combobox"
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
        <ul role="listbox" className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {onAddNew ? (
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
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
                className="w-full rounded px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
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
                className="flex w-full justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-accent"
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

