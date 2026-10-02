import type { Dashboard as DashboardData, DashboardMonth } from '@ppe/api-client'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'

import { BarList, KeyFigures, Kpi, MonthChart, MoreLink, NeedsYouPanel, Panel, RefreshButton, formatDate } from '@/components/dashboard'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { useApi, useSession } from '@/lib/api'
import { type Need, changeText, formatDays, monthLabel, share } from '@/lib/dashboard'
import { formatDateTime } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { formatEuro } from '@/lib/utils'

type Navigate = (to: Route) => void

/**
 * The administrator's start screen: the headline figures, then what needs
 * doing (orders waiting for confirmation, replacements due, setup gaps), each
 * with its action, then spending and confirmation over time. Figures come
 * from GET /api/v1/dashboard; nothing here changes data.
 */
export function Dashboard({ navigate }: { navigate: Navigate }) {
  const { client } = useApi()
  const { isManager, isEmployee } = useSession()
  const board = useLoad(() => client.dashboard())
  const d = board.data

  return (
    <>
      <PageHeader
        title={t.dashboard.title}
        descriptionClassName="max-md:hidden"
        description={
          d
            ? `${t.dashboard.adminIntro} ${t.dashboard.updated(formatDateTime(d.generated_at, d.timezone).slice(11))}`
            : t.dashboard.adminIntro
        }
        actions={
          <>
            {/* An administrator who also holds another role reaches its dashboard from here, not from a tab. */}
            {isManager ? (
              <Button variant="ghost" onClick={() => navigate({ name: 'managerDashboard' })}>
                {t.dashboard.managerDashboard} <ArrowRight aria-hidden />
              </Button>
            ) : null}
            {isEmployee ? (
              <Button variant="ghost" onClick={() => navigate({ name: 'employeeDashboard' })}>
                {t.dashboard.employeeDashboard} <ArrowRight aria-hidden />
              </Button>
            ) : null}
            <RefreshButton loading={board.loading} onClick={board.reload} />
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
          <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
            <NeedsYouPanel
              className="lg:col-span-2"
              needs={needsOf(d)}
              navigate={navigate}
              empty={t.dashboard.adminNothingNeeded}
              footer={
                d.awaiting.orders > d.awaiting.longest.length ? (
                  <MoreLink label={t.dashboard.allWaiting(d.awaiting.orders)} to={{ name: 'history' }} navigate={navigate} />
                ) : null
              }
            />
            <SetupCard d={d} navigate={navigate} />
          </div>
          <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
            <MonthlyChart months={d.months} className="lg:col-span-2" />
            <ConfirmationCard d={d} />
          </div>
          <TopItemsCard d={d} />
        </div>
      )}
    </>
  )
}

function Kpis({ d, navigate }: { d: DashboardData; navigate: Navigate }) {
  const cur = d.months.at(-1)
  // The same days of the previous month, not all of it.
  const prev = d.previous_to_date
  const r = d.replacements
  return (
    <KeyFigures>
      <Kpi
        label={t.dashboard.awaitingConfirmation}
        value={String(d.awaiting.orders)}
        detail={
          d.awaiting.orders === 0
            ? t.dashboard.everyOrderConfirmed
            : `${formatEuro(d.awaiting.value_cents)} · ${t.dashboard.oldest(formatDays(d.awaiting.oldest_days))}`
        }
        brief={d.awaiting.orders === 0 ? t.dashboard.allConfirmed : t.dashboard.oldest(formatDays(d.awaiting.oldest_days))}
        alert={(d.awaiting.oldest_days ?? 0) > 14}
        onOpen={d.awaiting.orders > 0 ? () => navigate({ name: 'history', status: 'ORDERED' }) : undefined}
        openHint={t.dashboard.showInHistory}
      />
      {cur ? (
        <Kpi
          label={t.dashboard.givenIn(monthLabel(cur.month))}
          value={formatEuro(cur.given_cents)}
          detail={t.dashboard.itemsInOrders(cur.given_items, cur.given_orders)}
          change={changeText(cur.given_cents, prev.given_cents, prev.month, d.through_day)}
        />
      ) : null}
      {cur ? (
        <Kpi
          label={t.dashboard.orderedIn(monthLabel(cur.month))}
          value={formatEuro(cur.ordered_cents)}
          detail={t.common.orders(cur.ordered_orders)}
          change={changeText(cur.ordered_cents, prev.ordered_cents, prev.month, d.through_day)}
        />
      ) : null}
      <Kpi
        label={t.dashboard.replacementsDue}
        value={String(r.overdue + r.due_soon)}
        detail={t.dashboard.dueDetail(r.overdue, r.due_soon, r.due_soon_days)}
        brief={t.dashboard.overdueCount(r.overdue)}
        alert={r.overdue > 0}
        onOpen={r.overdue + r.due_soon > 0 ? () => navigate({ name: 'replacements' }) : undefined}
        openHint={t.dashboard.showAllInReplacements}
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
      title={t.dashboard.spendingByMonth}
      className={className}
      description={
        <>
          {first && last ? `${monthLabel(first.month, true)} – ${monthLabel(last.month, true)}: ` : ''}
          {t.dashboard.spendingDescription(formatEuro(total))}
        </>
      }
    >
      <MonthChart
        months={months.map((m) => m.month)}
        series={[
          { label: t.common.ordered, className: 'bg-foreground/25', values: months.map((m) => m.ordered_cents) },
          { label: t.common.given, className: 'bg-foreground/80', values: months.map((m) => m.given_cents) },
        ]}
        format={formatEuro}
        caption={t.dashboard.spendingCaption}
        cell={(s, i) => {
          const m = months[i]!
          return s.label === t.common.ordered
            ? t.dashboard.valueInOrders(formatEuro(m.ordered_cents), m.ordered_orders)
            : t.dashboard.valueInOrdersItems(formatEuro(m.given_cents), m.given_orders, m.given_items)
        }}
      />
    </Panel>
  )
}

function ConfirmationCard({ d }: { d: DashboardData }) {
  const c = d.confirmation
  // The three methods' shares; in person takes the remainder so the bar and figures add up to 100.
  const electronic = share(c.electronic, c.given)
  const paper = share(c.paper, c.given)
  const methods = [
    { label: t.dashboard.electronic, count: c.electronic, pct: electronic, className: 'bg-foreground/80' },
    { label: t.dashboard.paper, count: c.paper, pct: paper, className: 'bg-foreground/45' },
    { label: t.dashboard.inPerson, count: c.in_person, pct: c.in_person > 0 ? 100 - electronic - paper : 0, className: 'bg-foreground/25' },
  ]
  return (
    <Panel title={t.dashboard.confirmation} description={t.dashboard.confirmationDescription(c.window_days)}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-muted-foreground">{t.common.given}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{c.given}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t.dashboard.medianWait}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {c.median_days !== null && c.median_days < 1 ? t.dashboard.underADay : formatDays(c.median_days)}
            </dd>
          </div>
        </dl>
        {c.given > 0 ? (
          <div>
            <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-foreground/10">
              {methods.map((m) => (
                <div key={m.label} className={m.className} style={{ width: `${m.pct}%` }} />
              ))}
            </div>
            <dl className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
              {methods
                .filter((m) => m.label !== t.dashboard.inPerson || m.count > 0)
                .map((m) => (
                  <div key={m.label}>
                    <dt className="inline text-muted-foreground">{m.label} </dt>
                    <dd className="inline font-medium tabular-nums">
                      {m.count} ({m.pct}%)
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.dashboard.nothingGiven}</p>
        )}
        <p className="text-xs text-muted-foreground">{t.dashboard.medianWaitNote}</p>
      </div>
    </Panel>
  )
}

/**
 * The administrator's to-do list: orders the employee has not confirmed
 * (open the order to send a link), replacements due (reorder the same item
 * and quantity for the same employee) and the setup gaps that stop ordering.
 */
function needsOf(d: DashboardData): Need[] {
  const waiting = d.awaiting.longest.map<Need>((w) => ({
    key: `wait-${w.order_id}`,
    urgent: w.days > 14,
    tag: formatDays(w.days),
    title: w.employee_name,
    detail: t.dashboard.waitingDetail(w.record_number, formatDate(w.ordered_at, d.timezone), formatEuro(w.value_cents)),
    action: { label: t.dashboard.sendLink, context: t.dashboard.forContext(w.record_number), to: { name: 'history', order: w.order_id } },
  }))
  const due = d.replacements.next.map<Need>((x) => ({
    key: `due-${x.employee_id}-${x.catalogue_item_id}`,
    urgent: x.overdue,
    tag: x.overdue ? t.dashboard.overdue : t.dashboard.dueSoon,
    title: x.employee_name,
    detail: `${x.item_name}${x.size ? ` · ${x.size}` : ''} × ${x.quantity} · ${t.dashboard.dueOn(formatDate(x.due_at, d.timezone))}`,
    action: {
      label: t.dashboard.reorder,
      context: t.dashboard.itemFor(x.item_name, x.employee_name),
      to: { name: 'createOrder', prefill: { employeeId: x.employee_id, items: [{ id: x.catalogue_item_id, quantity: x.quantity }] } },
    },
  }))
  const s = d.setup
  const setup: Need[] = []
  if (s.employees_missing_sizes > 0)
    setup.push({
      key: 'sizes',
      urgent: false,
      tag: t.dashboard.sizesTag,
      title: t.dashboard.employeesMissingSize(s.employees_missing_sizes),
      detail: t.dashboard.createOrderWillAsk,
      action: { label: t.dashboard.addSizes, context: t.dashboard.inEmployees, to: { name: 'employees' } },
    })
  if (s.catalogue_unpriced > 0)
    setup.push({
      key: 'unpriced',
      urgent: false,
      tag: t.dashboard.itemsTag,
      title: t.dashboard.itemsUnpriced(s.catalogue_unpriced),
      detail: t.dashboard.markAsOrderedRefuses,
      action: { label: t.dashboard.fix, context: t.dashboard.inCatalogue, to: { name: 'catalogue' } },
    })
  return [...waiting, ...due, ...setup]
}

function TopItemsCard({ d }: { d: DashboardData }) {
  return (
    <Panel title={t.dashboard.mostGiven} description={t.dashboard.mostGivenDescription}>
      {d.top_items.length === 0 ? (
        <EmptyState>{t.dashboard.noItemsGiven}</EmptyState>
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
      label: t.dashboard.employees,
      count: s.employees,
      issue: s.employees_missing_sizes > 0 ? t.dashboard.missingASize(s.employees_missing_sizes) : null,
      to: { name: 'employees' },
    },
    {
      label: t.dashboard.catalogueItems,
      count: s.catalogue_active,
      issue: s.catalogue_unpriced > 0 ? t.dashboard.withoutPriceOrPeriod(s.catalogue_unpriced) : null,
      to: { name: 'catalogue' },
    },
    { label: t.dashboard.itemSets, count: s.item_sets_active, issue: null, to: { name: 'itemSets' } },
    { label: t.dashboard.users, count: s.users, issue: s.admins === 1 ? t.dashboard.onlyOneAdmin : null, to: { name: 'users' } },
  ]
  return (
    <Panel title={t.dashboard.setup} description={t.dashboard.setupDescription}>
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
