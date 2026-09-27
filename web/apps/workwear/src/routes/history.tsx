import type { HistoryQuery, HistorySort, OrderStatus } from '@ppe/api-client'
import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'

import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { OrderDetail } from '@/components/order-detail'
import { SortControl, SortableHead } from '@/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableHeader, TableRow, stackedBreak } from '@/components/ui/table'
import { useApi } from '@/lib/api'
import { LONG_WAIT_DAYS, activityAt, formatDateTime, formatUsage, formatWaiting, statusLabel, waitingDays } from '@/lib/history'
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
const statusTabs: { value: OrderStatus | ''; label: string }[] = [
  { value: 'ORDERED', label: 'Awaiting' },
  { value: 'GIVEN', label: 'Given' },
  { value: '', label: 'All' },
]

// History is paged, so the API sorts it (the whole history, not one page).
const columns: SortColumn<HistorySort>[] = [
  { key: 'record', label: 'Record' },
  { key: 'employee', label: 'Employee' },
  { key: 'date', label: 'Date', firstDir: 'desc' },
  { key: 'status', label: 'Status' },
  { key: 'usage', label: 'Usage time' },
  { key: 'total', label: 'Total value' },
]
const newestFirst: SortState<HistorySort> = { key: 'date', dir: 'desc' }

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
  navigate,
  onOpenRecord,
}: {
  selected: string | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
  onOpenRecord: (id: string, print: boolean) => void
}) {
  const { client } = useApi()
  const [filters, setFilters] = useState<Filters>(noFilters)
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

  const tz = settings.data?.timezone
  const now = new Date()
  const pages = orders.data ? Math.max(1, Math.ceil(orders.data.total / PAGE_SIZE)) : 1
  // The status tabs are not counted: they are always in view.
  const activeFilters = [filters.employee, filters.from, filters.to].filter(Boolean).length
  const dateError = filters.from && filters.to && filters.from > filters.to ? 'From must not be after To.' : undefined

  return (
    <div className={cn(selected && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:items-start lg:gap-6')}>
      {/* Narrow, an open order takes the screen; its list keeps its state behind it. */}
      <div className={cn('min-w-0', selected && 'max-lg:hidden')}>
        <PageHeader
          title="History"
          description="Stored orders, newest activity first. Values are as they were when ordered."
          actions={
            <Button variant="outline" className="md:hidden" aria-expanded={showFilters} aria-controls="history-filters" onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal aria-hidden /> Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
            </Button>
          }
        />

        <div role="group" aria-label="Status" className="mb-4 grid w-full grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1 sm:inline-grid sm:w-auto">
          {statusTabs.map((t) => (
            <button
              key={t.label}
              type="button"
              aria-pressed={filters.status === t.value}
              onClick={() => setFilter('status', t.value)}
              className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11"
            >
              {t.label}
              {counts.data ? <span className="tabular-nums text-muted-foreground">{counts.data[t.value]}</span> : null}
            </button>
          ))}
        </div>

        <section
          id="history-filters"
          aria-label="Filters"
          className={cn(
            'mb-4 grid gap-3 sm:grid-cols-2',
            // Beside an open order the list is narrow: two columns there, three on their own.
            !selected && 'xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_auto]',
            !showFilters && 'max-md:hidden',
          )}
        >
          <div>
            <p className="mb-1.5 text-sm font-medium">Employee</p>
            <EmployeePicker
              label="Employee"
              selected={filters.employee}
              onSelect={(e) => setFilter('employee', { id: e.id, full_name: e.full_name, code: e.code })}
              onClear={() => setFilter('employee', null)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm font-medium">
              From
              <Input type="date" className="mt-1.5" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
            </label>
            <label className="text-sm font-medium">
              To
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
              Clear filters
            </Button>
          </div>
        </section>
        {dateError ? <p role="alert" className="mb-4 text-sm text-destructive">{dateError}</p> : null}
        {tz ? <p className="mb-4 text-xs text-muted-foreground">Dates and times are shown in {tz}.</p> : null}

        {orders.error && !dateError ? (
          <ErrorState error={orders.error} onRetry={orders.reload} />
        ) : !orders.data ? (
          <Loading />
        ) : orders.data.orders.length === 0 ? (
          <EmptyState
            action={
              activeFilters > 0 ? (
                <Button variant="outline" size="sm" onClick={() => { setFilters((f) => ({ ...noFilters, status: f.status })); setPage(1) }}>
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {activeFilters > 0
              ? 'No orders match these filters.'
              : filters.status === 'ORDERED'
                ? 'Nothing is waiting: every order is confirmed.'
                : filters.status === 'GIVEN'
                  ? 'No order has been given yet.'
                  : 'No orders yet. Orders appear here after Mark as Ordered.'}
          </EmptyState>
        ) : (
          <>
            {/*
              A row opens its order, where its actions are. Where the table is
              narrow each order is a compact three-line row: record and status,
              employee, then date and value.
            */}
            <Table stack stackBelow="lg" sortControl={<SortControl columns={columns} {...sortProps} />}>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <SortableHead key={c.key} column={c} align={c.key === 'total' ? 'right' : 'left'} {...sortProps} />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="stacked:gap-2">
                {orders.data.orders.map((o) => {
                  const days = o.status === 'ORDERED' ? waitingDays(o.ordered_at, now, tz) : 0
                  return (
                    <TableRow
                      key={o.id}
                      data-state={selected === o.id ? 'selected' : undefined}
                      aria-current={selected === o.id ? 'true' : undefined}
                      className={cn(stackedBreak, 'cursor-pointer stacked:py-2.5 stacked:data-[state=selected]:bg-muted')}
                      // The whole row opens the order; the record number is the real link,
                      // for keyboards, screen readers and "open in new tab".
                      onClick={(ev) => {
                        if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                        open(o.id)
                      }}
                    >
                      <TableCell className="font-medium stacked:order-1 stacked:w-auto stacked:flex-1 stacked:text-base stacked:font-semibold">
                        <a
                          {...linkTo({ name: 'history', order: o.id }, () => open(o.id))}
                          className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {o.record_number}
                        </a>
                      </TableCell>
                      <TableCell className="min-w-32 whitespace-normal stacked:order-3">
                        {o.employee_first_name} {o.employee_last_name}
                        {o.employee_code ? <span className="text-muted-foreground"> · {o.employee_code}</span> : null}
                      </TableCell>
                      <TableCell className="tabular-nums stacked:order-4 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
                        {formatDateTime(activityAt(o), tz)}
                      </TableCell>
                      <TableCell className="stacked:order-1 stacked:w-auto">
                        <span className="inline-flex items-center gap-2">
                          <Badge variant={o.status === 'GIVEN' ? 'default' : 'secondary'}>{statusLabel[o.status]}</Badge>
                          {o.status === 'ORDERED' ? (
                            <span className={cn('text-xs whitespace-nowrap', days > LONG_WAIT_DAYS ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                              {formatWaiting(days)}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className={cn('stacked:order-4 stacked:w-auto stacked:text-xs stacked:text-muted-foreground', o.usage_months === null && 'stacked:hidden')}>
                        {formatUsage(o.usage_months) || '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums stacked:order-4 stacked:ml-auto stacked:w-auto">{formatEuro(o.total_cents)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <nav className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Pages">
              <span className="text-muted-foreground">
                {orders.data.total} order{orders.data.total === 1 ? '' : 's'} · page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </nav>
          </>
        )}
      </div>

      {selected ? (
        <aside aria-label="Order" className="lg:sticky lg:top-8 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-4">
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
          />
        </aside>
      ) : null}
    </div>
  )
}
