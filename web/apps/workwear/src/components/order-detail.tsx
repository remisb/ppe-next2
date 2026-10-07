import type { Order } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { ErrorState, Loading } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowLeft, FileText, Handshake, Link2, Printer, X } from 'lucide-react'
import { useState } from 'react'

import { ConfirmationSheet } from '@/components/confirmation-sheet'
import { HandOver } from '@/components/hand-over'
import { OrderLinesTable } from '@/components/order-lines'
import { t } from '@/i18n'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { LONG_WAIT_DAYS, deleteQuestion, historyActions, statusLabel, waitingDays } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'

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
  onDeleted,
}: {
  id: string
  timeZone: string | undefined
  navigate: (to: Route) => void
  onClose: () => void
  onOpenRecord: (id: string, print: boolean) => void
  /** The order changed state (a paper confirmation): the list should reload. */
  onChanged: () => void
  /** A manager deleted the order: close it and reload the list. */
  onDeleted: () => void
}) {
  const { client } = useApi()
  const session = useSession()
  const order = useLoad(() => client.orders.get(id), [id])
  const [confirming, setConfirming] = useState(false)
  const [handingOver, setHandingOver] = useState(false)
  const [deleteError, setDeleteError] = useState<unknown>()
  const o = order.data

  const remove = async (o: Order) => {
    if (!window.confirm(deleteQuestion(o))) return
    setDeleteError(undefined)
    try {
      await client.orders.remove(o.id)
      onDeleted()
    } catch (err) {
      setDeleteError(err)
    }
  }

  return (
    <article aria-label={o ? t.history.orderLabel(o.record_number) : t.history.order} className="flex flex-col gap-4">
      {/* Narrow: the detail is the whole screen, so the way out is Back to the list, on its own row. */}
      <div className="flex items-center lg:contents">
        <Button variant="ghost" className="-ml-3 lg:hidden" onClick={onClose}>
          <ArrowLeft aria-hidden /> {t.history.title}
        </Button>
        {/* Beside the list: Close sits in the pane's corner, beside the heading rather than above it. */}
        <Button variant="ghost" size="icon" className="absolute top-2 right-2 max-lg:hidden" aria-label={t.history.closeOrder} onClick={onClose}>
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
            // Only the manager role clears demo and test orders; the API allows no one else.
            onDelete={session.can('orders.delete') ? () => void remove(o) : undefined}
          />
          {deleteError ? <ErrorState title={t.history.notDeleted} error={deleteError} /> : null}
          {/* Loaded again whenever the order is (after a confirmation), so its new step shows. */}
          <RecordChanges load={() => client.audit.history('orders', id)} deps={[id, o]} timeZone={timeZone} />
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
            {days === 0 ? t.history.waitingToday : t.history.waitingFor(days)}
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
        {t.history.orderedBy(formatDateTime(o.ordered_at, timeZone), o.prepared_by_name)}
        {o.given_at
          ? ` · ${o.confirmation_method ? t.history.givenConfirmed[o.confirmation_method](formatDateTime(o.given_at, timeZone)) : t.history.given(formatDateTime(o.given_at, timeZone))}`
          : ''}
      </p>
    </header>
  )
}

/**
 * ORDERED: Open Employee Confirmation, Hand over now (the employee confirms on
 * this device, at the counter), and Print Record for a paper signature; the
 * supplier message is Create Order's, not here. GIVEN: View Record and Print
 * Record. The items (View Items in the manual) are always shown above.
 */
function Actions({
  order: o,
  onConfirm,
  onHandOver,
  onOpenRecord,
  onDelete,
}: {
  order: Order
  onConfirm: () => void
  onHandOver: () => void
  onOpenRecord: (print: boolean) => void
  /** Managers only: Delete order under ⋯, last and asking first. */
  onDelete?: (() => void) | undefined
}) {
  const actions = historyActions(o.status)
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      {actions.includes('openConfirmation') ? (
        <Button onClick={onConfirm}>
          <Link2 aria-hidden /> {t.history.openConfirmation}
        </Button>
      ) : null}
      {actions.includes('openConfirmation') ? (
        <Button variant="outline" onClick={onHandOver}>
          <Handshake aria-hidden /> {t.history.handOverNow}
        </Button>
      ) : null}
      {actions.includes('viewRecord') ? (
        <Button variant="outline" onClick={() => onOpenRecord(false)}>
          <FileText aria-hidden /> {t.history.viewRecord}
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => onOpenRecord(true)}>
        <Printer aria-hidden /> {t.history.printRecord}
      </Button>
      {onDelete ? (
        <MoreActions label={t.common.moreActions(o.record_number)} className="justify-self-start">
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            {t.history.deleteOrder}
          </DropdownMenuItem>
        </MoreActions>
      ) : null}
    </div>
  )
}
