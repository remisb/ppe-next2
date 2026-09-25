import type { HistoryQuery, ListedOrder, OrderStatus } from '@ppe/api-client'
import { ChevronDown, ChevronUp, FileText, Link2, Printer, SlidersHorizontal } from 'lucide-react'
import { Fragment, useState } from 'react'

import { ConfirmationSheet } from '@/components/confirmation-sheet'

import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { OrderLinesTable } from '@/components/order-lines'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WhatsAppButton } from '@/components/whatsapp-button'
import { useApi } from '@/lib/api'
import { activityAt, formatDateTime, formatUsage, historyActions, statusLabel } from '@/lib/history'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro } from '@/lib/utils'
import { formatWhatsApp, messageFromOrder } from '@/lib/whatsapp'

const PAGE_SIZE = 20

interface Filters {
  employee: PickedEmployee | null
  status: OrderStatus | ''
  from: string
  to: string
}

const noFilters: Filters = { employee: null, status: '', from: '', to: '' }

/**
 * History (manual §3.5): stored orders and snapshots, newest activity first.
 * Changing any filter reloads page 1.
 */
export function History({ onOpenRecord }: { onOpenRecord: (id: string, print: boolean) => void }) {
  const { client } = useApi()
  const [confirming, setConfirming] = useState<ListedOrder | null>(null)
  const [filters, setFilters] = useState<Filters>(noFilters)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Set<string>>(new Set())
  // Phone only: the filters fold away so the orders start at the top of the screen.
  const [showFilters, setShowFilters] = useState(false)
  const settings = useLoad(() => client.settings())

  const query: HistoryQuery = {
    ...(filters.employee ? { employee_id: filters.employee.id } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    page,
    page_size: PAGE_SIZE,
  }
  const key = JSON.stringify(query)
  const orders = useLoad(() => client.orders.list(query), [key])

  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const tz = settings.data?.timezone
  const pages = orders.data ? Math.max(1, Math.ceil(orders.data.total / PAGE_SIZE)) : 1
  const activeFilters = [filters.employee, filters.status, filters.from, filters.to].filter(Boolean).length
  const dateError = filters.from && filters.to && filters.from > filters.to ? 'From must not be after To.' : undefined

  return (
    <>
      <PageHeader
        title="History"
        description="Stored orders, newest activity first. Values are as they were when ordered."
        actions={
          <Button variant="outline" className="md:hidden" aria-expanded={showFilters} aria-controls="history-filters" onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal aria-hidden /> Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}
          </Button>
        }
      />

      <section
        id="history-filters"
        aria-label="Filters"
        className={cn('mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto]', !showFilters && 'max-md:hidden')}
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
        <label className="text-sm font-medium">
          Status
          <Select className="mt-1.5" value={filters.status} onChange={(e) => setFilter('status', e.target.value as OrderStatus | '')}>
            <option value="">All statuses</option>
            <option value="ORDERED">Ordered</option>
            <option value="GIVEN">Given</option>
          </Select>
        </label>
        <div className="flex items-end">
          <Button variant="ghost" className="w-full sm:w-auto" disabled={activeFilters === 0} onClick={() => { setFilters(noFilters); setPage(1) }}>
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
              <Button variant="outline" size="sm" onClick={() => { setFilters(noFilters); setPage(1) }}>
                Clear filters
              </Button>
            ) : undefined
          }
        >
          {activeFilters > 0 ? 'No orders match these filters.' : 'No orders yet. Orders appear here after Mark as Ordered.'}
        </EmptyState>
      ) : (
        <>
          {/* Where the table is narrow each order is a card: record and status, employee, details, then actions. */}
          <Table stack stackBelow="lg">
            <TableHeader>
              <TableRow>
                <TableHead>Record</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Usage time</TableHead>
                <TableHead className="text-right">Total value</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.data.orders.map((o) => (
                <Fragment key={o.id}>
                  <TableRow className={cn(open.has(o.id) && 'stacked:rounded-b-none')}>
                    <TableCell className="font-medium stacked:order-1 stacked:w-auto stacked:text-base stacked:font-semibold">{o.record_number}</TableCell>
                    <TableCell className="min-w-32 whitespace-normal stacked:order-3 stacked:mb-1">
                      {o.employee_first_name} {o.employee_last_name}
                      {o.employee_code ? <span className="text-muted-foreground"> · {o.employee_code}</span> : null}
                    </TableCell>
                    <TableCell label="Date" className="tabular-nums stacked:order-4">{formatDateTime(activityAt(o), tz)}</TableCell>
                    <TableCell className="stacked:order-2 stacked:ml-auto stacked:w-auto">
                      <Badge variant={o.status === 'GIVEN' ? 'default' : 'secondary'}>{statusLabel[o.status]}</Badge>
                    </TableCell>
                    <TableCell label="Usage time" className={cn('stacked:order-5', o.usage_months === null && 'stacked:hidden')}>
                      {formatUsage(o.usage_months) || '—'}
                    </TableCell>
                    <TableCell label="Total value" className="text-right font-medium tabular-nums stacked:order-6">{formatEuro(o.total_cents)}</TableCell>
                    <TableCell className="text-right stacked:order-7 stacked:mt-2">
                      <RowActions
                        order={o}
                        open={open.has(o.id)}
                        onToggle={() => toggle(o.id)}
                        onConfirm={() => setConfirming(o)}
                        onRecord={(print) => onOpenRecord(o.id, print)}
                      />
                    </TableCell>
                  </TableRow>
                  {open.has(o.id) ? (
                    <TableRow className="stacked:-mt-3 stacked:rounded-t-none stacked:border-t-0 stacked:bg-muted/30">
                      <TableCell colSpan={7} className="bg-muted/30 whitespace-normal stacked:block stacked:bg-transparent">
                        <p className="mb-2 text-xs text-muted-foreground">
                          Ordered {formatDateTime(o.ordered_at, tz)} by {o.prepared_by_name}
                          {o.given_at ? ` · given ${formatDateTime(o.given_at, tz)} by ${o.given_by_name ?? ''}` : ''}
                        </p>
                        <OrderLinesTable order={o} />
                        <div className="mt-3">
                          <WhatsAppButton
                            label={o.status === 'GIVEN' ? 'Share via WhatsApp' : 'Copy for WhatsApp'}
                            text={formatWhatsApp(messageFromOrder(o))}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
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
      <ConfirmationSheet
        order={confirming}
        onClose={() => setConfirming(null)}
        onGiven={() => {
          setConfirming(null)
          orders.reload()
        }}
        onPrint={(id) => onOpenRecord(id, true)}
      />
    </>
  )
}

/**
 * Per-state actions (manual §6). ORDERED: View Items, Open Employee
 * Confirmation, Copy for WhatsApp (inside View Items). GIVEN: View Items,
 * View Record, Print Record, Share via WhatsApp (inside View Items and on the record).
 */
function RowActions({
  order,
  open,
  onToggle,
  onConfirm,
  onRecord,
}: {
  order: ListedOrder
  open: boolean
  onToggle: () => void
  onConfirm: () => void
  onRecord: (print: boolean) => void
}) {
  const actions = historyActions(order.status)
  return (
    <div className="flex flex-wrap justify-end gap-1 stacked:w-full stacked:gap-2 stacked:*:flex-auto">
      {actions.includes('viewItems') ? (
        <Button size="sm" variant="outline" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          {open ? 'Hide Items' : 'View Items'}
        </Button>
      ) : null}
      {actions.includes('openConfirmation') ? (
        <Button size="sm" onClick={onConfirm}>
          <Link2 aria-hidden /> Open Employee Confirmation
        </Button>
      ) : null}
      {actions.includes('viewRecord') ? (
        <Button size="sm" variant="outline" onClick={() => onRecord(false)}>
          <FileText aria-hidden /> View Record
        </Button>
      ) : null}
      {actions.includes('printRecord') ? (
        <Button size="sm" variant="outline" onClick={() => onRecord(true)}>
          <Printer aria-hidden /> Print Record
        </Button>
      ) : null}
    </div>
  )
}
