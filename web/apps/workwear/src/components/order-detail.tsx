import type { ConfirmationLink, Order } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { ActionError, Loaded } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronDown, CircleCheck, FileText, Handshake, Link2, PenLine, Printer, X } from 'lucide-react'
import { useId, useState } from 'react'

import { ConfirmationLinkView } from '@/components/confirmation-sheet'
import { HandOver } from '@/components/hand-over'
import { OrderLinesTable } from '@/components/order-lines'
import { t } from '@/i18n'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { linkVariants } from '@ppe/ui/components/link'
import { BackButton } from '@ppe/ui/components/back-button'
import { useAction } from '@ppe/ui/lib/use-action'
import { LONG_WAIT_DAYS, deleteQuestion, historyActions, statusLabel, waitingDays } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { useOpenKey } from '@/lib/open-sections'

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
  const changesKey = useOpenKey('order.changes')
  const order = useLoad(() => client.orders.get(id), [id])
  const [handingOver, setHandingOver] = useState(false)
  const deleting = useAction()
  const o = order.data

  const remove = (o: Order) =>
    deleting.run(
      async () => {
        await client.orders.remove(o.id)
        onDeleted()
      },
      { confirm: deleteQuestion(o) },
    )

  return (
    <article aria-label={o ? t.history.orderLabel(o.record_number) : t.history.order} className="flex flex-col gap-4">
      {/* Narrow: the detail is the whole screen, so the way out is Back to the list, on its own row. */}
      <div className="flex items-center lg:contents">
        <BackButton className="lg:hidden" onClick={onClose}>{t.history.title}</BackButton>
        {/* Beside the list: Close sits in the pane's corner, beside the heading rather than above it. */}
        <Button variant="ghost" size="icon" className="absolute top-2 right-2 max-lg:hidden" aria-label={t.history.closeOrder} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      <Loaded load={order}>
        {(o) => (
          <>
            <Summary order={o} timeZone={timeZone} navigate={navigate} />
            <OrderLinesTable order={o} />
            <Actions
              // A link is shown once, for the order it was created for.
              key={o.id}
              order={o}
              onHandOver={() => setHandingOver(true)}
              onOpenRecord={(print) => onOpenRecord(o.id, print)}
              onGiven={() => {
                order.reload()
                onChanged()
              }}
              // Only the manager role clears demo and test orders; the API allows no one else.
              onDelete={session.can('orders.delete') ? () => void remove(o) : undefined}
            />
            <ActionError title={t.history.notDeleted} error={deleting.error} />
            {/* Closed at first, so the actions stay near the top; once open, loaded again whenever
                the order is (after a confirmation), so its new step shows. */}
            <RecordChanges load={() => client.audit.history('orders', id)} deps={[id, o]} timeZone={timeZone} rememberAs={changesKey} className="mb-0" />
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
          </>
        )}
      </Loaded>
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
        ) : (
          // Where an ordered order says how long it has waited: done, a green badge with its tick.
          <Badge variant="success">
            <CircleCheck aria-hidden /> {t.history.signed}
          </Badge>
        )}
      </div>
      <p className="font-medium">
        <a {...linkTo({ name: 'employee', id: o.employee_id }, navigate)} className={linkVariants()}>
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
 * ORDERED: Create confirmation link on its own row (electronic; the link
 * then shows right below it, and the button becomes Confirmation link, which
 * collapses and expands it), Hand over now (the employee confirms on this device, at the counter),
 * Print Order (prints the record) and Mark as Signed & Given (records the signed paper copy); the supplier
 * message is Create Order's, not here. GIVEN: View Order and Print Order (both the record);
 * Signed, with a green tick, is beside its status at the top (Summary).
 * The items (View Items in the manual) are always shown above.
 */
function Actions({
  order: o,
  onHandOver,
  onOpenRecord,
  onGiven,
  onDelete,
}: {
  order: Order
  onHandOver: () => void
  onOpenRecord: (print: boolean) => void
  /** A signed paper confirmation was recorded: the order is Given. */
  onGiven: () => void
  /** Managers only: Delete order under ⋯, last and asking first. */
  onDelete?: (() => void) | undefined
}) {
  const { client } = useApi()
  const [link, setLink] = useState<ConfirmationLink | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const linkId = useId()
  const action = useAction()
  const actions = historyActions(o.status)
  const name = `${o.employee_first_name} ${o.employee_last_name}`

  const sign = () =>
    void action.run(
      async () => {
        await client.orders.confirmPaper(o.id)
        onGiven()
      },
      { confirm: t.history.recordPaperQuestion(name, o.record_number) },
    )

  return (
    <div className="flex flex-col gap-4">
      {/* Electronic first, on its own. Create confirmation link makes the link and opens it right
          below; the button then becomes Confirmation link, a disclosure (chevron, aria-expanded)
          that hides and shows that same link, never making another, which would replace it. */}
      {actions.includes('createLink') ? (
        <div className="flex flex-col gap-2">
          {link ? (
            <Button
              variant="outline"
              className="w-full sm:w-fit"
              aria-expanded={linkOpen}
              aria-controls={linkId}
              onClick={() => setLinkOpen((v) => !v)}
            >
              <Link2 aria-hidden /> {t.history.confirmationLink}
              <ChevronDown aria-hidden className={cn('transition-transform motion-reduce:transition-none', linkOpen && 'rotate-180')} />
            </Button>
          ) : (
            <Button
              className="w-full sm:w-fit"
              disabled={action.pending}
              onClick={() =>
                void action.run(async () => {
                  setLink(await client.orders.createConfirmationLink(o.id))
                  setLinkOpen(true)
                })
              }
            >
              <Link2 aria-hidden /> {t.history.createLink}
            </Button>
          )}
          <div id={linkId} className="empty:hidden">
            {link && linkOpen ? (
              <section aria-label={t.history.confirmationLink} className="flex flex-col gap-2 border-y border-border py-3">
                <ConfirmationLinkView link={link} name={name} recordNumber={o.record_number} />
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {actions.includes('handOver') ? (
          <Button variant="outline" onClick={onHandOver}>
            <Handshake aria-hidden /> {t.history.handOverNow}
          </Button>
        ) : null}
        {actions.includes('viewRecord') ? (
          <Button variant="outline" onClick={() => onOpenRecord(false)}>
            <FileText aria-hidden /> {t.history.viewOrder}
          </Button>
        ) : null}
        {actions.includes('printRecord') ? (
          <Button variant="outline" onClick={() => onOpenRecord(true)}>
            <Printer aria-hidden /> {t.history.printOrder}
          </Button>
        ) : null}
        {actions.includes('sign') ? (
          <Button variant="outline" disabled={action.pending} onClick={sign}>
            <PenLine aria-hidden className="text-warning" /> {t.history.sign}
          </Button>
        ) : null}
        {onDelete ? (
          <MoreActions label={t.common.moreActions(o.record_number)} className="justify-self-start">
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              {t.history.deleteOrder}
            </DropdownMenuItem>
          </MoreActions>
        ) : null}
      </div>
      <ActionError error={action.error} />
    </div>
  )
}
