import type { ManagerDashboard as Data } from '@ppe/api-client'
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CheckCircle2, RefreshCw } from 'lucide-react'

import { BarList, KeyFigures, Kpi, MonthChart, Panel, formatDate, inlineLink } from '@/components/dashboard'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/lib/api'
import { changeText, monthLabel, percentChange, plural } from '@/lib/dashboard'
import { formatDateTime } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro, formatMonths } from '@/lib/utils'

type Navigate = (to: Route) => void

/**
 * The manager's start screen: items, prices and purchasing. What is on order,
 * what was ordered and on which items, what will need buying for replacements,
 * recent price changes, what in the catalogue and item sets holds up ordering,
 * and the sizes to stock. Figures come from GET /api/v1/dashboard/manager.
 */
export function ManagerDashboard({ navigate }: { navigate: Navigate }) {
  const { client } = useApi()
  const board = useLoad(() => client.managerDashboard())
  const d = board.data

  return (
    <>
      <PageHeader
        title="Manager Dashboard"
        description={
          d
            ? `Items, prices and what will need buying. Months and dates are in ${d.timezone}; updated ${formatDateTime(d.generated_at, d.timezone).slice(11)}.`
            : 'Items, prices and what will need buying.'
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

function Kpis({ d }: { d: Data }) {
  const cur = d.months.at(-1)
  const prev = d.months.at(-2)
  const year = d.months.reduce((t, m) => ({ orders: t.orders + m.orders, items: t.items + m.items, value: t.value + m.value_cents }), {
    orders: 0,
    items: 0,
    value: 0,
  })
  const f = d.forecast
  return (
    <KeyFigures>
      <Kpi
        label="On order"
        value={formatEuro(d.on_order.value_cents)}
        detail={`${plural(d.on_order.items, 'item')} in ${plural(d.on_order.orders, 'order')}, not yet given out`}
      />
      {cur ? (
        <Kpi
          label={`Ordered in ${monthLabel(cur.month)}`}
          value={formatEuro(cur.value_cents)}
          detail={`${plural(cur.items, 'item')} in ${plural(cur.orders, 'order')}`}
          change={prev ? changeText(cur.value_cents, prev.value_cents, prev.month) : ''}
        />
      ) : null}
      <Kpi label="Ordered, last 12 months" value={formatEuro(year.value)} detail={`${plural(year.items, 'item')} in ${plural(year.orders, 'order')}`} />
      <Kpi
        label={`Replacements, next ${f.days} days`}
        value={plural(f.items, 'item')}
        detail={
          f.items === 0
            ? 'Nothing is due.'
            : `About ${formatEuro(f.estimated_cents)} at current prices${f.unpriced > 0 ? ` · ${f.unpriced} without a price` : ''}`
        }
        alert={f.unpriced > 0}
      />
    </KeyFigures>
  )
}

function OrderedChart({ d, className }: { d: Data; className?: string }) {
  const first = d.months[0]
  const last = d.months.at(-1)
  return (
    <Panel
      title="Ordered by month"
      className={className}
      description={`${first && last ? `${monthLabel(first.month, true)} – ${monthLabel(last.month, true)}. ` : ''}The value of the orders placed each month, at the prices they were ordered at.`}
    >
      <MonthChart
        months={d.months.map((m) => m.month)}
        series={[{ label: 'Ordered', className: 'bg-foreground/70', values: d.months.map((m) => m.value_cents) }]}
        format={formatEuro}
        caption="Value ordered per month"
        cell={(_, i) => {
          const m = d.months[i]!
          return `${formatEuro(m.value_cents)}: ${plural(m.items, 'item')} in ${plural(m.orders, 'order')}`
        }}
      />
    </Panel>
  )
}

/** Employees per size, for stocking: the size Create Order would use for each. */
function SizesCard({ d }: { d: Data }) {
  const s = d.sizes
  return (
    <Panel title="Sizes to stock" description="Employees by the size Create Order would pick: the saved size, or for clothing one suggested from height.">
      <div className="flex flex-col gap-5">
        <SizeBars title="Clothing" sizes={s.clothing} />
        <SizeBars title="Shoes" sizes={s.shoes} />
        <p className="text-xs text-muted-foreground">
          {s.suggested > 0 ? `${plural(s.suggested, 'clothing size')} suggested from height. ` : ''}
          {s.no_clothing > 0 || s.no_shoes > 0
            ? `Without a size: ${s.no_clothing} for clothing, ${s.no_shoes} for shoes.`
            : 'Every employee has both sizes.'}
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
            <span className="sr-only">{`Size ${s.size}: ${plural(s.employees, 'employee')}`}</span>
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
      title="Replacement forecast"
      description={`Items whose service period has ended or ends within ${f.days} days and that are not already on order: the same quantity again, at today's catalogue price.`}
    >
      {f.lines.length === 0 ? (
        <EmptyState>Nothing is due for replacement in the next {f.days} days.</EmptyState>
      ) : (
        <Table stack="grid">
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Employees</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Estimated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {f.lines.map((l) => (
              <TableRow key={l.catalogue_item_id}>
                <TableCell className="font-medium whitespace-normal stacked:mb-1">{l.item_name}</TableCell>
                <TableCell label="Quantity" className="text-right tabular-nums">
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    {l.quantity}
                    {l.overdue > 0 ? <Badge variant="destructive">{l.overdue} overdue</Badge> : null}
                  </span>
                </TableCell>
                <TableCell label="Employees" className="text-right tabular-nums">
                  {l.employees}
                </TableCell>
                <TableCell label="Unit price" className="text-right tabular-nums">
                  {l.unit_price_cents === null ? <Badge variant="outline">No price</Badge> : formatEuro(l.unit_price_cents)}
                </TableCell>
                <TableCell label="Estimated" className="text-right font-medium tabular-nums">
                  {formatEuro(l.estimated_cents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {f.items > shown ? (
        <p className="mt-3 text-xs text-muted-foreground">And {plural(f.items - shown, 'more item')} of other items, included in the total.</p>
      ) : null}
    </Panel>
  )
}

function SpendCard({ d }: { d: Data }) {
  return (
    <Panel title="Spend by item" description="Value ordered over the last 12 months, at the prices ordered.">
      {d.spend_by_item.length === 0 ? (
        <EmptyState>Nothing was ordered in this period.</EmptyState>
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
    <Panel title="Price changes" description="Catalogue prices and service periods changed in the last 12 months, newest first. Existing orders keep their prices.">
      {d.price_changes.length === 0 ? (
        <EmptyState>No prices changed in this period.</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {d.price_changes.map((p, i) => {
            const pct = p.before_cents !== null && p.after_cents !== null ? percentChange(p.after_cents, p.before_cents) : null
            const periodChanged = p.before_service_months !== p.after_service_months
            return (
              <li key={`${p.catalogue_item_id}-${p.at}-${i}`} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <span className="block truncate font-medium">{p.item_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(p.at, d.timezone)}
                    {p.by_name ? ` · ${p.by_name}` : ''}
                    {periodChanged ? ` · service period ${formatMonths(p.before_service_months)} → ${formatMonths(p.after_service_months)}` : ''}
                  </span>
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums">
                  <span className="text-muted-foreground">{formatEuro(p.before_cents)} → </span>
                  <span className="font-medium">{formatEuro(p.after_cents)}</span>
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
      title="Catalogue and item sets"
      description={`${plural(c.active, 'active item')}, ${c.inactive} inactive. Items without a price or service period cannot be ordered; item sets holding them, or inactive items, get flagged lines when applied.`}
    >
      <div className="grid gap-6 md:grid-cols-3">
        <Check
          title="Without a price or service period"
          empty="Every active item has a price and service period."
          alert
          items={c.unpriced.map((i) => ({ key: i.id, label: i.name }))}
          to={{ name: 'catalogue' }}
          toLabel="Item Catalogue"
          navigate={navigate}
        />
        <Check
          title="Item sets with flagged lines"
          empty="Every active item set applies cleanly."
          alert
          items={d.item_sets.map((s) => ({
            key: s.id,
            label: s.name,
            note: [s.unpriced ? `${s.unpriced} without a price` : '', s.inactive ? `${s.inactive} inactive` : ''].filter(Boolean).join(', '),
          }))}
          to={{ name: 'itemSets' }}
          toLabel="Item Sets"
          navigate={navigate}
        />
        <Check
          title="Not ordered in 12 months"
          empty="Every active item was ordered this year."
          items={c.not_ordered.map((i) => ({ key: i.id, label: i.name }))}
          to={{ name: 'catalogue' }}
          toLabel="Item Catalogue"
          navigate={navigate}
        />
      </div>
      {ready ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-4" /> Everything active is ready to order.
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
  toLabel,
  navigate,
}: {
  title: string
  empty: string
  items: { key: string; label: string; note?: string }[]
  alert?: boolean
  to: Route
  toLabel: string
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
          {items.length > 6 ? <p className="mt-1 text-xs text-muted-foreground">And {items.length - 6} more.</p> : null}
          <a {...linkTo(to, navigate)} className={cn(inlineLink, 'mt-2 inline-flex min-h-11 items-center gap-1 text-sm md:min-h-0')}>
            Open {toLabel} <ArrowRight aria-hidden className="size-3.5" />
          </a>
        </>
      )}
    </section>
  )
}
