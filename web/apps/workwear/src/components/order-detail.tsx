import type { ConfirmationLink, Order, SupplierChat, WaitingLink } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { RecordHeader, RecordTitle, type RecordNav } from '@ppe/ui/components/record-header'
import { ActionError, Loaded } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { useId, useState } from 'react'

import { ConfirmationLinkView } from '@/components/confirmation-sheet'
import { HandOver } from '@/components/hand-over'
import { OrderLinesTable } from '@/components/order-lines'
import { WhatsAppCopyStatus, useWhatsAppCopy } from '@/components/whatsapp-button'
import { t } from '@/i18n'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { linkVariants } from '@ppe/ui/components/link'
import { useAction } from '@ppe/ui/lib/use-action'
import { PaneBar } from '@ppe/ui/components/list-detail'
import { OrderStatusBadge, OrderWait } from '@/components/order-status'
import { deleteQuestion, waitingDays } from '@/lib/history'
import { orderActions } from '@/lib/order-actions'
import { type Route, linkTo } from '@/lib/router'
import { useOpenKey } from '@/lib/open-sections'
import { formatWhatsApp, messageFromOrder } from '@/lib/whatsapp'

/**
 * One stored order from History: who and when, its snapshot lines and the
 * actions its state allows (manual §6). Beside the list on a wide screen,
 * where it closes; on its own on a narrow one, where it goes back.
 */
export function OrderDetail({
  id,
  timeZone,
  supplierChat,
  navigate,
  onClose,
  onOpenRecord,
  onChanged,
  onDeleted,
}: {
  id: string
  timeZone: string | undefined
  /** The supplier's WhatsApp group (Settings), which Copy for WhatsApp offers to open. */
  supplierChat: SupplierChat | null
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
              supplierChat={supplierChat}
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
 * record number on a row of its own, its actions in the bar under it
 * (orderActions: the main action with its words, the tools, ⋯), who it is
 * for, its status and its facts between rules, all above the lines, so a
 * long order never pushes them off a phone's screen.
 *
 * Create confirmation link (electronic) shows the link right below the
 * header, and becomes Confirmation link, which collapses and expands it. Copy
 * for WhatsApp says nothing once copied; only when copying is blocked does
 * the text show below the header.
 */
function OrderBody({
  order: o,
  timeZone,
  supplierChat,
  navigate,
  nav,
  onHandOver,
  onOpenRecord,
  onGiven,
  onDelete,
}: {
  order: Order
  timeZone: string | undefined
  supplierChat: SupplierChat | null
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
  const [link, setLink] = useState<(ConfirmationLink & { made_at: string }) | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const linkId = useId()
  const action = useAction()
  const name = `${o.employee_first_name} ${o.employee_last_name}`
  const days = o.status === 'ORDERED' ? waitingDays(o.ordered_at, new Date(), timeZone) : 0
  const whatsappText = formatWhatsApp(messageFromOrder(o))
  const whatsapp = useWhatsAppCopy(whatsappText)
  // The link the order waits on: the one just made here, else the one the API knows of.
  const waiting = link ? { created_at: link.made_at, expires_at: link.expires_at, opened_at: null } : o.link

  const sign = () =>
    void action.run(
      async () => {
        await client.orders.confirmPaper(o.id)
        onGiven()
      },
      { confirm: t.history.recordPaperQuestion(name, o.record_number) },
    )

  const createLink = () =>
    void action.run(
      async () => {
        setLink({ ...(await client.orders.createConfirmationLink(o.id)), made_at: new Date().toISOString() })
        setLinkOpen(true)
      },
      // A link made earlier (on another visit or device) would stop working without a word: ask first (S11).
      o.link ? { confirm: t.history.replaceLinkQuestion(formatDateTime(o.link.created_at, timeZone)) } : {},
    )

  // Create confirmation link makes the link and opens it below the header; the main action then becomes
  // Confirmation link, a disclosure (chevron, aria-expanded) that hides and shows that same link,
  // never making another, which would replace it.
  const actions = orderActions(
    o,
    { link: link ? { open: linkOpen, id: linkId } : null, pending: action.pending },
    {
      createLink,
      toggleLink: () => setLinkOpen((v) => !v),
      viewRecord: () => onOpenRecord(false),
      printRecord: () => onOpenRecord(true),
      sign,
      handOver: onHandOver,
      copyWhatsApp: () => void whatsapp.copy(),
      remove: onDelete,
    },
  )

  return (
    <>
      <RecordHeader className="mb-0" nav={nav} title={<RecordTitle>{o.record_number}</RecordTitle>} actions={actions} moreLabel={t.common.moreActions(o.record_number)}>
        <p className="mt-1 font-medium">
          <a {...linkTo({ name: 'employeePage', id: o.employee_id, from: o.record_number }, navigate)} className={linkVariants()}>
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
      {whatsapp.state === 'manual' ? (
        <section aria-label={t.order.copyForWhatsApp} className="flex flex-col gap-1.5">
          <WhatsAppCopyStatus state={whatsapp.state} text={whatsappText} chat={supplierChat} />
        </section>
      ) : null}
      <ActionError error={action.error} />
      <FactGrid aria-label={t.history.orderDetails}>
        <Fact label={t.common.ordered}>{formatDateTime(o.ordered_at, timeZone)}</Fact>
        <Fact label={t.history.preparedByLabel}>{o.prepared_by_name}</Fact>
        {o.given_at ? <Fact label={t.common.given}>{formatDateTime(o.given_at, timeZone)}</Fact> : null}
        {o.confirmation_method ? <Fact label={t.history.confirmedLabel}>{t.history.confirmedHow[o.confirmation_method]}</Fact> : null}
        {waiting ? <Fact label={t.history.confirmationLink} wide>{linkState(waiting, timeZone)}</Fact> : null}
      </FactGrid>
    </>
  )
}

/** "Made 3 Nov 2026, 14:05 · opened 4 Nov 2026, 09:12", or not opened yet, or when it stopped working. */
function linkState(l: WaitingLink, timeZone: string | undefined): string {
  const parts = [t.history.linkMade(formatDateTime(l.created_at, timeZone))]
  parts.push(l.opened_at ? t.history.linkOpened(formatDateTime(l.opened_at, timeZone)) : t.history.linkNotOpened)
  if (new Date(l.expires_at).getTime() <= Date.now()) parts.push(t.history.linkExpired(formatDateTime(l.expires_at, timeZone)))
  return parts.join(' · ')
}
