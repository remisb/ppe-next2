/**
 * Company Assets' rules for the SIM card register, as pure functions: the
 * tiles and filters as one query, where a card is, and Add SIM Card's and
 * Edit's checks (docs/specs/asset-service.md). Screens only wire events.
 */
import type { Asset, AssetInput, AssetQuery, AssetSort, AssignmentFormInput, ConnectionStatus, CreateAssetInput } from '@ppe/api-client'
import { formatDateTime } from '@ppe/ui/lib/dates'

import { intlLocale, t } from '@/i18n'
import { parseEuro } from '@/lib/utils'

export const ASSET_PAGE_SIZE = 50

/**
 * Where the register looks: every card, those in the office, those someone
 * holds (whereabouts known or not: the With Employees tile) or those whose
 * whereabouts are unknown.
 */
export type Place = 'all' | 'office' | 'held' | 'unknown'

export interface AssetFilters {
  place: Place
  notReturned: boolean
  status: ConnectionStatus | ''
  provider: string
  q: string
}

export const noAssetFilters: AssetFilters = { place: 'all', notReturned: false, status: '', provider: '', q: '' }

/** A summary tile: the filters it sets; it is pressed while they are the place and Not Returned chosen. */
export type Tile = 'total' | 'inOffice' | 'withEmployees' | 'notReturned'

const tilePlaces: Record<Tile, Pick<AssetFilters, 'place' | 'notReturned'>> = {
  total: { place: 'all', notReturned: false },
  inOffice: { place: 'office', notReturned: false },
  withEmployees: { place: 'held', notReturned: false },
  notReturned: { place: 'all', notReturned: true },
}

/** The filters after choosing tile: its place, the status, provider and search kept (Office + Blocked, §3). */
export function chooseTile(f: AssetFilters, tile: Tile): AssetFilters {
  return { ...f, ...tilePlaces[tile] }
}

export function tilePressed(f: AssetFilters, tile: Tile): boolean {
  const p = tilePlaces[tile]
  return f.place === p.place && f.notReturned === p.notReturned
}

/** How many filters besides the tiles and the search are set, for the phone's Filters button. */
export function filterCount(f: AssetFilters): number {
  return [f.status, f.provider].filter(Boolean).length
}

/** The register's query: the SIM cards matching f, sorted, one page. Unset filters are left out. */
export function assetQuery(f: AssetFilters, sort: AssetSort, dir: 'asc' | 'desc', page: number): AssetQuery {
  const q = f.q.trim()
  return {
    kind: 'SIM',
    ...(q ? { q } : {}),
    ...(f.place === 'office' ? { location: 'OFFICE' as const } : {}),
    ...(f.place === 'unknown' ? { location: 'UNKNOWN' as const } : {}),
    ...(f.place === 'held' ? { held: true } : {}),
    ...(f.notReturned ? { not_returned: true } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.provider ? { provider: f.provider } : {}),
    sort,
    dir,
    page,
    page_size: ASSET_PAGE_SIZE,
  }
}

/** A connection status in the language in use. */
export function statusLabel(s: ConnectionStatus): string {
  return t.assets.statuses[s]
}

/** The badge a status wears: Active plain, Blocked a warning, Not Activated an outline. */
export function statusVariant(s: ConnectionStatus): 'secondary' | 'destructive' | 'outline' {
  return s === 'ACTIVE' ? 'secondary' : s === 'BLOCKED' ? 'destructive' : 'outline'
}

/**
 * Held By / Location: the holder's name, the Office, or Unknown with the last
 * holder kept (§3, §13).
 */
export function holderText(a: Pick<Asset, 'location' | 'open_assignment'>): { main: string; sub?: string } {
  const open = a.open_assignment
  if (a.location === 'OFFICE' || !open) return { main: t.assets.office }
  if (a.location === 'UNKNOWN') return { main: t.assets.unknown, sub: t.assets.lastHeldBy(open.employee_name) }
  return { main: open.employee_name }
}

/** Today in timeZone, YYYY-MM-DD: the latest date a card can have been received or given. */
export function todayIn(timeZone: string | undefined, now = new Date()): string {
  return formatDateTime(now.toISOString(), timeZone).slice(0, 10)
}

/** Add SIM Card's and Edit's fields, as typed. */
export interface SimDraft {
  simNo: string
  phoneNo: string
  provider: string
  plan: string
  value: string
  receivedDate: string
  inventoryNo: string
  status: 'NOT_ACTIVATED' | 'ACTIVE'
  comment: string
}

export function emptySimDraft(today: string): SimDraft {
  return { simNo: '', phoneNo: '', provider: '', plan: '', value: '', receivedDate: today, inventoryNo: '', status: 'NOT_ACTIVATED', comment: '' }
}

/** Edit starts from the card as it is. */
export function simDraftOf(a: Asset): SimDraft {
  return {
    simNo: a.sim_no ?? '',
    phoneNo: a.phone_no ?? '',
    provider: a.provider ?? '',
    plan: a.plan ?? '',
    value: a.non_return_value_cents != null ? (a.non_return_value_cents / 100).toFixed(2) : '',
    receivedDate: a.received_date ?? '',
    inventoryNo: a.inventory_no,
    status: a.connection_status === 'ACTIVE' ? 'ACTIVE' : 'NOT_ACTIVATED',
    comment: a.comment,
  }
}

export type SimErrors = Partial<Record<keyof SimDraft, string>>

/**
 * The draft's problems, as the API would refuse it, so they show at the
 * fields before saving; and the details to send when there are none.
 */
export function checkSimDraft(d: SimDraft, today: string): { errors: SimErrors; input?: AssetInput } {
  const errors: SimErrors = {}
  const simNo = d.simNo.trim()
  const phoneNo = d.phoneNo.trim()
  if (!simNo) errors.simNo = t.assets.required
  else if (!/^[0-9A-Za-z ]+$/.test(simNo)) errors.simNo = t.assets.simNoInvalid
  if (phoneNo && !/^\+?[0-9 ()-]+$/.test(phoneNo)) errors.phoneNo = t.assets.phoneNoInvalid
  if (!d.provider.trim()) errors.provider = t.assets.required
  if (!d.inventoryNo.trim()) errors.inventoryNo = t.assets.required
  const cents = parseEuro(d.value)
  if (Number.isNaN(cents) || (cents !== null && cents < 0)) errors.value = t.assets.valueInvalid
  if (!d.receivedDate) errors.receivedDate = t.assets.required
  else if (d.receivedDate > today) errors.receivedDate = t.assets.dateInFuture
  if (Object.keys(errors).length > 0) return { errors }
  return {
    errors,
    input: {
      inventory_no: d.inventoryNo.trim(),
      sim_no: simNo,
      phone_no: phoneNo || null,
      provider: d.provider.trim(),
      plan: d.plan.trim() || null,
      non_return_value_cents: cents,
      received_date: d.receivedDate,
      comment: d.comment.trim(),
    },
  }
}

/** Add SIM Card's request: the details, the kind and the status chosen. */
export function newSimInput(input: AssetInput, status: SimDraft['status']): CreateAssetInput {
  return { ...input, kind: 'SIM', connection_status: status }
}

/** A calendar date (YYYY-MM-DD) as people read it, "2 Mar 2026", in the language in use. */
export function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

/**
 * The one action a card's state calls for (§3: "situacijai tinkami
 * veiksmai"): Register SIM Return while someone holds it, Give SIM Card when
 * it is in the office and Active, else Change Status (to get it Active).
 */
export type PrimaryAction = 'return' | 'give' | 'status'

export function primaryAction(a: Pick<Asset, 'open_assignment' | 'connection_status'>): PrimaryAction {
  if (a.open_assignment) return 'return'
  return a.connection_status === 'ACTIVE' ? 'give' : 'status'
}

/** Mark as Not Returned is for a held card not yet marked; the mark is set once. */
export function canMarkNotReturned(a: Pick<Asset, 'open_assignment'>): boolean {
  return a.open_assignment !== null && a.open_assignment.not_returned_at === null
}

/** Give SIM Card's form, as typed. Plan and value are asked only when the card lacks them (§6). */
export interface GiveDraft {
  employeeId: string
  employeeName: string
  givenDate: string
  plan: string
  value: string
  comment: string
}

export function emptyGiveDraft(today: string): GiveDraft {
  return { employeeId: '', employeeName: '', givenDate: today, plan: '', value: '', comment: '' }
}

/** What the form prints: the fields that change its content, as one comparable key. */
export function formKey(d: GiveDraft): string {
  return JSON.stringify([d.employeeId, d.givenDate, d.plan.trim(), d.value.trim()])
}

/** The form's inputs to send: the card's own plan and value stay its own; only missing ones are filled in. */
export function formInput(a: Pick<Asset, 'plan' | 'non_return_value_cents'>, d: GiveDraft): AssignmentFormInput {
  const cents = parseEuro(d.value)
  return {
    employee_id: d.employeeId,
    given_date: d.givenDate,
    ...(a.plan === null && d.plan.trim() ? { plan: d.plan.trim() } : {}),
    ...(a.non_return_value_cents === null && cents !== null && !Number.isNaN(cents) ? { non_return_value_cents: cents } : {}),
  }
}

/**
 * Why Give SIM Card cannot be done yet, the first reason only, shown by the
 * button (§6: the reason at the field or button), or null when it can. A
 * card someone holds, one not Active or without a phone number cannot be
 * given from this form at all; the rest the form itself fixes.
 */
export function giveBlock(
  a: Pick<Asset, 'open_assignment' | 'connection_status' | 'phone_no' | 'plan' | 'non_return_value_cents'>,
  d: GiveDraft,
  today: string,
  printed: { key: string } | null,
  signed: boolean,
): string | null {
  if (a.open_assignment) return t.assets.alreadyGivenReason
  if (a.connection_status !== 'ACTIVE') return a.connection_status === 'BLOCKED' ? t.assets.blockedReason : t.assets.notActivatedReason
  if (!a.phone_no) return t.assets.phoneMissingReason
  if (!d.employeeId) return t.assets.chooseEmployeeReason
  if (!d.givenDate) return t.assets.givenDateReason
  if (d.givenDate > today) return t.assets.dateInFuture
  const cents = parseEuro(d.value)
  if (a.plan === null && !d.plan.trim()) return t.assets.planReason
  if (a.non_return_value_cents === null && (cents === null || Number.isNaN(cents))) return t.assets.valueReason
  if (!printed || printed.key !== formKey(d)) return t.assets.printFirstReason
  if (!signed) return t.assets.tickSignedReason
  return null
}

/**
 * The blocking request to copy into the user's own e-mail (§14), in the
 * brief's English, which the providers read. Nothing is sent from the app.
 * The company's name is not in Settings yet (spec, open decision 3): the
 * placeholder stays for the user to replace.
 */
export function blockingEmail(a: Pick<Asset, 'phone_no' | 'sim_no'>, company = '[Company Name]'): { subject: string; body: string } {
  const phone = a.phone_no ?? '[Phone Number]'
  return {
    subject: `SIM blocking request - ${phone}`,
    body: [
      'Hello,',
      '',
      'Please block the following SIM card:',
      '',
      `Phone number: ${phone}`,
      `SIM number: ${a.sim_no ?? ''}`,
      `Company: ${company}`,
      '',
      'Please confirm once the SIM card has been blocked.',
      '',
      'Thank you.',
    ].join('\n'),
  }
}
