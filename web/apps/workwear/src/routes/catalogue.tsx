import type { CatalogueIcon, CatalogueItem, CatalogueItemInput, SizeGroup } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { Field, Input, Select, controlProps } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { SortControl, SortableHead } from '@ppe/ui/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { type SortColumn, type SortState, sortRows } from '@ppe/ui/lib/sort'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronRight, GripVertical, Plus } from 'lucide-react'
import { type FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { InactiveItemBadge, IncompleteBadge } from '@/components/status-badges'
import { ItemIcon, ItemTile, iconChoices } from '@/components/item-icon'
import { t } from '@/i18n'
import { guessIcon } from '@/lib/items'
import { moveBefore } from '@/lib/catalogue-order'
import { type ItemStatus, itemStatus } from '@/lib/records'
import { type NavigateOptions, type Route, linkTo } from '@/lib/router'
import { isTyping } from '@/lib/shortcuts'
import { useRowDrag } from '@/lib/use-row-drag'
import { formatEuro, formatMonths, parseEuro } from '@/lib/utils'

import { CatalogueItemDetail } from './catalogue-item'

/** Each size group's name in the current language; the getters read the text in use at each lookup. */
export const sizeGroupLabel: Record<SizeGroup, string> = {
  get CLOTHING() {
    return t.catalogue.clothing
  },
  get SHOES() {
    return t.catalogue.shoes
  },
  get NONE() {
    return t.catalogue.noSize
  },
}

type CatalogueSort = 'name' | 'details' | 'group' | 'price' | 'period' | 'status'

/** Beside an open item the list keeps the columns that find the next one; the rest is in the pane. */
const besideColumns: CatalogueSort[] = ['name', 'price', 'status']

const columns = (): SortColumn<CatalogueSort>[] => [
  { key: 'name', label: t.catalogue.colItem, kind: 'text' },
  { key: 'details', label: t.catalogue.colDetails, kind: 'text' },
  { key: 'group', label: t.catalogue.sizeGroup, kind: 'text' },
  { key: 'price', label: t.catalogue.accountingPrice, kind: 'number' },
  { key: 'period', label: t.catalogue.servicePeriod, kind: 'duration' },
  { key: 'status', label: t.catalogue.colStatus },
]

/**
 * Asks before an item is deactivated, which takes it out of Add Item;
 * activating needs no confirmation.
 */
export function confirmActiveChange(i: CatalogueItem): boolean {
  return !i.active || window.confirm(t.catalogue.confirmDeactivate(i.name))
}

const statusChips = (): { status: ItemStatus | 'all'; label: string; empty: string }[] => [
  { status: 'all', label: t.catalogue.statusAll, empty: t.catalogue.noItems },
  { status: 'active', label: t.catalogue.statusActive, empty: t.catalogue.noActiveItems },
  { status: 'incomplete', label: t.catalogue.statusIncomplete, empty: t.catalogue.noIncompleteItems },
  { status: 'inactive', label: t.catalogue.statusInactive, empty: t.catalogue.noInactiveItems },
]

/** Active before inactive; an item missing its price or period sorts with the inactive ones, after them. */
function statusRank(i: CatalogueItem): number {
  return (i.active ? 0 : 2) + (i.accounting_price_cents === null || i.service_period_months === null ? 1 : 0)
}

/** From lg an item opens beside the list; below it, instead of the list. */
const wide = () => window.matchMedia('(min-width: 64rem)').matches

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-border px-1 font-mono">{children}</kbd>
}

/**
 * The Item Catalogue. A row opens its item as Orders opens an order
 * (/catalogue/<id>): beside the list from lg, with J and K for the next or
 * previous one and Escape to close it, and on its own on a narrow screen; the
 * list keeps its tab and sort behind it.
 */
export function Catalogue({
  item: selected,
  navigate,
}: {
  /** The item open beside the list. */
  item?: string | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
}) {
  const { client } = useApi()
  const canManageItems = useSession().can('catalogue.manage')
  const items = useLoad(() => client.catalogue.list())
  const [editing, setEditing] = useState<CatalogueItem | 'new' | null>(null)
  const [picturesOpen, setPicturesOpen] = useState(false)
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
            return i.accounting_price_cents
          case 'period':
            return i.service_period_months
          case 'status':
            return statusRank(i)
        }
      }),
    [items.data, sort, status],
  )

  // Moving an item: in the display order only (no column sorted), by those who manage items.
  const canMove = canManageItems && sort === null
  // The order a move left, shown until the list is read again; and what a screen reader hears of it.
  const [pending, setPending] = useState<{ shown: string[]; all: string[] } | null>(null)
  const [moved, setMoved] = useState('')
  useEffect(() => setPending(null), [items.data])
  // Moves are sent one after another, each from the order the one before left.
  const moves = useRef(Promise.resolve())
  const shownIds = useMemo(() => pending?.shown.filter((id) => shown.some((i) => i.id === id)) ?? shown.map((i) => i.id), [pending, shown])
  const move = (order: string[], id: string) => {
    const all = pending?.all ?? (items.data ?? []).map((i) => i.id)
    const before = moveBefore(all, order, id)
    const rest = all.filter((x) => x !== id)
    const at = before === null ? rest.length : rest.indexOf(before)
    setPending({ shown: order, all: [...rest.slice(0, at), id, ...rest.slice(at)] })
    const name = shown.find((i) => i.id === id)?.name ?? ''
    moves.current = moves.current.then(async () => {
      try {
        await client.catalogue.move(id, before)
        setMoved(t.catalogue.movedTo(name, order.indexOf(id) + 1, order.length))
      } catch (err) {
        setActionError(err)
      }
      items.reload()
    })
  }
  const drag = useRowDrag(shownIds, move)
  const rows = useMemo(() => {
    const byId = new Map(shown.map((i) => [i.id, i]))
    return (drag.order ?? shownIds).flatMap((id) => byId.get(id) ?? [])
  }, [shown, drag.order, shownIds])

  const openItem = (id: string) => navigate({ name: 'catalogue', item: id }, { scroll: !wide() })
  const close = () => navigate({ name: 'catalogue' }, { scroll: false })

  // J and K: the next or previous item in the list as shown, while one is open; Escape closes it beside the list.
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return
      if (e.key === 'Escape' && wide()) {
        e.preventDefault()
        close()
        return
      }
      if (key !== 'j' && key !== 'k') return
      const n = shown.findIndex((i) => i.id === selected)
      const next = shown[n + (key === 'j' ? 1 : -1)]
      if (next) {
        e.preventDefault()
        navigate({ name: 'catalogue', item: next.id }, { scroll: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, shown, navigate])

  // The open item's row stays in view as J and K move through the list.
  useEffect(() => {
    if (selected && wide()) document.querySelector('[data-slot=table-row][aria-current=true]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, shown])

  const beside = selected !== undefined
  const shownColumns = beside ? columns().filter((c) => besideColumns.includes(c.key)) : columns()
  // Its actions are in the pane beside the list.
  const rowActions = canManageItems && !beside

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
      <div className={cn(beside && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] lg:items-start lg:gap-6')}>
        {/* Narrow, an open item takes the screen; the list keeps its tab and sort behind it. */}
        <div className={cn('min-w-0', beside && 'max-lg:hidden')}>
          <PageHeader
            title={t.catalogue.title}
            description={t.catalogue.description}
            descriptionClassName="max-md:hidden"
            actions={
              canManageItems ? (
                <>
                  <Button variant="outline" onClick={() => setPicturesOpen(true)}>
                    {t.catalogue.pictures}
                  </Button>
                  <Button onClick={() => setEditing('new')}>
                    <Plus aria-hidden /> {t.catalogue.addItem}
                  </Button>
                </>
              ) : undefined
            }
          />
          {counts.all > 0 ? (
            // One status per item; a tab with nothing in it is left out unless it is the one chosen.
            // The same tabs as Orders, equal where they fit; on a phone each narrows to its words, and four that still do not fit scroll sideways.
            <div className="mb-4 max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none]">
              <div role="group" aria-label={t.catalogue.show} className="flex w-max min-w-full gap-1 rounded-lg bg-muted p-1 sm:inline-grid sm:w-auto sm:min-w-0 sm:grid-flow-col sm:auto-cols-fr">
                {statusChips()
                  .filter((c) => c.status === 'all' || c.status === 'active' || counts[c.status] > 0 || status === c.status)
                  .map((c) => (
                    <button
                      key={c.status}
                      type="button"
                      aria-pressed={status === c.status}
                      onClick={() => setStatus(c.status)}
                      className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11"
                    >
                      {c.label}
                      <span className="tabular-nums text-muted-foreground">{counts[c.status]}</span>
                    </button>
                  ))}
              </div>
            </div>
          ) : null}
          {actionError ? <ErrorState title={t.common.actionFailed} error={actionError} /> : null}
          <p aria-live="polite" className="sr-only">
            {moved}
          </p>
          {items.error ? (
            <ErrorState error={items.error} onRetry={items.reload} />
          ) : items.loading && !items.data ? (
            <Loading />
          ) : shown.length === 0 ? (
            <EmptyState>{statusChips().find((c) => c.status === status)!.empty}</EmptyState>
          ) : (
            /*
              Where the table is narrow the items are one list of two-line rows:
              name and price, then details, size group and service period, with
              Incomplete or Inactive flagged. A row opens the item, whose page holds
              Edit and Deactivate; the table keeps Edit and ⋯ on each row.
            */
            <Table stack="list" stackBelow={beside ? 'sm' : 'lg'} sortControl={<SortControl columns={shownColumns} noneLabel={t.catalogue.displayOrder} {...sortProps} />}>
              <TableHeader>
                <TableRow>
                  {shownColumns.map((c) => (
                    <SortableHead key={c.key} column={c} align={c.key === 'price' ? 'right' : 'left'} {...sortProps} />
                  ))}
                  {rowActions ? <TableHead className="text-right">{t.catalogue.actions}</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i, n, list) => {
                  const incomplete = i.accounting_price_cents === null || i.service_period_months === null
                  // Sorted by size group, a heading starts each group: the way sizes are resolved.
                  const newGroup = sort?.key === 'group' && list[n - 1]?.size_group !== i.size_group
                  return (
                    <Fragment key={i.id}>
                      {newGroup ? <TableGroupRow colSpan={shownColumns.length + (rowActions ? 1 : 0)}>{sizeGroupLabel[i.size_group]}</TableGroupRow> : null}
                      <TableRow
                        data-row-id={i.id}
                        data-state={selected === i.id ? 'selected' : undefined}
                        aria-current={selected === i.id ? 'true' : undefined}
                        className={cn(
                          'cursor-pointer hover:bg-muted/50 stacked:grid stacked:grid-cols-[auto_minmax(0,1fr)_auto_auto] stacked:gap-x-3 stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted',
                          // The row being moved stands out where it will land.
                          drag.dragging === i.id && 'relative z-10 bg-accent shadow-md outline-2 -outline-offset-2 outline-primary hover:bg-accent',
                          !i.active && 'text-muted-foreground',
                        )}
                        // The whole row opens the item; the name is the real link, for keyboards,
                        // screen readers and "open in new tab". The row's own buttons keep their action.
                        onClick={(ev) => {
                          if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                          openItem(i.id)
                        }}
                      >
                        <TableCell className="font-medium stacked:col-start-2 stacked:row-start-1 stacked:min-w-0">
                          <span className="flex items-center gap-3">
                            {canMove ? (
                              // The handle: press and move, or the arrow keys. Not on a stacked row, which only opens the item.
                              <button
                                type="button"
                                aria-label={t.catalogue.moveItem(i.name)}
                                title={t.catalogue.moveHint}
                                className="-mx-1.5 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing pointer-coarse:size-11 stacked:hidden"
                                {...drag.handleProps(i.id)}
                              >
                                <GripVertical aria-hidden className="size-4" />
                              </button>
                            ) : null}
                            <ItemTile icon={i.icon} className="size-8 compact:size-7 stacked:hidden" />
                            <a {...linkTo({ name: 'catalogue', item: i.id }, () => openItem(i.id))} className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                              {i.name}
                            </a>
                          </span>
                        </TableCell>
                        {/* The stacked row's picture spans both lines; in the table it sits beside the name. */}
                        <TableCell aria-hidden className="hidden stacked:col-start-1 stacked:flex stacked:[grid-row:1/span_2]">
                          <ItemTile icon={i.icon} className="size-9" />
                        </TableCell>
                        {beside ? null : <TableCell className="whitespace-normal stacked:hidden">{i.details || '–'}</TableCell>}
                        <TableCell className="hidden stacked:[grid-column:2/span_2] stacked:row-start-2 stacked:block stacked:text-xs stacked:text-muted-foreground">
                          {[i.details, sizeGroupLabel[i.size_group], i.service_period_months !== null ? formatMonths(i.service_period_months) : null].filter(Boolean).join(' · ')}
                        </TableCell>
                        {beside ? null : <TableCell className="stacked:hidden">{sizeGroupLabel[i.size_group]}</TableCell>}
                        <TableCell className="text-right tabular-nums stacked:col-start-3 stacked:row-start-1 stacked:font-medium">{formatEuro(i.accounting_price_cents)}</TableCell>
                        {beside ? null : <TableCell className="stacked:hidden">{formatMonths(i.service_period_months)}</TableCell>}
                        <TableCell
                          className={cn(
                            'space-x-1 stacked:[grid-column:2/span_2] stacked:row-start-3 stacked:flex stacked:gap-1 stacked:space-x-0 stacked:pt-1',
                            i.active && !incomplete && 'stacked:hidden',
                          )}
                        >
                          {i.active ? (
                            <Badge variant="secondary" className="stacked:hidden">
                              {t.catalogue.active}
                            </Badge>
                          ) : (
                            <InactiveItemBadge />
                          )}
                          <IncompleteBadge item={i} />
                        </TableCell>
                        <TableCell aria-hidden className="hidden stacked:col-start-4 stacked:flex stacked:[grid-row:1/span_2]">
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </TableCell>
                        {rowActions ? (
                          <TableCell className="text-right whitespace-nowrap stacked:hidden">
                            <Button size="sm" variant="outline" onClick={() => setEditing(i)}>
                              {t.common.edit}
                            </Button>{' '}
                            <MoreActions label={t.common.moreActions(i.name)}>
                              <DropdownMenuItem variant={i.active ? 'destructive' : 'default'} onClick={() => void toggle(i)}>
                                {i.active ? t.catalogue.deactivateItem : t.catalogue.activateItem}
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
        </div>

        {selected ? (
          <aside
            aria-label={t.catalogue.item}
            className="relative lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-4"
          >
            <CatalogueItemDetail key={selected} id={selected} navigate={navigate} onClose={close} onChanged={items.reload} />
            {/* Beside the list only, and only where there is a keyboard. */}
            <p className="mt-3 hidden border-t border-border pt-3 text-xs text-muted-foreground lg:block pointer-coarse:hidden">
              <Kbd>J</Kbd> / <Kbd>K</Kbd> {t.catalogue.nextOrPreviousItem} · <Kbd>Esc</Kbd> {t.history.closeHint}
            </p>
          </aside>
        ) : null}
      </div>
      <ItemForm
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          items.reload()
        }}
      />
      <PicturesSheet
        open={picturesOpen}
        onClose={() => setPicturesOpen(false)}
        onSaved={() => {
          setPicturesOpen(false)
          items.reload()
        }}
      />
    </>
  )
}

/** Add Item and Edit Item; also used in the item's pane. */
export function ItemForm({ item, onClose, onSaved }: { item: CatalogueItem | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { client } = useApi()
  const existing = item !== 'new' && item !== null ? item : undefined
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [purchase, setPurchase] = useState('')
  const [price, setPrice] = useState('')
  const [period, setPeriod] = useState('')
  const [rank, setRank] = useState('1000')
  const [active, setActive] = useState(true)
  const [icon, setIcon] = useState<CatalogueIcon>('other')
  // A new item's picture follows its name until someone picks one.
  const [iconPicked, setIconPicked] = useState(false)
  const [error, setError] = useState<string>()
  // The picture gives the item its size group; read afresh each time the form opens.
  const pictures = useLoad(() => client.catalogue.pictures(), [item])
  const pictureGroup = pictures.data?.find((p) => p.icon === icon)?.size_group

  useEffect(() => {
    setName(existing?.name ?? '')
    setDetails(existing?.details ?? '')
    setPurchase(existing?.purchase_price_cents != null ? (existing.purchase_price_cents / 100).toFixed(2) : '')
    setPrice(existing?.accounting_price_cents != null ? (existing.accounting_price_cents / 100).toFixed(2) : '')
    setPeriod(existing?.service_period_months?.toString() ?? '')
    setRank(existing?.display_rank.toString() ?? '1000')
    setActive(existing?.active ?? true)
    setIcon(existing?.icon ?? 'other')
    setIconPicked(existing !== undefined)
    setError(undefined)
  }, [item, existing])

  const purchaseCents = parseEuro(purchase)
  const purchaseError = Number.isNaN(purchaseCents) ? t.catalogue.priceInvalid : undefined
  const priceCents = parseEuro(price)
  const priceError = Number.isNaN(priceCents) ? t.catalogue.priceInvalid : undefined
  const months = period.trim() === '' ? null : Number(period)
  const periodError = months !== null && (!Number.isInteger(months) || months < 1) ? t.catalogue.periodInvalid : undefined
  const rankNum = Number(rank)
  const rankError = !Number.isInteger(rankNum) || rankNum < 0 ? t.catalogue.rankInvalid : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (purchaseError || priceError || periodError || rankError) return
    const input: CatalogueItemInput = {
      name,
      details,
      purchase_price_cents: purchaseCents,
      accounting_price_cents: priceCents,
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
      setError(err instanceof ApiError && err.isConflict ? t.catalogue.itemNameTaken : errorText(err))
    }
  }

  return (
    <FormSheet
      open={item !== null}
      onClose={onClose}
      title={existing ? t.catalogue.editItem : t.catalogue.addItem}
      description={t.catalogue.formDescription}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="item-form" disabled={!name.trim()}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t.catalogue.itemName} required>
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
        <Field label={t.catalogue.manufacturerModel}>{(p) => <Input {...controlProps(p)} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
        <Field label={t.catalogue.purchasePriceEuro} hint={t.catalogue.purchasePriceHint} error={purchaseError}>
          {(p) => <Input {...controlProps(p)} inputMode="decimal" placeholder={t.catalogue.pricePlaceholder} value={purchase} onChange={(e) => setPurchase(e.target.value)} />}
        </Field>
        <Field label={t.catalogue.accountingPriceEuro} hint={t.catalogue.accountingPriceHint} error={priceError}>
          {(p) => <Input {...controlProps(p)} inputMode="decimal" placeholder={t.catalogue.pricePlaceholder} value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Field label={t.catalogue.servicePeriodMonths} error={periodError}>{(p) => <Input {...controlProps(p)} inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value)} />}</Field>
        <Field label={t.catalogue.displayOrder} hint={t.catalogue.displayOrderHint} error={rankError}>
          {(p) => <Input {...controlProps(p)} inputMode="numeric" value={rank} onChange={(e) => setRank(e.target.value)} />}
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">{t.catalogue.picture}</legend>
          <div className="grid grid-cols-5 gap-2">
            {iconChoices().map((c) => (
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
          {/* Polite, so a screen reader hears the size group a newly picked picture brings. */}
          <p aria-live="polite" className="mt-2 text-sm text-muted-foreground">
            {pictureGroup ? `${t.catalogue.pictureSizeGroup(sizeGroupLabel[pictureGroup])} ${t.catalogue.sizeGroupHint}` : null}
          </p>
        </fieldset>
        <label className="flex min-h-11 items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" className="size-5 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t.catalogue.activeInAddItem}
        </label>
        {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
      </form>
    </FormSheet>
  )
}

/**
 * Pictures: the size group each picture gives every item that has it. Saving
 * changes those items at once; orders keep the size group they were placed with.
 */
export function PicturesSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { client } = useApi()
  const pictures = useLoad(() => client.catalogue.pictures(), [open])
  // The size groups chosen here, by picture, until saved.
  const [chosen, setChosen] = useState<Partial<Record<CatalogueIcon, SizeGroup>>>({})
  const [error, setError] = useState<string>()

  useEffect(() => {
    setChosen({})
    setError(undefined)
  }, [open])

  const changed = (pictures.data ?? []).filter((p) => chosen[p.icon] !== undefined && chosen[p.icon] !== p.size_group)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      for (const p of changed) await client.catalogue.updatePicture(p.icon, { size_group: chosen[p.icon]! })
      onSaved()
    } catch (err) {
      setError(errorText(err))
      pictures.reload()
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.catalogue.pictures}
      description={t.catalogue.picturesDescription}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="pictures-form" disabled={changed.length === 0}>
            {t.common.save}
          </Button>
        </>
      }
    >
      {pictures.error ? (
        <ErrorState error={pictures.error} onRetry={pictures.reload} />
      ) : !pictures.data ? (
        <Loading />
      ) : (
        <form id="pictures-form" onSubmit={submit}>
          <ul aria-label={t.catalogue.pictures} className="divide-y divide-border rounded-lg border border-border">
            {pictures.data.map((p) => {
              const label = t.catalogue.icons[p.icon]
              const value = chosen[p.icon] ?? p.size_group
              return (
                <li key={p.icon} className="flex items-center gap-3 p-2">
                  <ItemTile icon={p.icon} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{t.catalogue.pictureItems(p.item_count)}</div>
                    {value !== p.size_group && p.item_count > 0 ? <div className="text-xs text-warning">{t.catalogue.pictureChanges(p.item_count)}</div> : null}
                  </div>
                  <Select
                    aria-label={t.catalogue.pictureSizeGroupFor(label)}
                    value={value}
                    onChange={(e) => setChosen((c) => ({ ...c, [p.icon]: e.target.value as SizeGroup }))}
                    className="w-36 shrink-0"
                  >
                    {(Object.keys(sizeGroupLabel) as SizeGroup[]).map((g) => (
                      <option key={g} value={g}>
                        {sizeGroupLabel[g]}
                      </option>
                    ))}
                  </Select>
                </li>
              )
            })}
          </ul>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </FormSheet>
  )
}
