/**
 * History rules as pure functions: which actions each state shows (manual §6)
 * and how History values are displayed.
 */
import type { OrderStatus } from '@ppe/api-client'

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

/** The order's activity time: given if given, else ordered. History sorts on it. */
export function activityAt(o: { given_at: string | null; ordered_at: string }): string {
  return o.given_at ?? o.ordered_at
}
