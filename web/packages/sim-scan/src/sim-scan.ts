/**
 * Scan SIMs' rules, as pure functions: which barcode is the SIM No., where the
 * PIN and PUK are among the words read from a carrier's back, how photos pair
 * into cards, what the review list marks, and the batch Add sends. The API
 * checks every rule again (asset.CheckSIMs); these give the list its marks at
 * once, while the user edits.
 */
import type { ScannedSimInput, SimBatchInput, SimProblem, SimProblemCode } from '@ppe/api-client'

/** A scanned SIM No.: an ICCID, 89 and 17 more digits, with the 20-character form's filler F. */
export const SIM_NO = /^89\d{17}F?$/

/** At most this many cards go in one batch (asset.MaxScannedSIMs). */
export const MAX_CARDS = 100

const PIN = /^\d{4,8}$/
const PUK = /^\d{8}$/

/** A SIM No. as compared and sent: no spaces, in capitals. */
export function compactSimNo(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase()
}

/** The card a SIM No. names, as the register compares it: compacted, without the filler F. */
export function simKey(s: string): string {
  return compactSimNo(s).replace(/F$/, '')
}

/** Whether digits end in their Luhn check digit. */
export function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return digits.length > 0 && sum % 10 === 0
}

/** What is wrong with a SIM No. on its own, or null. */
export function simNoProblem(s: string): 'not_sim_no' | 'check_digit' | null {
  const c = compactSimNo(s)
  if (!SIM_NO.test(c)) return 'not_sim_no'
  return luhn(c.replace(/F$/, '')) ? null : 'check_digit'
}

/**
 * The SIM No. among a carrier's barcodes: the one that is an ICCID whose
 * check digit checks. The carrier's other barcode, the product code, is the
 * same on every card and never one.
 */
export function pickSimNo(barcodes: readonly string[]): string | null {
  for (const text of barcodes) {
    const c = compactSimNo(text)
    if (simNoProblem(c) === null) return c
  }
  return null
}

/** A word the text reader found, with its box in the image's pixels. */
export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A carrier's PIN and PUK, as far as they were read. */
export interface Codes {
  pin?: string
  puk?: string
}

const pinLabel = /^P[I1l|]N$/i
const pukLabel = /^P[UV]K$/i

/**
 * The PIN and PUK among the words read from a carrier's back: each the
 * number on the line of its label, after it. The reader returns the words in
 * no reliable order, so they are placed by their boxes; the customer service
 * number printed lower down is on no label's line.
 */
export function codesFromWords(words: readonly OcrWord[]): Codes {
  const out: Codes = {}
  const pin = valueBeside(words, pinLabel, PIN)
  const puk = valueBeside(words, pukLabel, PUK)
  if (pin) out.pin = pin
  if (puk) out.puk = puk
  return out
}

function valueBeside(words: readonly OcrWord[], label: RegExp, value: RegExp): string | undefined {
  let best: { text: string; gap: number } | undefined
  for (const l of words) {
    if (!label.test(l.text.trim())) continue
    const mid = (l.y0 + l.y1) / 2
    const height = Math.max(1, l.y1 - l.y0)
    for (const w of words) {
      const text = w.text.trim()
      if (!value.test(text) || w.x0 < l.x1 - height / 2) continue
      if (Math.abs((w.y0 + w.y1) / 2 - mid) > height * 0.8) continue
      const gap = w.x0 - l.x1
      if (!best || gap < best.gap) best = { text, gap }
    }
  }
  return best?.text
}

/** Which side of a carrier a picture shows: the front has the SIM No. barcode, the back the PIN and PUK. */
export type Side = 'front' | 'back' | 'unknown'

/** What was read from one picture. */
export interface PictureRead {
  /** The picture's own key, for its thumbnail. */
  id: string
  simNo: string | null
  codes: Codes
}

export function sideOf(read: PictureRead): Side {
  if (read.simNo) return 'front'
  if (read.codes.pin || read.codes.puk) return 'back'
  return 'unknown'
}

/** One card of the review list: its SIM No., PIN and PUK as read and as edited, and its pictures. */
export interface ScanCard {
  key: string
  simNo: string
  pin: string
  puk: string
  front?: string
  back?: string
  /** A picture on which nothing was read: the row asks for its number, or to be removed. */
  unread?: boolean
}

/**
 * Photos paired into cards, in the order they were chosen. Each card is one
 * front and one back; which comes first is told by the first photo read,
 * front or back, and the same order is kept. A photo on which nothing was read
 * is a row of its own; a side without its other side is a card with that side
 * alone, which the review list marks.
 */
export function pairPhotos(reads: readonly PictureRead[]): ScanCard[] {
  const firstSide = reads.map(sideOf).find((s) => s !== 'unknown')
  const lead: Side = firstSide ?? 'front'
  const follow: Side = lead === 'front' ? 'back' : 'front'
  const cards: ScanCard[] = []
  let open: ScanCard | undefined
  for (const r of reads) {
    const side = sideOf(r)
    if (side === 'unknown') {
      cards.push({ key: r.id, simNo: '', pin: '', puk: '', front: r.id, unread: true })
      continue
    }
    if (side === follow && open && !has(open, side)) {
      put(open, side, r)
      open = undefined
      continue
    }
    const card: ScanCard = { key: r.id, simNo: '', pin: '', puk: '' }
    put(card, side, r)
    cards.push(card)
    open = side === lead ? card : undefined
  }
  return cards
}

function has(card: ScanCard, side: Side): boolean {
  return side === 'front' ? card.front !== undefined : card.back !== undefined
}

function put(card: ScanCard, side: Side, r: PictureRead): void {
  if (side === 'front') {
    card.front = r.id
    card.simNo = r.simNo ?? ''
  } else {
    card.back = r.id
    card.pin = r.codes.pin ?? ''
    card.puk = r.codes.puk ?? ''
  }
}

/** A mark on a row of the review list: the API's problems and the list's own. */
export interface RowMark {
  field: 'sim_no' | 'pin' | 'puk'
  code: SimProblemCode | 'no_back' | 'no_front'
  existingId?: string
  other?: number
}

/**
 * Each row's marks, as the API would make them (registered comes from the
 * API alone) and the list's own: a card without its back (no PIN and PUK) or
 * without its front. The latter two are notes; only problems stop Add.
 */
export function rowMarks(cards: readonly ScanCard[], fromApi: readonly SimProblem[] = []): RowMark[][] {
  const marks: RowMark[][] = cards.map(() => [])
  const seen = new Map<string, number>()
  cards.forEach((c, i) => {
    const row = marks[i]!
    const problem = simNoProblem(c.simNo)
    if (problem) row.push({ field: 'sim_no', code: problem })
    if (c.simNo !== '') {
      const key = simKey(c.simNo)
      const j = seen.get(key)
      if (j === undefined) seen.set(key, i)
      else row.push({ field: 'sim_no', code: 'duplicate', other: j })
    }
    const pin = c.pin.trim()
    const puk = c.puk.trim()
    if ((pin === '') !== (puk === '')) row.push({ field: pin === '' ? 'pin' : 'puk', code: 'codes_incomplete' })
    else if (pin !== '') {
      if (!PIN.test(pin)) row.push({ field: 'pin', code: 'pin' })
      if (!PUK.test(puk)) row.push({ field: 'puk', code: 'puk' })
    } else if (c.back === undefined && !c.unread) row.push({ field: 'pin', code: 'no_back' })
    if (c.front === undefined && c.back !== undefined && c.simNo === '') row.push({ field: 'sim_no', code: 'no_front' })
  })
  for (const p of fromApi) {
    if (p.code !== 'registered') continue
    const row = marks[p.index]
    if (!row) continue
    const mark: RowMark = { field: p.field, code: p.code }
    if (p.existing_id !== undefined) mark.existingId = p.existing_id
    row.push(mark)
  }
  return marks
}

/** Whether a mark stops Add: everything but the notes on a missing side. */
export function blocks(mark: RowMark): boolean {
  return mark.code !== 'no_back' && mark.code !== 'no_front'
}

/** What the batch's cards share, chosen once at the top of Scan SIMs. */
export interface BatchSettings {
  provider: string
  plan: string
  /** Non-return Value in cents, null when left blank. */
  valueCents: number | null
  receivedDate: string
  comment: string
}

/** The batch Add and the check send: the shared settings, then each card compacted. */
export function batchRequest(settings: BatchSettings, cards: readonly ScanCard[]): SimBatchInput {
  const input: SimBatchInput = {
    provider: settings.provider.trim(),
    comment: settings.comment.trim(),
    cards: cards.map((c): ScannedSimInput => ({ sim_no: compactSimNo(c.simNo), pin: c.pin.trim(), puk: c.puk.trim() })),
  }
  if (settings.plan.trim() !== '') input.plan = settings.plan.trim()
  if (settings.valueCents !== null) input.non_return_value_cents = settings.valueCents
  if (settings.receivedDate !== '') input.received_date = settings.receivedDate
  return input
}

/**
 * Live scanning accepts a reading once it is the same twice in a row, so one
 * misread frame is never taken.
 */
export class Steady<T> {
  #last: string | undefined
  #count = 0
  readonly #needed: number
  constructor(needed = 2) {
    this.#needed = needed
  }

  /** The value, once seen needed times in a row; else null. */
  see(value: T | null, key: (v: T) => string): T | null {
    if (value === null) {
      this.#last = undefined
      this.#count = 0
      return null
    }
    const k = key(value)
    this.#count = k === this.#last ? this.#count + 1 : 1
    this.#last = k
    return this.#count >= this.#needed ? value : null
  }

  reset(): void {
    this.#last = undefined
    this.#count = 0
  }
}
