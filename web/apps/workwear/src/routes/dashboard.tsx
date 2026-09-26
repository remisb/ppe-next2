import type { Dashboard as DashboardData, DashboardMonth } from '@ppe/api-client'
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react'

import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/lib/api'
import { barPercent, changeText, formatDays, monthLabel, niceCeiling, plural, share } from '@/lib/dashboard'
import { formatDateTime } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro, formatSize } from '@/lib/utils'

type Navigate = (to: Route) => void

/** A date without the time, in the organisation's timezone. */
const formatDate = (iso: string, tz: string) => formatDateTime(iso, tz).slice(0, 10)

const inlineLink = 'rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The administrator's start screen: what is waiting, what was spent, what is
 * due for replacement and what in the master data blocks ordering. Figures
 * come from GET /api/v1/dashboard; nothing here changes data.
 */
export function Dashboard({ navigate }: { navigate: Navigate }) {
  const { client } = useApi()
  const board = useLoad(() => client.dashboard())
  const d = board.data

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          d
            ? `Orders, spending and what needs attention. Months and dates are in ${d.timezone}; updated ${formatDateTime(d.generated_at, d.timezone).slice(11)}.`
            : 'Orders, spending and what needs attention.'
        }
        actions={
          <Button variant="outline" onClick={board.reload} disabled={board.loading}>
            <RefreshCw aria-hidden className={cn(board.loading && 'animate-spin')} /> Refresh
          </Button>
        }
      />
      {board.error ? (
        <ErrorState error={board.error} onRetry={board.reload} />
      ) : !d ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4 md:gap-6">
          <Kpis d={d} />
          <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
            <MonthlyChart months={d.months} className="lg:col-span-2" />
            <ConfirmationCard d={d} />
          </div>
          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <ReplacementsCard d={d} navigate={navigate} />
            <WaitingCard d={d} navigate={navigate} />
          </div>
          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <TopItemsCard d={d} />
            <SetupCard d={d} navigate={navigate} />
          </div>
        </div>
      )}
    </>
  )
}

function Kpis({ d }: { d: DashboardData }) {
  const cur = d.months.at(-1)
  const prev = d.months.at(-2)
  const r = d.replacements
  return (
    <ul aria-label="Key figures" className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:gap-4 lg:grid-cols-4">
      <Kpi
        label="Awaiting confirmation"
        value={String(d.awaiting.orders)}
        detail={
          d.awaiting.orders === 0
            ? 'Every order is confirmed.'
            : `${formatEuro(d.awaiting.value_cents)} · oldest ${formatDays(d.awaiting.oldest_days)}`
        }
        alert={(d.awaiting.oldest_days ?? 0) > 14}
      />
      {cur ? (
        <Kpi
          label={`Given in ${monthLabel(cur.month)}`}
          value={formatEuro(cur.given_cents)}
          detail={`${plural(cur.given_items, 'item')} in ${plural(cur.given_orders, 'order')}`}
          change={prev ? changeText(cur.given_cents, prev.given_cents, prev.month) : ''}
        />
      ) : null}
      {cur ? (
        <Kpi
          label={`Ordered in ${monthLabel(cur.month)}`}
          value={formatEuro(cur.ordered_cents)}
          detail={plural(cur.ordered_orders, 'order')}
          change={prev ? changeText(cur.ordered_cents, prev.ordered_cents, prev.month) : ''}
        />
      ) : null}
      <Kpi
        label="Replacements due"
        value={String(r.overdue + r.due_soon)}
        detail={`${r.overdue} overdue · ${r.due_soon} within ${r.due_soon_days} days`}
        alert={r.overdue > 0}
      />
    </ul>
  )
}

function Kpi({ label, value, detail, change, alert = false }: { label: string; value: string; detail: string; change?: string; alert?: boolean }) {
  return (
    <li>
      <Card size="sm" className="h-full">
        <CardContent className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {label}
            {alert ? <AlertTriangle aria-label="Needs attention" className="size-3.5 text-destructive" /> : null}
          </span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
          <span className="text-xs text-muted-foreground">
            {detail}
            {change ? <span className="block">{change}</span> : null}
          </span>
        </CardContent>
      </Card>
    </li>
  )
}

/**
 * Value ordered and given per month, as paired bars. The bars are drawn for
 * the eye only; the same figures are in a table for screen readers.
 */
function MonthlyChart({ months, className }: { months: DashboardMonth[]; className?: string }) {
  const scale = niceCeiling(Math.max(0, ...months.flatMap((m) => [m.ordered_cents, m.given_cents])))
  const total = months.reduce((s, m) => s + m.given_cents, 0)
  const first = months[0]
  const last = months.at(-1)
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>Spending by month</h2>
        </CardTitle>
        <CardDescription>
          {first && last ? `${monthLabel(first.month, true)} – ${monthLabel(last.month, true)}: ` : ''}
          {formatEuro(total)} given. Orders count in the month they were ordered, and again in the month they were given.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div aria-hidden className="flex items-center gap-4 pb-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-foreground/25" /> Ordered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-foreground/80" /> Given
          </span>
          <span className="ml-auto tabular-nums">Scale {formatEuro(scale)}</span>
        </div>
        <div aria-hidden className="relative h-44 border-b border-border md:h-52">
          {[25, 50, 75, 100].map((p) => (
            <div key={p} className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ bottom: `${p}%` }} />
          ))}
          <div className="relative flex h-full items-end gap-0.5 sm:gap-1.5">
            {months.map((m) => (
              <div
                key={m.month}
                title={`${monthLabel(m.month, true)}: ordered ${formatEuro(m.ordered_cents)}, given ${formatEuro(m.given_cents)}`}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-px sm:gap-0.5"
              >
                <div className="w-full max-w-4 rounded-t-sm bg-foreground/25" style={{ height: `${barPercent(m.ordered_cents, scale)}%` }} />
                <div className="w-full max-w-4 rounded-t-sm bg-foreground/80" style={{ height: `${barPercent(m.given_cents, scale)}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div aria-hidden className="flex gap-0.5 pt-1.5 text-center text-[0.625rem] text-muted-foreground sm:gap-1.5 sm:text-xs">
          {months.map((m, i) => (
            // Every month on wider screens; every other one on a phone, where twelve labels collide.
            <span key={m.month} className={cn('min-w-0 flex-1 truncate', i % 2 === 1 && 'max-sm:invisible')}>
              {monthLabel(m.month)}
            </span>
          ))}
        </div>
        {/* In a div: a table will not shrink to sr-only's 1px, and would widen a phone's page. */}
        <div className="sr-only">
          <table>
            <caption>Value ordered and given per month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Ordered</th>
                <th scope="col">Given</th>
                <th scope="col">Items given</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthLabel(m.month, true)}</th>
                  <td>{`${formatEuro(m.ordered_cents)} in ${plural(m.ordered_orders, 'order')}`}</td>
                  <td>{`${formatEuro(m.given_cents)} in ${plural(m.given_orders, 'order')}`}</td>
                  <td>{m.given_items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function ConfirmationCard({ d }: { d: DashboardData }) {
  const c = d.confirmation
  const electronic = share(c.electronic, c.given)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Confirmation</h2>
        </CardTitle>
        <CardDescription>Orders given in the last {c.window_days} days.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-muted-foreground">Given</dt>
            <dd className="text-2xl font-semibold tabular-nums">{c.given}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Median wait</dt>
            <dd className="text-2xl font-semibold tabular-nums">{c.median_days !== null && c.median_days < 1 ? 'under a day' : formatDays(c.median_days)}</dd>
          </div>
        </dl>
        {c.given > 0 ? (
          <div>
            <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-foreground/15">
              <div className="bg-foreground/80" style={{ width: `${electronic}%` }} />
            </div>
            <dl className="mt-2 flex justify-between gap-2 text-xs">
              <div>
                <dt className="inline text-muted-foreground">Electronic </dt>
                <dd className="inline font-medium tabular-nums">
                  {c.electronic} ({electronic}%)
                </dd>
              </div>
              <div className="text-right">
                <dt className="inline text-muted-foreground">Paper </dt>
                <dd className="inline font-medium tabular-nums">
                  {c.paper} ({100 - electronic}%)
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing was given in this period.</p>
        )}
        <p className="text-xs text-muted-foreground">Median wait is the time from Mark as Ordered to the employee's confirmation.</p>
      </CardContent>
    </Card>
  )
}

function ReplacementsCard({ d, navigate }: { d: DashboardData; navigate: Navigate }) {
  const r = d.replacements
  const more = r.overdue + r.due_soon - r.next.length
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Replacements due</h2>
        </CardTitle>
        <CardDescription>
          Items whose service period has ended or ends within {r.due_soon_days} days, counted from the date given and not already on
          an open order.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {r.next.length === 0 ? (
          <EmptyState>Nothing is due for replacement.</EmptyState>
        ) : (
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.next.map((x) => (
                <TableRow key={`${x.employee_id}-${x.catalogue_item_id}`}>
                  <TableCell className="stacked:mb-1">
                    <a {...linkTo({ name: 'employee', id: x.employee_id }, navigate)} className={inlineLink}>
                      {x.employee_name}
                    </a>
                    {x.employee_code ? <span className="block text-xs text-muted-foreground">{x.employee_code}</span> : null}
                  </TableCell>
                  <TableCell label="Item" className="whitespace-normal">
                    {x.item_name}
                    {x.size ? <span className="text-muted-foreground"> · {formatSize(x.size)}</span> : null}
                  </TableCell>
                  <TableCell label="Due" className="tabular-nums">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {formatDate(x.due_at, d.timezone)}
                      <Badge variant={x.overdue ? 'destructive' : 'secondary'}>{x.overdue ? 'Overdue' : 'Due soon'}</Badge>
                    </span>
                  </TableCell>
                  <TableCell label="Receipt">
                    <a {...linkTo({ name: 'record', id: x.order_id }, navigate)} aria-label={`Receipt ${x.record_number}`} className={inlineLink}>
                      {x.record_number}
                    </a>
                    <span className="block text-xs text-muted-foreground">given {formatDate(x.given_at, d.timezone)}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {more > 0 ? <p className="mt-3 text-xs text-muted-foreground">And {more} more, due later.</p> : null}
      </CardContent>
    </Card>
  )
}

function WaitingCard({ d, navigate }: { d: DashboardData; navigate: Navigate }) {
  const a = d.awaiting
  const more = a.orders - a.longest.length
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Longest waiting</h2>
        </CardTitle>
        <CardDescription>Ordered, but the employee has not yet confirmed receipt.</CardDescription>
      </CardHeader>
      <CardContent>
        {a.longest.length === 0 ? (
          <EmptyState>No order is waiting for confirmation.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {a.longest.map((w) => (
              <li key={w.order_id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <a {...linkTo({ name: 'employee', id: w.employee_id }, navigate)} className={cn(inlineLink, 'block truncate')}>
                    {w.employee_name}
                  </a>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {w.record_number} · ordered {formatDate(w.ordered_at, d.timezone)} · {formatEuro(w.value_cents)}
                  </span>
                </div>
                <Badge variant={w.days > 14 ? 'destructive' : 'outline'} className="tabular-nums">
                  {formatDays(w.days)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {more > 0 ? <p className="text-xs text-muted-foreground">And {more} more.</p> : <span />}
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'history' })}>
            History <ArrowRight aria-hidden />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function TopItemsCard({ d }: { d: DashboardData }) {
  const items = d.top_items
  const scale = Math.max(1, ...items.map((i) => i.quantity))
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Most given items</h2>
        </CardTitle>
        <CardDescription>By quantity over the last 12 months.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState>No items were given in this period.</EmptyState>
        ) : (
          <ol className="flex flex-col gap-3">
            {items.map((i) => (
              <li key={i.catalogue_item_id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{i.item_name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {i.quantity} · {formatEuro(i.value_cents)}
                  </span>
                </div>
                <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full rounded-full bg-foreground/70" style={{ width: `${barPercent(i.quantity, scale)}%` }} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

/** Master data at a glance, with what in it stops or slows ordering and where to fix it. */
function SetupCard({ d, navigate }: { d: DashboardData; navigate: Navigate }) {
  const s = d.setup
  const rows: { label: string; count: number; issue: string | null; to: Route }[] = [
    {
      label: 'Employees',
      count: s.employees,
      issue: s.employees_missing_sizes > 0 ? `${s.employees_missing_sizes} missing a size` : null,
      to: { name: 'employees' },
    },
    {
      label: 'Catalogue items',
      count: s.catalogue_active,
      issue: s.catalogue_unpriced > 0 ? `${s.catalogue_unpriced} without a price or service period` : null,
      to: { name: 'catalogue' },
    },
    { label: 'Item sets', count: s.item_sets_active, issue: null, to: { name: 'itemSets' } },
    { label: 'Users', count: s.users, issue: s.admins === 1 ? 'only one administrator' : null, to: { name: 'users' } },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Setup</h2>
        </CardTitle>
        <CardDescription>Active records, and anything that holds up ordering.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.label}>
              <a
                {...linkTo(r.to, navigate)}
                className="-mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {r.issue ? (
                  <AlertTriangle aria-hidden className="size-4 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.label}</span>
                  {r.issue ? <span className="block text-xs text-destructive">{r.issue}</span> : null}
                </span>
                <span className="text-lg font-semibold tabular-nums">{r.count}</span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
