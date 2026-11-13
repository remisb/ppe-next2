/**
 * Scan Document's rules, as a pure reducer and functions: one person's
 * document photographed page by page, each photo flattened (its corners
 * found, a perspective transform) and read again, then kept as an archive on
 * the server for a few days, or handed to Import to Personnel. Pictures are
 * the screen's PictureStore's (blob URLs must be revoked, which a reducer may
 * not do): every action that lets a picture go puts it in `released`, and the
 * screen forgets them and says so (`released` again), as Scan SIMs' list does.
 */
import type { IdentityDocumentKind } from '@ppe/api-client'
import type { PhotoReading, Turn } from '@ppe/mrz/reader'
import type { Quad } from '@ppe/scan-kit/perspective'

import { kindOf, namesFromMrz, type DocType } from './flow'

/** The most pages one archive holds (the API's limit too). */
export const MAX_PAGES = 10

/** One photo and the page made from it. */
export interface ScanPage {
  /** The photo's picture key, as taken. */
  source: string
  status: 'working' | 'done' | 'failed'
  /** The flattened page's picture key, once made. */
  page?: string
  /** Degrees clockwise the photo is turned before its corners are taken. */
  turn: Turn
  /** The page's corners, in the turned photo's pixels. */
  corners?: Quad
  /** The turned photo's size. */
  size?: { width: number; height: number }
  /** How sure the corners are (0–1); unsure pages say Check corners. */
  confidence: number
  /** The flattened page's MRZ reading, when it has one. */
  reading?: PhotoReading
}

/** What names the archive: the person and the document's kind and number. */
export interface Details {
  surname: string
  givenNames: string
  kind: IdentityDocumentKind
  number: string
}

export interface ScanBatch {
  pages: ScanPage[]
  /** What the user typed over what was read; the reading fills the rest. */
  typed: Partial<Details>
  /** Said once photos were more than MAX_PAGES; cleared by the next photos or Clear. */
  notice: 'too_many' | null
  /** Picture ids no page shows any more, for the screen to forget. */
  released: string[]
}

export type ScanAction =
  /** Photos chosen, their pictures kept under these keys: as many as there is room for become pages. */
  | { type: 'add'; sources: readonly string[] }
  /** A page made again (Turn, Adjust Corners): it works until done or failed. */
  | { type: 'working'; source: string; turn?: Turn }
  | {
      type: 'done'
      source: string
      page: string
      turn: Turn
      corners: Quad
      size: { width: number; height: number }
      confidence: number
      reading?: PhotoReading
    }
  | { type: 'failed'; source: string }
  | { type: 'remove'; source: string }
  | { type: 'typed'; details: Partial<Details> }
  | { type: 'clear' }
  | { type: 'released'; ids: readonly string[] }

export const emptyBatch: ScanBatch = { pages: [], typed: {}, notice: null, released: [] }

const picturesOf = (p: ScanPage) => (p.page ? [p.source, p.page] : [p.source])

export function scanBatch(state: ScanBatch, action: ScanAction): ScanBatch {
  switch (action.type) {
    case 'add': {
      const room = Math.max(0, MAX_PAGES - state.pages.length)
      const kept = action.sources.slice(0, room)
      const dropped = action.sources.slice(room)
      return {
        ...state,
        pages: [...state.pages, ...kept.map((source): ScanPage => ({ source, status: 'working', turn: 0, confidence: 0 }))],
        notice: dropped.length > 0 ? 'too_many' : null,
        released: [...state.released, ...dropped],
      }
    }
    case 'working':
      return {
        ...state,
        pages: state.pages.map((p) => (p.source === action.source ? { ...p, status: 'working', ...(action.turn === undefined ? {} : { turn: action.turn }) } : p)),
      }
    case 'done': {
      const old = state.pages.find((p) => p.source === action.source)
      // A page removed while it was made: its new picture goes at once.
      if (!old) return { ...state, released: [...state.released, action.page] }
      const { type: _, ...made } = action
      const page: ScanPage = { ...old, ...made, status: 'done' }
      if (!action.reading) delete page.reading
      return {
        ...state,
        pages: state.pages.map((p) => (p.source === action.source ? page : p)),
        released: old.page && old.page !== action.page ? [...state.released, old.page] : state.released,
      }
    }
    case 'failed':
      return { ...state, pages: state.pages.map((p) => (p.source === action.source ? { ...p, status: 'failed' } : p)) }
    case 'remove': {
      const page = state.pages.find((p) => p.source === action.source)
      if (!page) return state
      return { ...state, pages: state.pages.filter((p) => p !== page), released: [...state.released, ...picturesOf(page)] }
    }
    case 'typed':
      return { ...state, typed: { ...state.typed, ...action.details } }
    case 'clear':
      return { ...emptyBatch, released: [...state.released, ...state.pages.flatMap(picturesOf)] }
    case 'released': {
      const gone = new Set(action.ids)
      return { ...state, released: state.released.filter((id) => !gone.has(id)) }
    }
  }
}

/**
 * The page whose reading names the document: one both reads agreed on, else
 * one that reads valid, else any with an MRZ read, for the user to put right.
 */
export function readPageOf(pages: readonly ScanPage[]): ScanPage | undefined {
  const done = pages.filter((p) => p.status === 'done' && p.reading?.mrz)
  return done.find((p) => p.reading!.agreed) ?? done.find((p) => p.reading!.mrz!.valid) ?? done[0]
}

/** The archive's details: what the user typed, else what was read, else blank. */
export function detailsOf(batch: Pick<ScanBatch, 'pages' | 'typed'>): Details {
  const m = readPageOf(batch.pages)?.reading?.mrz
  const read: Details = m
    ? { ...namesFromMrz(m), kind: kindOf(m), number: m.documentNumber }
    : { surname: '', givenNames: '', kind: 'passport', number: '' }
  return { ...read, ...batch.typed }
}

/** Whether what names the archive was read and agreed: else it says Check this. */
export function detailsAgreed(pages: readonly ScanPage[]): boolean {
  return readPageOf(pages)?.reading?.agreed === true
}

/** Import to Personnel's document type for a kind. */
export const docTypeOf = (kind: IdentityDocumentKind): DocType => (kind === 'passport' ? 'passport' : 'card')

/**
 * A name part as the API writes it in the file name (scan.go's fileWord):
 * letters (diacritics kept), digits and hyphens; spaces as one underscore;
 * anything else left out.
 */
function filePart(s: string): string {
  return s
    .trim()
    .replace(/[\s_]+/gu, ' ')
    .replace(/[^\p{L}\p{N}\- ]/gu, '')
    .trim()
    .replace(/ +/g, '_')
}

const KIND_WORDS: Record<IdentityDocumentKind, string> = { passport: 'passport', id_card: 'id-card', residence_permit: 'residence-permit' }

/** The archive's file name as the API gives it: Surname_Given_Names_passport.zip (shown before it is kept). */
export function archiveName(d: Details): string {
  const parts = [filePart(d.surname), filePart(d.givenNames), KIND_WORDS[d.kind]].filter((p) => p !== '')
  return `${parts.join('_')}.zip`
}

/** What stops Download Archive and Save to Personnel, each said on the screen. */
export type ScanBlocker = 'no_pages' | 'working' | 'surname'

export function scanBlockers(batch: Pick<ScanBatch, 'pages' | 'typed'>): ScanBlocker[] {
  const done = batch.pages.filter((p) => p.status === 'done')
  if (done.length === 0) return ['no_pages']
  const out: ScanBlocker[] = []
  if (batch.pages.some((p) => p.status === 'working')) out.push('working')
  if (detailsOf(batch).surname.trim() === '') out.push('surname')
  return out
}

/** Whether the batch holds work not yet kept or handed over: leaving asks first. */
export const unsavedWork = (batch: Pick<ScanBatch, 'pages'>, kept: boolean): boolean => batch.pages.length > 0 && !kept
