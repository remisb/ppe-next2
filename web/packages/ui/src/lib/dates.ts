/**
 * Dates as the apps show them, in the organisation's timezone (the API sends
 * it) and the language in use.
 */
import { currentLang, intlLocale } from '@ppe/i18n'

import { uiText } from '../text.ts'

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

/**
 * The month form for a day and month: short ("24 Sept", "24 сент."), except
 * in Lithuanian, where Intl's short form is numeric ("09-24") and the long
 * one reads as people write it ("rugsėjo 24 d.").
 */
function shortMonth(): 'short' | 'long' {
  return currentLang() === 'lt' ? 'long' : 'short'
}

/** A date as "24 Sep" in timeZone, for a compact row. */
export function formatShortDate(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(intlLocale(), { timeZone, day: 'numeric', month: shortMonth() }).format(d)
}

/** The calendar date of iso in timeZone, as days since 1970 (for day differences). */
export function localDay(iso: string | Date, timeZone: string | undefined): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d)
    .split('-')
    .map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, day ?? 1) / 86_400_000
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
  const text = uiText()
  const days = localDay(d, timeZone) - localDay(now, timeZone)
  const at = time ? formatDateTime(iso, timeZone).slice(11) : ''
  if (days === 0) return at ? text.todayAt(at) : text.today
  if (days === -1) return at ? text.yesterdayAt(at) : text.yesterday
  if (days === 1) return text.tomorrow
  if (days < 0 && days > -7) return text.daysAgo(-days)
  if (days > 0 && days < 7) return text.inDays(days)
  const sameYear = formatDateTime(iso, timeZone).slice(0, 4) === formatDateTime(now.toISOString(), timeZone).slice(0, 4)
  return new Intl.DateTimeFormat(intlLocale(), { timeZone, day: 'numeric', month: shortMonth(), ...(sameYear ? {} : { year: 'numeric' }) }).format(d)
}

/** The first letter in upper case: "today 14:03" as a table cell's "Today 14:03". */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
