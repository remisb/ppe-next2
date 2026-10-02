import type { EmployeeDashboard as Data, EmployeeDashboardWaiting } from '@ppe/api-client'

import { KeyFigures, Kpi, MonthChart, MoreLink, NeedsYouPanel, Panel, RefreshButton, formatDate, inlineLink, jumpTo } from '@/components/dashboard'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { useApi } from '@/lib/api'
import { type Need, changeText, formatDays, missingSizesText, missingText, monthLabel } from '@/lib/dashboard'
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
        title={t.dashboard.employeeDashboard}
        descriptionClassName="max-md:hidden"
        description={
          d
            ? `${t.dashboard.employeeIntro} ${t.dashboard.updated(formatDateTime(d.generated_at, d.timezone).slice(11))}`
            : t.dashboard.employeeIntro
        }
        actions={
          <>
            <Button onClick={() => navigate({ name: 'createOrder' })}>{t.dashboard.createOrder}</Button>
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
          <NeedsYouPanel
            needs={needsOf(d)}
            navigate={navigate}
            empty={t.dashboard.employeeNothingNeeded}
            footer={
              d.awaiting.orders > d.awaiting.longest.length ? (
                <MoreLink label={t.dashboard.allYoursWaiting(d.awaiting.orders)} to={{ name: 'history' }} navigate={navigate} />
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
        label={t.dashboard.awaitingConfirmation}
        value={String(a.orders)}
        detail={
          a.orders === 0
            ? t.dashboard.everyOrderOfYoursConfirmed
            : `${t.common.items(a.items)} · ${t.dashboard.oldest(formatDays(a.oldest_days))}${unlinked > 0 ? ` · ${t.dashboard.withoutUsableLink(unlinked)}` : ''}`
        }
        brief={
          a.orders === 0 ? t.dashboard.allConfirmed : unlinked > 0 ? t.dashboard.withoutLink(unlinked) : t.dashboard.oldest(formatDays(a.oldest_days))
        }
        alert={unlinked > 0 || (a.oldest_days ?? 0) > 14}
        onOpen={a.orders > 0 ? () => jumpTo('[data-need^="wait-"]') : undefined}
        openHint={t.dashboard.showInNeedsYou}
      />
      {cur ? (
        <Kpi
          label={t.dashboard.givenIn(monthLabel(cur.month))}
          value={String(cur.given)}
          detail={t.dashboard.yourOrdersItems(cur.given, cur.given_items)}
          change={changeText(cur.given, prev.given, prev.month, d.through_day)}
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
      <Kpi
        label={t.dashboard.missingSizes}
        value={String(d.missing_sizes.employees)}
        detail={missingSizesText(d.missing_sizes.employees, d.missing_sizes.list[0])}
        alert={d.missing_sizes.employees > 0}
        onOpen={d.missing_sizes.employees > 0 ? () => navigate({ name: 'employees', missing: true }) : undefined}
        openHint={t.dashboard.showInEmployees}
      />
    </KeyFigures>
  )
}

/** Whether the employee can confirm electronically: a link was sent and is still usable. */
function linkText(w: EmployeeDashboardWaiting, timezone: string): string {
  switch (w.link) {
    case 'ACTIVE':
      return t.dashboard.linkValidUntil(w.link_expires_at ? formatDate(w.link_expires_at, timezone) : '—')
    case 'EXPIRED':
      return t.dashboard.linkExpired
    default:
      return t.dashboard.noLinkSent
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
    detail: `${w.record_number} · ${t.common.items(w.items)} · ${linkText(w, d.timezone)}`,
    action: {
      label: w.link === 'ACTIVE' ? t.dashboard.open : t.dashboard.sendLink,
      context: t.dashboard.forContext(w.record_number),
      to: { name: 'history', order: w.order_id },
    },
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
  const sizes = d.missing_sizes.list.map<Need>((e) => ({
    key: `size-${e.employee_id}`,
    urgent: false,
    tag: t.dashboard.sizeTag,
    title: e.employee_name,
    detail: missingText(e),
    action: { label: t.dashboard.addSizes, context: t.dashboard.forContext(e.employee_name), to: { name: 'employee', id: e.employee_id } },
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
      title={t.dashboard.yourOrdersByMonth}
      className={className}
      description={`${first && last ? `${monthLabel(first.month, true)} – ${monthLabel(last.month, true)}: ` : ''}${t.dashboard.yourOrdersDescription(total)}`}
    >
      <MonthChart
        months={d.months.map((m) => m.month)}
        series={[
          { label: t.common.ordered, className: 'bg-foreground/25', values: d.months.map((m) => m.ordered) },
          { label: t.common.given, className: 'bg-foreground/80', values: d.months.map((m) => m.given) },
        ]}
        format={String}
        caption={t.dashboard.yourOrdersCaption}
        cell={(s, i) => {
          const m = d.months[i]!
          return s.label === t.common.ordered ? t.common.orders(m.ordered) : `${t.common.orders(m.given)}, ${t.common.items(m.given_items)}`
        }}
      />
    </Panel>
  )
}

function RecentlyGivenCard({ d, navigate }: { d: Data; navigate: Navigate }) {
  return (
    <Panel title={t.dashboard.recentlyGiven} description={t.dashboard.recentlyGivenDescription}>
      {d.recently_given.length === 0 ? (
        <EmptyState>{t.dashboard.noneGivenYet}</EmptyState>
      ) : (
        <ul className="grid gap-x-6 md:grid-cols-2">
          {d.recently_given.map((g) => (
            <li key={g.order_id} className="flex items-center justify-between gap-3 border-b border-border py-2.5">
              <div className="min-w-0">
                <a {...linkTo({ name: 'employee', id: g.employee_id }, navigate)} className={cn(inlineLink, 'block truncate')}>
                  {g.employee_name}
                </a>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t.dashboard.givenOn(formatDate(g.given_at, d.timezone))} ·{' '}
                  {g.method === 'PAPER' ? t.dashboard.methodPaper : g.method === 'IN_PERSON' ? t.dashboard.methodInPerson : t.dashboard.methodElectronic} ·{' '}
                  {t.common.items(g.items)} ·{' '}
                  {formatEuro(g.value_cents)}
                </span>
              </div>
              <a
                {...linkTo({ name: 'record', id: g.order_id }, navigate)}
                aria-label={t.dashboard.receipt(g.record_number)}
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
