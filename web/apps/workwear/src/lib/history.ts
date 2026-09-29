/**
 * History rules as pure functions: which actions each state shows (manual §6)
 * and how History values are displayed.
 */
import type { ConfirmationMethod, OrderStatus } from '@ppe/api-client'

export type HistoryAction =
  | 'viewItems'
  | 'openConfirmation'
  | 'copyWhatsApp'
  | 'viewRecord'
  | 'printRecord'
  | 'shareWhatsApp'

/**
 * Manual §6: ORDERED shows View Items, Open Employee Confirmation and Copy for
 * WhatsApp; GIVEN shows View Items, View Record, Print Record and Share via
 * WhatsApp, and never confirmation or edit actions.
 */
export function historyActions(status: OrderStatus): HistoryAction[] {
  return status === 'ORDERED'
    ? ['viewItems', 'openConfirmation', 'copyWhatsApp']
    : ['viewItems', 'viewRecord', 'printRecord', 'shareWhatsApp']
}

export const statusLabel: Record<OrderStatus, string> = { ORDERED: 'Ordered', GIVEN: 'Given' }

/** How receipt was confirmed, as it completes "Confirmed …" and "given …, …". */
export const methodText: Record<ConfirmationMethod, string> = {
  ELECTRONIC: 'electronically',
  PAPER: 'on paper',
  IN_PERSON: 'in person on a staff device',
}

/** Usage time (algorithm D), shown for GIVEN orders only, e.g. "2.1 months". */
export function formatUsage(months: number | null): string {
  if (months === null) return ''
  return `${months.toFixed(1)} months`
}

/** A timestamp as "YYYY-MM-DD HH:mm" in timeZone (the organisation's). */
export function formatDateTime(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** A date as "24 Sep" in timeZone, for a compact History row. */
export function formatShortDate(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(d)
}

/**
 * A timestamp relative to now, in timeZone's calendar, for lists: "today",
 * "yesterday", "3 days ago", "tomorrow", "in 5 days"; a week or more away, the
 * date ("24 Sep", with the year when it is not this year's). With `time`,
 * today's and yesterday's add the time of day ("today 14:03"). Lower case, to
 * sit inside a sentence; `capitalize` it to start one. Records and receipts
 * keep absolute dates.
 */
export function formatRelative(iso: string, now: Date, timeZone: string | undefined, { time = false } = {}): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const days = localDay(d, timeZone) - localDay(now, timeZone)
  const at = time ? ` ${formatDateTime(iso, timeZone).slice(11)}` : ''
  if (days === 0) return `today${at}`
  if (days === -1) return `yesterday${at}`
  if (days === 1) return 'tomorrow'
  if (days < 0 && days > -7) return `${-days} days ago`
  if (days > 0 && days < 7) return `in ${days} days`
  const sameYear = formatDateTime(iso, timeZone).slice(0, 4) === formatDateTime(now.toISOString(), timeZone).slice(0, 4)
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(d)
}

/** The first letter in upper case: "today 14:03" as a table cell's "Today 14:03". */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The month of a timestamp in timeZone: a key to group by ("2026-09") and its heading ("September 2026"). */
export function monthOf(iso: string, timeZone: string | undefined): { key: string; label: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { key: '', label: '' }
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(d).split('-')
  return { key: `${y}-${m}`, label: new Intl.DateTimeFormat('en-GB', { timeZone, month: 'long', year: 'numeric' }).format(d) }
}

/** The calendar date of iso in timeZone, as days since 1970 (for day differences). */
function localDay(iso: string | Date, timeZone: string | undefined): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d)
    .split('-')
    .map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1) / 86_400_000
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
  return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`
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
