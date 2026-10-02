import type { HistoryQuery, HistorySort, OrderStatus } from '@ppe/api-client'
import { ChevronRight, Plus, SlidersHorizontal } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'

import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { OrderDetail } from '@/components/order-detail'
import { RecordPreview } from '@/components/record-preview'
import { RelativeDate } from '@/components/relative-date'
import { SortControl, SortableHead } from '@/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableGroupRow, TableHeader, TableRow, stackedBreak } from '@/components/ui/table'
import { t } from '@/i18n'
import { useApi } from '@/lib/api'
import { isTyping } from '@/lib/shortcuts'
import { LONG_WAIT_DAYS, activityAt, formatUsage, formatWaiting, monthOf, statusLabel, waitingDays } from '@/lib/history'
import { type NavigateOptions, type Route, linkTo } from '@/lib/router'
import type { SortColumn, SortState } from '@/lib/sort'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro } from '@/lib/utils'

const PAGE_SIZE = 20

interface Filters {
  employee: PickedEmployee | null
  status: OrderStatus | ''
  from: string
  to: string
}

const noFilters: Filters = { employee: null, status: '', from: '', to: '' }

/** The status tabs: the question most people bring to History is what is still waiting. */
const statusTabs = (): { value: OrderStatus | ''; label: string }[] => [
  { value: 'ORDERED', label: t.history.awaiting },
  { value: 'GIVEN', label: t.common.given },
  { value: '', label: t.common.all },
]

// History is paged, so the API sorts it (the whole history, not one page).
const historyColumns = (): SortColumn<HistorySort>[] => [
  { key: 'record', label: t.history.colRecord },
  { key: 'employee', label: t.history.colEmployee },
  { key: 'date', label: t.history.colDate, firstDir: 'desc' },
  { key: 'status', label: t.history.colStatus },
  { key: 'usage', label: t.history.colUsage },
  { key: 'total', label: t.history.colTotal },
]
const newestFirst: SortState<HistorySort> = { key: 'date', dir: 'desc' }

const recordLink = 'rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-border px-1 font-mono">{children}</kbd>
}

/** From lg the order opens beside the list; below it, instead of the list. */
const wide = () => window.matchMedia('(min-width: 64rem)').matches

/**
 * History (manual §3.5): stored orders and snapshots, newest activity first.
 * A row opens its order (/history/<id>): beside the list on a wide screen, on
 * its own on a narrow one; the list, its filters and page stay as they were.
 * Changing any filter reloads page 1.
 */
export function History({
  selected,
  status,
  navigate,
  onOpenRecord,
}: {
  selected: string | undefined
  /** The tab to open on, from the address (a dashboard's Awaiting tile); later tab changes stay on the screen. */
  status?: OrderStatus | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
  onOpenRecord: (id: string, print: boolean) => void
}) {
  const { client } = useApi()
  const [filters, setFilters] = useState<Filters>(() => ({ ...noFilters, status: status ?? '' }))
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<SortState<HistorySort>>(newestFirst)
  // Phone only: the filters fold away so the orders start at the top of the screen.
  const [showFilters, setShowFilters] = useState(false)
  const settings = useLoad(() => client.settings())

  const scope: HistoryQuery = {
    ...(filters.employee ? { employee_id: filters.employee.id } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  }
  const query: HistoryQuery = {
    ...scope,
    ...(filters.status ? { status: filters.status } : {}),
    sort: sort.key,
    dir: sort.dir,
    page,
    page_size: PAGE_SIZE,
  }
  const key = JSON.stringify(query)
  const orders = useLoad(() => client.orders.list(query), [key])
  // The tabs' counts, within the other filters.
  const scopeKey = JSON.stringify(scope)
  const counts = useLoad(
    () =>
      Promise.all(
        (['ORDERED', 'GIVEN'] as const).map((status) => client.orders.list({ ...scope, status, page_size: 1 }).then((p) => p.total)),
      ).then(([ordered = 0, given = 0]) => ({ ORDERED: ordered, GIVEN: given, '': ordered + given })),
    [scopeKey],
  )

  // History has no unsorted order: a third click on a column starts over rather than clearing.
  const sortProps = {
    sort,
    onSort: (next: SortState<HistorySort> | null) => {
      setSort(next ?? newestFirst)
      setPage(1)
    },
  }

  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }

  const open = (id: string) => navigate({ name: 'history', order: id }, { scroll: !wide() })
  const close = () => navigate({ name: 'history' }, { scroll: false })

  // J and K: the next or previous order on this page, while one is open; Escape closes it beside the list.
  const shown = orders.data?.orders
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
      const at = shown.findIndex((o) => o.id === selected)
      const next = shown[at + (key === 'j' ? 1 : -1)]
      if (next) {
        e.preventDefault()
        navigate({ name: 'history', order: next.id }, { scroll: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, shown, navigate])

  // The open order's row stays in view as J and K move through the list.
  useEffect(() => {
    if (selected && wide()) document.querySelector('[data-slot=table-row][aria-current=true]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, shown])

  const tz = settings.data?.timezone
  const now = new Date()
  // An order is open beside the list (from lg): the list keeps its short columns.
  const beside = selected !== undefined
  const columns = historyColumns()
  // Beside an open order the list keeps the columns that find the next one to chase: one line a row.
  const shownColumns = beside ? columns.filter((c) => c.key !== 'usage') : columns
  const pages = orders.data ? Math.max(1, Math.ceil(orders.data.total / PAGE_SIZE)) : 1
  // The status tabs are not counted: they are always in view.
  const activeFilters = [filters.employee, filters.from, filters.to].filter(Boolean).length
  const dateError = filters.from && filters.to && filters.from > filters.to ? t.history.fromAfterTo : undefined

  return (
    <div className={cn(selected && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start lg:gap-6')}>
      {/* Narrow, an open order takes the screen; its list keeps its state behind it. */}
      <div className={cn('min-w-0', selected && 'max-lg:hidden')}>
        <PageHeader
          title={t.history.title}
          actions={
            <>
              {/* As Employees has Add New Employee: a link, so it also opens in a new tab. */}
              <a {...linkTo({ name: 'createOrder' }, navigate)} className={buttonVariants()}>
                <Plus aria-hidden /> {t.shell.createOrder}
              </a>
              <Button variant="outline" className="md:hidden" aria-expanded={showFilters} aria-controls="history-filters" onClick={() => setShowFilters((v) => !v)}>
                <SlidersHorizontal aria-hidden /> {activeFilters > 0 ? t.history.filtersCount(activeFilters) : t.history.filters}
              </Button>
            </>
          }
        />

        <div role="group" aria-label={t.history.status} className="mb-4 grid w-full grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1 sm:inline-grid sm:w-auto">
          {statusTabs().map((tab) => (
            <button
              key={tab.label}
              type="button"
              aria-pressed={filters.status === tab.value}
              onClick={() => setFilter('status', tab.value)}
              className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11"
            >
              {tab.label}
              {counts.data ? <span className="tabular-nums text-muted-foreground">{counts.data[tab.value]}</span> : null}
            </button>
          ))}
        </div>

        <section
          id="history-filters"
          aria-label={t.history.filters}
          className={cn(
            'mb-4 grid gap-3 sm:grid-cols-2',
            // Beside an open order the list is narrow: two columns there, three on their own.
            !selected && 'xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_auto]',
            !showFilters && 'max-md:hidden',
          )}
        >
          <div>
            <p className="mb-1.5 text-sm font-medium">{t.history.employee}</p>
            <EmployeePicker
              label={t.history.employee}
              selected={filters.employee}
              onSelect={(e) => setFilter('employee', { id: e.id, full_name: e.full_name, code: e.code })}
              onClear={() => setFilter('employee', null)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm font-medium">
              {t.history.from}
              <Input type="date" className="mt-1.5" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
            </label>
            <label className="text-sm font-medium">
              {t.history.to}
              <Input type="date" className="mt-1.5" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
            </label>
          </div>
          <div className="flex items-end">
            <Button
              variant="ghost"
              className="w-full sm:w-auto"
              disabled={activeFilters === 0}
              onClick={() => {
                setFilters((f) => ({ ...noFilters, status: f.status }))
                setPage(1)
              }}
            >
              {t.history.clearFilters}
            </Button>
          </div>
          {/* On a phone the sort order folds away with the filters; wider, it sits above the rows. */}
          <div className="md:hidden">
            <SortControl columns={columns} {...sortProps} />
          </div>
        </section>
        {dateError ? <p role="alert" className="mb-4 text-sm text-destructive">{dateError}</p> : null}

        {orders.error && !dateError ? (
          <ErrorState error={orders.error} onRetry={orders.reload} />
        ) : !orders.data ? (
          <Loading />
        ) : orders.data.orders.length === 0 ? (
          <EmptyState
            action={
              activeFilters > 0 ? (
                <Button variant="outline" size="sm" onClick={() => { setFilters((f) => ({ ...noFilters, status: f.status })); setPage(1) }}>
                  {t.history.clearFilters}
                </Button>
              ) : undefined
            }
          >
            {activeFilters > 0
              ? t.history.noMatch
              : filters.status === 'ORDERED'
                ? t.history.nothingWaiting
                : filters.status === 'GIVEN'
                  ? t.history.noneGiven
                  : t.history.noOrders}
          </EmptyState>
        ) : (
          <>
            {/*
              A row opens its order, where its actions are. Where the table is
              narrow the orders are one list of two-line rows: who and how long
              it has waited, then the record, date and value; sorted by date,
              under a heading per month. Beside an open order the table drops
              Usage time, the Ordered badge and the time of day, so it stays
              one line a row down to 30rem of room (a desktop from about 1200px).
            */}
            <Table
              stack="list"
              stackBelow={selected ? 'sm' : 'lg'}
              sortControl={
                <div className="max-md:hidden">
                  <SortControl columns={columns} {...sortProps} />
                </div>
              }
            >
              <TableHeader>
                <TableRow>
                  {shownColumns.map((c) => (
                    <SortableHead key={c.key} column={c} align={c.key === 'total' ? 'right' : 'left'} {...sortProps} />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.data.orders.map((o, i, list) => {
                  const days = o.status === 'ORDERED' ? waitingDays(o.ordered_at, now, tz) : 0
                  const month = monthOf(activityAt(o), tz)
                  const prev = list[i - 1]
                  const newMonth = sort.key === 'date' && (!prev || monthOf(activityAt(prev), tz).key !== month.key)
                  return (
                    <Fragment key={o.id}>
                    {newMonth ? <TableGroupRow colSpan={shownColumns.length}>{month.label}</TableGroupRow> : null}
                    <TableRow
                      data-state={selected === o.id ? 'selected' : undefined}
                      aria-current={selected === o.id ? 'true' : undefined}
                      className={cn(
                        stackedBreak,
                        'cursor-pointer stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted',
                      )}
                      // The whole row opens the order; the record number is the real link,
                      // for keyboards, screen readers and "open in new tab".
                      onClick={(ev) => {
                        if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                        open(o.id)
                      }}
                    >
                      {/*
                        Second line in a row: the record number, still the link for keyboards and "open in new tab".
                        With no order open, hovering it previews the order; beside one, the row itself does that.
                      */}
                      <TableCell className="font-medium stacked:order-3 stacked:w-auto stacked:text-xs stacked:font-normal stacked:text-muted-foreground">
                        {beside ? (
                          <a {...linkTo({ name: 'history', order: o.id }, () => open(o.id))} className={recordLink}>
                            {o.record_number}
                          </a>
                        ) : (
                          <RecordPreview orderId={o.id} timeZone={tz} {...linkTo({ name: 'history', order: o.id }, () => open(o.id))} className={recordLink}>
                            {o.record_number}
                          </RecordPreview>
                        )}
                      </TableCell>
                      <TableCell className={cn('whitespace-normal stacked:order-1 stacked:w-auto stacked:min-w-0 stacked:flex-1 stacked:truncate stacked:font-medium', !beside && 'min-w-32')}>
                        {o.employee_first_name} {o.employee_last_name}
                        {o.employee_code && !beside ? <span className="text-muted-foreground stacked:hidden"> · {o.employee_code}</span> : null}
                      </TableCell>
                      <TableCell className="tabular-nums stacked:order-3 stacked:w-auto stacked:text-xs stacked:text-muted-foreground stacked:before:mr-1.5 stacked:before:content-['·']">
                        {/* "3 days ago", the exact time on hover; today's and yesterday's with the time where there is room. */}
                        {beside ? null : <RelativeDate iso={activityAt(o)} timeZone={tz} time className="stacked:hidden" />}
                        <RelativeDate iso={activityAt(o)} timeZone={tz} className={cn(!beside && 'hidden stacked:inline')} />
                      </TableCell>
                      <TableCell className="stacked:order-1 stacked:w-auto">
                        <span className="inline-flex items-center gap-2">
                          {/* In a row an aging chip says Ordered by itself. */}
                          <Badge variant={o.status === 'GIVEN' ? 'default' : 'secondary'} className={cn(o.status === 'ORDERED' && (beside ? 'hidden' : 'stacked:hidden'))}>
                            {statusLabel[o.status]}
                          </Badge>
                          {o.status === 'ORDERED' ? (
                            <span
                              className={cn(
                                'text-xs whitespace-nowrap',
                                // Beside an order, and stacked, the wait is a pill: it stands for the Ordered badge.
                                beside ? 'rounded-full px-2 py-0.5 tabular-nums' : 'stacked:rounded-full stacked:px-2 stacked:py-0.5 stacked:tabular-nums',
                                days > LONG_WAIT_DAYS
                                  ? cn('font-medium text-destructive', beside ? 'bg-destructive/10' : 'stacked:bg-destructive/10')
                                  : cn('text-muted-foreground', beside ? 'bg-muted' : 'stacked:bg-muted'),
                              )}
                            >
                              {formatWaiting(days)}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      {beside ? null : (
                        <TableCell
                          className={cn(
                            "stacked:order-3 stacked:w-auto stacked:text-xs stacked:text-muted-foreground stacked:before:mr-1.5 stacked:before:content-['·']",
                            o.usage_months === null && 'stacked:hidden',
                          )}
                        >
                          {formatUsage(o.usage_months) || '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-medium tabular-nums stacked:order-3 stacked:w-auto stacked:text-xs stacked:font-normal stacked:text-muted-foreground stacked:before:mr-1.5 stacked:before:content-['·']">
                        {formatEuro(o.total_cents)}
                      </TableCell>
                      {/* A row opens its order: a chevron says so where the row is the whole target. */}
                      <TableCell aria-hidden className="hidden w-auto text-muted-foreground stacked:order-1 stacked:block stacked:w-auto">
                        <ChevronRight className="size-4" />
                      </TableCell>
                    </TableRow>
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
            <nav className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label={t.history.pages}>
              <span className="text-muted-foreground">
                {t.common.orders(orders.data.total)} · {t.history.pageOf(page, pages)}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t.history.previous}
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  {t.history.next}
                </Button>
              </div>
            </nav>
          </>
        )}
      </div>

      {selected ? (
        <aside aria-label={t.history.order} className="lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-4">
          <OrderDetail
            key={selected}
            id={selected}
            timeZone={tz}
            navigate={navigate}
            onClose={close}
            onOpenRecord={onOpenRecord}
            onChanged={() => {
              orders.reload()
              counts.reload()
            }}
            onDeleted={() => {
              close()
              orders.reload()
              counts.reload()
            }}
          />
          {/* Beside the list only, and only where there is a keyboard. */}
          <p className="mt-4 hidden border-t border-border pt-3 text-xs text-muted-foreground lg:block pointer-coarse:hidden">
            <Kbd>J</Kbd> / <Kbd>K</Kbd> {t.history.nextOrPrevious} · <Kbd>Esc</Kbd> {t.history.closeHint}
          </p>
        </aside>
      ) : null}
    </div>
  )
}
