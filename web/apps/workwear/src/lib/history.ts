/**
 * History rules as pure functions: which actions each state shows (manual §6)
 * and how History values are displayed.
 */
import type { ConfirmationMethod, OrderStatus } from '@ppe/api-client'
import { capitalize, localDay } from '@ppe/ui/lib/dates'

import { intlLocale, t } from '@/i18n'

export type HistoryAction =
  | 'viewItems'
  | 'openConfirmation'
  | 'viewRecord'
  | 'printRecord'

/**
 * Manual §6: ORDERED shows View Items and Open Employee Confirmation; GIVEN
 * shows View Items, View Record and Print Record, and never confirmation or
 * edit actions. The manual's Copy for WhatsApp on ORDERED and Share via
 * WhatsApp on GIVEN are left out: the supplier message is sent from Create
 * Order's review.
 */
export function historyActions(status: OrderStatus): HistoryAction[] {
  return status === 'ORDERED'
    ? ['viewItems', 'openConfirmation']
    : ['viewItems', 'viewRecord', 'printRecord']
}

/** A status in the interface language, read when used: `statusLabel[o.status]`. */
export const statusLabel: Readonly<Record<OrderStatus, string>> = {
  get ORDERED() {
    return t.common.ordered
  },
  get GIVEN() {
    return t.common.given
  },
}

/**
 * How receipt was confirmed, as it completes the Items Given Record's English
 * "Confirmed … by". English only: the record keeps its own English / Russian.
 * The staff screens word it through t.history.givenConfirmed.
 */
export const methodText: Record<ConfirmationMethod, string> = {
  ELECTRONIC: 'electronically',
  PAPER: 'on paper',
  IN_PERSON: 'in person on a staff device',
}

/**
 * What Delete order asks before a manager removes a demo or test order. A
 * given order says so: its signed record goes with it.
 */
export function deleteQuestion(o: { record_number: string; status: OrderStatus; employee_first_name: string; employee_last_name: string }): string {
  const name = `${o.employee_first_name} ${o.employee_last_name}`
  return o.status === 'GIVEN' ? t.history.deleteGiven(o.record_number, name) : t.history.deleteOrdered(o.record_number, name)
}

/** Usage time (algorithm D), shown for GIVEN orders only, e.g. "2.1 months". */
export function formatUsage(months: number | null): string {
  if (months === null) return ''
  const value = new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }).format(months)
  return t.history.usage(value)
}

/** The month of a timestamp in timeZone: a key to group by ("2026-09") and its heading ("September 2026"). */
export function monthOf(iso: string, timeZone: string | undefined): { key: string; label: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { key: '', label: '' }
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(d).split('-')
  // Capitalized for a heading: Russian names the month in lower case ("сентябрь 2026 г.").
  return { key: `${y}-${m}`, label: capitalize(new Intl.DateTimeFormat(intlLocale(), { timeZone, month: 'long', year: 'numeric' }).format(d)) }
}

/**
 * How many calendar days an ORDERED order has waited for the employee's
 * confirmation, in the organisation's timezone, as the dashboards count it:
 * an order placed yesterday evening is one day old this morning.
 */
export function waitingDays(orderedAt: string, now: Date, timeZone: string | undefined): number {
  return Math.max(0, localDay(now, timeZone) - localDay(orderedAt, timeZone))
}

/** Waiting longer than this is flagged, as on the dashboards. */
export const LONG_WAIT_DAYS = 14

/** "today", "1 day", "12 days". */
export function formatWaiting(days: number): string {
  return days === 0 ? t.history.today : t.common.days(days)
}

/** The order's activity time: given if given, else ordered. History sorts on it. */
export function activityAt(o: { given_at: string | null; ordered_at: string }): string {
  return o.given_at ?? o.ordered_at
}

/**
 * Whether a search looks like a record number, as the API reads one:
 * "WE-000004", "we4", "WE 4" or just digits. The palette then asks for that order.
 */
export function looksLikeRecord(q: string): boolean {
  return /^(we[-\s]*)?\d{1,12}$/i.test(q.trim())
}
