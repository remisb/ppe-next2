import type { Company, Employee, EmployeeStatus, Employment } from '@ppe/api-client'
import { formatDay } from '@ppe/ui/lib/dates'

import { t } from '@/i18n'

/**
 * Employment rules for the screens (docs/specs/employee-service.md,
 * "Employment"). The API enforces each; these say so before a round trip.
 * Dates are YYYY-MM-DD, which compare as text. A period runs from started_on
 * to ended_on, the day the person left, so the next may start that day.
 */

/** The Employees screen's status tabs, in their order. */
export const STATUSES: readonly EmployeeStatus[] = ['employee', 'candidate', 'former']

/** How many people have each status. */
export function countByStatus(es: readonly Pick<Employee, 'status'>[]): Record<EmployeeStatus, number> {
  const out: Record<EmployeeStatus, number> = { employee: 0, candidate: 0, former: 0 }
  for (const e of es) out[e.status] += 1
  return out
}

/** The default company's id, else the only company's; '' when there is no such one. */
export function defaultCompanyId(companies: readonly Pick<Company, 'id' | 'is_default'>[]): string {
  return companies.find((c) => c.is_default)?.id ?? (companies.length === 1 ? companies[0]!.id : '')
}

/** A period's days: "from 10 Jan 2026", "10 Jan 2026 – 1 Mar 2026", "until 1 Mar 2026", or none recorded. */
export function periodText(m: Pick<Employment, 'started_on' | 'ended_on'>): string {
  const from = m.started_on ? formatDay(m.started_on) : null
  const to = m.ended_on ? formatDay(m.ended_on) : null
  if (from && to) return `${from} – ${to}`
  if (from) return t.employment.since(from)
  if (to) return t.employment.until(to)
  return t.employment.datesNotRecorded
}

/** The open period, if any. */
export function openEmployment(jobs: readonly Employment[]): Employment | undefined {
  return jobs.find((m) => m.ended_on === null)
}

/** Whether periods a and b share a day: a missing start reaches back, a missing end forward. */
export function overlaps(a: Pick<Employment, 'started_on' | 'ended_on'>, b: Pick<Employment, 'started_on' | 'ended_on'>): boolean {
  const before = (start: string | null, end: string | null) => start === null || end === null || start < end
  return before(a.started_on, b.ended_on) && before(b.started_on, a.ended_on)
}

/** What Employ, Move to Another Company and Edit Employment check. */
export interface PeriodDraft {
  companyId: string
  startedOn: string
  endedOn: string
}

export type PeriodErrors = Partial<Record<keyof PeriodDraft, string>>

/**
 * The form's problems. `jobs` are the person's periods (`editing` the one
 * edited, left out); `move` is Move to Another Company, which ends the open one
 * on the new start, so it needs a start no earlier than the open one's.
 */
export function checkPeriod(d: PeriodDraft, jobs: readonly Employment[], opts: { move?: boolean; editing?: Employment } = {}): PeriodErrors {
  const errors: PeriodErrors = {}
  if (!d.companyId) errors.companyId = t.employment.chooseCompany
  const start = d.startedOn || null
  const end = d.endedOn || null
  const open = openEmployment(jobs)
  if (opts.move) {
    if (!start) errors.startedOn = t.employment.enterStart
    else if (open?.started_on && start < open.started_on) errors.startedOn = t.employment.moveBeforeStart(formatDay(open.started_on))
    else if (open && open.company_id === d.companyId) errors.companyId = t.employment.sameCompany
  }
  if (start && end && end < start) errors.endedOn = t.employment.endBeforeStart
  if (Object.keys(errors).length > 0) return errors
  const others = jobs.filter((m) => m.id !== opts.editing?.id && !(opts.move && m === open))
  if (!opts.move && !opts.editing && open) errors.companyId = t.employment.alreadyEmployed(open.company_name)
  else if (opts.editing && !end && others.some((m) => m.ended_on === null)) errors.endedOn = t.employment.anotherOpen
  else {
    const clash = others.find((m) => overlaps({ started_on: start, ended_on: end }, m))
    if (clash) errors.startedOn = t.employment.overlaps(clash.company_name, periodText(clash))
  }
  return errors
}

/** End Employment's problem with the day, if any: it is required and no earlier than the start. */
export function checkEnd(day: string, m: Pick<Employment, 'started_on'>): string | undefined {
  if (!day) return t.employment.enterEnd
  if (m.started_on && day < m.started_on) return t.employment.endBeforeStart
  return undefined
}
