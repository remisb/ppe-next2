import type { Route } from './router'

/**
 * Display rules for the administrator's dashboard. The API computes every
 * figure; these only label, compare and scale them.
 */

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09" as "Sep", or with long as "Sep 2026". */
export function monthLabel(month: string, long = false): string {
  const [y, m] = month.split('-')
  const name = monthNames[Number(m) - 1] ?? month
  return long ? `${name} ${y}` : name
}

/**
 * The change from previous to current as a whole percentage, or null when
 * there is nothing to compare with (previous is zero).
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

/**
 * The days of the previous month a comparison covers: "1–27 Aug", or "Aug"
 * when it covers the whole month.
 */
export function periodLabel(month: string, throughDay: number): string {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y ?? 0, m ?? 0, 0)).getUTCDate()
  const name = monthLabel(month)
  if (throughDay >= days) return name
  return throughDay === 1 ? `1 ${name}` : `1–${throughDay} ${name}`
}

/**
 * The current month so far against the same days of the previous month:
 * "+12% vs 1–27 Aug", "−5% vs Aug", "same as 1–27 Aug". Empty when there is
 * nothing to compare with: the period is empty or held nothing.
 */
export function changeText(current: number, previous: number, previousMonth: string, throughDay: number): string {
  if (throughDay < 1) return ''
  const pct = percentChange(current, previous)
  if (pct === null) return ''
  const vs = periodLabel(previousMonth, throughDay)
  if (pct === 0) return `same as ${vs}`
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs ${vs}`
}

/**
 * A round top for a chart's scale at or above max: 1, 2, 2.5 or 5 times a
 * power of ten, so gridlines fall on readable amounts. At least 1.
 */
export function niceCeiling(max: number): number {
  if (!(max > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= max) return step * power
  }
  return 10 * power
}

/** A bar's length as a percentage of the scale; a non-zero value always shows at least a sliver. */
export function barPercent(value: number, scale: number): number {
  if (value <= 0 || scale <= 0) return 0
  return Math.max(2, Math.min(100, (value / scale) * 100))
}

/** Days for people: "today", "1 day", "5 days", "1.5 days". */
export function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'today'
  return days === 1 ? '1 day' : `${days} days`
}

/** part as a whole percentage of total; 0 when total is 0. */
export function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

/** "1 order", "3 orders". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** One thing a dashboard asks the user to do. */
export interface Need {
  key: string
  /** Overdue, or waiting past the flag: shown first and in red. */
  urgent: boolean
  /** A short tag: "12 days", "Overdue", "Sizes". */
  tag: string
  title: string
  detail: string
  /** The one action; context completes its name for screen readers ("Reorder" + "Gloves for Ona"). */
  action: { label: string; context: string; to: Route }
}

/** Urgent first; otherwise in the order given (each source is already oldest or soonest first). */
export function sortNeeds(needs: readonly Need[]): Need[] {
  return [...needs.filter((n) => n.urgent), ...needs.filter((n) => !n.urgent)]
}
