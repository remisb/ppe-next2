import type { ListedOrder, PriceEntry } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { EmptyState, ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ItemTile } from '@/components/item-icon'
import { RecordPreview } from '@/components/record-preview'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { t } from '@/i18n'
import { percentChange } from '@/lib/dashboard'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { activityAt, statusLabel } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { formatEuro, formatMonths } from '@/lib/utils'

import { ItemForm, confirmActiveChange, sizeGroupLabel } from './catalogue'

/** How many of the item's orders the page lists, newest activity first. */
const ORDERS_SHOWN = 100

/**
 * One catalogue item (/catalogue/<id>): its current values, which new orders
 * take, its price history, the orders that hold it, the item sets that hold
 * it, and its Changes (who changed what, and when). Managers edit and
 * (de)activate it here as in the list. Orders keep the values they were
 * placed with, so their prices come from the snapshots.
 */
export function CatalogueItemPage({ id, navigate, onBack }: { id: string; navigate: (to: Route) => void; onBack: () => void }) {
  const { client } = useApi()
  const canManageItems = useSession().can('catalogue.manage')
  const item = useLoad(() => client.catalogue.get(id), [id])
  const sets = useLoad(() => client.itemSets.list())
  const settings = useLoad(() => client.settings())
  const prices = useLoad(() => client.catalogue.priceHistory(id), [id])
  const orders = useLoad(() => client.orders.list({ catalogue_item_id: id, page_size: ORDERS_SHOWN }), [id])
  const [editing, setEditing] = useState(false)
  const [actionError, setActionError] = useState<unknown>()

  const holding = useMemo(
    () =>
      (sets.data ?? []).flatMap((s) => {
        const line = s.lines.find((l) => l.catalogue_item_id === id)
        return line ? [{ set: s, quantity: line.default_quantity }] : []
      }),
    [sets.data, id],
  )
  const tz = settings.data?.timezone
  const i = item.data
  const incomplete = i ? i.accounting_price_cents === null || i.service_period_months === null : false

  const toggle = async () => {
    if (!i || !confirmActiveChange(i)) return
    setActionError(undefined)
    try {
      await client.catalogue.setActive(i.id, !i.active)
      item.reload()
      prices.reload()
    } catch (err) {
      setActionError(err)
    }
  }

  return (
    <>
      <Button variant="ghost" className="-ml-3 mb-2" onClick={onBack}>
        <ArrowLeft aria-hidden /> {t.catalogue.title}
      </Button>
      {item.error ? (
        <ErrorState error={item.error} onRetry={item.reload} />
      ) : !i ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={i.name}
            icon={<ItemTile icon={i.icon} className="size-10" />}
            {...(i.details ? { description: i.details } : {})}
            actions={
              canManageItems ? (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    {t.common.edit}
                  </Button>
                  <MoreActions label={t.common.moreActions(i.name)}>
                    <DropdownMenuItem variant={i.active ? 'destructive' : 'default'} onClick={() => void toggle()}>
                      {i.active ? t.catalogue.deactivateItem : t.catalogue.activateItem}
                    </DropdownMenuItem>
                  </MoreActions>
                </>
              ) : undefined
            }
          />
          {actionError ? <ErrorState title={t.common.actionFailed} error={actionError} /> : null}

          <div className="mb-3 flex flex-wrap gap-1">
            {i.active ? <Badge variant="secondary">{t.catalogue.active}</Badge> : <Badge variant="outline">{t.catalogue.inactive}</Badge>}
            {incomplete ? <Badge variant="destructive">{t.catalogue.incomplete}</Badge> : null}
          </div>
          {incomplete ? (
            <p role="note" className="mb-4 text-sm text-destructive">
              {t.catalogue.incompleteNote}
            </p>
          ) : null}
          {!i.active ? <p className="mb-4 text-sm text-muted-foreground">{t.catalogue.inactiveNote}</p> : null}

          <dl aria-label={t.catalogue.itemDetails} className="mb-8 grid grid-cols-2 gap-4 rounded-lg border border-border p-4 text-sm sm:max-w-2xl sm:grid-cols-3">
            <Fact label={t.catalogue.sizeGroup}>{sizeGroupLabel[i.size_group]}</Fact>
            <Fact label={t.catalogue.purchasePrice}>{formatEuro(i.purchase_price_cents)}</Fact>
            <Fact label={t.catalogue.accountingPrice}>{formatEuro(i.accounting_price_cents)}</Fact>
            <Fact label={t.catalogue.servicePeriod}>{formatMonths(i.service_period_months)}</Fact>
            <Fact label={t.catalogue.displayOrder}>{i.display_rank}</Fact>
            <Fact label={t.catalogue.added}>{formatDateTime(i.created_at, tz)}</Fact>
            <Fact label={t.catalogue.lastChanged}>{formatDateTime(i.updated_at, tz)}</Fact>
          </dl>

          <section aria-labelledby="price-history" className="mb-8">
            <h2 id="price-history" className="mb-1 text-lg font-semibold">
              {t.catalogue.priceHistory}
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              {t.catalogue.priceHistoryIntro}
            </p>
            {prices.error ? (
              <ErrorState error={prices.error} onRetry={prices.reload} />
            ) : !prices.data ? (
              <Loading />
            ) : prices.data.length === 0 ? (
              <EmptyState>{t.catalogue.noPriceHistory}</EmptyState>
            ) : (
              <ol aria-label={t.catalogue.priceHistory} className="divide-y divide-border rounded-lg border border-border sm:max-w-2xl">
                {prices.data.map((p, n) => (
                  <PriceStep key={`${p.at}-${n}`} p={p} tz={tz} />
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="item-orders" className="mb-8">
            <h2 id="item-orders" className="mb-1 text-lg font-semibold">
              {t.catalogue.orders}
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              {t.catalogue.ordersIntro(tz)}
            </p>
            {orders.error ? (
              <ErrorState error={orders.error} onRetry={orders.reload} />
            ) : !orders.data ? (
              <Loading />
            ) : orders.data.orders.length === 0 ? (
              <EmptyState>{t.catalogue.notOrdered}</EmptyState>
            ) : (
              <ItemOrders itemId={id} orders={orders.data.orders} total={orders.data.total} tz={tz} navigate={navigate} />
            )}
          </section>

          <section aria-labelledby="item-sets" className="mb-8">
            <h2 id="item-sets" className="mb-1 text-lg font-semibold">
              {t.catalogue.itemSets}
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">{t.catalogue.itemSetsIntro}</p>
            {sets.error ? (
              <ErrorState error={sets.error} onRetry={sets.reload} />
            ) : !sets.data ? (
              <Loading />
            ) : holding.length === 0 ? (
              <EmptyState>{t.catalogue.noSetHolds}</EmptyState>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border sm:max-w-2xl">
                {holding.map(({ set, quantity }) => (
                  <li key={set.id} className={cn('flex items-center justify-between gap-3 px-4 py-2.5', !set.active && 'text-muted-foreground')}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{set.name}</span>
                      {set.description ? <span className="block truncate text-xs text-muted-foreground">{set.description}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {set.active ? null : <Badge variant="outline">{t.common.inactive}</Badge>}
                      <span className="text-sm tabular-nums">× {quantity}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <a
              {...linkTo({ name: 'itemSets' }, navigate)}
              className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
            >
              {t.catalogue.openItemSets} <ArrowRight aria-hidden className="size-3.5" />
            </a>
          </section>

          <RecordChanges load={() => client.audit.history('catalogue', id)} deps={[id, i.updated_at]} timeZone={tz} />

          <ItemForm
            item={editing ? i : null}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              item.reload()
              prices.reload()
            }}
          />
        </>
      )}
    </>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * One price step: what it changed to, from what, when and by whom. The
 * accounting price is the figure on the right; the purchase price and service
 * period follow the date.
 */
function PriceStep({ p, tz }: { p: PriceEntry; tz: string | undefined }) {
  const created = p.event === 'catalogue.created'
  const priceChanged = !created && p.before_accounting_cents !== p.accounting_price_cents
  const purchaseChanged = !created && p.before_purchase_cents !== p.purchase_price_cents
  const periodChanged = !created && p.before_service_months !== p.service_period_months
  const pct =
    priceChanged && p.before_accounting_cents !== null && p.accounting_price_cents !== null
      ? percentChange(p.accounting_price_cents, p.before_accounting_cents)
      : null
  const title = created
    ? t.catalogue.stepAdded
    : (priceChanged || purchaseChanged) && periodChanged
      ? t.catalogue.priceAndPeriodChanged
      : priceChanged && purchaseChanged
        ? t.catalogue.pricesChanged
        : priceChanged
          ? t.catalogue.accountingPriceChanged
          : purchaseChanged
            ? t.catalogue.purchasePriceChanged
            : t.catalogue.periodChanged
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatDateTime(p.at, tz)}
          {p.by_name ? ` · ${p.by_name}` : ''}
          {created && p.purchase_price_cents !== null ? t.catalogue.stepPurchase(formatEuro(p.purchase_price_cents)) : ''}
          {purchaseChanged
            ? p.before_purchase_cents === null
              ? t.catalogue.stepPurchase(formatEuro(p.purchase_price_cents))
              : t.catalogue.stepPurchaseChange(formatEuro(p.before_purchase_cents), formatEuro(p.purchase_price_cents))
            : ''}
          {created ? t.catalogue.stepPeriod(formatMonths(p.service_period_months)) : ''}
          {periodChanged ? t.catalogue.stepPeriodChange(formatMonths(p.before_service_months), formatMonths(p.service_period_months)) : ''}
        </span>
      </div>
      <div className="shrink-0 text-right text-sm tabular-nums">
        {priceChanged ? <span className="text-muted-foreground">{formatEuro(p.before_accounting_cents)} → </span> : null}
        <span className="font-medium">{formatEuro(p.accounting_price_cents)}</span>
        {pct !== null && pct !== 0 ? (
          <span className={cn('flex items-center justify-end gap-0.5 text-xs', pct > 0 ? 'text-destructive' : 'text-muted-foreground')}>
            {pct > 0 ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" />}
            {pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`}
          </span>
        ) : null}
      </div>
    </li>
  )
}

/**
 * The orders holding the item, one row per order with its line for the item:
 * the size, quantity and accounting price it was ordered at. A GIVEN order links to
 * its receipt; an ORDERED one has none yet.
 */
function ItemOrders({
  itemId,
  orders,
  total,
  tz,
  navigate,
}: {
  itemId: string
  orders: ListedOrder[]
  total: number
  tz: string | undefined
  navigate: (to: Route) => void
}) {
  const rows = orders.flatMap((o) => {
    const line = o.lines.find((l) => l.catalogue_item_id === itemId)
    return line ? [{ o, line }] : []
  })
  const sum = (status: string) => rows.reduce((n, r) => n + (r.o.status === status ? r.line.quantity : 0), 0)
  return (
    <>
      {total <= orders.length ? (
        <p className="mb-3 text-sm">
          {t.catalogue.ordersSummary(total, sum('GIVEN'), sum('ORDERED'))}
        </p>
      ) : (
        <p className="mb-3 text-sm">{t.catalogue.latestShown(total, orders.length)}</p>
      )}
      <Table stack stackBelow="lg">
        <TableHeader>
          <TableRow>
            <TableHead>{t.catalogue.colRecord}</TableHead>
            <TableHead>{t.catalogue.colEmployee}</TableHead>
            <TableHead>{t.catalogue.colStatus}</TableHead>
            <TableHead>{t.catalogue.colDate}</TableHead>
            <TableHead>{t.catalogue.colSize}</TableHead>
            <TableHead className="text-right">{t.catalogue.colQuantity}</TableHead>
            <TableHead className="text-right">{t.catalogue.accountingPrice}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ o, line }) => (
            <TableRow key={o.id}>
              <TableCell className="stacked:order-1 stacked:mb-1">
                {/* A given order opens its receipt, one on order its page in History; either previews on hover. */}
                {o.status === 'GIVEN' ? (
                  <RecordPreview
                    orderId={o.id}
                    timeZone={tz}
                    {...linkTo({ name: 'record', id: o.id }, navigate)}
                    aria-label={t.catalogue.receipt(o.record_number)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                  >
                    <FileText aria-hidden className="size-4" />
                    {o.record_number}
                  </RecordPreview>
                ) : (
                  <RecordPreview
                    orderId={o.id}
                    timeZone={tz}
                    {...linkTo({ name: 'history', order: o.id }, navigate)}
                    className="inline-flex min-h-11 items-center rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                  >
                    {o.record_number}
                  </RecordPreview>
                )}
              </TableCell>
              <TableCell label={t.catalogue.colEmployee} className="stacked:order-2">
                <a
                  {...linkTo({ name: 'employee', id: o.employee_id }, navigate)}
                  className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {o.employee_first_name} {o.employee_last_name}
                </a>
              </TableCell>
              <TableCell label={t.catalogue.colStatus} className="stacked:order-2">
                <Badge variant={o.status === 'GIVEN' ? 'default' : 'secondary'}>{statusLabel[o.status]}</Badge>
              </TableCell>
              <TableCell label={t.catalogue.colDate} className="tabular-nums stacked:order-2">
                <RelativeDate iso={activityAt(o)} timeZone={tz} time />
              </TableCell>
              <TableCell label={t.catalogue.colSize} className="stacked:order-2">{line.size ?? '–'}</TableCell>
              <TableCell label={t.catalogue.colQuantity} className="text-right tabular-nums stacked:order-2">{line.quantity}</TableCell>
              <TableCell label={t.catalogue.accountingPrice} className="text-right tabular-nums stacked:order-2">{formatEuro(line.accounting_price_cents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
