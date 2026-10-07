import { t } from '@/i18n'

import type { Route } from './router'

/**
 * Display rules for the administrator's dashboard. The API computes every
 * figure; these only label, compare and scale them.
 */

/**
 * "2026-09" as "Sep", or with long as "Sep 2026". The names come from the
 * dictionary, not Intl: en-GB's short September is "Sept", and Lithuanian's
 * short months are numbers ("09").
 */
export function monthLabel(month: string, long = false): string {
  const [y, m] = month.split('-')
  const i = Number(m) - 1
  const name = t.dashboard.months[i]
  if (name === undefined) return long ? `${month} ${y}` : month
  return long ? t.dashboard.monthYear(i, y ?? '') : name
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
  return t.dashboard.monthDays((m ?? 0) - 1, throughDay)
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
  if (pct === 0) return t.dashboard.sameAs(vs)
  return t.dashboard.changeVs(`${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, vs)
}

// The chart scales are @ppe/ui's, shared with Administration's Usage screen.
export { barPercent, niceCeiling } from '@ppe/ui/lib/charts'

/** Days for people: "today", "1 day", "5 days", "1.5 days". */
export function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return t.dashboard.today
  return t.common.days(days)
}

/** part as a whole percentage of total; 0 when total is 0. */
export function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
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

/** What a person is missing, as Create Order will ask: "no shoe size", "no clothing size or height". */
export function missingText(m: { clothing: boolean; shoes: boolean }): string {
  if (m.clothing && m.shoes) return t.dashboard.noShoeOrClothingSize
  return m.shoes ? t.dashboard.noShoeSize : t.dashboard.noClothingSize
}

/**
 * The Missing sizes tile's line: who and what when it is one person, how many
 * otherwise; never "to measure", since a shoe size needs asking, not measuring.
 */
export function missingSizesText(employees: number, first?: { employee_name: string; clothing: boolean; shoes: boolean }): string {
  if (employees === 0) return t.dashboard.everyoneHasSizes
  if (employees === 1 && first) return t.dashboard.personMissing(first.employee_name, missingText(first))
  return t.dashboard.employeesMissing(employees)
}
