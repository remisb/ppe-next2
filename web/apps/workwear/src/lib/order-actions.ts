/**
 * An order's actions as its action bar and ⋯ show them (record-actions.md §6),
 * from the state's actions (historyActions, manual §6).
 */
import type { Order } from '@ppe/api-client'
import type { RecordAction } from '@ppe/ui/lib/record-actions'

import { t } from '@/i18n'
import { historyActions } from '@/lib/history'

export interface OrderRunners {
  createLink: () => void
  /** Show or hide the link made here. */
  toggleLink: () => void
  viewRecord: () => void
  printRecord: () => void
  sign: () => void
  handOver: () => void
  copyWhatsApp: () => void
  /** A manager's: Delete order, last and asking first. */
  remove?: (() => void) | undefined
}

export interface OrderActionState {
  /** A link was made here: the main action shows and hides it. */
  link: { open: boolean; id: string } | null
  /** An action is under way: the main action and Mark as Signed & Given wait. */
  pending: boolean
}

/**
 * ORDERED: Create confirmation link (then Confirmation link, which shows and
 * hides the link made), Print Order and Mark as Signed & Given as tools, Hand
 * over now (when shown) and Copy for WhatsApp in ⋯. GIVEN: View Order, Print
 * Order as a tool, Copy for WhatsApp in ⋯. Delete order, a manager's, last.
 */
export function orderActions(o: Pick<Order, 'status'>, state: OrderActionState, run: OrderRunners): RecordAction[] {
  const has = new Set(historyActions(o.status))
  const actions: RecordAction[] = []
  if (has.has('createLink')) {
    actions.push(
      state.link
        ? {
            id: 'confirmationLink',
            label: t.history.confirmationLink,
            short: t.history.confirmationLinkShort,
            icon: 'link',
            place: 'main',
            expanded: state.link.open,
            controls: state.link.id,
            run: run.toggleLink,
          }
        : { id: 'createLink', label: t.history.createLink, short: t.history.createLinkShort, icon: 'link', place: 'main', pending: state.pending, run: run.createLink },
    )
  } else if (has.has('viewRecord')) {
    actions.push({ id: 'viewRecord', label: t.history.viewOrder, short: t.history.viewOrderShort, icon: 'document', place: 'main', run: run.viewRecord })
  }
  if (has.has('printRecord')) actions.push({ id: 'printRecord', label: t.history.printOrder, icon: 'print', place: 'tool', run: run.printRecord })
  // It records the signed paper copy, so it asks first (the question names the employee and the order).
  if (has.has('sign')) actions.push({ id: 'sign', label: t.history.sign, icon: 'sign', place: 'tool', pending: state.pending, run: run.sign })
  if (has.has('handOver')) actions.push({ id: 'handOver', label: t.history.handOverNow, place: 'menu', run: run.handOver })
  if (has.has('copyWhatsApp')) actions.push({ id: 'copyWhatsApp', label: t.order.copyForWhatsApp, icon: 'whatsapp', place: 'menu', run: run.copyWhatsApp })
  if (run.remove) actions.push({ id: 'delete', label: t.history.deleteOrder, place: 'menu', destructive: true, asks: true, run: run.remove })
  return actions
}
