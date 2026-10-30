import type { ConfirmationLink, Order } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { ShortWords } from '@ppe/ui/components/page-header'
import { RecordHeader, RecordTitle, type RecordNav } from '@ppe/ui/components/record-header'
import { ActionError, Loaded } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronDown, FileText, Handshake, Link2, PenLine, Printer } from 'lucide-react'
import { useId, useState } from 'react'

import { ConfirmationLinkView } from '@/components/confirmation-sheet'
import { HandOver } from '@/components/hand-over'
import { OrderLinesTable } from '@/components/order-lines'
import { t } from '@/i18n'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { linkVariants } from '@ppe/ui/components/link'
import { useAction } from '@ppe/ui/lib/use-action'
import { PaneBar } from '@ppe/ui/components/list-detail'
import { OrderStatusBadge, OrderWait } from '@/components/order-status'
import { deleteQuestion, historyActions, waitingDays } from '@/lib/history'
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
    <article aria-label={o ? t.history.orderLabel(o.record_number) : t.history.order} className="@container flex flex-col gap-4">
      <PaneBar backLabel={t.history.title} closeLabel={t.history.closeOrder} onClose={onClose} className="self-start" />
      <Loaded load={order}>
        {(o) => (
          <>
            <OrderBody
              // A link is shown once, for the order it was created for.
              key={o.id}
              order={o}
              timeZone={timeZone}
              navigate={navigate}
              nav={{ backLabel: t.history.title, onBack: onClose, closeLabel: t.history.closeOrder }}
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
            <OrderLinesTable order={o} />
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

/**
 * The order as the item pane shows an item (guidelines, "The detail pane"): its
 * record number with the main action and ⋯ in the corner, who it is for, its
 * status, its facts between rules, then the rest of its actions, all above
 * the lines, so a long order never pushes them off a phone's screen.
 *
 * ORDERED: Create confirmation link is the main action (electronic; the link
 * then shows right below the header, and the button becomes Confirmation
 * link, which collapses and expands it), then Hand over now (the employee
 * confirms on this device, at the counter), Print Order (prints the record)
 * and Mark as Signed & Given (records the signed paper copy); the supplier
 * message is Create Order's, not here. GIVEN: View Order is the main action,
 * then Print Order (both the record). Delete order, a manager's, is under ⋯.
 */
function OrderBody({
  order: o,
  timeZone,
  navigate,
  nav,
  onHandOver,
  onOpenRecord,
  onGiven,
  onDelete,
}: {
  order: Order
  timeZone: string | undefined
  navigate: (to: Route) => void
  nav: RecordNav
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
  const days = o.status === 'ORDERED' ? waitingDays(o.ordered_at, new Date(), timeZone) : 0

  const sign = () =>
    void action.run(
      async () => {
        await client.orders.confirmPaper(o.id)
        onGiven()
      },
      { confirm: t.history.recordPaperQuestion(name, o.record_number) },
    )

  // Create confirmation link makes the link and opens it below the header; the button then becomes
  // Confirmation link, a disclosure (chevron, aria-expanded) that hides and shows that same link,
  // never making another, which would replace it.
  const main = actions.includes('createLink') ? (
    link ? (
      <Button variant="outline" aria-expanded={linkOpen} aria-controls={linkId} onClick={() => setLinkOpen((v) => !v)}>
        <Link2 aria-hidden /> <ShortWords label={t.history.confirmationLink} short={t.history.confirmationLinkShort} />
        <ChevronDown aria-hidden className={cn('transition-transform motion-reduce:transition-none', linkOpen && 'rotate-180')} />
      </Button>
    ) : (
      <Button
        disabled={action.pending}
        onClick={() =>
          void action.run(async () => {
            setLink(await client.orders.createConfirmationLink(o.id))
            setLinkOpen(true)
          })
        }
      >
        <Link2 aria-hidden /> <ShortWords label={t.history.createLink} short={t.history.createLinkShort} />
      </Button>
    )
  ) : actions.includes('viewRecord') ? (
    <Button variant="outline" onClick={() => onOpenRecord(false)}>
      <FileText aria-hidden /> <ShortWords label={t.history.viewOrder} short={t.history.viewOrderShort} />
    </Button>
  ) : null

  return (
    <>
      <RecordHeader
        className="mb-0"
        nav={nav}
        title={<RecordTitle>{o.record_number}</RecordTitle>}
        actions={
          <>
            {main}
            {onDelete ? (
              <MoreActions label={t.common.moreActions(o.record_number)}>
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  {t.history.deleteOrder}
                </DropdownMenuItem>
              </MoreActions>
            ) : null}
          </>
        }
      >
        <p className="mt-1 font-medium">
          <a {...linkTo({ name: 'employee', id: o.employee_id }, navigate)} className={linkVariants()}>
            {name}
          </a>
          {o.employee_code ? <span className="font-normal text-muted-foreground"> · {o.employee_code}</span> : null}
        </p>
        {/* A long wait says what to do from its badge (IssueBadge), not in words under it. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={o.status} />
          {o.status === 'ORDERED' ? <OrderWait days={days} /> : null}
        </div>
      </RecordHeader>
      <div id={linkId} className="empty:hidden">
        {link && linkOpen ? (
          <section aria-label={t.history.confirmationLink} className="flex flex-col gap-2 border-y border-border py-3">
            <ConfirmationLinkView link={link} name={name} recordNumber={o.record_number} />
          </section>
        ) : null}
      </div>
      <ActionError error={action.error} />
      <FactGrid aria-label={t.history.orderDetails}>
        <Fact label={t.common.ordered}>{formatDateTime(o.ordered_at, timeZone)}</Fact>
        <Fact label={t.history.preparedByLabel}>{o.prepared_by_name}</Fact>
        {o.given_at ? <Fact label={t.common.given}>{formatDateTime(o.given_at, timeZone)}</Fact> : null}
        {o.confirmation_method ? <Fact label={t.history.confirmedLabel}>{t.history.confirmedHow[o.confirmation_method]}</Fact> : null}
      </FactGrid>
      {actions.some((a) => a === 'handOver' || a === 'printRecord' || a === 'sign') ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {actions.includes('handOver') ? (
            <Button variant="outline" onClick={onHandOver}>
              <Handshake aria-hidden /> {t.history.handOverNow}
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
        </div>
      ) : null}
    </>
  )
}
