import type { CatalogueIcon, CatalogueItem, CatalogueItemInput, SizeGroup } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { ChevronRight, Plus } from 'lucide-react'
import { type FormEvent, Fragment, useEffect, useMemo, useState } from 'react'

import { ItemIcon, ItemTile, iconChoices } from '@/components/item-icon'
import { MoreActions } from '@/components/more-actions'
import { SortControl, SortableHead } from '@/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Field, Input, Select, controlProps } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi, useSession } from '@/lib/api'
import { guessIcon } from '@/lib/items'
import { type ItemStatus, itemStatus } from '@/lib/records'
import { type Route, linkTo } from '@/lib/router'
import { type SortColumn, type SortState, sortRows } from '@/lib/sort'
import { errorText, useLoad } from '@/lib/use-load'
import { cn, formatEuro, formatMonths, parseEuro } from '@/lib/utils'

export const sizeGroupLabel: Record<SizeGroup, string> = { CLOTHING: 'Clothing', SHOES: 'Shoes', NONE: 'No size' }

type CatalogueSort = 'name' | 'details' | 'group' | 'price' | 'period' | 'status'

const columns: SortColumn<CatalogueSort>[] = [
  { key: 'name', label: 'Item' },
  { key: 'details', label: 'Details' },
  { key: 'group', label: 'Size group' },
  { key: 'price', label: 'Unit price' },
  { key: 'period', label: 'Service period' },
  { key: 'status', label: 'Status' },
]

/**
 * Asks before an item is deactivated, which takes it out of Add Item;
 * activating needs no confirmation.
 */
export function confirmActiveChange(i: CatalogueItem): boolean {
  return !i.active || window.confirm(`Deactivate ${i.name}? It will no longer be offered in Add Item. Orders that hold it keep it.`)
}

const statusChips: { status: ItemStatus | 'all'; label: string }[] = [
  { status: 'all', label: 'All' },
  { status: 'active', label: 'Active' },
  { status: 'incomplete', label: 'Incomplete' },
  { status: 'inactive', label: 'Inactive' },
]

/** Active before inactive; an item missing its price or period sorts with the inactive ones, after them. */
function statusRank(i: CatalogueItem): number {
  return (i.active ? 0 : 2) + (i.unit_price_cents === null || i.service_period_months === null ? 1 : 0)
}

export function Catalogue({ navigate }: { navigate: (to: Route) => void }) {
  const { client } = useApi()
  const { canManageItems } = useSession()
  const items = useLoad(() => client.catalogue.list())
  const [editing, setEditing] = useState<CatalogueItem | 'new' | null>(null)
  const [actionError, setActionError] = useState<unknown>()
  // null is the catalogue's display order, the order Add Item lists items in.
  const [sort, setSort] = useState<SortState<CatalogueSort> | null>(null)
  const sortProps = { sort, onSort: setSort, allowNone: true }
  const [status, setStatus] = useState<ItemStatus | 'all'>('all')
  const counts = useMemo(() => {
    const c: Record<ItemStatus | 'all', number> = { all: 0, active: 0, incomplete: 0, inactive: 0 }
    for (const i of items.data ?? []) {
      c.all++
      c[itemStatus(i)]++
    }
    return c
  }, [items.data])
  const shown = useMemo(
    () =>
      sortRows((items.data ?? []).filter((i) => status === 'all' || itemStatus(i) === status), sort, (i, key) => {
        switch (key) {
          case 'name':
            return i.name
          case 'details':
            return i.details
          case 'group':
            return sizeGroupLabel[i.size_group]
          case 'price':
            return i.unit_price_cents
          case 'period':
            return i.service_period_months
          case 'status':
            return statusRank(i)
        }
      }),
    [items.data, sort, status],
  )

  const toggle = async (i: CatalogueItem) => {
    if (!confirmActiveChange(i)) return
    try {
      await client.catalogue.setActive(i.id, !i.active)
      items.reload()
    } catch (err) {
      setActionError(err)
    }
  }

  return (
    <>
      <PageHeader
        title="Item Catalogue"
        description="Current names, prices and service periods. Orders keep the values they were placed with."
        descriptionClassName="max-md:hidden"
        actions={
          canManageItems ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Add Item
            </Button>
          ) : undefined
        }
      />
      {counts.all > 0 ? (
        // One status per item; a chip with nothing in it is left out unless it is the one chosen.
        // On a phone the chips scroll sideways in their own row rather than take two lines.
        <div role="group" aria-label="Show" className="mb-4 flex gap-2 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none] md:flex-wrap">
          {statusChips
            .filter((c) => c.status === 'all' || c.status === 'active' || counts[c.status] > 0 || status === c.status)
            .map((c) => (
              <Button key={c.status} className="shrink-0" variant={status === c.status ? 'secondary' : 'outline'} aria-pressed={status === c.status} onClick={() => setStatus(c.status)}>
                {c.label} · {counts[c.status]}
              </Button>
            ))}
        </div>
      ) : null}
      {actionError ? <ErrorState title="Action failed" error={actionError} /> : null}
      {items.error ? (
        <ErrorState error={items.error} onRetry={items.reload} />
      ) : items.loading && !items.data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState>{status === 'all' ? 'No items yet.' : `No ${statusChips.find((c) => c.status === status)!.label.toLowerCase()} items.`}</EmptyState>
      ) : (
        /*
          Where the table is narrow the items are one list of two-line rows:
          name and price, then details, size group and service period, with
          Incomplete or Inactive flagged. A row opens the item, whose page holds
          Edit and Deactivate; the table keeps Edit and ⋯ on each row.
        */
        <Table stack="list" stackBelow="lg" sortControl={<SortControl columns={columns} noneLabel="Display order" {...sortProps} />}>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <SortableHead key={c.key} column={c} align={c.key === 'price' ? 'right' : 'left'} {...sortProps} />
              ))}
              {canManageItems ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((i, n, list) => {
              const incomplete = i.unit_price_cents === null || i.service_period_months === null
              // Sorted by size group, a heading starts each group: the way sizes are resolved.
              const newGroup = sort?.key === 'group' && list[n - 1]?.size_group !== i.size_group
              return (
                <Fragment key={i.id}>
                  {newGroup ? <TableGroupRow colSpan={columns.length + (canManageItems ? 1 : 0)}>{sizeGroupLabel[i.size_group]}</TableGroupRow> : null}
                  <TableRow
                    className={cn(
                      'cursor-pointer hover:bg-muted/50 stacked:grid stacked:grid-cols-[auto_minmax(0,1fr)_auto_auto] stacked:gap-x-3 stacked:hover:bg-muted/50',
                      !i.active && 'text-muted-foreground',
                    )}
                    // The whole row opens the item; the name is the real link, for keyboards,
                    // screen readers and "open in new tab". The row's own buttons keep their action.
                    onClick={(ev) => {
                      if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                      navigate({ name: 'catalogueItem', id: i.id })
                    }}
                  >
                    <TableCell className="font-medium stacked:col-start-2 stacked:row-start-1 stacked:min-w-0">
                      <span className="flex items-center gap-3">
                        <ItemTile icon={i.icon} className="size-8 stacked:hidden" />
                        <a {...linkTo({ name: 'catalogueItem', id: i.id }, navigate)} className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                          {i.name}
                        </a>
                      </span>
                    </TableCell>
                    {/* The stacked row's picture spans both lines; in the table it sits beside the name. */}
                    <TableCell aria-hidden className="hidden stacked:col-start-1 stacked:flex stacked:[grid-row:1/span_2]">
                      <ItemTile icon={i.icon} className="size-9" />
                    </TableCell>
                    <TableCell className="whitespace-normal stacked:hidden">{i.details || '—'}</TableCell>
                    <TableCell className="hidden stacked:[grid-column:2/span_2] stacked:row-start-2 stacked:block stacked:text-xs stacked:text-muted-foreground">
                      {[i.details, sizeGroupLabel[i.size_group], i.service_period_months !== null ? formatMonths(i.service_period_months) : null].filter(Boolean).join(' · ')}
                    </TableCell>
                    <TableCell className="stacked:hidden">{sizeGroupLabel[i.size_group]}</TableCell>
                    <TableCell className="text-right tabular-nums stacked:col-start-3 stacked:row-start-1 stacked:font-medium">{formatEuro(i.unit_price_cents)}</TableCell>
                    <TableCell className="stacked:hidden">{formatMonths(i.service_period_months)}</TableCell>
                    <TableCell
                      className={cn(
                        'space-x-1 stacked:[grid-column:2/span_2] stacked:row-start-3 stacked:flex stacked:gap-1 stacked:space-x-0 stacked:pt-1',
                        i.active && !incomplete && 'stacked:hidden',
                      )}
                    >
                      {i.active ? (
                        <Badge variant="secondary" className="stacked:hidden">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                      {incomplete ? <Badge variant="destructive">Incomplete</Badge> : null}
                    </TableCell>
                    <TableCell aria-hidden className="hidden stacked:col-start-4 stacked:flex stacked:[grid-row:1/span_2]">
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </TableCell>
                    {canManageItems ? (
                      <TableCell className="text-right whitespace-nowrap stacked:hidden">
                        <Button size="sm" variant="outline" onClick={() => setEditing(i)}>
                          Edit
                        </Button>{' '}
                        <MoreActions label={`More actions for ${i.name}`}>
                          <DropdownMenuItem variant={i.active ? 'destructive' : 'default'} onClick={() => void toggle(i)}>
                            {i.active ? 'Deactivate item…' : 'Activate item'}
                          </DropdownMenuItem>
                        </MoreActions>
                      </TableCell>
                    ) : null}
                  </TableRow>
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}
      <ItemForm
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          items.reload()
        }}
      />
    </>
  )
}

/** Add Item and Edit Item; also used on the item's own page. */
export function ItemForm({ item, onClose, onSaved }: { item: CatalogueItem | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { client } = useApi()
  const existing = item !== 'new' && item !== null ? item : undefined
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [group, setGroup] = useState<SizeGroup>('NONE')
  const [price, setPrice] = useState('')
  const [period, setPeriod] = useState('')
  const [rank, setRank] = useState('1000')
  const [active, setActive] = useState(true)
  const [icon, setIcon] = useState<CatalogueIcon>('other')
  // A new item's picture follows its name until someone picks one.
  const [iconPicked, setIconPicked] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setName(existing?.name ?? '')
    setDetails(existing?.details ?? '')
    setGroup(existing?.size_group ?? 'NONE')
    setPrice(existing?.unit_price_cents != null ? (existing.unit_price_cents / 100).toFixed(2) : '')
    setPeriod(existing?.service_period_months?.toString() ?? '')
    setRank(existing?.display_rank.toString() ?? '1000')
    setActive(existing?.active ?? true)
    setIcon(existing?.icon ?? 'other')
    setIconPicked(existing !== undefined)
    setError(undefined)
  }, [item, existing])

  const priceCents = parseEuro(price)
  const priceError = Number.isNaN(priceCents) ? 'Enter a price like 49.99.' : undefined
  const months = period.trim() === '' ? null : Number(period)
  const periodError = months !== null && (!Number.isInteger(months) || months < 1) ? 'Whole months, at least 1.' : undefined
  const rankNum = Number(rank)
  const rankError = !Number.isInteger(rankNum) || rankNum < 0 ? 'A whole number, 0 or more.' : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (priceError || periodError || rankError) return
    const input: CatalogueItemInput = {
      name,
      details,
      size_group: group,
      unit_price_cents: priceCents,
      service_period_months: months,
      active,
      display_rank: rankNum,
      icon,
    }
    try {
      if (existing) await client.catalogue.update(existing.id, input)
      else await client.catalogue.create(input)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError && err.isConflict ? 'An item with this name already exists.' : errorText(err))
    }
  }

  return (
    <FormSheet
      open={item !== null}
      onClose={onClose}
      title={existing ? 'Edit Item' : 'Add Item'}
      description="An item without a price or service period cannot be ordered until both are set."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Item name" required>
          {(p) => (
            <Input
              {...controlProps(p)}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!iconPicked) setIcon(guessIcon(e.target.value))
              }}
            />
          )}
        </Field>
        <Field label="Manufacturer / model">{(p) => <Input {...controlProps(p)} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
        <Field label="Size group" hint="Clothing and shoe items take the employee's size; no-size items (gloves, helmets) have none.">
          {(p) => (
            <Select {...controlProps(p)} value={group} onChange={(e) => setGroup(e.target.value as SizeGroup)}>
              {(Object.keys(sizeGroupLabel) as SizeGroup[]).map((g) => (
                <option key={g} value={g}>
                  {sizeGroupLabel[g]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Unit price (€)" error={priceError}>{(p) => <Input {...controlProps(p)} inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
        <Field label="Service period (months)" error={periodError}>{(p) => <Input {...controlProps(p)} inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value)} />}</Field>
        <Field label="Display order" hint="Lower comes first in Add Item." error={rankError}>
          {(p) => <Input {...controlProps(p)} inputMode="numeric" value={rank} onChange={(e) => setRank(e.target.value)} />}
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Picture</legend>
          <div className="grid grid-cols-5 gap-2">
            {iconChoices.map((c) => (
              <label
                key={c.icon}
                className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-border p-1.5 text-center text-xs text-muted-foreground has-checked:border-primary has-checked:bg-accent has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring"
              >
                <input
                  type="radio"
                  name="item-icon"
                  value={c.icon}
                  checked={icon === c.icon}
                  onChange={() => {
                    setIcon(c.icon)
                    setIconPicked(true)
                  }}
                  className="sr-only"
                />
                <ItemIcon icon={c.icon} className="size-5" />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" className="size-5 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (offered in Add Item)
        </label>
        {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
      </form>
    </FormSheet>
  )
}
