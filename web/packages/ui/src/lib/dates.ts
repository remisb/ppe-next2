/**
 * Dates as the apps show them, in the organisation's timezone (the API sends
 * it) and the language in use.
 */
import { currentLang, intlLocale } from '@ppe/i18n'

import { uiText } from '../text.ts'

/** The parts of a timestamp in timeZone (the organisation's), as two-digit strings. */
function partsOf(d: Date, timeZone: string | undefined) {
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
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

/**
 * How each language writes a calendar date, the one form every date field
 * shows and takes: the order of year, month and day, and what parts them.
 */
const DATE_FORMS = {
  en: { order: 'ymd', sep: '-' },
  lt: { order: 'ymd', sep: '.' },
  ru: { order: 'dmy', sep: '.' },
} as const

/** The language's date form: ymd or dmy, and its separator. */
export function dateForm(): (typeof DATE_FORMS)[keyof typeof DATE_FORMS] {
  return DATE_FORMS[currentLang()]
}

/**
 * A calendar date (YYYY-MM-DD) as the language writes it: 2026-10-15 in
 * English, 2026.10.15 in Lithuanian, 15.10.2026 in Russian. Anything else is
 * returned as it came.
 */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return day
  const [, y, mo, d] = m
  const { order, sep } = dateForm()
  return order === 'ymd' ? `${y}${sep}${mo}${sep}${d}` : `${d}${sep}${mo}${sep}${y}`
}

/** The calendar date of a timestamp in timeZone, YYYY-MM-DD: for comparing and for the API, not for reading. */
export function isoDay(iso: string | Date, timeZone: string | undefined): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return Number.isNaN(d.getTime()) ? '' : partsOf(d, timeZone).day
}

/** A timestamp's date in timeZone, as the language writes it (formatDay). */
export function formatDate(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return formatDay(partsOf(d, timeZone).day)
}

/** A timestamp's time of day in timeZone, HH:mm. */
export function formatTime(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return partsOf(d, timeZone).time
}

/** A timestamp as its date (formatDay) and HH:mm in timeZone (the organisation's). */
export function formatDateTime(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const { day, time } = partsOf(d, timeZone)
  return `${formatDay(day)} ${time}`
}

/**
 * A calendar date (YYYY-MM-DD) as every printed document writes it, whatever
 * the language: "2026 10 15". Anything else is returned as it came.
 */
export function printDay(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.replaceAll('-', ' ') : day
}

/** A timestamp as a printed document writes it, its date (printDay) and HH:mm in timeZone: "2026 10 15 14:03". */
export function printDateTime(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const { day, time } = partsOf(d, timeZone)
  return `${printDay(day)} ${time}`
}

/**
 * A typed date as YYYY-MM-DD, or null when it is not a real day. The
 * language's form is read first; the year may also come first or last with
 * any of . - / or a space between the parts (a date pasted in another form),
 * a lone day or month may have one digit, and eight digits in a row are read
 * in the language's order. The year is four digits, 1900 to 2199.
 */
export function parseDay(text: string): string | null {
  const s = text.trim()
  let y: string, mo: string, d: string
  const digits = /^\d{8}$/.exec(s)
  const parts = /^(\d{1,4})[./\- ](\d{1,2})[./\- ](\d{1,4})\.?$/.exec(s)
  if (digits) {
    if (dateForm().order === 'ymd') [y, mo, d] = [s.slice(0, 4), s.slice(4, 6), s.slice(6)]
    else [d, mo, y] = [s.slice(0, 2), s.slice(2, 4), s.slice(4)]
  } else if (parts) {
    const [, a = '', b = '', c = '']: string[] = parts
    if (a.length === 4 && c.length <= 2) [y, mo, d] = [a, b, c]
    else if (c.length === 4 && a.length <= 2) [d, mo, y] = [a, b, c]
    else return null
  } else return null
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1) return null
  // The last day of the month: day 0 of the next.
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * A date field's text as it is typed at its end: the separator added once a
 * part is complete, and a typed . - / or space made the language's separator,
 * never doubled. Edits elsewhere in the text are left as they are.
 *
 * With year (the current one), a field typed from empty starts in that year:
 * where the year comes first, the first digit follows it ("1" is "2026.1");
 * where it comes last, it follows the day and month ("15.10" is "15.10.2026").
 * Typing another year over it still works: two digits that cannot be a month
 * but start a year ("2026.2" then "0") begin the year instead, and a digit
 * after the filled-in year replaces it.
 */
export function typeDate(prev: string, next: string, year?: string): string {
  if (next.length !== prev.length + 1 || !next.startsWith(prev)) return next
  const { order, sep } = dateForm()
  const typed = next.slice(-1)
  if (/[./\- ,]/.test(typed)) {
    if (prev === '' || prev.endsWith(sep)) return prev
    return prev + sep
  }
  if (!/\d/.test(typed)) return next
  if (year && order === 'ymd') {
    if (prev === '') return `${year}${sep}${typed}`
    const month = new RegExp(`^${year}\\${sep}(\\d\\d)$`).exec(next)
    if (month && /^(19|20|21)$/.test(month[1] ?? '')) return month[1] ?? next
  }
  if (year && order === 'dmy' && new RegExp(`^\\d{1,2}\\${sep}\\d{1,2}\\${sep}${year}$`).test(prev)) {
    return prev.slice(0, prev.length - year.length) + typed
  }
  const groups = order === 'ymd' ? [4, 2] : [2, 2]
  const done = next.split(sep)
  const last = done[done.length - 1] ?? ''
  const at = done.length - 1
  if (at >= groups.length || last.length !== groups[at]) return next
  return year && order === 'dmy' && at === 1 ? `${next}${sep}${year}` : next + sep
}

/**
 * A typed date without its year read in year (the current one): "10.15" in
 * Lithuanian, "15.10" in Russian. Null when that is not a real day either.
 */
export function parseDayInYear(text: string, year: string): string | null {
  const s = text.trim().replace(/[./\- ]$/, '')
  if (!/^\d{1,2}[./\- ]\d{1,2}$/.test(s)) return null
  const { order, sep } = dateForm()
  return parseDay(order === 'ymd' ? `${year}${sep}${s}` : `${s}${sep}${year}`)
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
 * date ("24 Sep", or in full, formatDay, when it is not this year's). With `time`,
 * today's and yesterday's add the time of day ("today 14:03"). Lower case, to
 * sit inside a sentence; `capitalize` it to start one. Records and receipts
 * keep absolute dates.
 */
export function formatRelative(iso: string, now: Date, timeZone: string | undefined, { time = false } = {}): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const text = uiText()
  const days = localDay(d, timeZone) - localDay(now, timeZone)
  const at = time ? formatTime(iso, timeZone) : ''
  if (days === 0) return at ? text.todayAt(at) : text.today
  if (days === -1) return at ? text.yesterdayAt(at) : text.yesterday
  if (days === 1) return text.tomorrow
  if (days < 0 && days > -7) return text.daysAgo(-days)
  if (days > 0 && days < 7) return text.inDays(days)
  // Another year's date is written in full, as every date field shows one.
  if (isoDay(d, timeZone).slice(0, 4) !== isoDay(now, timeZone).slice(0, 4)) return formatDate(iso, timeZone)
  return new Intl.DateTimeFormat(intlLocale(), { timeZone, day: 'numeric', month: shortMonth() }).format(d)
}

/** The first letter in upper case: "today 14:03" as a table cell's "Today 14:03". */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
