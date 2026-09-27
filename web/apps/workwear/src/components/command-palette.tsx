import type { CatalogueItem, Employee } from '@ppe/api-client'
import { ClipboardList, CornerDownLeft, Search, UserRound, type LucideIcon } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'

import { ItemIcon } from '@/components/item-icon'
import { useApi } from '@/lib/api'
import { matchItems } from '@/lib/items'
import type { Route } from '@/lib/router'
import { cn } from '@/lib/utils'

/** A screen the palette can jump to: the user's own navigation sections, and Account. */
export interface PaletteSection {
  route: Route
  label: string
  icon: LucideIcon
}

interface Entry {
  key: string
  group: 'Actions' | 'Screens' | 'Employees' | 'Items'
  label: string
  hint?: string
  icon: ReactNode
  to: Route
}

/** How many of each kind the palette lists, so the first screen of results stays short. */
const PER_GROUP = 5

/**
 * ⌘K (Ctrl+K): one search box over the screens, employees and catalogue items,
 * with the action most often wanted on each: a new order for an employee, an
 * item's page, a screen. Arrow keys move, Enter goes, Escape closes. A modal
 * dialog, so the page behind is inert while it is open.
 */
export function CommandPalette({
  open,
  sections,
  onClose,
  navigate,
}: {
  open: boolean
  sections: PaletteSection[]
  onClose: () => void
  navigate: (to: Route) => void
}) {
  const { client } = useApi()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [items, setItems] = useState<CatalogueItem[] | null>(null)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) {
      setQ('')
      setAt(0)
      d.showModal()
      input.current?.focus()
    } else if (!open && d.open) d.close()
  }, [open])

  // Escape fires cancel: close through the parent so its state agrees.
  useEffect(() => {
    const d = dialog.current
    if (!d) return
    const onCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    d.addEventListener('cancel', onCancel)
    return () => d.removeEventListener('cancel', onCancel)
  }, [onClose])

  // The catalogue once per opening; employees as the search changes.
  useEffect(() => {
    if (open && items === null) client.catalogue.listActive().then(setItems, () => setItems([]))
  }, [open, items, client])
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term) {
      setEmployees([])
      return
    }
    let current = true
    const t = setTimeout(() => {
      client.employees.search(term).then(
        (r) => current && setEmployees(r),
        () => current && setEmployees([]),
      )
    }, 150)
    return () => {
      current = false
      clearTimeout(t)
    }
  }, [q, open, client])

  const entries = useMemo<Entry[]>(() => {
    const term = q.trim().toLowerCase()
    const has = (s: string) => s.toLowerCase().includes(term)
    const out: Entry[] = []
    if (!term || has('new order') || has('create order')) {
      out.push({ key: 'new', group: 'Actions', label: 'New order', icon: <ClipboardList aria-hidden className="size-4" />, to: { name: 'createOrder' } })
    }
    for (const e of employees.slice(0, PER_GROUP)) {
      out.push({
        key: `new-${e.id}`,
        group: 'Actions',
        label: `New order for ${e.full_name}`,
        icon: <ClipboardList aria-hidden className="size-4" />,
        to: { name: 'createOrder', prefill: { employeeId: e.id, items: [] } },
      })
    }
    for (const s of sections.filter((s) => !term || has(s.label))) {
      const Icon = s.icon
      out.push({ key: `screen-${s.label}`, group: 'Screens', label: s.label, icon: <Icon aria-hidden className="size-4" />, to: s.route })
    }
    for (const e of employees.slice(0, PER_GROUP)) {
      out.push({
        key: `emp-${e.id}`,
        group: 'Employees',
        label: e.full_name,
        ...(e.code ? { hint: e.code } : {}),
        icon: <UserRound aria-hidden className="size-4" />,
        to: { name: 'employee', id: e.id },
      })
    }
    if (term) {
      for (const i of matchItems(items ?? [], term).slice(0, PER_GROUP)) {
        out.push({ key: `item-${i.id}`, group: 'Items', label: i.name, hint: i.details, icon: <ItemIcon icon={i.icon} />, to: { name: 'catalogueItem', id: i.id } })
      }
    }
    return out
  }, [q, employees, items, sections])

  useEffect(() => setAt(0), [q])
  const selected = entries[Math.min(at, entries.length - 1)]

  const go = (e: Entry | undefined) => {
    if (!e) return
    onClose()
    navigate(e.to)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = entries.length
      if (n > 0) setAt((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(selected)
    }
  }

  let lastGroup = ''
  return (
    <dialog
      ref={dialog}
      aria-label="Search or jump to"
      className="mx-auto mt-[12dvh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl backdrop:bg-black/40"
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={selected ? `${listId}-${selected.key}` : undefined}
          aria-label="Search or jump to"
          placeholder="Search employees, items and screens…"
          autoComplete="off"
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground">esc</kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(24rem,60dvh)] overflow-y-auto p-1">
        {entries.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{q.trim()}”.</li> : null}
        {entries.map((e) => {
          const heading = e.group !== lastGroup ? e.group : null
          lastGroup = e.group
          const active = e === selected
          return (
            <li key={e.key} role="presentation">
              {heading ? <div className="px-3 pt-2 pb-1 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{heading}</div> : null}
              <div
                id={`${listId}-${e.key}`}
                role="option"
                aria-selected={active}
                className={cn('flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm', active && 'bg-accent text-accent-foreground')}
                onMouseMove={() => setAt(entries.indexOf(e))}
                onClick={() => go(e)}
              >
                <span className="text-muted-foreground">{e.icon}</span>
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                {e.hint ? <span className="truncate text-xs text-muted-foreground">{e.hint}</span> : null}
                {active ? <CornerDownLeft aria-hidden className="size-3.5 text-muted-foreground" /> : null}
              </div>
            </li>
          )
        })}
      </ul>
    </dialog>
  )
}
