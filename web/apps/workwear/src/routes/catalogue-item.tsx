import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApi, useSession } from '@/lib/api'
import { formatDateTime } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro, formatMonths } from '@/lib/utils'

import { ItemForm, sizeGroupLabel } from './catalogue'

/**
 * One catalogue item (/catalogue/<id>): its current values, which new orders
 * take, and the item sets that hold it. Managers edit and (de)activate it here
 * as in the list. Orders keep the values they were placed with.
 */
export function CatalogueItemPage({ id, navigate, onBack }: { id: string; navigate: (to: Route) => void; onBack: () => void }) {
  const { client } = useApi()
  const { canManageItems } = useSession()
  const item = useLoad(() => client.catalogue.get(id), [id])
  const sets = useLoad(() => client.itemSets.list())
  const settings = useLoad(() => client.settings())
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
