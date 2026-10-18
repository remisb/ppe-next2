import type { Asset, AssetKind, AssetSort, ConnectionStatus } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Input } from '@ppe/ui/components/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ppe/ui/components/select'
import { SortControl, SortableHead } from '@ppe/ui/components/sortable'
import { type Help, HelpTooltip } from '@ppe/ui/components/tooltip'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import type { SortColumn, SortState } from '@ppe/ui/lib/sort'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronRight, Plus, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AssetDetail } from '@/components/asset-detail'
import { AssetMoreActions, CopyButton, StatusBadge, StatusMenu } from '@/components/asset-controls'
import { type AssetSheet, AssetSheets } from '@/components/asset-sheets'
import { EquipmentForm } from '@/components/equipment-form'
import { SimCardForm } from '@/components/sim-card-form'
import { t } from '@/i18n'
import {
  ASSET_PAGE_SIZE,
  type AssetFilters,
  type Place,
  chooseTile,
  assetQuery,
  documentsText,
  categories,
  categoryLabel,
  filterCount,
  formatDay,
  holderText,
  locationText,
  noAssetFilters,
  type AssetTab,
  assetTabs,
  chooseTab,
  countedTabs,
  primaryAction,
  simCopyText,
  statusLabel,
  tabCountQuery,
  tabCounts,
  tabPressed,
  todayIn,
} from '@/lib/assets'
import { type AssetTile, type NavigateOptions, type Route, linkTo } from '@/lib/router'
import { isTyping } from '@/lib/shortcuts'

/**
 * The sortable columns. A SIM is known by its numbers, so SIM Cards starts
 * with the phone number over the SIM No., then the employee who holds it
 * (its Inventory No. is on the card's page, and still a sort); Equipment
 * starts with the Inventory No. Both open in inventory order.
 */
const columns = (kind: AssetKind): SortColumn<AssetSort>[] =>
  kind === 'SIM'
    ? [
        { key: 'phone', label: t.assets.colNumbers },
        { key: 'holder', label: t.assets.employee },
        { key: 'inventory', label: t.assets.colInventoryNo },
        { key: 'status', label: t.assets.colStatus },
        { key: 'given', label: t.assets.colGiven, firstDir: 'desc' },
      ]
    : [
        { key: 'inventory', label: t.assets.colInventoryNo },
        { key: 'name', label: t.assets.colItem },
        { key: 'holder', label: t.assets.colHeldBy },
        { key: 'given', label: t.assets.colGiven, firstDir: 'desc' },
      ]
const byNumber: SortState<AssetSort> = { key: 'inventory', dir: 'asc' }

/** From lg a SIM opens beside the register; below it, instead of the register. */
const wide = () => window.matchMedia('(min-width: 64rem)').matches

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-border px-1 font-mono">{children}</kbd>
}

const segment =
  'flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11'

/**
 * Company Assets' two screens, SIM Cards (assets brief §3–§5) and Equipment
 * (§15–§17), each a register at its own address. The tabs, with their
 * counts, filter the list one choice at a time; the Location filter keeps
 * the status, so In Office with Blocked is the blocked cards in the office. On a wide
 * screen a row offers the one action the card's state calls for (Give SIM
 * Card, Register SIM Return or Change Status), the rest under ⋯. On a phone a
 * row is two short lines and its actions are on the card's page. Writes need
 * assets.manage. A SIM's row opens the card as Orders opens an order
 * (/assets/sim-cards/<id>): beside the register from lg, with J and K for the
 * next or previous card and Escape to close it, and on its own on a narrow
 * screen; the register keeps its filters and page behind it. An equipment
 * row opens the item's page.
 */
export function Assets({
  kind,
  tile,
  card,
  navigate,
}: {
  kind: AssetKind
  tile?: AssetTile | undefined
  /** The SIM open beside the register (SIM Cards only). */
  card?: string | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
}) {
  const sim = kind === 'SIM'
  const selected = sim ? card : undefined
  const { client } = useApi()
  const session = useSession()
  const canManage = session.can('assets.manage')
  const seesEquipment = session.can('equipment.read')
  const settings = useLoad(() => client.settings())
  const today = todayIn(settings.data?.timezone)
  // A dashboard's Company Assets card opens the register on the tab of one of its tiles.
  const [filters, setFilters] = useState<AssetFilters>(() => (tile ? chooseTile(noAssetFilters, tile) : noAssetFilters))
  // The search as typed; it filters a moment after typing stops.
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState<AssetSort>>(byNumber)
  const [page, setPage] = useState(1)
  const [reloads, setReloads] = useState(0)
  // Phone only: the filters fold away so the cards start near the top.
  const [showFilters, setShowFilters] = useState(false)
  const [editing, setEditing] = useState<Asset | 'new' | null>(null)
  const [sheet, setSheet] = useState<AssetSheet>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState<unknown>()

  useEffect(() => {
    const id = window.setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }))
      setPage(1)
    }, 250)
    return () => window.clearTimeout(id)
  }, [search])

  const query = assetQuery(kind, filters, sort.key, sort.dir, page)
  const list = useLoad(() => client.assets.list(query), [JSON.stringify(query), reloads])
  const summary = useLoad(() => client.assets.summary(kind), [reloads])
  // The tabs each show how many choosing them would list; they set the status and place, so only the rest counts.
  const counted = chooseTab(filters, 'all')
  const counts = useLoad(
    () =>
      Promise.all(countedTabs(kind).map((tab) => client.assets.list(tabCountQuery(kind, filters, tab)).then((r) => [tab, r.total] as const))).then((pairs) =>
        tabCounts(Object.fromEntries(pairs)),
      ),
    [kind, JSON.stringify(counted), reloads],
  )
  const reload = () => setReloads((n) => n + 1)

  const update = (next: AssetFilters) => {
    setFilters(next)
    setPage(1)
  }
  const clear = () => {
    setSearch('')
    update(noAssetFilters)
  }

  const changeStatus = async (a: Asset, next: ConnectionStatus) => {
    setSaving(a.id)
    setActionError(undefined)
    try {
      await client.assets.setStatus(a.id, next)
      setMessage(t.assets.statusChanged(a.inventory_no, statusLabel(next)))
      reload()
    } catch (err) {
      setActionError(err)
    } finally {
      setSaving(null)
    }
  }

  // The card that already has a number typed on the form: found in this
  // register by its own number. An inventory number may be another kind's
  // (numbers are unique across assets), which opens that item's page.
  const openExisting = async (id: string) => {
    setEditing(null)
    try {
      const found = await client.assets.get(id)
      if (found.kind !== kind) {
        navigate({ name: 'asset', id })
        return
      }
      setSearch(found.inventory_no)
      update({ ...noAssetFilters, q: found.inventory_no })
    } catch (err) {
      setActionError(err)
    }
  }

  const copied = (value: string) => (ok: boolean) => setMessage(ok ? t.assets.copied(value) : t.assets.copyFailed)

  // The register's address keeps the tile it was opened on, so opening a card keeps the register as it is.
  const at = tile ? { tile } : {}
  const openCard = (id: string) => (sim ? navigate({ name: 'simCards', ...at, card: id }, { scroll: !wide() }) : navigate({ name: 'asset', id }))
  const close = () => navigate({ name: 'simCards', ...at }, { scroll: false })

  // J and K: the next or previous card on this page, while one is open; Escape closes it beside the register.
  const shown = list.data?.assets
  useEffect(() => {
    if (!selected || !shown) return
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return
      if (e.key === 'Escape' && wide()) {
        e.preventDefault()
        close()
        return
      }
      if (key !== 'j' && key !== 'k') return
      const i = shown.findIndex((a) => a.id === selected)
      const next = shown[i + (key === 'j' ? 1 : -1)]
      if (next) {
        e.preventDefault()
        navigate({ name: 'simCards', ...at, card: next.id }, { scroll: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, shown, navigate, tile])

  // The open card's row stays in view as J and K move through the register.
  useEffect(() => {
    if (selected && wide()) document.querySelector('[data-slot=table-row][aria-current=true]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, shown])

  // Beside an open card the register keeps the columns that find the next one: one line a row; the rest is in the card.
  const beside = selected !== undefined

  const s = summary.data
  const places: { value: Place; label: string }[] = [
    { value: 'all', label: t.assets.anyLocation },
    { value: 'office', label: t.assets.office },
    { value: 'held', label: t.assets.withAnEmployee },
    { value: 'unknown', label: t.assets.unknown },
  ]
  const tabLabels: Record<AssetTab, string> = {
    all: t.assets.all,
    ...t.assets.statuses,
    inOffice: t.assets.inOffice,
    withEmployees: t.assets.withEmployees,
    notReturned: t.assets.notReturned,
  }
  // The tabs' tooltips: the statuses' own, and the register's words for All (Total) and the places.
  const tabHelp: Record<AssetTab, Help> = {
    all: t.assets.tileHelp[kind].total,
    ...t.assets.statusHelp,
    inOffice: t.assets.tileHelp[kind].inOffice,
    withEmployees: t.assets.tileHelp[kind].withEmployees,
    notReturned: t.assets.tileHelp[kind].notReturned,
  }
  const filtered = search.trim() !== '' || JSON.stringify(filters) !== JSON.stringify({ ...noAssetFilters, q: filters.q })
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / ASSET_PAGE_SIZE)) : 1
  const sortProps = {
    sort,
    onSort: (next: SortState<AssetSort> | null) => {
      setSort(next ?? byNumber)
      setPage(1)
    },
  }
  const extra = filterCount(filters)
  const column = (key: AssetSort) => columns(kind).find((c) => c.key === key)!
  // Phone only: what Filters folds away.
  const folded = cn(!showFilters && 'max-md:hidden')

  return (
    <>
      <div className={cn(selected && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start lg:gap-6')}>
        {/* Narrow, an open card takes the screen; the register keeps its state behind it. */}
        <div className={cn('min-w-0', selected && 'max-lg:hidden')}>
          <PageHeader
            title={sim ? t.assets.simCards : t.assets.equipment}
            actions={
              <>
                {canManage ? (
                  <Button onClick={() => setEditing('new')}>
                    <Plus aria-hidden /> {sim ? t.assets.addSimCard : t.assets.addAsset}
                  </Button>
                ) : null}
                <Button variant="outline" className="md:hidden" aria-expanded={showFilters} aria-controls="asset-filters" onClick={() => setShowFilters((v) => !v)}>
                  <SlidersHorizontal aria-hidden /> {extra > 0 ? t.assets.filtersCount(extra) : t.assets.filters}
                </Button>
              </>
            }
          />
          {/* The section's other screen on the rail, which has no room to list its screens (the sidebar
              and a phone's More panel do): Equipment is only the Equipment Assignments role's; without it there is none. */}
          {seesEquipment ? (
            <nav aria-label={t.assets.title} className="mb-4 hidden grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1 md:inline-grid xl:hidden">
              {([['SIM', 'simCards', t.assets.simCards], ['EQUIPMENT', 'equipment', t.assets.equipment]] as const).map(([k, name, label]) => (
                <a
                  key={k}
                  {...linkTo({ name }, navigate)}
                  aria-current={kind === k ? 'page' : undefined}
                  className={cn(segment, 'aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm')}
                >
                  {label}
                </a>
              ))}
            </nav>
          ) : null}

          <div className="mb-4 flex flex-col gap-3">
            {/*
              The tabs with their counts, always in sight, in place of tiles: two to a row on a phone, then SIM Cards' seven
              three to a row and Equipment's four in one, and from the sidebar's width one row, each as wide as its words (Russian needs it).
            */}
            <div
              role="group"
              aria-label={sim ? t.assets.statusAndLocation : t.assets.locationAndReturn}
              className={cn(
                'grid grid-cols-2 gap-1 rounded-lg bg-muted p-1',
                // Beside an open card the register is narrow: the tabs stay three to a row there.
                !beside && 'xl:inline-grid xl:grid-flow-col xl:auto-cols-auto xl:grid-cols-none xl:self-start',
                sim ? 'sm:grid-cols-3' : 'sm:inline-grid sm:grid-flow-col sm:auto-cols-auto sm:grid-cols-none sm:self-start',
              )}
            >
              {assetTabs(kind).map((tab) => (
                <HelpTooltip key={tab} title={tabLabels[tab]} help={tabHelp[tab]}>
                  <button type="button" aria-pressed={tabPressed(filters, tab)} onClick={() => update(chooseTab(filters, tab))} className={segment}>
                    {tabLabels[tab]}
                    {counts.data ? (
                      <span className={cn('min-w-5 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-center text-xs leading-none tabular-nums', counts.loading && 'opacity-60')}>
                        {counts.data[tab]}
                      </span>
                    ) : null}
                  </button>
                </HelpTooltip>
              ))}
            </div>
            {/* The search and the filters on one line, as wide as it lets them; on a phone the search stays in view and Filters folds away the rest. */}
            <div id="asset-filters" role="region" aria-label={t.assets.filters} className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
              <Input
                type="search"
                data-shortcut="search"
                aria-label={sim ? t.assets.searchLabel : t.assets.equipmentSearchLabel}
                placeholder={sim ? t.assets.searchPlaceholder : t.assets.equipmentSearchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="md:max-w-md md:min-w-72 md:flex-1"
              />
              {sim ? null : (
                <FilterSelect
                  label={t.assets.category}
                  value={filters.category}
                  items={[{ value: '', label: t.assets.allCategories }, ...categories.map((c) => ({ value: c, label: categoryLabel(c) }))]}
                  onChange={(category) => update({ ...filters, category })}
                  className={folded}
                />
              )}
              <FilterSelect label={t.assets.location} value={filters.place} items={places} onChange={(place) => update({ ...filters, place })} className={folded} />
              {sim ? (
                <FilterSelect
                  label={t.assets.provider}
                  value={filters.provider}
                  items={[{ value: '', label: t.assets.allProviders }, ...(s?.providers ?? []).map((p) => ({ value: p, label: p }))]}
                  onChange={(provider) => update({ ...filters, provider })}
                  className={folded}
                />
              ) : null}
              <FilterSelect
                label={t.assets.documents}
                value={filters.signedCopyMissing ? 'missing' : ''}
                items={[
                  { value: '', label: t.assets.anyDocuments },
                  { value: 'missing', label: t.assets.signedCopyMissing },
                ]}
                onChange={(v) => update({ ...filters, signedCopyMissing: v === 'missing' })}
                className={folded}
              />
              {filtered ? (
                <Button variant="ghost" className={folded} onClick={clear}>
                  {t.assets.clearFilters}
                </Button>
              ) : null}
            </div>
          </div>

          <p role="status" className={cn('text-sm text-muted-foreground', message && 'mb-3')}>
            {message}
          </p>
          {actionError ? <ErrorState title={t.common.actionFailed} error={actionError} /> : null}
          {list.error ? (
            <ErrorState error={list.error} onRetry={reload} />
          ) : list.loading && !list.data ? (
            <Loading />
          ) : !list.data || list.data.assets.length === 0 ? (
            <EmptyState>
              {filtered ? (sim ? t.assets.noMatches : t.assets.noEquipmentMatches) : sim ? t.assets.noSimCards : t.assets.noEquipment}
              {filtered ? (
                <Button variant="outline" className="mt-3" onClick={clear}>
                  {t.assets.clearFilters}
                </Button>
              ) : null}
            </EmptyState>
          ) : (
            <>
              <Table stack="list" stackBelow={beside ? 'sm' : 'lg'} sortControl={<SortControl columns={columns(kind)} {...sortProps} />}>
                {/* Two-word headers wrap, so the nine columns fit beside the sidebar or rail (from 1100px, where the table starts). */}
                <TableHeader className="[&_th]:whitespace-normal">
                  <TableRow>
                    {sim ? (
                      <>
                        <SortableHead column={column('phone')} {...sortProps} />
                        <SortableHead column={column('holder')} {...sortProps} />
                        {beside ? null : <TableHead>{t.assets.colProvider}</TableHead>}
                        <SortableHead column={column('status')} {...sortProps} />
                        <TableHead>{t.assets.location}</TableHead>
                      </>
                    ) : (
                      <>
                        <SortableHead column={column('inventory')} {...sortProps} />
                        <SortableHead column={column('name')} {...sortProps} />
                        <TableHead>{t.assets.colSerialNo}</TableHead>
                        <SortableHead column={column('holder')} {...sortProps} />
                      </>
                    )}
                    {beside ? null : (
                      <>
                        <SortableHead column={column('given')} {...sortProps} />
                        <TableHead>{t.assets.colDocuments}</TableHead>
                        {/* SIM Cards has two more columns: its comment shows from 2xl, and on the card's page. */}
                        <TableHead className={cn(sim && 'hidden 2xl:table-cell')}>{t.assets.colComment}</TableHead>
                        {canManage ? <TableHead className="text-right">{t.assets.actions}</TableHead> : null}
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.assets.map((a) => {
                    const holder = holderText(a)
                    const open = a.open_assignment
                    const action = primaryAction(a)
                    return (
                      <TableRow
                        key={a.id}
                        data-state={selected === a.id ? 'selected' : undefined}
                        aria-current={selected === a.id ? 'true' : undefined}
                        className="cursor-pointer hover:bg-muted/50 stacked:grid stacked:grid-cols-[minmax(0,1fr)_auto_auto] stacked:gap-x-3 stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted"
                        // The whole row opens the card; its number is the real link, for keyboards and new tabs.
                        onClick={(ev) => {
                          if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                          openCard(a.id)
                        }}
                      >
                        {sim ? (
                          <TableCell className="stacked:col-start-1 stacked:row-start-1">
                            {/* The phone number over the SIM No., the card's link, and one button copying both for the provider's e-mail. */}
                            <span className="flex items-center gap-1">
                              <a
                                {...linkTo({ name: 'simCards', ...at, card: a.id }, () => openCard(a.id))}
                                className="flex flex-col items-start rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <span className="font-mono text-xs font-medium tabular-nums stacked:hidden">
                                  {a.phone_no ?? <span className="font-sans font-normal text-muted-foreground">{t.assets.noPhoneNo}</span>}
                                </span>
                                <span className="font-mono text-xs text-muted-foreground tabular-nums stacked:hidden">{a.sim_no}</span>
                                {/* A phone's row is one number: the phone's, or the SIM No. until there is one. */}
                                <span className="hidden font-mono font-medium tabular-nums stacked:inline">{a.phone_no ?? a.sim_no}</span>
                              </a>
                              {a.sim_no ? (
                                <span className="stacked:hidden">
                                  <CopyButton text={simCopyText(a)} label={t.assets.copyNumbers(a.inventory_no)} onCopied={copied(simCopyText(a))} />
                                </span>
                              ) : null}
                            </span>
                          </TableCell>
                        ) : (
                          <TableCell className="font-mono font-medium stacked:col-start-1 stacked:row-start-1">
                            <a {...linkTo({ name: 'asset', id: a.id }, navigate)} className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                              {a.inventory_no}
                            </a>
                          </TableCell>
                        )}
                        {/* Who holds the card, also when it is Unknown (its last holder); where it is has a column of its own. */}
                        {sim ? (
                          <TableCell className="stacked:hidden">
                            {open ? (
                              <a
                                {...linkTo({ name: 'employee', id: open.employee_id }, navigate)}
                                className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {open.employee_name}
                              </a>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        ) : null}
                        {/* The stacked row's second line: the SIM No. (when the phone number is the first), provider and where the card is. */}
                        <TableCell className="hidden stacked:col-start-1 stacked:row-start-2 stacked:block stacked:text-xs stacked:text-muted-foreground">
                          {(sim
                            ? [a.phone_no ? a.sim_no : null, a.provider, holder.main]
                            : [a.name, a.category ? categoryLabel(a.category) : null, holder.main]
                          )
                            .filter(Boolean)
                            .join(' · ')}
                          {open?.not_returned_at ? ` · ${t.assets.notReturned}` : ''}
                        </TableCell>
                        {sim && !beside ? (
                        <TableCell className="stacked:hidden">
                          {a.provider}
                          {a.plan ? <span className="block text-xs text-muted-foreground">{a.plan}</span> : null}
                        </TableCell>
                        ) : null}
                        {sim ? (
                          <>
                            <TableCell className="stacked:col-start-2 stacked:row-start-1">{a.connection_status ? <StatusBadge status={a.connection_status} /> : null}</TableCell>
                            <TableCell className="stacked:hidden">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={cn(a.location === 'UNKNOWN' && 'font-medium')}>{locationText(a)}</span>
                                {open?.not_returned_at ? <Badge variant="destructive">{t.assets.notReturned}</Badge> : null}
                              </span>
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="stacked:hidden">
                              {a.name}
                              {a.category ? <span className="block text-xs text-muted-foreground">{categoryLabel(a.category)}</span> : null}
                            </TableCell>
                            <TableCell className="font-mono text-xs stacked:hidden">{a.serial_no ?? '—'}</TableCell>
                            <TableCell className="stacked:hidden">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={cn(a.location === 'UNKNOWN' && 'font-medium')}>{holder.main}</span>
                                {open?.not_returned_at ? <Badge variant="destructive">{t.assets.notReturned}</Badge> : null}
                              </span>
                              {holder.sub ? <span className="block text-xs text-muted-foreground">{holder.sub}</span> : null}
                            </TableCell>
                          </>
                        )}
                        {beside ? null : (
                          <>
                            <TableCell className="stacked:hidden">
                              {open ? (
                                <>
                                  <span className="tabular-nums">{formatDay(open.given_date)}</span>
                                  <span className="block text-xs text-muted-foreground">{t.assets.daysHeld(open.days_held)}</span>
                                </>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="stacked:hidden">{documentsText(open) ?? '—'}</TableCell>
                            <TableCell className={cn('max-w-48 truncate stacked:hidden', sim && 'hidden 2xl:table-cell')} title={a.comment || undefined}>
                              {a.comment || '—'}
                            </TableCell>
                          </>
                        )}
                        <TableCell aria-hidden className="hidden stacked:col-start-3 stacked:flex stacked:[grid-row:1/span_2] stacked:items-center">
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </TableCell>
                        {canManage && !beside ? (
                          <TableCell className="text-right whitespace-nowrap stacked:hidden">
                            {action === 'give' ? (
                              <Button size="sm" variant="outline" onClick={() => setSheet({ kind: 'give', asset: a })}>
                                {sim ? t.assets.giveSimCard : t.assets.giveAsset}
                              </Button>
                            ) : action === 'return' ? (
                              <Button size="sm" variant="outline" onClick={() => setSheet({ kind: 'return', asset: a })}>
                                {sim ? t.assets.registerReturn : t.assets.registerAssetReturn}
                              </Button>
                            ) : a.connection_status ? (
                              <StatusMenu number={a.inventory_no} status={a.connection_status} disabled={saving === a.id} onChange={(next) => void changeStatus(a, next)} />
                            ) : null}{' '}
                            <AssetMoreActions
                              asset={a}
                              status={action !== 'status'}
                              onStatus={(next) => void changeStatus(a, next)}
                              onEdit={() => setEditing(a)}
                              onNotReturned={() => setSheet({ kind: 'notReturned', asset: a })}
                              onBlockingEmail={() => setSheet({ kind: 'email', asset: a })}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>{sim ? t.assets.shown(list.data.total) : t.assets.shownItems(list.data.total)}</span>
                {pages > 1 ? (
                  <span className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      {t.assets.previous}
                    </Button>
                    <span className="tabular-nums">{t.assets.page(page, pages)}</span>
                    <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                      {t.assets.next}
                    </Button>
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>

        {selected ? (
          <aside
            aria-label={t.assets.simCard}
            className="lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-4"
          >
            <AssetDetail
              key={selected}
              id={selected}
              place={{ page: false, onClose: close }}
              navigate={navigate}
              onOpen={(id) => navigate({ name: 'asset', id })}
              onChanged={reload}
              refresh={reloads}
            />
            {/* Beside the register only, and only where there is a keyboard. */}
            <p className="mt-3 hidden border-t border-border pt-3 text-xs text-muted-foreground lg:block pointer-coarse:hidden">
              <Kbd>J</Kbd> / <Kbd>K</Kbd> {t.assets.nextOrPreviousCard} · <Kbd>Esc</Kbd> {t.history.closeHint}
            </p>
          </aside>
        ) : null}
      </div>

      <AssetSheets
        sheet={sheet}
        today={today}
        onChange={setSheet}
        onDone={(m) => {
          setMessage(m)
          reload()
        }}
      />
      {sim ? (
        <SimCardForm
          card={editing}
          today={today}
          providers={settings.data?.sim_providers ?? []}
          inUse={s?.providers ?? []}
          defaultProvider={settings.data?.default_sim_provider}
          onClose={() => setEditing(null)}
          onSaved={(saved, added) => {
            setEditing(null)
            setMessage(added ? t.assets.added(saved.inventory_no) : t.assets.saved(saved.inventory_no))
            reload()
          }}
          onOpenExisting={(id) => void openExisting(id)}
        />
      ) : (
        <EquipmentForm
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, added) => {
            setEditing(null)
            setMessage(added ? t.assets.added(saved.inventory_no) : t.assets.saved(saved.inventory_no))
            reload()
          }}
          onOpenExisting={(id) => navigate({ name: 'asset', id })}
        />
      )}
    </>
  )
}

/**
 * One of the register's filters: shadcn's Select in the Orders Date filter's look, as Sort by. It has no
 * heading, as the search has none: its choice says what it filters ("All categories"), and its label is its name.
 */
function FilterSelect<V extends string>({
  label,
  value,
  items,
  onChange,
  className,
}: {
  label: string
  value: V
  items: { value: V; label: string }[]
  onChange: (next: V) => void
  className?: string | undefined
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger aria-label={label} className={cn('md:w-48', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
