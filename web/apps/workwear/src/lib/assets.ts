/**
 * Company Assets' rules for the SIM card register, as pure functions: the
 * tiles and filters as one query, where a card is, and Add SIM Card's and
 * Edit's checks (docs/specs/asset-service.md). Screens only wire events.
 */
import type { Asset, AssetInput, AssetQuery, AssetSort, ConnectionStatus, CreateAssetInput } from '@ppe/api-client'
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
