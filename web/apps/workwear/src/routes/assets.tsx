import type { Asset, AssetSort, ConnectionStatus } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Input, Select } from '@ppe/ui/components/field'
import { KeyFigures, Kpi } from '@ppe/ui/components/panel'
import { SortControl, SortableHead } from '@ppe/ui/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import type { SortColumn, SortState } from '@ppe/ui/lib/sort'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronRight, Plus, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AssetMoreActions, CopyNumber, StatusBadge, StatusMenu } from '@/components/asset-controls'
import { type AssetSheet, AssetSheets } from '@/components/asset-sheets'
import { SimCardForm } from '@/components/sim-card-form'
import { t } from '@/i18n'
import {
  ASSET_PAGE_SIZE,
  type AssetFilters,
  type Place,
  type Tile,
  chooseTile,
  assetQuery,
  filterCount,
  formatDay,
  holderText,
  noAssetFilters,
  primaryAction,
  statusLabel,
  tilePressed,
  todayIn,
} from '@/lib/assets'
import { type Route, linkTo } from '@/lib/router'

const columns = (): SortColumn<AssetSort>[] => [
  { key: 'inventory', label: t.assets.colInventoryNo },
  { key: 'status', label: t.assets.colStatus },
  { key: 'holder', label: t.assets.colHeldBy },
  { key: 'given', label: t.assets.colGiven, firstDir: 'desc' },
]
const byNumber: SortState<AssetSort> = { key: 'inventory', dir: 'asc' }

const segment =
  'flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11'

/**
 * Company Assets: the SIM card register (assets brief §3–§5). The tiles
 * filter the list and keep the other filters, so In Office with Blocked is
 * the blocked cards in the office. A row opens the card's page; on a wide
 * screen it also offers the one action the card's state calls for (Give SIM
 * Card, Register SIM Return or Change Status), the rest under ⋯. On a phone a
 * row is two short lines and its actions are on the card's page. Writes need
 * assets.manage.
 */
export function Assets({ tile, navigate }: { tile?: Tile | undefined; navigate: (to: Route) => void }) {
  const { client } = useApi()
  const canManage = useSession().can('assets.manage')
  const settings = useLoad(() => client.settings())
  const today = todayIn(settings.data?.timezone)
  // A dashboard's Company Assets card opens the register on one of its tiles.
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

  const query = assetQuery(filters, sort.key, sort.dir, page)
  const list = useLoad(() => client.assets.list(query), [JSON.stringify(query), reloads])
  const summary = useLoad(() => client.assets.summary('SIM'), [reloads])
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

  // The card that already has a number typed on the form: found by its own number.
  const openExisting = async (id: string) => {
    setEditing(null)
    try {
      const found = await client.assets.get(id)
      setSearch(found.inventory_no)
      update({ ...noAssetFilters, q: found.inventory_no })
    } catch (err) {
      setActionError(err)
    }
  }

  const copied = (value: string) => (ok: boolean) => setMessage(ok ? t.assets.copied(value) : t.assets.copyFailed)

  const s = summary.data
  const tiles: { tile: Tile; label: string; value: number | undefined; detail: string }[] = [
    { tile: 'total', label: t.assets.totalSimCards, value: s?.total, detail: t.assets.totalDetail },
    { tile: 'inOffice', label: t.assets.inOffice, value: s?.in_office, detail: t.assets.inOfficeDetail },
    { tile: 'withEmployees', label: t.assets.withEmployees, value: s?.with_employees, detail: t.assets.withEmployeesDetail },
    { tile: 'notReturned', label: t.assets.notReturned, value: s?.not_returned, detail: t.assets.notReturnedDetail },
  ]
  const places: { value: Place; label: string }[] = [
    { value: 'all', label: t.assets.anyLocation },
    { value: 'office', label: t.assets.office },
    { value: 'held', label: t.assets.withAnEmployee },
    { value: 'unknown', label: t.assets.unknown },
  ]
  const statuses: { value: ConnectionStatus | ''; label: string }[] = [
    { value: '', label: t.assets.allStatuses },
    { value: 'NOT_ACTIVATED', label: t.assets.statuses.NOT_ACTIVATED },
    { value: 'ACTIVE', label: t.assets.statuses.ACTIVE },
    { value: 'BLOCKED', label: t.assets.statuses.BLOCKED },
  ]
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

  return (
    <>
      <PageHeader
        title={t.assets.title}
        description={t.assets.description}
        descriptionClassName="max-md:hidden"
        actions={
          <>
            {canManage ? (
              <Button onClick={() => setEditing('new')}>
                <Plus aria-hidden /> {t.assets.addSimCard}
              </Button>
            ) : null}
            <Button variant="outline" className="md:hidden" aria-expanded={showFilters} aria-controls="asset-filters" onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal aria-hidden /> {extra > 0 ? t.assets.filtersCount(extra) : t.assets.filters}
            </Button>
          </>
        }
      />
      <h2 className="mb-3 text-lg font-semibold">{t.assets.simCards}</h2>

      <KeyFigures>
        {tiles.map((k) => (
          <Kpi
            key={k.tile}
            label={k.label}
            value={k.value === undefined ? '—' : String(k.value)}
            detail={k.detail}
            pressed={tilePressed(filters, k.tile)}
            onOpen={() => update(chooseTile(filters, k.tile))}
          />
        ))}
      </KeyFigures>
      <p className="mt-2 mb-4 text-xs text-muted-foreground">{t.assets.tilesOverlap}</p>

      <div className="mb-4 flex flex-col gap-3">
        <Input
          type="search"
          data-shortcut="search"
          aria-label={t.assets.searchLabel}
          placeholder={t.assets.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:max-w-md"
        />
        <div id="asset-filters" role="region" aria-label={t.assets.filters} className={cn('flex flex-col gap-3 md:flex md:flex-row md:flex-wrap md:items-center', !showFilters && 'max-md:hidden')}>
          <div role="group" aria-label={t.assets.status} className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1 max-md:overflow-x-auto sm:inline-grid sm:w-auto">
            {statuses.map((o) => (
              <button key={o.label} type="button" aria-pressed={filters.status === o.value} onClick={() => update({ ...filters, status: o.value })} className={segment}>
                {o.label}
              </button>
            ))}
          </div>
          <Select aria-label={t.assets.location} value={filters.place} onChange={(e) => update({ ...filters, place: e.target.value as Place })} className="md:w-auto">
            {places.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select aria-label={t.assets.provider} value={filters.provider} onChange={(e) => update({ ...filters, provider: e.target.value })} className="md:w-auto">
            <option value="">{t.assets.allProviders}</option>
            {(s?.providers ?? []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          {filtered ? (
            <Button variant="ghost" onClick={clear}>
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
          {filtered ? t.assets.noMatches : t.assets.noSimCards}
          {filtered ? (
            <Button variant="outline" className="mt-3" onClick={clear}>
              {t.assets.clearFilters}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <Table stack="list" stackBelow="lg" sortControl={<SortControl columns={columns()} {...sortProps} />}>
            <TableHeader>
              <TableRow>
                <SortableHead column={columns()[0]!} {...sortProps} />
                <TableHead>{t.assets.colNumbers}</TableHead>
                <TableHead>{t.assets.colProvider}</TableHead>
                <SortableHead column={columns()[1]!} {...sortProps} />
                <SortableHead column={columns()[2]!} {...sortProps} />
                <SortableHead column={columns()[3]!} {...sortProps} />
                <TableHead>{t.assets.colDocuments}</TableHead>
                <TableHead>{t.assets.colComment}</TableHead>
                {canManage ? <TableHead className="text-right">{t.assets.actions}</TableHead> : null}
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
                    className="cursor-pointer hover:bg-muted/50 stacked:grid stacked:grid-cols-[minmax(0,1fr)_auto_auto] stacked:gap-x-3 stacked:hover:bg-muted/50"
                    // The whole row opens the card; its number is the real link, for keyboards and new tabs.
                    onClick={(ev) => {
                      if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                      navigate({ name: 'asset', id: a.id })
                    }}
                  >
                    <TableCell className="font-mono font-medium stacked:col-start-1 stacked:row-start-1">
                      <a {...linkTo({ name: 'asset', id: a.id }, navigate)} className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                        {a.inventory_no}
                      </a>
                    </TableCell>
                    {/* The stacked row's second line: phone, provider and where the card is. */}
                    <TableCell className="hidden stacked:col-start-1 stacked:row-start-2 stacked:block stacked:text-xs stacked:text-muted-foreground">
                      {[a.phone_no ?? a.sim_no, a.provider, holder.main].filter(Boolean).join(' · ')}
                      {open?.not_returned_at ? ` · ${t.assets.notReturned}` : ''}
                    </TableCell>
                    <TableCell className="stacked:hidden">
                      <span className="flex flex-col items-start">
                        {a.sim_no ? <CopyNumber value={a.sim_no} label={t.assets.copySimNo(a.sim_no)} onCopied={copied(a.sim_no)} /> : null}
                        {a.phone_no ? (
                          <CopyNumber value={a.phone_no} label={t.assets.copyPhoneNo(a.phone_no)} onCopied={copied(a.phone_no)} />
                        ) : (
                          <span className="text-xs text-muted-foreground">{t.assets.noPhoneNo}</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="stacked:hidden">
                      {a.provider}
                      {a.plan ? <span className="block text-xs text-muted-foreground">{a.plan}</span> : null}
                    </TableCell>
                    <TableCell className="stacked:col-start-2 stacked:row-start-1">{a.connection_status ? <StatusBadge status={a.connection_status} /> : null}</TableCell>
                    <TableCell className="stacked:hidden">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn(a.location === 'UNKNOWN' && 'font-medium')}>{holder.main}</span>
                        {open?.not_returned_at ? <Badge variant="destructive">{t.assets.notReturned}</Badge> : null}
                      </span>
                      {holder.sub ? <span className="block text-xs text-muted-foreground">{holder.sub}</span> : null}
                    </TableCell>
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
                    <TableCell className="stacked:hidden">{open?.paper_form_signed ? t.assets.formSigned : '—'}</TableCell>
                    <TableCell className="max-w-48 truncate stacked:hidden" title={a.comment || undefined}>
                      {a.comment || '—'}
                    </TableCell>
                    <TableCell aria-hidden className="hidden stacked:col-start-3 stacked:flex stacked:[grid-row:1/span_2] stacked:items-center">
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right whitespace-nowrap stacked:hidden">
                        {action === 'give' ? (
                          <Button size="sm" variant="outline" onClick={() => setSheet({ kind: 'give', asset: a })}>
                            {t.assets.giveSimCard}
                          </Button>
                        ) : action === 'return' ? (
                          <Button size="sm" variant="outline" onClick={() => setSheet({ kind: 'return', asset: a })}>
                            {t.assets.registerReturn}
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
            <span>{t.assets.shown(list.data.total)}</span>
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

      <AssetSheets
        sheet={sheet}
        today={today}
        onChange={setSheet}
        onDone={(m) => {
          setMessage(m)
          reload()
        }}
      />
      <SimCardForm
        card={editing}
        today={today}
        providers={s?.providers ?? []}
        onClose={() => setEditing(null)}
        onSaved={(saved, added) => {
          setEditing(null)
          setMessage(added ? t.assets.added(saved.inventory_no) : t.assets.saved(saved.inventory_no))
          reload()
        }}
        onOpenExisting={(id) => void openExisting(id)}
      />
    </>
  )
}
