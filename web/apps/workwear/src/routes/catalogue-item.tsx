import type { ListedOrder, PriceEntry } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { RuleList } from '@ppe/ui/components/rule-list'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { ActionError, EmptyState, ErrorState, Loaded, Loading } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowDown, ArrowRight, ArrowUp, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'

import { OrderStatusBadge } from '@/components/order-status'
import { InactiveItemBadge, InactiveSetBadge, IncompleteBadge } from '@/components/status-badges'
import { ItemTile } from '@/components/item-icon'
import { RecordPreview } from '@/components/record-preview'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { t } from '@/i18n'
import { percentChange } from '@/lib/dashboard'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { linkVariants } from '@ppe/ui/components/link'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { useAction } from '@ppe/ui/lib/use-action'
import { RecordHeader, RecordTitle } from '@ppe/ui/components/record-header'
import { PaneBar } from '@ppe/ui/components/list-detail'
import { activityAt } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { formatEuro, formatMonths } from '@/lib/utils'
import { loadAllOrders } from '@/lib/employee-items'
import { useOpenKey } from '@/lib/open-sections'

import { ItemForm, activeChangeQuestion, sizeGroupLabel } from './catalogue'

/**
 * One catalogue item (/catalogue/<id>), opened from the Item Catalogue: beside
 * the list from lg, in its place below, as Orders opens an order. Its current
 * values, which new orders take, its price history, the orders that hold it,
 * the item sets that hold it, and its Changes (who changed what, and when).
 * Managers edit and (de)activate it here as in the list; onChanged tells the
 * list. Orders keep the values they were placed with, so their prices come
 * from the snapshots.
 */
export function CatalogueItemDetail({
  id,
  navigate,
  onClose,
  onChanged,
}: {
  id: string
  navigate: (to: Route) => void
  onClose: () => void
  onChanged: () => void
}) {
  const { client } = useApi()
  const canManageItems = useSession().can('catalogue.manage')
  const changesKey = useOpenKey('item.changes')
  const pricesKey = useOpenKey('item.price-history')
  const item = useLoad(() => client.catalogue.get(id), [id])
  const sets = useLoad(() => client.itemSets.list())
  const settings = useLoad(() => client.settings())
  const prices = useLoad(() => client.catalogue.priceHistory(id), [id])
  // Only the count: the orders themselves load when their section opens (AllItemOrders).
  const orderCount = useLoad(() => client.orders.list({ catalogue_item_id: id, page_size: 1 }), [id])
  const ordersKey = useOpenKey('item.orders')
  const setsKey = useOpenKey('item.item-sets')
  const [editing, setEditing] = useState(false)
  const action = useAction()

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

  const toggle = async () => {
    if (!i) return
    await action.run(
      async () => {
        await client.catalogue.setActive(i.id, !i.active)
        item.reload()
        prices.reload()
        onChanged()
      },
      { confirm: activeChangeQuestion(i) },
    )
  }

  return (
    <article aria-label={i ? i.name : t.catalogue.item} className="@container">
      <PaneBar backLabel={t.catalogue.title} closeLabel={t.catalogue.closeItem} onClose={onClose} className="mb-2" />
      <Loaded load={item}>
        {(i) => (
          <>
            {/* The list's title is the screen's h1; the item's is the pane's heading, as an order's beside Orders. */}
            <RecordHeader
              title={<RecordTitle icon={<ItemTile icon={i.icon} className="size-10 shrink-0" />}>{i.name}</RecordTitle>}
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
            >
              {i.details ? <p className="mt-1 text-sm text-muted-foreground">{i.details}</p> : null}
            </RecordHeader>
            <ActionError error={action.error} />

            {/* What is wrong with the item opens from its badges (IssueBadge), not written under them. */}
            <div className="mb-3 flex flex-wrap gap-1">
              {i.active ? <Badge variant="secondary">{t.catalogue.active}</Badge> : <InactiveItemBadge />}
              <IncompleteBadge item={i} />
            </div>

            {/* The pane is flat: its facts and lists sit between thin rules, no boxes. */}
            <FactGrid aria-label={t.catalogue.itemDetails} className="mb-4">
              <Fact label={t.catalogue.sizeGroup}>{sizeGroupLabel[i.size_group]}</Fact>
              <Fact label={t.catalogue.purchasePrice}>{formatEuro(i.purchase_price_cents)}</Fact>
              <Fact label={t.catalogue.accountingPrice}>{formatEuro(i.accounting_price_cents)}</Fact>
              <Fact label={t.catalogue.servicePeriod}>{formatMonths(i.service_period_months)}</Fact>
              <Fact label={t.catalogue.displayOrder}>{i.display_rank}</Fact>
              <Fact label={t.catalogue.added}>{formatDateTime(i.created_at, tz)}</Fact>
              <Fact label={t.catalogue.lastChanged}>{formatDateTime(i.updated_at, tz)}</Fact>
            </FactGrid>

            {/* Its sections are closed at first, each counting what it holds, with what it is behind an ⓘ (description). */}
            <DisclosureSection
              id="price-history"
              title={t.catalogue.priceHistory}
              count={prices.data?.length}
              description={t.catalogue.priceHistoryIntro}
              rememberAs={pricesKey}
            >
              <Loaded load={prices} emptyState={t.catalogue.noPriceHistory}>
                {(data) => (
                  <RuleList ordered aria-label={t.catalogue.priceHistory}>
                    {data.map((p, n) => (
                      <PriceStep key={`${p.at}-${n}`} p={p} tz={tz} />
                    ))}
                  </RuleList>
                )}
              </Loaded>
            </DisclosureSection>

            <DisclosureSection
              id="item-orders"
              title={t.catalogue.orders}
              count={orderCount.data?.total}
              description={t.catalogue.ordersIntro(tz)}
              rememberAs={ordersKey}
            >
              <AllItemOrders itemId={id} tz={tz} navigate={navigate} />
            </DisclosureSection>

            <DisclosureSection
              id="item-sets"
              title={t.catalogue.itemSets}
              count={sets.data ? holding.length : undefined}
              description={t.catalogue.itemSetsIntro}
              rememberAs={setsKey}
            >
              <Loaded load={sets} empty={holding.length === 0} emptyState={t.catalogue.noSetHolds}>
                {() => (
                  <RuleList aria-label={t.catalogue.itemSets}>
                    {holding.map(({ set, quantity }) => (
                      <li key={set.id} className={cn('flex items-center justify-between gap-3', !set.active && 'text-muted-foreground')}>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{set.name}</span>
                          {set.description ? <span className="block truncate text-xs text-muted-foreground">{set.description}</span> : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {set.active ? null : <InactiveSetBadge />}
                          <span className="text-sm tabular-nums">× {quantity}</span>
                        </span>
                      </li>
                    ))}
                  </RuleList>
                )}
              </Loaded>
              <a
                {...linkTo({ name: 'itemSets' }, navigate)}
                className={linkVariants({ weight: 'medium', className: 'mt-2 inline-flex min-h-11 items-center gap-1 text-sm md:min-h-0' })}
              >
                {t.catalogue.openItemSets} <ArrowRight aria-hidden className="size-3.5" />
              </a>
            </DisclosureSection>

            <RecordChanges load={() => client.audit.history('catalogue', id)} deps={[id, i.updated_at]} timeZone={tz} rememberAs={changesKey} className="mb-0" />

            <ItemForm
              item={editing ? i : null}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false)
                item.reload()
                prices.reload()
                onChanged()
              }}
            />
          </>
        )}
      </Loaded>
    </article>
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
    <li className="flex items-start justify-between gap-3">
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

/** Every order holding the item, read when its section opens. */
function AllItemOrders({ itemId, tz, navigate }: { itemId: string; tz: string | undefined; navigate: (to: Route) => void }) {
  const { client } = useApi()
  const orders = useLoad(() => loadAllOrders(client, { catalogue_item_id: itemId }), [itemId])
  if (orders.error) return <ErrorState error={orders.error} onRetry={orders.reload} />
  if (!orders.data) return <Loading />
  if (orders.data.length === 0) return <EmptyState>{t.catalogue.notOrdered}</EmptyState>
  return <ItemOrders itemId={itemId} orders={orders.data} tz={tz} navigate={navigate} />
}

/**
 * The orders holding the item, one row per order with its line for the item:
 * the size, quantity and accounting price it was ordered at. A GIVEN order links to
 * its receipt; an ORDERED one has none yet.
 */
function ItemOrders({
  itemId,
  orders,
  tz,
  navigate,
}: {
  itemId: string
  orders: ListedOrder[]
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
      <p className="mb-2 text-sm text-muted-foreground">{t.catalogue.ordersSummary(orders.length, sum('GIVEN'), sum('ORDERED'))}</p>
      {/* Two lines an order: the record, its status and the price it was ordered at; then who, when, the size and how many. */}
      <RuleList aria-label={t.catalogue.orders}>
        {rows.map(({ o, line }) => (
          <li key={o.id}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {/* A given order opens its receipt, one on order its page in History; either previews on hover. */}
                {o.status === 'GIVEN' ? (
                  <RecordPreview
                    orderId={o.id}
                    timeZone={tz}
                    {...linkTo({ name: 'record', id: o.id }, navigate)}
                    aria-label={t.catalogue.receipt(o.record_number)}
                    className={linkVariants({ underline: 'always', weight: 'medium', className: 'inline-flex min-h-11 items-center gap-1.5 md:min-h-0' })}
                  >
                    <FileText aria-hidden className="size-4" />
                    {o.record_number}
                  </RecordPreview>
                ) : (
                  <RecordPreview
                    orderId={o.id}
                    timeZone={tz}
                    {...linkTo({ name: 'history', order: o.id }, navigate)}
                    className={linkVariants({ weight: 'medium', className: 'inline-flex min-h-11 items-center md:min-h-0' })}
                  >
                    {o.record_number}
                  </RecordPreview>
                )}
                <OrderStatusBadge status={o.status} />
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">{formatEuro(line.accounting_price_cents)}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground tabular-nums">
              <a
                {...linkTo({ name: 'employee', id: o.employee_id }, navigate)}
                className={linkVariants({ className: 'text-foreground' })}
              >
                {o.employee_first_name} {o.employee_last_name}
              </a>
              <span aria-hidden>·</span>
              <RelativeDate iso={activityAt(o)} timeZone={tz} time />
              {line.size ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{t.catalogue.orderSize(line.size)}</span>
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span>{t.catalogue.orderQuantity(line.quantity)}</span>
            </div>
          </li>
        ))}
      </RuleList>
    </>
  )
}
