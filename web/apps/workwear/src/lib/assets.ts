/**
 * Company Assets' rules for the SIM card register, as pure functions: the
 * tabs and filters as one query, where a card is, and Add SIM's and
 * Edit's checks (docs/specs/asset-service.md). Screens only wire events.
 */
import type { Asset, AssetAssignment, AssetCategory, AssetInput, AssetKind, AssetQuery, AssetSort, AssignmentFormInput, ConnectionStatus, CreateAssetInput, InventoryPrefix } from '@ppe/api-client'
import { isoDay } from '@ppe/ui/lib/dates'

import { t } from '@/i18n'
import { parseEuro } from '@/lib/utils'

export const ASSET_PAGE_SIZE = 50

/**
 * Where the register looks: every card, those in the office, those someone
 * holds (whereabouts known or not: the With Employees tab) or those whose
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

/** A dashboard's summary tile: the filters it sets, which open the register on its tab. */
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

/** How many filters under the phone's Filters button are set: not the tabs or the search, which are in sight. */
export function filterCount(f: AssetFilters): number {
  return [f.provider, f.category, f.signedCopyMissing].filter(Boolean).length
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

/**
 * Each register's row of tabs, with counts, in place of tiles: All, on SIM
 * Cards each status, then In Office, With Employees (whereabouts known or
 * not) and Not Returned. A tab sets the status or the place and clears the
 * other, so one is chosen at a time; the search, provider, category and
 * documents stay. The Location filter still keeps the status (Office +
 * Blocked, §3), and a dashboard's tile link opens the screen on its tab.
 */
export type AssetTab = 'all' | ConnectionStatus | 'inOffice' | 'withEmployees' | 'notReturned'

/** Equipment has no connection status, so its tabs are All and the places. */
export function assetTabs(kind: AssetKind): AssetTab[] {
  return kind === 'SIM' ? ['all', 'NOT_ACTIVATED', 'ACTIVE', 'BLOCKED', 'inOffice', 'withEmployees', 'notReturned'] : ['all', 'inOffice', 'withEmployees', 'notReturned']
}

export function chooseTab(f: AssetFilters, tab: AssetTab): AssetFilters {
  const cleared: AssetFilters = { ...f, status: '', place: 'all', notReturned: false }
  if (tab === 'all') return cleared
  if (tab === 'inOffice') return { ...cleared, place: 'office' }
  if (tab === 'withEmployees') return { ...cleared, place: 'held' }
  if (tab === 'notReturned') return { ...cleared, notReturned: true }
  return { ...cleared, status: tab }
}

export function tabPressed(f: AssetFilters, tab: AssetTab): boolean {
  if (tab === 'all') return f.status === '' && f.place === 'all' && !f.notReturned
  if (tab === 'inOffice') return f.place === 'office' && !f.notReturned
  if (tab === 'withEmployees') return f.place === 'held' && !f.notReturned
  if (tab === 'notReturned') return f.notReturned
  return f.status === tab
}

/** The tabs a count is asked for; the rest follow from them (tabCounts). */
export function countedTabs(kind: AssetKind): AssetTab[] {
  return kind === 'SIM' ? ['NOT_ACTIVATED', 'ACTIVE', 'BLOCKED', 'inOffice', 'notReturned'] : ['all', 'inOffice', 'notReturned']
}

/** The query counting what tab would list: choosing it, then one row, as only the total is read. */
export function tabCountQuery(kind: AssetKind, f: AssetFilters, tab: AssetTab): AssetQuery {
  return { ...assetQuery(kind, chooseTab(f, tab), 'inventory', 'asc', 1), page_size: 1 }
}

/**
 * Every tab's count from those asked: every SIM has a status, so its All is
 * the three added up; an asset is either in the office or held, so With
 * Employees is All less In Office.
 */
export function tabCounts(n: Partial<Record<AssetTab, number>>): Partial<Record<AssetTab, number>> {
  const all = n.all ?? (n.NOT_ACTIVATED ?? 0) + (n.ACTIVE ?? 0) + (n.BLOCKED ?? 0)
  return { ...n, all, withEmployees: all - (n.inOffice ?? 0) }
}

/** What a SIM's copy button in the register puts on the clipboard: SIM: <SIM No.> | Phone: <Phone No.>, the phone left out until known. */
export function simCopyText(a: Pick<Asset, 'sim_no' | 'phone_no'>): string {
  return t.assets.simCopyText(a.sim_no ?? '', a.phone_no)
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

/** Where the card is, without who holds it (SIM Cards' Location column, beside its Employee). */
export function locationText(a: Pick<Asset, 'location'>): string {
  return a.location === 'OFFICE' ? t.assets.office : a.location === 'UNKNOWN' ? t.assets.unknown : t.assets.withAnEmployee
}

/** Today in timeZone, YYYY-MM-DD: the latest date a card can have been received or given. */
export function todayIn(timeZone: string | undefined, now = new Date()): string {
  return isoDay(now, timeZone)
}

/** Add SIM's and Edit's fields, as typed. */
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

/** Add SIM starts with the default provider, Non-return Value and plan (Settings), when there are. */
export function emptySimDraft(today: string, provider = '', valueCents: number | null = null, plan = ''): SimDraft {
  const value = valueCents === null ? '' : (valueCents / 100).toFixed(2)
  return { simNo: '', phoneNo: '', provider, plan, value, receivedDate: today, inventoryNo: '', status: 'NOT_ACTIVATED', comment: '' }
}

/**
 * The providers Add SIM and Edit offer: the ones listed on Settings, and a
 * card's own provider when it is no longer listed, so Edit keeps it.
 */
export function providerOptions(listed: readonly string[], current?: string | null): string[] {
  const own = current?.trim()
  return own && !listed.includes(own) ? [...listed, own] : [...listed]
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

/** Add SIM's request: the details, the kind and the status chosen. */
export function newSimInput(input: AssetInput, status: SimDraft['status']): CreateAssetInput {
  return { ...input, kind: 'SIM', connection_status: status }
}

/** A calendar date (YYYY-MM-DD) as every date is written in the language in use (2026.03.02 in Lithuanian). */
export { formatDay } from '@ppe/ui/lib/dates'

/**
 * The one action a card's state calls for (§3: "situacijai tinkami
 * veiksmai"): Return while someone holds it, Give SIM when
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

/** Give SIM's form, as typed. Plan and value are asked only when the card lacks them (§6); the plan may stay empty. */
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

/** Give SIM starts with the default plan (Settings), when there is one; formInput sends it only for a card without a plan. */
export function emptyGiveDraft(today: string, plan = ''): GiveDraft {
  return { assetId: '', employeeId: '', employeeName: '', givenDate: today, plan, value: '', comment: '' }
}

/** What the form prints: the fields that change its content, as one comparable key. */
export function formKey(d: GiveDraft): string {
  return JSON.stringify([d.assetId, d.employeeId, d.givenDate, d.plan.trim(), d.value.trim()])
}

/**
 * A form printed for Give SIM, kept on this device per user: Safari may reload
 * the page while the print tab is in front, and the sheet then forgets what
 * was printed, so the paper in hand could never be ticked as signed. Opening
 * Give again on the same card brings back the details and the printed mark
 * (the API still refuses a form the card has changed since). One per card,
 * for a day; Give and Sign out drop them.
 */
export interface PrintedForm {
  key: string
  hash: string
  draft: GiveDraft
  /** When it was printed, ms since the epoch. */
  at: number
}

const PRINTED_PREFIX = 'workwear.printedForms.v1.'
const PRINTED_FOR_MS = 86_400_000

function readPrinted(userId: string, storage: Storage | undefined, now: number): Record<string, PrintedForm> {
  try {
    const all = JSON.parse(storage?.getItem(PRINTED_PREFIX + userId) ?? '{}') as Record<string, PrintedForm>
    return Object.fromEntries(Object.entries(all).filter(([, f]) => typeof f?.key === 'string' && typeof f.hash === 'string' && now - f.at < PRINTED_FOR_MS))
  } catch {
    return {}
  }
}

function writePrinted(userId: string, all: Record<string, PrintedForm>, storage: Storage | undefined): void {
  try {
    if (Object.keys(all).length === 0) storage?.removeItem(PRINTED_PREFIX + userId)
    else storage?.setItem(PRINTED_PREFIX + userId, JSON.stringify(all))
  } catch {
    // Storage unavailable (private mode, quota): a reload asks for the form to be printed again.
  }
}

export function rememberPrinted(userId: string, form: PrintedForm, storage: Storage | undefined = globalThis.localStorage): void {
  writePrinted(userId, { ...readPrinted(userId, storage, form.at), [form.draft.assetId]: form }, storage)
}

/** The card's form printed within the day, or null. */
export function recallPrinted(userId: string, assetId: string, now = Date.now(), storage: Storage | undefined = globalThis.localStorage): PrintedForm | null {
  return readPrinted(userId, storage, now)[assetId] ?? null
}

export function forgetPrinted(userId: string, assetId: string, now = Date.now(), storage: Storage | undefined = globalThis.localStorage): void {
  const all = readPrinted(userId, storage, now)
  delete all[assetId]
  writePrinted(userId, all, storage)
}

/** Sign out forgets every form the user printed here. */
export function forgetAllPrinted(userId: string, storage: Storage | undefined = globalThis.localStorage): void {
  writePrinted(userId, {}, storage)
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
 * Why Give SIM cannot be done yet, the first reason only, shown by the
 * button (§6: the reason at the field or button), or null when it can. A
 * card someone holds or one not Active cannot be given from this form at
 * all; the rest the form itself fixes. A card without a phone number yet can
 * be given: the form leaves the number blank.
 */
export function giveBlock(
  a: Pick<Asset, 'kind' | 'needs_form' | 'open_assignment' | 'connection_status' | 'plan' | 'non_return_value_cents'> | null,
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
  }
  if (!d.employeeId) return t.assets.chooseEmployeeReason
  if (!d.givenDate) return t.assets.givenDateReason
  if (d.givenDate > today) return t.assets.dateInFuture
  const cents = parseEuro(d.value)
  if (a.needs_form && a.non_return_value_cents === null && (cents === null || Number.isNaN(cents))) return t.assets.valueReason
  // Furniture and other items need no signed form (spec, open decision 6).
  if (!a.needs_form) return null
  if (!printed || printed.key !== formKey(d)) return t.assets.printFirstReason
  if (!signed) return t.assets.tickSignedReason
  return null
}

/**
 * Why a card in the office cannot be chosen on Give SIM from the
 * employee's page, or null: the picker shows every office card with its
 * status, and greys out these (§6).
 */
export function cardBlock(a: Pick<Asset, 'kind' | 'connection_status'>): string | null {
  if (a.kind === 'EQUIPMENT') return null
  if (a.connection_status === 'NOT_ACTIVATED') return t.assets.statuses.NOT_ACTIVATED
  if (a.connection_status === 'BLOCKED') return t.assets.statuses.BLOCKED
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
      'Please block the following SIM:',
      '',
      `Phone number: ${phone}`,
      `SIM number: ${a.sim_no ?? ''}`,
      `Company: ${company}`,
      '',
      'Please confirm once the SIM has been blocked.',
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
