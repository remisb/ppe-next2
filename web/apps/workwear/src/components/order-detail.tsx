import type { Order } from '@ppe/api-client'
import { ArrowLeft, FileText, Handshake, Link2, Printer, X } from 'lucide-react'
import { useState } from 'react'

import { ConfirmationSheet } from '@/components/confirmation-sheet'
import { HandOver } from '@/components/hand-over'
import { OrderLinesTable } from '@/components/order-lines'
import { ErrorState, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WhatsAppButton } from '@/components/whatsapp-button'
import { useApi } from '@/lib/api'
import { LONG_WAIT_DAYS, formatDateTime, formatWaiting, historyActions, methodText, statusLabel, waitingDays } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn } from '@/lib/utils'
import { formatWhatsApp, messageFromOrder } from '@/lib/whatsapp'

/**
 * One stored order from History: who and when, its snapshot lines and the
 * actions its state allows (manual §6). Beside the list on a wide screen,
 * where it closes; on its own on a narrow one, where it goes back.
 */
export function OrderDetail({
  id,
  timeZone,
  navigate,
  onClose,
  onOpenRecord,
  onChanged,
}: {
  id: string
  timeZone: string | undefined
  navigate: (to: Route) => void
  onClose: () => void
  onOpenRecord: (id: string, print: boolean) => void
  /** The order changed state (a paper confirmation): the list should reload. */
  onChanged: () => void
}) {
  const { client } = useApi()
  const order = useLoad(() => client.orders.get(id), [id])
  const [confirming, setConfirming] = useState(false)
  const [handingOver, setHandingOver] = useState(false)
  const o = order.data

  return (
    <article aria-label={o ? `Order ${o.record_number}` : 'Order'} className="flex flex-col gap-4">
      {/* Narrow: the detail is the whole screen, so the way out is Back to the list, on its own row. */}
      <div className="flex items-center lg:contents">
        <Button variant="ghost" className="-ml-3 lg:hidden" onClick={onClose}>
          <ArrowLeft aria-hidden /> History
        </Button>
        {/* Beside the list: Close sits in the pane's corner, beside the heading rather than above it. */}
        <Button variant="ghost" size="icon" className="absolute top-2 right-2 max-lg:hidden" aria-label="Close order" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      {order.error ? (
        <ErrorState error={order.error} onRetry={order.reload} />
      ) : !o ? (
        <Loading />
      ) : (
        <>
          <Summary order={o} timeZone={timeZone} navigate={navigate} />
          <OrderLinesTable order={o} />
          <Actions
            order={o}
            onConfirm={() => setConfirming(true)}
            onHandOver={() => setHandingOver(true)}
            onOpenRecord={(print) => onOpenRecord(o.id, print)}
          />
          {handingOver ? (
            <HandOver
              orderId={o.id}
              onGiven={() => {
                order.reload()
                onChanged()
              }}
              onClose={() => setHandingOver(false)}
            />
          ) : null}
          <ConfirmationSheet
            order={confirming ? { ...o, usage_months: null } : null}
            onClose={() => setConfirming(false)}
            onGiven={() => {
              setConfirming(false)
              order.reload()
              onChanged()
            }}
            onPrint={(orderId) => onOpenRecord(orderId, true)}
          />
        </>
      )}
    </article>
  )
}

function Summary({ order: o, timeZone, navigate }: { order: Order; timeZone: string | undefined; navigate: (to: Route) => void }) {
  const days = o.status === 'ORDERED' ? waitingDays(o.ordered_at, new Date(), timeZone) : 0
  return (
    <header className="flex flex-col gap-1 lg:pr-10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{o.record_number}</h2>
        <Badge variant={o.status === 'GIVEN' ? 'default' : 'secondary'}>{statusLabel[o.status]}</Badge>
        {o.status === 'ORDERED' ? (
          <span className={cn('text-sm', days > LONG_WAIT_DAYS ? 'font-medium text-destructive' : 'text-muted-foreground')}>
            Waiting {formatWaiting(days)}
          </span>
        ) : null}
      </div>
      <p className="font-medium">
        <a {...linkTo({ name: 'employee', id: o.employee_id }, navigate)} className="underline-offset-4 hover:underline">
          {o.employee_first_name} {o.employee_last_name}
        </a>
        {o.employee_code ? <span className="font-normal text-muted-foreground"> · {o.employee_code}</span> : null}
      </p>
      <p className="text-sm text-muted-foreground">
        Ordered {formatDateTime(o.ordered_at, timeZone)} by {o.prepared_by_name}
        {o.given_at
          ? ` · given ${formatDateTime(o.given_at, timeZone)}${o.confirmation_method ? `, confirmed ${methodText[o.confirmation_method]}` : ''}`
          : ''}
      </p>
    </header>
  )
}

/**
 * ORDERED: Open Employee Confirmation, Hand over now (the employee confirms on
 * this device, at the counter), Copy for WhatsApp, and Print Record for a paper
 * signature. GIVEN: View Record, Print Record, Share via WhatsApp. The items
 * (View Items in the manual) are always shown above.
 */
function Actions({
  order: o,
  onConfirm,
  onHandOver,
  onOpenRecord,
}: {
  order: Order
  onConfirm: () => void
  onHandOver: () => void
  onOpenRecord: (print: boolean) => void
}) {
  const actions = historyActions(o.status)
  const whatsapp = formatWhatsApp(messageFromOrder(o))
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      {actions.includes('openConfirmation') ? (
        <Button onClick={onConfirm}>
          <Link2 aria-hidden /> Open Employee Confirmation
        </Button>
      ) : null}
      {actions.includes('openConfirmation') ? (
        <Button variant="outline" onClick={onHandOver}>
          <Handshake aria-hidden /> Hand over now
        </Button>
      ) : null}
      {actions.includes('viewRecord') ? (
        <Button variant="outline" onClick={() => onOpenRecord(false)}>
          <FileText aria-hidden /> View Record
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => onOpenRecord(true)}>
        <Printer aria-hidden /> Print Record
      </Button>
      <WhatsAppButton label={actions.includes('shareWhatsApp') ? 'Share via WhatsApp' : 'Copy for WhatsApp'} text={whatsapp} />
    </div>
  )
}
