/**
 * A document's printed fields (VIZ), taken from an OCR reading only as far as the MRZ vouches
 * for them (docs-scan plan DS-14, as phase 2 found: web/spikes/viz). Pure: the OCR's lines and
 * the MRZ's facts in, the fields out.
 *
 * - Names: a run of words whose letters, folded the ICAO way (@ppe/mrz fold), are the MRZ's
 *   name field. The MRZ has no accents, so the printed run gives them; but the OCR drops an
 *   accent as surely as it reads one (EGLĖ read as EGLE), which folding cannot see, so a name
 *   is only offered, with the box of its printed line, for the user to compare and confirm.
 * - Date of issue: a printed date between the birth and expiry the MRZ gives, taken only when
 *   the expiry is 5 or 10 years after it (a day either way).
 * Place of birth and authority are not read: the line under their label is too often the
 * wrong one (two columns, a value that wraps); they are typed.
 */
import { fold } from '@ppe/mrz'

import { titleCase } from './flow.ts'

export interface PrintedWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}
export interface PrintedLine {
  words: PrintedWord[]
}

/** A box in the page's pixels. */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A name as printed, title-cased with its accents, and where it is on the page. */
export interface PrintedName {
  value: string
  box: Box
}

export interface PrintedFields {
  surname?: PrintedName
  givenNames?: PrintedName
  /** YYYY-MM-DD. */
  issuedOn?: string
}

/** What the MRZ says, for the printed text to be checked against. */
export interface MrzFacts {
  /** As @ppe/mrz parses them: the MRZ's letters, words apart by spaces. */
  surname: string
  givenNames: string
  /** YYYY-MM-DD. */
  birthDate?: string | undefined
  expiryDate?: string | undefined
  /** The name field was full, so the names may be cut short. */
  namesFull: boolean
}

const NAME_WORD = /^[\p{L}][\p{L}'’‐-]*$/u
const CYRILLIC = /\p{Script=Cyrillic}/u
const mrzForm = (s: string) => s.trim().replace(/\s+/g, '<')

function matches(run: string, field: string, full: boolean): boolean {
  const want = mrzForm(field)
  return want !== '' && fold(run).some((f) => f === want || (full && f.length > want.length && f.startsWith(want)))
}

interface Run {
  text: string
  box: Box
  cyrillic: boolean
}

/** Every run of name-like words in a line, cut at a '/' (bilingual lines: ВОЛКОВ / VOLKOV). */
function runsOf(line: PrintedLine): Run[] {
  const parts: PrintedWord[][] = [[]]
  for (const w of line.words) {
    for (const [i, piece] of w.text.split('/').entries()) {
      if (i > 0) parts.push([])
      if (piece) parts.at(-1)!.push({ ...w, text: piece })
    }
  }
  const out: Run[] = []
  for (const words of parts) {
    for (let a = 0; a < words.length; a++) {
      for (let b = a; b < words.length; b++) {
        if (!NAME_WORD.test(words[b]!.text)) break
        const ws = words.slice(a, b + 1)
        const text = ws.map((w) => w.text).join(' ')
        const box = { x0: Math.min(...ws.map((w) => w.x0)), y0: Math.min(...ws.map((w) => w.y0)), x1: Math.max(...ws.map((w) => w.x1)), y1: Math.max(...ws.map((w) => w.y1)) }
        out.push({ text, box, cyrillic: CYRILLIC.test(text) })
      }
    }
  }
  return out
}

function findName(lines: readonly PrintedLine[], field: string, full: boolean): PrintedName | undefined {
  const found = lines.flatMap(runsOf).filter((r) => matches(r.text, field, full))
  // Latin before Cyrillic (the app keeps the Latin form), then the longer run.
  found.sort((x, y) => Number(x.cyrillic) - Number(y.cyrillic) || y.text.length - x.text.length)
  const best = found[0]
  return best ? { value: titleCase(best.text), box: best.box } : undefined
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Every date the text prints, as YYYY-MM-DD: 15.05.2031, 15 05 2031, 15 MAY 2031, 2031-05-15. */
export function datesIn(text: string): string[] {
  const out: string[] = []
  const push = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d))
    if (y > 1900 && y < 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d) out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  for (const m of text.matchAll(/(?<!\d)(\d{2})[.\s]{1,2}(\d{2})[.\s]{1,2}(\d{4})(?!\d)/g)) push(Number(m[3]), Number(m[2]), Number(m[1]))
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) push(Number(m[1]), Number(m[2]), Number(m[3]))
  for (const m of text.matchAll(/(?<!\d)(\d{2})\s+([A-Z]{3})[A-Z/]*\s+(\d{4})(?!\d)/gi)) {
    const month = MONTHS.indexOf(m[2]!.toUpperCase()) + 1
    if (month > 0) push(Number(m[3]), month, Number(m[1]))
  }
  return out
}

const yearsBefore = (from: string, to: string, years: number) => {
  const f = new Date(`${from}T00:00:00Z`)
  f.setUTCFullYear(f.getUTCFullYear() + years)
  return Math.abs(Date.parse(`${to}T00:00:00Z`) - f.getTime()) <= 86_400_000
}

function findIssued(text: string, m: MrzFacts): string | undefined {
  if (!m.birthDate || !m.expiryDate) return undefined
  const sure = [...new Set(datesIn(text))].filter(
    (d) => d > m.birthDate! && d < m.expiryDate! && (yearsBefore(d, m.expiryDate!, 5) || yearsBefore(d, m.expiryDate!, 10)),
  )
  return sure.length === 1 ? sure[0] : undefined
}

/** The printed fields the MRZ vouches for. The MRZ's own lines are left out (they hold '<<'). */
export function readPrinted(all: readonly PrintedLine[], m: MrzFacts): PrintedFields {
  const lines = all.filter((l) => !l.words.some((w) => w.text.includes('<<')))
  const text = lines.map((l) => l.words.map((w) => w.text).join(' ')).join('\n')
  const out: PrintedFields = {}
  const surname = findName(lines, m.surname, m.namesFull)
  const givenNames = m.givenNames ? findName(lines, m.givenNames, m.namesFull) : undefined
  const issuedOn = findIssued(text, m)
  if (surname) out.surname = surname
  if (givenNames) out.givenNames = givenNames
  if (issuedOn) out.issuedOn = issuedOn
  return out
}
