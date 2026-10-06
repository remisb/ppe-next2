import type { ManagerDashboard as Data } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CheckCircle2 } from 'lucide-react'

import { KeyFigures, Kpi, Panel, RefreshButton } from '@ppe/ui/components/panel'
import { BarList, MonthChart, formatDate, inlineLink, jumpTo } from '@/components/dashboard'
import { t } from '@/i18n'
import { changeText, monthLabel, percentChange } from '@/lib/dashboard'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { type Route, linkTo } from '@/lib/router'
import { formatEuro, formatMonths } from '@/lib/utils'

type Navigate = (to: Route) => void

/**
 * The manager's start screen: items, prices and purchasing. What is on order,
 * what was ordered and on which items, what will need buying for replacements,
 * recent price changes, what in the catalogue and item sets holds up ordering,
 * and the sizes to stock. Figures come from GET /api/v1/dashboard/manager.
 */
export function ManagerDashboard({ navigate }: { navigate: Navigate }) {
  const { client } = useApi()
  const isEmployee = useSession().can('dashboard.employee')
  const board = useLoad(() => client.managerDashboard())
  const d = board.data

  return (
    <>
      <PageHeader
        title={t.dashboard.managerDashboard}
        descriptionClassName="max-md:hidden"
        description={
          d
            ? `${t.dashboard.managerIntro} ${t.dashboard.updated(formatDateTime(d.generated_at, d.timezone).slice(11))}`
            : t.dashboard.managerIntro
        }
        actions={
          <>
            {/* A manager who also prepares orders reaches that dashboard from here, not from a tab. */}
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
            <OrderedChart d={d} className="lg:col-span-2" />
            <SizesCard d={d} />
          </div>
          <ForecastCard d={d} />
          <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
            <SpendCard d={d} />
            <PriceChangesCard d={d} />
          </div>
          <ReadinessCard d={d} navigate={navigate} />
        </div>
      )}
    </>
  )
}

function Kpis({ d, navigate }: { d: Data; navigate: Navigate }) {
  const cur = d.months.at(-1)
  // The same days of the previous month, not all of it.
  const prev = d.previous_to_date
  const year = d.months.reduce((t, m) => ({ orders: t.orders + m.orders, items: t.items + m.items, value: t.value + m.value_cents }), {
    orders: 0,
    items: 0,
    value: 0,
  })
  const f = d.forecast
  return (
    <KeyFigures>
      <Kpi
        label={t.dashboard.onOrder}
        value={formatEuro(d.on_order.value_cents)}
        detail={t.dashboard.onOrderDetail(d.on_order.items, d.on_order.orders)}
        brief={t.common.orders(d.on_order.orders)}
        onOpen={d.on_order.orders > 0 ? () => navigate({ name: 'history', status: 'ORDERED' }) : undefined}
        openHint={t.dashboard.showInHistory}
      />
      {cur ? (
        <Kpi
          label={t.dashboard.orderedIn(monthLabel(cur.month))}
          value={formatEuro(cur.value_cents)}
          detail={t.dashboard.itemsInOrders(cur.items, cur.orders)}
          change={changeText(cur.value_cents, prev.value_cents, prev.month, d.through_day)}
        />
      ) : null}
      <Kpi
        label={t.dashboard.orderedLast12}
        value={formatEuro(year.value)}
        detail={t.dashboard.itemsInOrders(year.items, year.orders)}
        brief={t.common.orders(year.orders)}
      />
      <Kpi
        label={t.dashboard.replacementsNext(f.days)}
        value={t.common.items(f.items)}
        detail={
          f.items === 0
            ? t.dashboard.nothingIsDue
            : `${t.dashboard.aboutAtCurrentPrices(formatEuro(f.estimated_cents))}${f.unpriced > 0 ? ` · ${t.dashboard.withoutPrice(f.unpriced)}` : ''}`
        }
        brief={
          f.items === 0 ? t.dashboard.nothingDue : f.unpriced > 0 ? t.dashboard.unpriced(f.unpriced) : t.dashboard.about(formatEuro(f.estimated_cents))
        }
        alert={f.unpriced > 0}
        onOpen={f.items > 0 ? () => jumpTo('[data-panel="forecast"]') : undefined}
        openHint={t.dashboard.showForecast}
      />
    </KeyFigures>
  )
}

function OrderedChart({ d, className }: { d: Data; className?: string }) {
  const first = d.months[0]
  const last = d.months.at(-1)
  return (
    <Panel
      title={t.dashboard.orderedByMonth}
      className={className}
      description={`${first && last ? `${monthLabel(first.month, true)} – ${monthLabel(last.month, true)}. ` : ''}${t.dashboard.orderedByMonthDescription}`}
    >
      <MonthChart
        months={d.months.map((m) => m.month)}
        series={[{ label: t.common.ordered, className: 'bg-foreground/70', values: d.months.map((m) => m.value_cents) }]}
        format={formatEuro}
        caption={t.dashboard.orderedCaption}
        cell={(_, i) => {
          const m = d.months[i]!
          return t.dashboard.valueItemsInOrders(formatEuro(m.value_cents), m.items, m.orders)
        }}
      />
    </Panel>
  )
}

/** Employees per size, for stocking: the size Create Order would use for each. */
function SizesCard({ d }: { d: Data }) {
  const s = d.sizes
  return (
    <Panel title={t.dashboard.sizesToStock} description={t.dashboard.sizesToStockDescription}>
      <div className="flex flex-col gap-5">
        <SizeBars title={t.dashboard.clothing} sizes={s.clothing} />
        <SizeBars title={t.dashboard.shoes} sizes={s.shoes} />
        <p className="text-xs text-muted-foreground">
          {s.suggested > 0 ? `${t.dashboard.suggestedFromHeight(s.suggested)} ` : ''}
          {s.no_clothing > 0 || s.no_shoes > 0 ? t.dashboard.withoutASize(s.no_clothing, s.no_shoes) : t.dashboard.everyoneHasBothSizes}
        </p>
      </div>
    </Panel>
  )
}

function SizeBars({ title, sizes }: { title: string; sizes: { size: string; employees: number }[] }) {
  const max = Math.max(1, ...sizes.map((s) => s.employees))
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <ul className="flex h-24 items-end gap-1">
        {sizes.map((s) => (
          <li key={s.size} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="sr-only">{t.dashboard.sizeEmployees(s.size, s.employees)}</span>
            <span aria-hidden className="text-xs text-muted-foreground tabular-nums">
              {s.employees || ''}
            </span>
            <span
              aria-hidden
              className="w-full max-w-8 rounded-t-sm bg-foreground/70"
              style={{ height: `${s.employees ? Math.max(4, (s.employees / max) * 70) : 0}%` }}
            />
            <span aria-hidden className="w-full truncate border-t border-border pt-1 text-center text-[0.625rem] text-muted-foreground sm:text-xs">
              {s.size}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ForecastCard({ d }: { d: Data }) {
  const f = d.forecast
  const shown = f.lines.reduce((n, l) => n + l.quantity, 0)
  return (
    <Panel
      anchor="forecast"
      title={t.dashboard.forecast}
      description={t.dashboard.forecastDescription(f.days)}
    >
      {f.lines.length === 0 ? (
        <EmptyState>{t.dashboard.forecastEmpty(f.days)}</EmptyState>
      ) : (
        <Table stack="grid">
          <TableHeader>
            <TableRow>
              <TableHead>{t.dashboard.item}</TableHead>
              <TableHead className="text-right">{t.dashboard.quantity}</TableHead>
              <TableHead className="text-right">{t.dashboard.employees}</TableHead>
              <TableHead className="text-right">{t.dashboard.accountingPrice}</TableHead>
              <TableHead className="text-right">{t.dashboard.estimated}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {f.lines.map((l) => (
              <TableRow key={l.catalogue_item_id}>
                <TableCell className="font-medium whitespace-normal stacked:mb-1">{l.item_name}</TableCell>
                <TableCell label={t.dashboard.quantity} className="text-right tabular-nums">
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    {l.quantity}
                    {l.overdue > 0 ? <Badge variant="destructive">{t.dashboard.overdueCount(l.overdue)}</Badge> : null}
                  </span>
                </TableCell>
                <TableCell label={t.dashboard.employees} className="text-right tabular-nums">
                  {l.employees}
                </TableCell>
                <TableCell label={t.dashboard.accountingPrice} className="text-right tabular-nums">
                  {l.accounting_price_cents === null ? <Badge variant="outline">{t.dashboard.noPrice}</Badge> : formatEuro(l.accounting_price_cents)}
                </TableCell>
                <TableCell label={t.dashboard.estimated} className="text-right font-medium tabular-nums">
                  {formatEuro(l.estimated_cents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {f.items > shown ? (
        <p className="mt-3 text-xs text-muted-foreground">{t.dashboard.moreItems(f.items - shown)}</p>
      ) : null}
    </Panel>
  )
}

function SpendCard({ d }: { d: Data }) {
  return (
    <Panel title={t.dashboard.spendByItem} description={t.dashboard.spendByItemDescription}>
      {d.spend_by_item.length === 0 ? (
        <EmptyState>{t.dashboard.nothingOrdered}</EmptyState>
      ) : (
        <BarList
          items={d.spend_by_item.map((i) => ({
            key: i.catalogue_item_id,
            label: i.item_name,
            value: i.value_cents,
            text: `${formatEuro(i.value_cents)} · ${i.quantity}`,
          }))}
        />
      )}
    </Panel>
  )
}

function PriceChangesCard({ d }: { d: Data }) {
  return (
    <Panel title={t.dashboard.priceChanges} description={t.dashboard.priceChangesDescription}>
      {d.price_changes.length === 0 ? (
        <EmptyState>{t.dashboard.noPriceChanges}</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {d.price_changes.map((p, i) => {
            const pct =
              p.before_accounting_cents !== null && p.after_accounting_cents !== null
                ? percentChange(p.after_accounting_cents, p.before_accounting_cents)
                : null
            const purchaseChanged = p.before_purchase_cents !== p.after_purchase_cents
            const periodChanged = p.before_service_months !== p.after_service_months
            return (
              <li key={`${p.catalogue_item_id}-${p.at}-${i}`} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <span className="block truncate font-medium">{p.item_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(p.at, d.timezone)}
                    {p.by_name ? ` · ${p.by_name}` : ''}
                    {purchaseChanged
                      ? ` · ${
                          p.before_purchase_cents === null
                            ? t.dashboard.purchasePrice(formatEuro(p.after_purchase_cents))
                            : t.dashboard.purchasePriceChange(formatEuro(p.before_purchase_cents), formatEuro(p.after_purchase_cents))
                        }`
                      : ''}
                    {periodChanged
                      ? ` · ${t.dashboard.servicePeriodChange(formatMonths(p.before_service_months), formatMonths(p.after_service_months))}`
                      : ''}
                  </span>
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums">
                  <span className="text-muted-foreground">{formatEuro(p.before_accounting_cents)} → </span>
                  <span className="font-medium">{formatEuro(p.after_accounting_cents)}</span>
                  {pct !== null && pct !== 0 ? (
                    <span className={cn('flex items-center justify-end gap-0.5 text-xs', pct > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                      {pct > 0 ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" />}
                      {pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`}
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** What in the catalogue and item sets holds up ordering, and where to fix it. */
function ReadinessCard({ d, navigate }: { d: Data; navigate: Navigate }) {
  const c = d.catalogue
  const ready = c.unpriced.length === 0 && d.item_sets.length === 0
  return (
    <Panel
      title={t.dashboard.readiness}
      description={t.dashboard.readinessDescription(c.active, c.inactive)}
    >
      <div className="grid gap-6 md:grid-cols-3">
        <Check
          title={t.dashboard.withoutPriceOrPeriodTitle}
          empty={t.dashboard.everyItemPriced}
          alert
          items={c.unpriced.map((i) => ({ key: i.id, label: i.name }))}
          to={{ name: 'catalogue' }}
          openLabel={t.dashboard.openCatalogue}
          navigate={navigate}
        />
        <Check
          title={t.dashboard.setsWithFlaggedLines}
          empty={t.dashboard.everySetClean}
          alert
          items={d.item_sets.map((s) => ({
            key: s.id,
            label: s.name,
            note: [s.unpriced ? t.dashboard.withoutPrice(s.unpriced) : '', s.inactive ? t.dashboard.inactiveCount(s.inactive) : '']
              .filter(Boolean)
              .join(', '),
          }))}
          to={{ name: 'itemSets' }}
          openLabel={t.dashboard.openItemSets}
          navigate={navigate}
        />
        <Check
          title={t.dashboard.notOrdered12}
          empty={t.dashboard.everyItemOrdered}
          items={c.not_ordered.map((i) => ({ key: i.id, label: i.name }))}
          to={{ name: 'catalogue' }}
          openLabel={t.dashboard.openCatalogue}
          navigate={navigate}
        />
      </div>
      {ready ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-4" /> {t.dashboard.readyToOrder}
        </p>
      ) : null}
    </Panel>
  )
}

function Check({
  title,
  empty,
  items,
  alert = false,
  to,
  openLabel,
  navigate,
}: {
  title: string
  empty: string
  items: { key: string; label: string; note?: string }[]
  alert?: boolean
  to: Route
  /** The link to where the list is fixed: "Open Item Catalogue". */
  openLabel: string
  navigate: Navigate
}) {
  const flagged = alert && items.length > 0
  return (
    <section aria-label={title}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        {flagged ? <AlertTriangle aria-hidden className="size-4 shrink-0 text-destructive" /> : null}
        {title}
        <Badge variant={flagged ? 'destructive' : 'secondary'} className="tabular-nums">
          {items.length}
        </Badge>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {items.slice(0, 6).map((i) => (
              <li key={i.key} className="min-w-0">
                <span className="block truncate">{i.label}</span>
                {i.note ? <span className="block text-xs text-muted-foreground">{i.note}</span> : null}
              </li>
            ))}
          </ul>
          {items.length > 6 ? <p className="mt-1 text-xs text-muted-foreground">{t.dashboard.andMore(items.length - 6)}</p> : null}
          <a {...linkTo(to, navigate)} className={cn(inlineLink, 'mt-2 inline-flex min-h-11 items-center gap-1 text-sm md:min-h-0')}>
            {openLabel} <ArrowRight aria-hidden className="size-3.5" />
          </a>
        </>
      )}
    </section>
  )
}
