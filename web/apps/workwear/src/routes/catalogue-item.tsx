import type { ListedOrder, PriceEntry } from '@ppe/api-client'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'

import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi, useSession } from '@/lib/api'
import { percentChange } from '@/lib/dashboard'
import { activityAt, formatDateTime, statusLabel } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro, formatMonths } from '@/lib/utils'

import { ItemForm, sizeGroupLabel } from './catalogue'

/** How many of the item's orders the page lists, newest activity first. */
const ORDERS_SHOWN = 100

/**
 * One catalogue item (/catalogue/<id>): its current values, which new orders
 * take, its price history, the orders that hold it and the item sets that
 * hold it. Managers edit and (de)activate it here as in the list. Orders keep
 * the values they were placed with, so their prices come from the snapshots.
 */
export function CatalogueItemPage({ id, navigate, onBack }: { id: string; navigate: (to: Route) => void; onBack: () => void }) {
  const { client } = useApi()
  const { canManageItems } = useSession()
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
  const incomplete = i ? i.unit_price_cents === null || i.service_period_months === null : false

  const toggle = async () => {
    if (!i) return
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
        <ArrowLeft aria-hidden /> Item Catalogue
      </Button>
      {item.error ? (
        <ErrorState error={item.error} onRetry={item.reload} />
      ) : !i ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={i.name}
            {...(i.details ? { description: i.details } : {})}
            actions={
              canManageItems ? (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => void toggle()}>
                    {i.active ? 'Deactivate' : 'Activate'}
                  </Button>
                </>
              ) : undefined
            }
          />
          {actionError ? <ErrorState title="Action failed" error={actionError} /> : null}

          <div className="mb-3 flex flex-wrap gap-1">
            {i.active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
            {incomplete ? <Badge variant="destructive">Incomplete</Badge> : null}
          </div>
          {incomplete ? (
            <p role="note" className="mb-4 text-sm text-destructive">
              Without a price and a service period this item cannot be ordered: Mark as Ordered refuses it.
            </p>
          ) : null}
          {!i.active ? <p className="mb-4 text-sm text-muted-foreground">Inactive: not offered in Add Item. Orders that hold it keep it.</p> : null}

          <dl aria-label="Item details" className="mb-8 grid grid-cols-2 gap-4 rounded-lg border border-border p-4 text-sm sm:max-w-2xl sm:grid-cols-3">
            <Fact label="Size group">{sizeGroupLabel[i.size_group]}</Fact>
            <Fact label="Unit price">{formatEuro(i.unit_price_cents)}</Fact>
            <Fact label="Service period">{formatMonths(i.service_period_months)}</Fact>
            <Fact label="Display order">{i.display_rank}</Fact>
            <Fact label="Added">{formatDateTime(i.created_at, tz)}</Fact>
            <Fact label="Last changed">{formatDateTime(i.updated_at, tz)}</Fact>
          </dl>

          <section aria-labelledby="price-history" className="mb-8">
            <h2 id="price-history" className="mb-1 text-lg font-semibold">
              Price history
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Price and service period changes, newest first. Orders keep the values they were placed with.
            </p>
            {prices.error ? (
              <ErrorState error={prices.error} onRetry={prices.reload} />
            ) : !prices.data ? (
              <Loading />
            ) : prices.data.length === 0 ? (
              <EmptyState>No price history is recorded for this item.</EmptyState>
            ) : (
              <ol aria-label="Price history" className="divide-y divide-border rounded-lg border border-border sm:max-w-2xl">
                {prices.data.map((p, n) => (
                  <PriceStep key={`${p.at}-${n}`} p={p} tz={tz} />
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="item-orders" className="mb-8">
            <h2 id="item-orders" className="mb-1 text-lg font-semibold">
              Orders
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Orders with this item, newest activity first, as recorded on each order.{tz ? ` Dates are shown in ${tz}.` : ''}
            </p>
            {orders.error ? (
              <ErrorState error={orders.error} onRetry={orders.reload} />
            ) : !orders.data ? (
              <Loading />
            ) : orders.data.orders.length === 0 ? (
              <EmptyState>This item has not been ordered yet.</EmptyState>
            ) : (
              <ItemOrders itemId={id} orders={orders.data.orders} total={orders.data.total} tz={tz} navigate={navigate} />
            )}
          </section>

          <section aria-labelledby="item-sets" className="mb-8">
            <h2 id="item-sets" className="mb-1 text-lg font-semibold">
              Item sets
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">Sets that add this item when applied in Create Order, with their default quantity.</p>
            {sets.error ? (
              <ErrorState error={sets.error} onRetry={sets.reload} />
            ) : !sets.data ? (
              <Loading />
            ) : holding.length === 0 ? (
              <EmptyState>No item set holds this item.</EmptyState>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border sm:max-w-2xl">
                {holding.map(({ set, quantity }) => (
                  <li key={set.id} className={cn('flex items-center justify-between gap-3 px-4 py-2.5', !set.active && 'text-muted-foreground')}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{set.name}</span>
                      {set.description ? <span className="block truncate text-xs text-muted-foreground">{set.description}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {set.active ? null : <Badge variant="outline">Inactive</Badge>}
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
              Open Item Sets <ArrowRight aria-hidden className="size-3.5" />
            </a>
          </section>

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

/** One price step: what it changed to, from what, when and by whom. */
function PriceStep({ p, tz }: { p: PriceEntry; tz: string | undefined }) {
  const created = p.event === 'catalogue.created'
  const priceChanged = !created && p.before_cents !== p.unit_price_cents
  const periodChanged = !created && p.before_service_months !== p.service_period_months
  const pct = priceChanged && p.before_cents !== null && p.unit_price_cents !== null ? percentChange(p.unit_price_cents, p.before_cents) : null
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <span className="block font-medium">
          {created ? 'Added' : priceChanged && periodChanged ? 'Price and service period changed' : priceChanged ? 'Price changed' : 'Service period changed'}
        </span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatDateTime(p.at, tz)}
          {p.by_name ? ` · ${p.by_name}` : ''}
          {created ? ` · service period ${formatMonths(p.service_period_months)}` : ''}
          {periodChanged ? ` · service period ${formatMonths(p.before_service_months)} → ${formatMonths(p.service_period_months)}` : ''}
        </span>
      </div>
      <div className="shrink-0 text-right text-sm tabular-nums">
        {priceChanged ? <span className="text-muted-foreground">{formatEuro(p.before_cents)} → </span> : null}
        <span className="font-medium">{formatEuro(p.unit_price_cents)}</span>
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
 * the size, quantity and unit price it was ordered at. A GIVEN order links to
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
          {`${total} ${total === 1 ? 'order' : 'orders'}: ${sum('GIVEN')} given, ${sum('ORDERED')} on order.`}
        </p>
      ) : (
        <p className="mb-3 text-sm">{`${total} orders; the latest ${orders.length} are shown.`}</p>
      )}
      <Table stack stackBelow="lg">
        <TableHeader>
          <TableRow>
            <TableHead>Record</TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Size</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead className="text-right">Unit price</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ o, line }) => (
            <TableRow key={o.id}>
              <TableCell className="stacked:order-1 stacked:mb-1">
                {o.status === 'GIVEN' ? (
                  <a
                    {...linkTo({ name: 'record', id: o.id }, navigate)}
                    aria-label={`Receipt ${o.record_number}`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                  >
                    <FileText aria-hidden className="size-4" />
                    {o.record_number}
                  </a>
                ) : (
                  <span className="font-medium">{o.record_number}</span>
                )}
              </TableCell>
              <TableCell label="Employee" className="stacked:order-2">
                <a
                  {...linkTo({ name: 'employee', id: o.employee_id }, navigate)}
                  className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {o.employee_first_name} {o.employee_last_name}
                </a>
              </TableCell>
              <TableCell label="Status" className="stacked:order-2">
                <Badge variant={o.status === 'GIVEN' ? 'default' : 'secondary'}>{statusLabel[o.status]}</Badge>
              </TableCell>
              <TableCell label="Date" className="tabular-nums stacked:order-2">{formatDateTime(activityAt(o), tz)}</TableCell>
              <TableCell label="Size" className="stacked:order-2">{line.size ?? '–'}</TableCell>
              <TableCell label="Quantity" className="text-right tabular-nums stacked:order-2">{line.quantity}</TableCell>
              <TableCell label="Unit price" className="text-right tabular-nums stacked:order-2">{formatEuro(line.unit_price_cents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
