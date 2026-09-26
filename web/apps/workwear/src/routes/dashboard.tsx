import type { Dashboard as DashboardData, DashboardMonth } from '@ppe/api-client'
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react'

import { BarList, KeyFigures, Kpi, MonthChart, Panel, ReplacementsPanel, formatDate, inlineLink } from '@/components/dashboard'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApi, useSession } from '@/lib/api'
import { changeText, formatDays, monthLabel, plural, share } from '@/lib/dashboard'
import { formatDateTime } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro } from '@/lib/utils'

type Navigate = (to: Route) => void

/**
 * The administrator's start screen: what is waiting, what was spent, what is
 * due for replacement and what in the master data blocks ordering. Figures
 * come from GET /api/v1/dashboard; nothing here changes data.
 */
export function Dashboard({ navigate }: { navigate: Navigate }) {
  const { client } = useApi()
  const { isManager, isEmployee } = useSession()
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
          <>
            {/* An administrator who also holds another role reaches its dashboard from here, not from a tab. */}
            {isManager ? (
              <Button variant="ghost" onClick={() => navigate({ name: 'managerDashboard' })}>
                Manager Dashboard <ArrowRight aria-hidden />
              </Button>
            ) : null}
            {isEmployee ? (
              <Button variant="ghost" onClick={() => navigate({ name: 'employeeDashboard' })}>
                Employee Dashboard <ArrowRight aria-hidden />
              </Button>
            ) : null}
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
          <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
            <MonthlyChart months={d.months} className="lg:col-span-2" />
            <ConfirmationCard d={d} />
          </div>
          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <ReplacementsPanel replacements={d.replacements} timezone={d.timezone} navigate={navigate} />
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
    <KeyFigures>
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
    </KeyFigures>
  )
}

/** Value ordered and given per month, as paired bars. */
function MonthlyChart({ months, className }: { months: DashboardMonth[]; className?: string }) {
  const total = months.reduce((s, m) => s + m.given_cents, 0)
  const first = months[0]
  const last = months.at(-1)
  return (
    <Panel
      title="Spending by month"
      className={className}
      description={
        <>
          {first && last ? `${monthLabel(first.month, true)} – ${monthLabel(last.month, true)}: ` : ''}
          {formatEuro(total)} given. Orders count in the month they were ordered, and again in the month they were given.
        </>
      }
    >
      <MonthChart
        months={months.map((m) => m.month)}
        series={[
          { label: 'Ordered', className: 'bg-foreground/25', values: months.map((m) => m.ordered_cents) },
          { label: 'Given', className: 'bg-foreground/80', values: months.map((m) => m.given_cents) },
        ]}
        format={formatEuro}
        caption="Value ordered and given per month"
        cell={(s, i) => {
          const m = months[i]!
          return s.label === 'Ordered'
            ? `${formatEuro(m.ordered_cents)} in ${plural(m.ordered_orders, 'order')}`
            : `${formatEuro(m.given_cents)} in ${plural(m.given_orders, 'order')}, ${plural(m.given_items, 'item')}`
        }}
      />
    </Panel>
  )
}

function ConfirmationCard({ d }: { d: DashboardData }) {
  const c = d.confirmation
  const electronic = share(c.electronic, c.given)
  return (
    <Panel title="Confirmation" description={`Orders given in the last ${c.window_days} days.`}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-muted-foreground">Given</dt>
            <dd className="text-2xl font-semibold tabular-nums">{c.given}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Median wait</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {c.median_days !== null && c.median_days < 1 ? 'under a day' : formatDays(c.median_days)}
            </dd>
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
      </div>
    </Panel>
  )
}

function WaitingCard({ d, navigate }: { d: DashboardData; navigate: Navigate }) {
  const a = d.awaiting
  const more = a.orders - a.longest.length
  return (
    <Panel title="Longest waiting" description="Ordered, but the employee has not yet confirmed receipt.">
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
    </Panel>
  )
}

function TopItemsCard({ d }: { d: DashboardData }) {
  return (
    <Panel title="Most given items" description="By quantity over the last 12 months.">
      {d.top_items.length === 0 ? (
        <EmptyState>No items were given in this period.</EmptyState>
      ) : (
        <BarList
          items={d.top_items.map((i) => ({
            key: i.catalogue_item_id,
            label: i.item_name,
            value: i.quantity,
            text: `${i.quantity} · ${formatEuro(i.value_cents)}`,
          }))}
        />
      )}
    </Panel>
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
    <Panel title="Setup" description="Active records, and anything that holds up ordering.">
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
    </Panel>
  )
}
