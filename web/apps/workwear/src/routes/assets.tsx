import type { Asset, AssetKind, AssetSort, ConnectionStatus } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Input } from '@ppe/ui/components/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ppe/ui/components/select'
import { SortControl, SortableHead } from '@ppe/ui/components/sortable'
import { type Help, Tooltip, TooltipContent, TooltipTrigger } from '@ppe/ui/components/tooltip'
import { ActionError, EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import type { SortColumn, SortState } from '@ppe/ui/lib/sort'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { linkVariants } from '@ppe/ui/components/link'
import { Segmented } from '@ppe/ui/components/segmented'
import { useAction } from '@ppe/ui/lib/use-action'
import { besideList, useListKeys } from '@ppe/ui/lib/list-keys'
import { DetailPane, ListDetail } from '@ppe/ui/components/list-detail'
import { ChevronRight, FileText, FilterX, Plus, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { AssetDetail } from '@/components/asset-detail'
import { AssetMoreActions, ReturnButton, StatusBadge, StatusMenu, setStatus } from '@/components/asset-controls'
import { type AssetSheet, AssetSheets } from '@/components/asset-sheets'
import { usePrintStoredForm } from '@/components/assignment-form'
import { EquipmentForm } from '@/components/equipment-form'
import { type PdfFile, PdfPreview } from '@/components/pdf-preview'
import { SimCardForm } from '@/components/sim-card-form'
import { t } from '@/i18n'
import {
  ASSET_PAGE_SIZE,
  type AssetFilters,
  type Place,
  chooseTile,
  registerTile,
  assetQuery,
  simCardsReportQuery,
  documentsText,
  categories,
  categoryLabel,
  filterCount,
  formatDay,
  holderText,
  noAssetFilters,
  type AssetTab,
  assetTabs,
  chooseTab,
  countedTabs,
  primaryAction,
  tabCountQuery,
  tabCounts,
  tabPressed,
  todayIn,
} from '@/lib/assets'
import { type AssetTile, type NavigateOptions, type Route, linkTo } from '@/lib/router'

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



/**
 * Company Assets' two screens, SIM Cards (assets brief §3–§5) and Equipment
 * (§15–§17), each a register at its own address. The tabs, with their
 * counts, filter the list one choice at a time; the Location filter keeps
 * the status, so In Office with Blocked is the blocked cards in the office. On a wide
 * screen a row offers the one action the card's state calls for (Give SIM
 * Card, Return or Change Status), the rest under ⋯. On a phone a
 * row is two short lines and its actions are on the card's page. Writes need
 * assets.manage. A row opens its SIM or item as Orders opens an order
 * (/assets/sim-cards/<id>, /assets/equipment/<id>): beside the register from
 * lg, with J and K for the next or previous one and Escape to close it, and on
 * its own on a narrow screen; the register keeps its filters and page behind it.
 */
export function Assets({
  kind,
  tile,
  asset,
  navigate,
}: {
  kind: AssetKind
  tile?: AssetTile | undefined
  /** The SIM or item open beside the register. */
  asset?: string | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
}) {
  const sim = kind === 'SIM'
  const selected = asset
  // The register's own route, which an open SIM or item keeps.
  const register = sim ? 'simCards' : 'equipment'
  const { client } = useApi()
  const session = useSession()
  const canManage = session.can('assets.manage')
  const settings = useLoad(() => client.settings())
  const today = todayIn(settings.data?.timezone)
  // A dashboard's Company Assets card opens the register on the tab of one of its tiles (SIM Cards' places on Location).
  const opened = registerTile(kind, tile)
  const [filters, setFilters] = useState<AssetFilters>(() => (opened ? chooseTile(noAssetFilters, opened) : noAssetFilters))
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
  const action = useAction()
  const { printHeldForm, printing } = usePrintStoredForm()
  // A row's own `action` is its primary action, so the form is printed through this.
  const reprint = (a: Asset) => void action.run(() => printHeldForm(a))

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
  const counted = chooseTab(kind, filters, 'all')
  const counts = useLoad(
    () =>
      Promise.all(countedTabs(kind).map((tab) => client.assets.list(tabCountQuery(kind, filters, tab)).then((r) => [tab, r.total] as const))).then((pairs) =>
        tabCounts(Object.fromEntries(pairs)),
      ),
    [kind, JSON.stringify(counted), reloads],
  )
  const reload = () => setReloads((n) => n + 1)
  // SIM Cards' Preview PDF: the server draws every card the filters match, in the register's sort and the language
  // of the user's account; the preview shows it, to print, download or open in a tab.
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdf, setPdf] = useState<PdfFile | null>(null)
  const previewPdf = async () => {
    setPdfLoading(true)
    await action.run(async () => setPdf(await client.assets.simCardsPDF(simCardsReportQuery(filters, sort.key, sort.dir))))
    setPdfLoading(false)
  }

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
    await action.run(async () => {
      setMessage(await setStatus(client, a, next))
      reload()
    })
    setSaving(null)
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
      action.fail(err)
    }
  }

  // The register's address keeps the tile it was opened on, so opening a SIM or item keeps the register as it is.
  const at = opened ? { tile: opened } : {}
  const openAsset = (id: string) => navigate({ name: register, ...at, asset: id }, { scroll: !besideList() })
  const close = () => navigate({ name: register, ...at }, { scroll: false })

  // J and K: the next or previous SIM or item on this page, while one is open; Escape closes it beside the register.
  const shownIds = useMemo(() => list.data?.assets.map((a) => a.id), [list.data])
  useListKeys({ ids: shownIds, selected, onOpen: (id) => navigate({ name: register, ...at, asset: id }, { scroll: false }), onClose: close })

  // Beside an open SIM or item the register keeps the columns that find the next one: one line a row; the rest is in the pane.
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

  /**
   * The tabs with their counts, always in sight, in place of tiles, each as wide as its words (Russian needs it).
   * SIM Cards' three are one row, and its search and filters are one line below them (they shrink to stay on it).
   * Equipment's four sit above its filters, two to a row on a phone and beside an open item, else one row.
   */
  const tabGroup = (
    <Segmented
      label={sim ? t.assets.status : t.assets.locationAndReturn}
      options={assetTabs(kind).map((tab) => ({ value: tab, label: tabLabels[tab], help: tabHelp[tab], count: counts.data?.[tab], pressed: tabPressed(kind, filters, tab) }))}
      onChange={(tab) => update(chooseTab(kind, filters, tab))}
      busy={counts.loading}
      layout="grid"
      className={
        sim
          ? 'grid-flow-col auto-cols-auto sm:inline-grid sm:self-start md:self-auto'
          : beside
            ? 'grid-cols-2'
            : 'grid-cols-2 sm:inline-grid sm:grid-flow-col sm:auto-cols-auto sm:grid-cols-none sm:self-start'
      }
    />
  )

  return (
    <>
      {/* Narrow, an open card takes the screen; the register keeps its state behind it. */}
      <ListDetail
        width="md"
        pane={
          selected ? (
            <DetailPane label={sim ? t.assets.simCard : t.assets.item} next={sim ? t.assets.nextOrPreviousCard : t.assets.nextOrPreviousItem}>
              <AssetDetail
                key={selected}
                id={selected}
                place={{ page: false, kind, onClose: close }}
                navigate={navigate}
                onOpen={(id) => navigate({ name: 'asset', id })}
                onChanged={reload}
                refresh={reloads}
              />
            </DetailPane>
          ) : null
        }
      >
        <PageHeader
          title={sim ? t.assets.simCards : t.assets.equipment}
          actions={
            <>
              {sim ? (
                <Button variant="outline" disabled={pdfLoading} onClick={() => void previewPdf()}>
                  <FileText aria-hidden /> {t.assets.previewPdf}
                </Button>
              ) : null}
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
        <div className="mb-4 flex flex-col gap-3">
          {tabGroup}
          {/*
            The search and the filters on one line, as wide as it lets them (on SIM Cards after the tabs), wrapping where it
            does not fit; on a phone the search stays in view and Filters folds away the rest.
          */}
          <div id="asset-filters" role="region" aria-label={t.assets.filters} className={cn('flex flex-col gap-3 md:flex-row md:items-center', sim ? 'md:flex-nowrap' : 'md:flex-wrap')}>
            <Input
              type="search"
              data-shortcut="search"
              aria-label={sim ? t.assets.searchLabel : t.assets.equipmentSearchLabel}
              placeholder={sim ? t.assets.searchPlaceholder : t.assets.equipmentSearchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn('md:flex-1', sim ? 'md:min-w-40' : 'md:min-w-72 md:max-w-md')}
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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" className={cn('shrink-0', folded)} aria-label={t.assets.clearFilters} onClick={clear}>
                      <FilterX aria-hidden />
                    </Button>
                  }
                />
                <TooltipContent aria-hidden>{t.assets.clearText}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>

        <p role="status" className={cn('text-sm text-muted-foreground', message && 'mb-3')}>
          {message}
        </p>
        <ActionError error={action.error} />
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
              {/*
                Two-word headers wrap, and so do the cells of words (names, the plan, where, when, the documents): the
                columns fit beside the sidebar or rail from 1100px, where the table starts, however long they run.
              */}
              <TableHeader className="[&_th]:whitespace-normal">
                <TableRow>
                  {sim ? (
                    <>
                      <SortableHead column={column('phone')} {...sortProps} />
                      <SortableHead column={column('holder')} {...sortProps} />
                      {beside ? null : <TableHead>{t.assets.colProvider}</TableHead>}
                      <SortableHead column={column('status')} {...sortProps} />
                    </>
                  ) : (
                    <>
                      <SortableHead column={column('inventory')} {...sortProps} />
                      <SortableHead column={column('name')} {...sortProps} />
                      {beside ? null : <TableHead>{t.assets.colSerialNo}</TableHead>}
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
                        openAsset(a.id)
                      }}
                    >
                      {sim ? (
                        <TableCell className="stacked:col-start-1 stacked:row-start-1">
                          {/* The phone number over the SIM No., the card's link; the card copies both (the Copy button there). */}
                          <a
                            {...linkTo({ name: register, ...at, asset: a.id }, () => openAsset(a.id))}
                            className={linkVariants({ className: 'flex flex-col items-start' })}
                          >
                            <span className="font-mono text-xs font-medium tabular-nums stacked:hidden">
                              {a.phone_no ?? <span className="font-sans font-normal text-muted-foreground">{t.assets.noPhoneNo}</span>}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground tabular-nums stacked:hidden">{a.sim_no}</span>
                            {/* A phone's row is one number: the phone's, or the SIM No. until there is one. */}
                            <span className="hidden font-mono font-medium tabular-nums stacked:inline">{a.phone_no ?? a.sim_no}</span>
                          </a>
                        </TableCell>
                      ) : (
                        <TableCell className="font-mono font-medium stacked:col-start-1 stacked:row-start-1">
                          <a {...linkTo({ name: register, ...at, asset: a.id }, () => openAsset(a.id))} className={linkVariants()}>
                            {a.inventory_no}
                          </a>
                        </TableCell>
                      )}
                      {/* Who holds the card, or where it is: the employee (their page), Office or Unknown, and the Not Returned mark. */}
                      {sim ? (
                        <TableCell className="whitespace-normal stacked:hidden">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {a.location === 'WITH_EMPLOYEE' && open ? (
                              <a
                                {...linkTo({ name: 'employee', id: open.employee_id }, navigate)}
                                className={linkVariants()}
                              >
                                {open.employee_name}
                              </a>
                            ) : (
                              <span className={cn(a.location === 'UNKNOWN' && 'font-medium')}>{holder.main}</span>
                            )}
                            {open?.not_returned_at ? <Badge variant="destructive">{t.assets.notReturned}</Badge> : null}
                          </span>
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
                      <TableCell className="whitespace-normal stacked:hidden">
                        {a.provider}
                        {a.plan ? <span className="block text-xs text-muted-foreground">{a.plan}</span> : null}
                      </TableCell>
                      ) : null}
                      {sim ? (
                        <>
                          <TableCell className="stacked:col-start-2 stacked:row-start-1">{a.connection_status ? <StatusBadge status={a.connection_status} /> : null}</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="whitespace-normal stacked:hidden">
                            {a.name}
                            {a.category ? <span className="block text-xs text-muted-foreground">{categoryLabel(a.category)}</span> : null}
                          </TableCell>
                          {beside ? null : <TableCell className="font-mono text-xs stacked:hidden">{a.serial_no ?? '–'}</TableCell>}
                          <TableCell className="whitespace-normal stacked:hidden">
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
                          <TableCell className="whitespace-normal stacked:hidden">
                            {open ? (
                              <>
                                <span className="tabular-nums">{formatDay(open.given_date)}</span>
                                <span className="block text-xs text-muted-foreground">{t.assets.daysHeld(open.days_held)}</span>
                              </>
                            ) : (
                              '–'
                            )}
                          </TableCell>
                          <TableCell className="whitespace-normal stacked:hidden">{documentsText(open) ?? '–'}</TableCell>
                          <TableCell className={cn('max-w-48 truncate stacked:hidden', sim && 'hidden 2xl:table-cell')} title={a.comment || undefined}>
                            {a.comment || '–'}
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
                            <ReturnButton kind={a.kind} size="sm" variant="outline" onClick={() => setSheet({ kind: 'return', asset: a })} />
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
                            onPrintForm={() => reprint(a)}
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
      </ListDetail>

      {printing}
      <PdfPreview file={pdf} label={t.assets.pdfPreviewLabel} onClose={() => setPdf(null)} />
      <AssetSheets
        sheet={sheet}
        today={today}
        defaultPlan={settings.data?.default_sim_plan}
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
          defaultValueCents={settings.data?.default_sim_non_return_value_cents}
          defaultPlan={settings.data?.default_sim_plan}
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
      <SelectTrigger aria-label={label} className={cn('md:w-48 md:min-w-0 md:shrink', className)}>
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
