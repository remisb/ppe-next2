/**
 * The MRZ's dates are YYMMDD, without their century (docs-import plan §2.2).
 * The rules that give it, the same in Go:
 *
 * - a **birth** date is in the past: 20YY unless that is after today, then 19YY;
 * - an **expiry** date is at most 50 years ahead: 20YY unless that is more
 *   than 50 years after today's year, then 19YY (a document expired long ago).
 *
 * "Today" is always passed in (an ISO date), so the rules are pure and the
 * test vectors fix it.
 */

export type DateKind = 'birth' | 'expiry'

/** The ISO date (YYYY-MM-DD) a YYMMDD stands for, or undefined when it is not a date (`<` for an unknown day or month included). */
export function mrzDate(yymmdd: string, kind: DateKind, today: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined
  const yy = Number(yymmdd.slice(0, 2))
  const mm = Number(yymmdd.slice(2, 4))
  const dd = Number(yymmdd.slice(4, 6))
  if (!isRealDate(2000 + yy, mm, dd) && !isRealDate(1900 + yy, mm, dd)) return undefined
  const thisYear = Number(today.slice(0, 4))
  let year = 2000 + yy
  if (kind === 'birth') {
    if (iso(year, mm, dd) > today) year = 1900 + yy
  } else if (year > thisYear + 50) {
    year = 1900 + yy
  }
  // 29 February of a year that has none (the other century's had one).
  if (!isRealDate(year, mm, dd)) return undefined
  return iso(year, mm, dd)
}

export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const days = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
  return day <= days
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Today's date in UTC, as ISO; callers that care about the organisation's timezone pass their own. */
export function todayUTC(now: Date = new Date()): string {
  return iso(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())
}
