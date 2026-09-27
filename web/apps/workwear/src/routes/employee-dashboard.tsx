import type { EmployeeDashboard as Data, EmployeeDashboardWaiting } from '@ppe/api-client'
import { RefreshCw } from 'lucide-react'

import { KeyFigures, Kpi, MonthChart, MoreLink, NeedsYouPanel, Panel, formatDate, inlineLink, jumpTo } from '@/components/dashboard'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'
import { type Need, changeText, formatDays, missingSizesText, missingText, monthLabel, plural } from '@/lib/dashboard'
import { formatDateTime } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro } from '@/lib/utils'

type Navigate = (to: Route) => void

/**
 * The start screen of the employee role, the staff who prepare orders. First
 * what needs doing, each with its action: their own orders still waiting for
 * the employee's confirmation (and whether a usable link was sent), and for the
 * whole organisation what is due for replacement and whose sizes are missing.
 * Then their orders by month and recently given. Figures come from
 * GET /api/v1/dashboard/employee.
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
          <Kpis d={d} navigate={navigate} />
          <NeedsYouPanel
            needs={needsOf(d)}
            navigate={navigate}
            empty="Nothing needs you right now."
            footer={
              d.awaiting.orders > d.awaiting.longest.length ? (
                <MoreLink label={`All ${d.awaiting.orders} of yours waiting in History`} to={{ name: 'history' }} navigate={navigate} />
              ) : null
            }
          />
          <ActivityChart d={d} />
          <RecentlyGivenCard d={d} navigate={navigate} />
        </div>
      )}
    </>
  )
}

function Kpis({ d, navigate }: { d: Data; navigate: Navigate }) {
  const a = d.awaiting
  const cur = d.months.at(-1)
  // The same days of the previous month, not all of it.
  const prev = d.previous_to_date
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
        onOpen={a.orders > 0 ? () => jumpTo('[data-need^="wait-"]') : undefined}
        openHint="Show them in Needs you"
      />
      {cur ? (
        <Kpi
          label={`Given in ${monthLabel(cur.month)}`}
          value={String(cur.given)}
          detail={`${plural(cur.given, 'order')} of yours, ${plural(cur.given_items, 'item')}`}
          change={changeText(cur.given, prev.given, prev.month, d.through_day)}
        />
      ) : null}
      <Kpi
        label="Replacements due"
        value={String(r.overdue + r.due_soon)}
        detail={`${r.overdue} overdue · ${r.due_soon} within ${r.due_soon_days} days`}
        alert={r.overdue > 0}
        onOpen={r.overdue + r.due_soon > 0 ? () => navigate({ name: 'replacements' }) : undefined}
        openHint="Show them all in Replacements due"
      />
      <Kpi
        label="Missing sizes"
        value={String(d.missing_sizes.employees)}
        detail={missingSizesText(d.missing_sizes.employees, d.missing_sizes.list[0])}
        alert={d.missing_sizes.employees > 0}
        onOpen={d.missing_sizes.employees > 0 ? () => navigate({ name: 'employees', missing: true }) : undefined}
        openHint="Show them in Employees"
      />
    </KeyFigures>
  )
}

/** Whether the employee can confirm electronically: a link was sent and is still usable. */
function linkText(w: EmployeeDashboardWaiting, timezone: string): string {
  switch (w.link) {
    case 'ACTIVE':
      return `link valid until ${w.link_expires_at ? formatDate(w.link_expires_at, timezone) : '—'}`
    case 'EXPIRED':
      return 'link expired'
    default:
      return 'no link sent'
  }
}

/**
 * The preparer's to-do list: their orders waiting for the employee (open the
 * order to send a link; an expired link or a long wait is urgent), what is due
 * for replacement (reorder it) and whose sizes are missing (fill them in).
 */
function needsOf(d: Data): Need[] {
  const waiting = d.awaiting.longest.map<Need>((w) => ({
    key: `wait-${w.order_id}`,
    urgent: w.days > 14 || w.link === 'EXPIRED',
    tag: formatDays(w.days),
    title: w.employee_name,
    detail: `${w.record_number} · ${plural(w.items, 'item')} · ${linkText(w, d.timezone)}`,
    action: { label: w.link === 'ACTIVE' ? 'Open' : 'Send link', context: `for ${w.record_number}`, to: { name: 'history', order: w.order_id } },
  }))
  const due = d.replacements.next.map<Need>((x) => ({
    key: `due-${x.employee_id}-${x.catalogue_item_id}`,
    urgent: x.overdue,
    tag: x.overdue ? 'Overdue' : 'Due soon',
    title: x.employee_name,
    detail: `${x.item_name}${x.size ? ` · ${x.size}` : ''} × ${x.quantity} · due ${formatDate(x.due_at, d.timezone)}`,
    action: {
      label: 'Reorder',
      context: `${x.item_name} for ${x.employee_name}`,
      to: { name: 'createOrder', prefill: { employeeId: x.employee_id, items: [{ id: x.catalogue_item_id, quantity: x.quantity }] } },
    },
  }))
  const sizes = d.missing_sizes.list.map<Need>((e) => ({
    key: `size-${e.employee_id}`,
    urgent: false,
    tag: 'Size',
    title: e.employee_name,
    detail: missingText(e),
    action: { label: 'Add sizes', context: `for ${e.employee_name}`, to: { name: 'employee', id: e.employee_id } },
  }))
  return [...waiting, ...due, ...sizes]
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
                  given {formatDate(g.given_at, d.timezone)} · {g.method === 'PAPER' ? 'paper' : g.method === 'IN_PERSON' ? 'in person' : 'electronic'} · {plural(g.items, 'item')} ·{' '}
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
