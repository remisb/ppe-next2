import { PreviewCard } from '@base-ui/react/preview-card'
import type { ComponentProps, ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useApi } from '@/lib/api'
import { formatShortDate, statusLabel } from '@/lib/history'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro, formatSize } from '@/lib/utils'

/** How many lines the card lists before "and N more". */
const SHOWN_LINES = 5

/**
 * A record number that shows its order on hover (and on keyboard focus): the
 * status, who and when, the lines and the total, so a list need not be left
 * to check one. It stays an ordinary link: a click, a tap (touch screens have
 * no hover) or "open in new tab" goes where `href` says.
 */
export function RecordPreview({
  orderId,
  timeZone,
  children,
  className,
  ...link
}: Omit<ComponentProps<'a'>, 'children'> & { orderId: string; timeZone: string | undefined; children: ReactNode }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger {...link} className={className}>
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner className="isolate z-50" side="bottom" align="start" sideOffset={6}>
          <PreviewCard.Popup
            data-slot="record-preview"
            className={cn(
              'w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none',
              'data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95',
              'motion-reduce:animate-none',
            )}
            // Portalled, but React bubbles its clicks through the tree: a clickable row must not open.
            onClick={(e) => e.stopPropagation()}
          >
            <OrderSummary id={orderId} timeZone={timeZone} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  )
}

/** The card's content, loaded when it opens: an order can be given between two looks. */
function OrderSummary({ id, timeZone }: { id: string; timeZone: string | undefined }) {
  const { client } = useApi()
  const order = useLoad(() => client.orders.get(id), [id])
  const o = order.data
  if (order.error) return <p className="text-muted-foreground">The order could not be loaded.</p>
  if (!o) {
    return (
      <div aria-busy className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
        <Skeleton className="h-3 w-48" />
      </div>
    )
  }
  const more = o.lines.length - SHOWN_LINES
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{o.record_number}</span>
        <Badge variant={o.status === 'GIVEN' ? 'default' : 'secondary'}>{statusLabel[o.status]}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {o.employee_first_name} {o.employee_last_name} · ordered {formatShortDate(o.ordered_at, timeZone)}
        {o.given_at ? `, given ${formatShortDate(o.given_at, timeZone)}` : ''}
      </p>
      <ul className="flex flex-col gap-1 border-t border-border pt-2">
        {o.lines.slice(0, SHOWN_LINES).map((l) => (
          <li key={l.id} className="flex items-baseline gap-2">
            <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{l.quantity}×</span>
            <span className="min-w-0 flex-1 truncate">{l.item_name}</span>
            {l.size ? <span className="shrink-0 text-xs text-muted-foreground">{formatSize(l.size)}</span> : null}
          </li>
        ))}
        {more > 0 ? <li className="pl-10 text-xs text-muted-foreground">and {more} more</li> : null}
      </ul>
      <p className="flex justify-between border-t border-border pt-2 font-medium">
        Total <span className="tabular-nums">{formatEuro(o.total_cents)}</span>
      </p>
    </div>
  )
}
