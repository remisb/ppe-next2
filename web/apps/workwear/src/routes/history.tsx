import type { HistoryQuery, HistorySort, OrderStatus } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { SortControl, SortableHead } from '@ppe/ui/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import type { Help } from '@ppe/ui/components/tooltip'
import { Table, TableBody, TableCell, TableGroupRow, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import type { SortColumn, SortState } from '@ppe/ui/lib/sort'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronRight, Plus, SlidersHorizontal } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'

import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { OrderDetail } from '@/components/order-detail'
import { PeriodFilter } from '@/components/period-filter'
import { RecordPreview } from '@/components/record-preview'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { isoDay } from '@ppe/ui/lib/dates'
import { linkVariants } from '@ppe/ui/components/link'
import { Kbd } from '@ppe/ui/components/kbd'
import { Segmented } from '@ppe/ui/components/segmented'
import { t } from '@/i18n'
import { type DatePeriod, LONG_WAIT_DAYS, activityAt, formatUsage, formatWaiting, looksLikeRecord, monthOf, periodRange, statusLabel, waitingDays } from '@/lib/history'
import { type NavigateOptions, type Route, linkTo } from '@/lib/router'
import { isTyping } from '@/lib/shortcuts'
import { formatEuro } from '@/lib/utils'

const PAGE_SIZE = 20

interface Filters {
  employee: PickedEmployee | null
  /** A record number as typed; it filters once it reads as one (looksLikeRecord). */
  record: string
  status: OrderStatus | ''
  /** All dates at first; From and To filter only under Custom range. */
  period: DatePeriod
  from: string
  to: string
}

const noFilters: Filters = { employee: null, record: '', status: '', period: 'all', from: '', to: '' }

/**
 * The status tabs, All first as the screen opens on it, then Ordered and Given, in the order's own sequence,
 * each with its tooltip, as SIM Cards' tabs have.
 */
const statusTabs = (): { value: OrderStatus | ''; label: string; help: Help }[] => [
  { value: '', label: t.common.all, help: t.history.tabHelp.all },
  { value: 'ORDERED', label: t.common.ordered, help: { ...t.history.tabHelp.ORDERED, note: t.history.tabHelp.ORDERED.note(LONG_WAIT_DAYS) } },
  { value: 'GIVEN', label: t.common.given, help: t.history.tabHelp.GIVEN },
]

// History is paged, so the API sorts it (the whole history, not one page).
const historyColumns = (): SortColumn<HistorySort>[] => [
  { key: 'record', label: t.history.colRecord, kind: 'number' },
  { key: 'employee', label: t.history.colEmployee, kind: 'text' },
  { key: 'date', label: t.history.colDate, firstDir: 'desc', kind: 'date' },
  { key: 'status', label: t.history.colStatus },
  { key: 'usage', label: t.history.colUsage, kind: 'duration' },
  { key: 'total', label: t.history.colTotal, kind: 'number' },
]
const newestFirst: SortState<HistorySort> = { key: 'date', dir: 'desc' }

/**
 * The list as a user left it (tab, period, employee, page, sort) on going to an
 * order's record (View Order, Print Order), which replaces this screen: the next
 * time Orders opens, coming back, it is restored once. Otherwise Orders opens
 * afresh, and a reload forgets it.
 */
const leftForRecord = new Map<string, { filters: Filters; page: number; sort: SortState<HistorySort> }>()

const recordLink = linkVariants()


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
  /** The tab to open on, from the address (a dashboard's Awaiting confirmation tile); later tab changes stay on the screen. */
  status?: OrderStatus | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
  onOpenRecord: (id: string, print: boolean) => void
}) {
  const { client } = useApi()
  const { userId } = useSession()
  // Back from an order's record, the list is as it was left; a tab from the address (a dashboard's link) starts afresh on it.
  const [left] = useState(() => {
    const was = leftForRecord.get(userId)
    leftForRecord.delete(userId)
    return status ? undefined : was
  })
  const [filters, setFilters] = useState<Filters>(() => left?.filters ?? { ...noFilters, status: status ?? '' })
  const [page, setPage] = useState(left?.page ?? 1)
  const [sort, setSort] = useState<SortState<HistorySort>>(left?.sort ?? newestFirst)
  const openRecord = (id: string, print: boolean) => {
    leftForRecord.set(userId, { filters, page, sort })
    onOpenRecord(id, print)
  }
  // Phone only: the filters fold away so the orders start at the top of the screen.
  const [showFilters, setShowFilters] = useState(false)
  const settings = useLoad(() => client.settings())

  // A period's days count from today in the organisation timezone; Custom range takes From and To as typed.
  const today = isoDay(new Date(), settings.data?.timezone)
  const range = periodRange(filters.period, today) ?? (filters.period === 'custom' ? filters : { from: '', to: '' })
  const record = filters.record.trim()
  const recordValid = record === '' || looksLikeRecord(record)
  const scope: HistoryQuery = {
    ...(filters.employee ? { employee_id: filters.employee.id } : {}),
    ...(record && recordValid ? { record } : {}),
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
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

  const clearFilters = () => {
    setFilters((f) => ({ ...noFilters, status: f.status }))
    setRecordText('')
    setPage(1)
  }

  // The record number as typed, applied a moment after typing stops, so each key does not ask the server.
  const [recordText, setRecordText] = useState(filters.record)
  useEffect(() => {
    const later = setTimeout(() => {
      if (recordText !== filters.record) setFilter('record', recordText)
    }, 300)
    return () => clearTimeout(later)
  }, [recordText])

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
  const activeFilters = [filters.employee, record, filters.period !== 'all'].filter(Boolean).length

  // What Filters folds away on a phone, and so counts there: the employee search stays in view.
  const folded = !showFilters && 'max-md:hidden'
  const foldedFilters = filters.period !== 'all' ? 1 : 0

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
                <SlidersHorizontal aria-hidden /> {foldedFilters > 0 ? t.history.filtersCount(foldedFilters) : t.history.filters}
              </Button>
            </>
          }
        />

        <Segmented
          label={t.history.status}
          options={statusTabs().map((tab) => ({ ...tab, count: counts.data?.[tab.value] }))}
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          className="mb-4"
        />

        <section
          id="history-filters"
          aria-label={t.history.filters}
          className={cn(
            'mb-4 grid gap-3 sm:grid-cols-2',
            // Beside an open order the list is narrow: two columns there, three on their own.
            !selected && 'xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]',
          )}
        >
          {/* On a phone the employee search stays in view, without its heading (its placeholder
              says what it is), and Filters folds away only the dates, Clear filters and the sort. */}
          <div>
            <p className="mb-1.5 text-sm font-medium max-md:hidden">{t.history.employee}</p>
            <EmployeePicker
              label={t.history.employee}
              selected={filters.employee}
              onSelect={(e) => setFilter('employee', { id: e.id, full_name: e.full_name, code: e.code })}
              onClear={() => setFilter('employee', null)}
            />
          </div>
          {/* A record number read out on the phone finds its order: typed, it filters once it reads as one. */}
          <Field label={t.history.recordNumber} error={recordValid ? undefined : t.history.recordInvalid}>
            {(p) => (
              <Input
                {...controlProps(p)}
                value={recordText}
                onChange={(e) => setRecordText(e.target.value)}
                placeholder="WE-000004"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          {/* The date filter: a period, or Custom range, whose From and To open over it. */}
          <PeriodFilter
            id="history-period"
            className={cn(folded)}
            value={filters}
            today={today}
            onChange={(choice) => {
              setFilters((f) => ({ ...f, ...choice }))
              setPage(1)
            }}
          />
          <div className={cn('flex items-end', folded)}>
            <Button
              variant="ghost"
              className="w-full sm:w-auto"
              disabled={activeFilters === 0}
              onClick={clearFilters}
            >
              {t.history.clearFilters}
            </Button>
          </div>
          {/* On a phone the sort order folds away with the filters; wider, it sits above the rows. */}
          <div className={cn('md:hidden', folded)}>
            <SortControl columns={columns} {...sortProps} />
          </div>
        </section>
        {orders.error ? (
          <ErrorState error={orders.error} onRetry={orders.reload} />
        ) : !orders.data ? (
          <Loading />
        ) : orders.data.orders.length === 0 ? (
          <EmptyState
            action={
              activeFilters > 0 ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
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
                          {formatUsage(o.usage_months) || '–'}
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
            onOpenRecord={openRecord}
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
          <p className="mt-3 hidden border-t border-border pt-3 text-xs text-muted-foreground lg:block pointer-coarse:hidden">
            <Kbd>J</Kbd> / <Kbd>K</Kbd> {t.history.nextOrPrevious} · <Kbd>Esc</Kbd> {t.history.closeHint}
          </p>
        </aside>
      ) : null}
    </div>
  )
}
