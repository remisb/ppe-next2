/**
 * Company Assets' rules for the SIM card register, as pure functions: the
 * tiles and filters as one query, where a card is, and Add SIM Card's and
 * Edit's checks (docs/specs/asset-service.md). Screens only wire events.
 */
import type { Asset, AssetAssignment, AssetCategory, AssetInput, AssetKind, AssetQuery, AssetSort, AssignmentFormInput, ConnectionStatus, CreateAssetInput, InventoryPrefix } from '@ppe/api-client'
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
  /** Equipment only. */
  category: AssetCategory | ''
  /** Held on a form whose signed copy is not uploaded yet (§9). */
  signedCopyMissing: boolean
  q: string
}

export const noAssetFilters: AssetFilters = { place: 'all', notReturned: false, status: '', provider: '', category: '', signedCopyMissing: false, q: '' }

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
  return [f.status, f.provider, f.category, f.signedCopyMissing].filter(Boolean).length
}

/** The register's query: kind's assets matching f, sorted, one page. Unset filters are left out. */
export function assetQuery(kind: AssetKind, f: AssetFilters, sort: AssetSort, dir: 'asc' | 'desc', page: number): AssetQuery {
  const q = f.q.trim()
  return {
    kind,
    ...(q ? { q } : {}),
    ...(f.place === 'office' ? { location: 'OFFICE' as const } : {}),
    ...(f.place === 'unknown' ? { location: 'UNKNOWN' as const } : {}),
    ...(f.place === 'held' ? { held: true } : {}),
    ...(f.notReturned ? { not_returned: true } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.signedCopyMissing ? { signed_copy: 'missing' as const } : {}),
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

/** Add SIM Card starts with the default provider, when there is one. */
export function emptySimDraft(today: string, provider = ''): SimDraft {
  return { simNo: '', phoneNo: '', provider, plan: '', value: '', receivedDate: today, inventoryNo: '', status: 'NOT_ACTIVATED', comment: '' }
}

/** Whether provider is the default one: Add SIM Card's "Default for new cards" as the provider is typed. */
export function isDefaultProvider(provider: string, current: string | null | undefined): boolean {
  return !!current && provider.trim() === current
}

/**
 * The default provider Add SIM Card saves with the card: the typed provider
 * when "Default for new cards" is ticked, '' (none) when the default one is
 * unticked, undefined when the default stays as it is.
 */
export function defaultProviderChange(provider: string, makeDefault: boolean, current: string | null | undefined): string | undefined {
  const typed = provider.trim()
  if (makeDefault) return typed && typed !== current ? typed : undefined
  return isDefaultProvider(typed, current) ? '' : undefined
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

export function primaryAction(a: Pick<Asset, 'kind' | 'open_assignment' | 'connection_status'>): PrimaryAction {
  if (a.open_assignment) return 'return'
  // Equipment has no connection status: in the office it can always be given.
  return a.kind === 'EQUIPMENT' || a.connection_status === 'ACTIVE' ? 'give' : 'status'
}

/** Mark as Not Returned is for a held card not yet marked; the mark is set once. */
export function canMarkNotReturned(a: Pick<Asset, 'open_assignment'>): boolean {
  return a.open_assignment !== null && a.open_assignment.not_returned_at === null
}

/** Give SIM Card's form, as typed. Plan and value are asked only when the card lacks them (§6). */
export interface GiveDraft {
  /** The card chosen, when Give starts from the employee; the card's own id when it starts from the card. */
  assetId: string
  employeeId: string
  employeeName: string
  givenDate: string
  plan: string
  value: string
  comment: string
}

export function emptyGiveDraft(today: string): GiveDraft {
  return { assetId: '', employeeId: '', employeeName: '', givenDate: today, plan: '', value: '', comment: '' }
}

/** What the form prints: the fields that change its content, as one comparable key. */
export function formKey(d: GiveDraft): string {
  return JSON.stringify([d.assetId, d.employeeId, d.givenDate, d.plan.trim(), d.value.trim()])
}

/** The form's inputs to send: the card's own plan and value stay its own; only missing ones are filled in. Only a SIM card has a plan. */
export function formInput(a: Pick<Asset, 'kind' | 'plan' | 'non_return_value_cents'>, d: GiveDraft): AssignmentFormInput {
  const cents = parseEuro(d.value)
  return {
    employee_id: d.employeeId,
    given_date: d.givenDate,
    ...(a.kind === 'SIM' && a.plan === null && d.plan.trim() ? { plan: d.plan.trim() } : {}),
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
  a: Pick<Asset, 'kind' | 'needs_form' | 'open_assignment' | 'connection_status' | 'phone_no' | 'plan' | 'non_return_value_cents'> | null,
  d: GiveDraft,
  today: string,
  printed: { key: string } | null,
  signed: boolean,
  kind: AssetKind = 'SIM',
): string | null {
  if (!a) return kind === 'SIM' ? t.assets.chooseCardReason : t.assets.chooseItemReason
  if (a.open_assignment) return t.assets.alreadyGivenReason
  if (a.kind === 'SIM') {
    if (a.connection_status !== 'ACTIVE') return a.connection_status === 'BLOCKED' ? t.assets.blockedReason : t.assets.notActivatedReason
    if (!a.phone_no) return t.assets.phoneMissingReason
  }
  if (!d.employeeId) return t.assets.chooseEmployeeReason
  if (!d.givenDate) return t.assets.givenDateReason
  if (d.givenDate > today) return t.assets.dateInFuture
  const cents = parseEuro(d.value)
  if (a.kind === 'SIM' && a.plan === null && !d.plan.trim()) return t.assets.planReason
  if (a.needs_form && a.non_return_value_cents === null && (cents === null || Number.isNaN(cents))) return t.assets.valueReason
  // Furniture and other items need no signed form (spec, open decision 6).
  if (!a.needs_form) return null
  if (!printed || printed.key !== formKey(d)) return t.assets.printFirstReason
  if (!signed) return t.assets.tickSignedReason
  return null
}

/**
 * Why a card in the office cannot be chosen on Give SIM Card from the
 * employee's page, or null: the picker shows every office card with its
 * status, and greys out these (§6).
 */
export function cardBlock(a: Pick<Asset, 'kind' | 'connection_status' | 'phone_no'>): string | null {
  if (a.kind === 'EQUIPMENT') return null
  if (a.connection_status === 'NOT_ACTIVATED') return t.assets.statuses.NOT_ACTIVATED
  if (a.connection_status === 'BLOCKED') return t.assets.statuses.BLOCKED
  if (!a.phone_no) return t.assets.noPhoneNo
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

/**
 * Whether ⌘K should look a search up among the cards' numbers: three digits
 * or more (a SIM, phone or inventory number, typed with or without spaces),
 * or an inventory number's prefix ("SIM-", "sim 12").
 */
export function looksLikeAssetNumber(q: string): boolean {
  const s = q.trim()
  return /\d{3,}/.test(s.replace(/[\s()+-]/g, '')) || /^sim[\s-]?\d/i.test(s)
}

/** The inventory number prefix of an equipment category (§16). */
export const categoryPrefix: Record<AssetCategory, InventoryPrefix> = { COMPUTER: 'PC', PHONE: 'PH', EXTERNAL_DRIVE: 'DRV', FURNITURE: 'FUR', OTHER: 'AST' }

export const categories: AssetCategory[] = ['COMPUTER', 'PHONE', 'EXTERNAL_DRIVE', 'FURNITURE', 'OTHER']

/** An equipment category in the language in use. */
export function categoryLabel(c: AssetCategory): string {
  return t.assets.categories[c]
}

/** Add Asset's and Edit's fields for equipment and furniture, as typed (§15). */
export interface EquipmentDraft {
  name: string
  category: AssetCategory | ''
  inventoryNo: string
  serialNo: string
  value: string
  comment: string
}

export function emptyEquipmentDraft(): EquipmentDraft {
  return { name: '', category: '', inventoryNo: '', serialNo: '', value: '', comment: '' }
}

export function equipmentDraftOf(a: Asset): EquipmentDraft {
  return {
    name: a.name ?? '',
    category: a.category ?? '',
    inventoryNo: a.inventory_no,
    serialNo: a.serial_no ?? '',
    value: a.non_return_value_cents != null ? (a.non_return_value_cents / 100).toFixed(2) : '',
    comment: a.comment,
  }
}

export type EquipmentErrors = Partial<Record<keyof EquipmentDraft, string>>

/** The draft's problems as the API would refuse it, and the details to send when there are none. */
export function checkEquipmentDraft(d: EquipmentDraft): { errors: EquipmentErrors; input?: AssetInput } {
  const errors: EquipmentErrors = {}
  if (!d.name.trim()) errors.name = t.assets.required
  if (!d.category) errors.category = t.assets.required
  if (!d.inventoryNo.trim()) errors.inventoryNo = t.assets.required
  const cents = parseEuro(d.value)
  if (Number.isNaN(cents) || (cents !== null && cents < 0)) errors.value = t.assets.valueInvalid
  if (Object.keys(errors).length > 0 || !d.category) return { errors }
  return {
    errors,
    input: {
      category: d.category,
      inventory_no: d.inventoryNo.trim(),
      name: d.name.trim(),
      serial_no: d.serialNo.trim() || null,
      non_return_value_cents: cents,
      comment: d.comment.trim(),
    },
  }
}

/** The largest signed copy the API takes. */
export const MAX_SIGNED_COPY_BYTES = 10 * 1024 * 1024

/** What Upload Signed Form's file picker offers: a scan (PDF) or a photo (JPEG, PNG). */
export const SIGNED_COPY_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

/**
 * Why a file chosen for Upload Signed Form is not sent, or null. The API reads
 * the file's own bytes again; this saves sending 10 MB to be told so.
 */
export function signedCopyProblem(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size === 0) return t.assets.fileEmpty
  if (file.size > MAX_SIGNED_COPY_BYTES) return t.assets.fileTooLarge
  const known = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name)
  return known ? null : t.assets.fileType
}

/** An upload the API refused, in the user's language: the file's type or size, or no storage set up; else null. */
export function uploadRefusal(status: number): string | null {
  switch (status) {
    case 413:
      return t.assets.fileTooLarge
    case 415:
      return t.assets.fileType
    case 503:
      return t.assets.noStorage
  }
  return null
}

/** The Documents a holding shows: none for an item given without a form, else whether its signed copy is in. */
export function documentsText(a: Pick<AssetAssignment, 'paper_form_signed' | 'signed_copy_uploaded'> | null | undefined): string | null {
  if (!a?.paper_form_signed) return null
  return a.signed_copy_uploaded ? t.assets.signedCopyUploaded : t.assets.signedCopyMissing
}
