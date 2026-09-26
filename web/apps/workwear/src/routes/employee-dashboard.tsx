import type { EmployeeDashboard as Data, EmployeeDashboardWaiting } from '@ppe/api-client'
import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react'

import { KeyFigures, Kpi, MonthChart, Panel, ReplacementsPanel, formatDate, inlineLink } from '@/components/dashboard'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'
import { changeText, formatDays, monthLabel, plural } from '@/lib/dashboard'
import { formatDateTime } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro } from '@/lib/utils'

type Navigate = (to: Route) => void

/**
 * The start screen of the employee role, the staff who prepare orders: their
 * own orders still waiting for the employee's confirmation (and whether a
 * usable link was sent), their orders by month and recently given, and for the
 * whole organisation what is due for replacement and whose sizes are missing.
 * Figures come from GET /api/v1/dashboard/employee.
 */
export function EmployeeDashboard({ navigate }: { navigate: Navigate }) {
  const { client } = useApi()
  const board = useLoad(() => client.employeeDashboard())
  const d = board.data

  return (
    <>
      <PageHeader
        title="Employee Dashboard"
        description={
          d
            ? `Your orders and what to order next. Months and dates are in ${d.timezone}; updated ${formatDateTime(d.generated_at, d.timezone).slice(11)}.`
            : 'Your orders and what to order next.'
        }
        actions={
          <>
            <Button onClick={() => navigate({ name: 'createOrder' })}>Create Order</Button>
            <Button variant="outline" onClick={board.reload} disabled={board.loading}>
              <RefreshCw aria-hidden className={cn(board.loading && 'animate-spin')} /> Refresh
            </Button>
          </>
        }
      />
      {board.error ? (
        <ErrorState error={board.error} onRetry={board.reload} />
      ) : !d ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4 md:gap-6">
          <Kpis d={d} />
          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <WaitingCard d={d} navigate={navigate} />
            <ReplacementsPanel replacements={d.replacements} timezone={d.timezone} navigate={navigate} />
          </div>
          <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
            <ActivityChart d={d} className="lg:col-span-2" />
            <MissingSizesCard d={d} navigate={navigate} />
          </div>
          <RecentlyGivenCard d={d} navigate={navigate} />
        </div>
      )}
    </>
  )
}

function Kpis({ d }: { d: Data }) {
  const a = d.awaiting
  const cur = d.months.at(-1)
  const prev = d.months.at(-2)
  const r = d.replacements
  const unlinked = a.no_link + a.link_expired
  return (
    <KeyFigures>
      <Kpi
        label="Awaiting confirmation"
        value={String(a.orders)}
        detail={
          a.orders === 0
            ? 'Every order of yours is confirmed.'
            : `${plural(a.items, 'item')} · oldest ${formatDays(a.oldest_days)}${unlinked > 0 ? ` · ${unlinked} without a usable link` : ''}`
        }
        alert={unlinked > 0 || (a.oldest_days ?? 0) > 14}
      />
      {cur ? (
        <Kpi
          label={`Given in ${monthLabel(cur.month)}`}
          value={String(cur.given)}
          detail={`${plural(cur.given, 'order')} of yours, ${plural(cur.given_items, 'item')}`}
          change={prev ? changeText(cur.given, prev.given, prev.month) : ''}
        />
      ) : null}
      <Kpi
        label="Replacements due"
        value={String(r.overdue + r.due_soon)}
        detail={`${r.overdue} overdue · ${r.due_soon} within ${r.due_soon_days} days`}
        alert={r.overdue > 0}
      />
      <Kpi
        label="Missing sizes"
        value={String(d.missing_sizes.employees)}
        detail={d.missing_sizes.employees === 0 ? 'Every employee has their sizes.' : `${plural(d.missing_sizes.employees, 'employee')} to measure`}
        alert={d.missing_sizes.employees > 0}
      />
    </KeyFigures>
  )
}

function LinkBadge({ w, timezone }: { w: EmployeeDashboardWaiting; timezone: string }) {
  switch (w.link) {
    case 'ACTIVE':
      return <Badge variant="secondary">Link until {w.link_expires_at ? formatDate(w.link_expires_at, timezone) : '—'}</Badge>
    case 'EXPIRED':
      return <Badge variant="destructive">Link expired</Badge>
    default:
      return <Badge variant="outline">No link sent</Badge>
  }
}

/** The user's orders waiting for the employee's confirmation, oldest first. */
function WaitingCard({ d, navigate }: { d: Data; navigate: Navigate }) {
  const a = d.awaiting
  const more = a.orders - a.longest.length
  return (
    <Panel
      title="Waiting for confirmation"
      description="Orders you marked as ordered that the employee has not yet confirmed. Without a usable link they cannot confirm electronically: open the order in History to send one, or confirm on paper."
    >
      {a.longest.length === 0 ? (
        <EmptyState>None of your orders is waiting.</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {a.longest.map((w) => (
            <li key={w.order_id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <a {...linkTo({ name: 'employee', id: w.employee_id }, navigate)} className={cn(inlineLink, 'block truncate')}>
                  {w.employee_name}
                </a>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {w.record_number} · ordered {formatDate(w.ordered_at, d.timezone)} · {plural(w.items, 'item')} · {formatEuro(w.value_cents)}
                </span>
                <span className="mt-1 flex">
                  <LinkBadge w={w} timezone={d.timezone} />
                </span>
              </div>
              <Badge variant={w.days > 14 ? 'destructive' : 'outline'} className="shrink-0 tabular-nums">
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
    </Panel>
  )
}

/** The user's orders placed and given per month, as paired bars. */
function ActivityChart({ d, className }: { d: Data; className?: string }) {
  const first = d.months[0]
  const last = d.months.at(-1)
  const total = d.months.reduce((n, m) => n + m.ordered, 0)
  return (
    <Panel
      title="Your orders by month"
      className={className}
      description={`${first && last ? `${monthLabel(first.month, true)} – ${monthLabel(last.month, true)}: ` : ''}${plural(total, 'order')} placed. An order counts in the month it was ordered, and again in the month it was given.`}
    >
      <MonthChart
        months={d.months.map((m) => m.month)}
        series={[
          { label: 'Ordered', className: 'bg-foreground/25', values: d.months.map((m) => m.ordered) },
          { label: 'Given', className: 'bg-foreground/80', values: d.months.map((m) => m.given) },
        ]}
        format={String}
        caption="Your orders ordered and given per month"
        cell={(s, i) => {
          const m = d.months[i]!
          return s.label === 'Ordered' ? plural(m.ordered, 'order') : `${plural(m.given, 'order')}, ${plural(m.given_items, 'item')}`
        }}
      />
    </Panel>
  )
}

/** Employees whose missing sizes Create Order will flag, with a link to fill them in. */
function MissingSizesCard({ d, navigate }: { d: Data; navigate: Navigate }) {
  const m = d.missing_sizes
  const more = m.employees - m.list.length
  return (
    <Panel title="Missing sizes" description="Create Order flags these employees' clothing or shoe lines until a size is saved.">
      {m.list.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-4" /> Every employee has their sizes.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {m.list.map((e) => (
            <li key={e.employee_id} className="py-2 first:pt-0 last:pb-0">
              <a {...linkTo({ name: 'employee', id: e.employee_id }, navigate)} className={cn(inlineLink, 'block truncate')}>
                {e.employee_name}
              </a>
              <span className="text-xs text-muted-foreground">
                {e.employee_code ? `${e.employee_code} · ` : ''}
                {[e.clothing ? 'no clothing size or height' : '', e.shoes ? 'no shoe size' : ''].filter(Boolean).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 ? <p className="mt-3 text-xs text-muted-foreground">And {more} more.</p> : null}
    </Panel>
  )
}

function RecentlyGivenCard({ d, navigate }: { d: Data; navigate: Navigate }) {
  return (
    <Panel title="Recently given" description="Your orders the employee most recently confirmed, newest first.">
      {d.recently_given.length === 0 ? (
        <EmptyState>None of your orders has been given yet.</EmptyState>
      ) : (
        <ul className="grid gap-x-6 md:grid-cols-2">
          {d.recently_given.map((g) => (
            <li key={g.order_id} className="flex items-center justify-between gap-3 border-b border-border py-2.5">
              <div className="min-w-0">
                <a {...linkTo({ name: 'employee', id: g.employee_id }, navigate)} className={cn(inlineLink, 'block truncate')}>
                  {g.employee_name}
                </a>
                <span className="text-xs text-muted-foreground tabular-nums">
                  given {formatDate(g.given_at, d.timezone)} · {g.method === 'PAPER' ? 'paper' : 'electronic'} · {plural(g.items, 'item')} ·{' '}
                  {formatEuro(g.value_cents)}
                </span>
              </div>
              <a
                {...linkTo({ name: 'record', id: g.order_id }, navigate)}
                aria-label={`Receipt ${g.record_number}`}
                className={cn(inlineLink, 'inline-flex min-h-11 shrink-0 items-center text-sm tabular-nums md:min-h-0')}
              >
                {g.record_number}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
