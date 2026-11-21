/**
 * The printed fields (VIZ), taken from an OCR reading only as far as the MRZ vouches for
 * them (docs-scan plan DS-14, D7). Pure: OCR lines and the MRZ's facts in, fields out.
 *
 * - Names: a run of words whose letters, folded the ICAO way (@ppe/mrz fold), are the MRZ's
 *   name field. The MRZ has no accents, so the printed run gives them. Folding cannot see an
 *   accent the OCR dropped or invented (Ž read as Z folds the same), so a run is taken
 *   ("Printed · MRZ agrees") only when every word was read with `minConf`; else it is
 *   offered to check.
 * - Date of issue: a printed date between the birth and expiry the MRZ gives; taken when
 *   the expiry is 5 or 10 years after it (a day either way), else offered to check.
 * - Place of birth and authority: the line under their label, always to check.
 */
import { fold } from '@ppe/mrz'

export interface OcrWord {
  text: string
  /** Tesseract's confidence, 0–100. */
  conf: number
  /** Each character's confidence, when the OCR gives them. */
  symbols?: { text: string; conf: number }[]
}

/** The letters Lithuanian (and its neighbours) may write with a mark: where folding hides a misread. */
const MARKABLE = /[AĄÄCČEĘĖÉIĮSŠUŲŪÜZŽOÖ]/iu

/**
 * How sure the reading of a word is where it matters: its least sure letter that could
 * carry a mark, or the word's own confidence when the OCR gives no letters.
 */
function sureness(w: OcrWord): number {
  const marked = (w.symbols ?? []).filter((s) => MARKABLE.test(s.text.normalize('NFD').charAt(0)))
  return marked.length ? Math.min(...marked.map((s) => s.conf)) : w.conf
}
export interface OcrLine {
  words: OcrWord[]
}

export interface MrzFacts {
  /** As @ppe/mrz parses them: the MRZ's letters, words apart by spaces. */
  surname: string
  givenNames: string
  /** YYYY-MM-DD. */
  birth?: string
  expiry?: string
  /** The name field was full, so the names may be cut short. */
  namesFull: boolean
}

/** Where a value came from: vouched for by the MRZ, or read and to be checked. */
export type Source = 'agrees' | 'printed' | 'check'
export interface Taken {
  value: string
  source: Source
}
export interface VizFields {
  surname?: Taken
  givenNames?: Taken
  issued?: Taken
  placeOfBirth?: Taken
  authority?: Taken
}

const LETTERS = /^[\p{L}][\p{L}'’‐-]*$/u
const CYRILLIC = /\p{Script=Cyrillic}/u
const mrzForm = (s: string) => s.trim().replace(/\s+/g, '<')

/** Whether a printed run is the MRZ's field: equal once folded, or its start when the MRZ cut it. */
function matches(run: string, field: string, full: boolean): boolean {
  const want = mrzForm(field)
  if (!want) return false
  return fold(run).some((f) => f === want || (full && f.length > want.length && f.startsWith(want)))
}

interface Run {
  text: string
  minConf: number
  cyrillic: boolean
}

/** Every run of name-like words in a line, cut at a '/' (bilingual lines: ВОЛКОВ / VOLKOV). */
function runsOf(line: OcrLine): Run[] {
  const parts: OcrWord[][] = [[]]
  for (const w of line.words) {
    for (const [i, piece] of w.text.split('/').entries()) {
      if (i > 0) parts.push([])
      if (piece) parts.at(-1)!.push({ text: piece, conf: sureness(w) })
    }
  }
  const out: Run[] = []
  for (const words of parts) {
    for (let a = 0; a < words.length; a++) {
      for (let b = a; b < words.length; b++) {
        if (!LETTERS.test(words[b]!.text)) break
        const ws = words.slice(a, b + 1)
        const text = ws.map((w) => w.text).join(' ')
        out.push({ text, minConf: Math.min(...ws.map((w) => w.conf)), cyrillic: CYRILLIC.test(text) })
      }
    }
  }
  return out
}

function findName(lines: OcrLine[], field: string, full: boolean, minConf: number): Taken | undefined {
  const found = lines.flatMap(runsOf).filter((r) => matches(r.text, field, full))
  if (found.length === 0) return undefined
  // Latin before Cyrillic (the app keeps the Latin form), then the surer reading, then the longer.
  found.sort((x, y) => Number(x.cyrillic) - Number(y.cyrillic) || y.minConf - x.minConf || y.text.length - x.text.length)
  const best = found[0]!
  return { value: best.text.toLocaleUpperCase('lt'), source: best.minConf >= minConf ? 'agrees' : 'check' }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Every date the text prints, as YYYY-MM-DD: 15.05.2031, 15 05 2031, 15 MAY 2031. */
export function datesIn(text: string): string[] {
  const out: string[] = []
  const valid = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1, d))
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
  }
  const push = (y: number, m: number, d: number) => {
    if (y > 1900 && y < 2100 && valid(y, m, d)) out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  for (const m of text.matchAll(/(?<!\d)(\d{2})[.\s]{1,2}(\d{2})[.\s]{1,2}(\d{4})(?!\d)/g)) push(Number(m[3]), Number(m[2]), Number(m[1]))
  for (const m of text.matchAll(/(?<!\d)(\d{2})\s+([A-Z]{3})[A-Z/]*\s+(\d{4})(?!\d)/gi)) {
    const month = MONTHS.indexOf(m[2]!.toUpperCase()) + 1
    if (month > 0) push(Number(m[3]), month, Number(m[1]))
  }
  return out
}

const yearsApart = (from: string, to: string, years: number) => {
  const f = new Date(`${from}T00:00:00Z`)
  f.setUTCFullYear(f.getUTCFullYear() + years)
  return Math.abs(Date.parse(`${to}T00:00:00Z`) - f.getTime()) <= 86_400_000
}

function findIssued(text: string, mrz: MrzFacts): Taken | undefined {
  if (!mrz.birth || !mrz.expiry) return undefined
  const between = [...new Set(datesIn(text))].filter((d) => d > mrz.birth! && d < mrz.expiry!)
  const sure = between.filter((d) => yearsApart(d, mrz.expiry!, 5) || yearsApart(d, mrz.expiry!, 10))
  if (sure.length === 1) return { value: sure[0]!, source: 'printed' }
  if (between.length === 1) return { value: between[0]!, source: 'check' }
  return undefined
}

const LABELS = {
  placeOfBirth: ['PLACE<OF<BIRTH', 'GIMIMO<VIETA'],
  authority: ['AUTHORITY', 'ISSUED<BY', 'ISDAVE'],
}

function underLabel(lines: OcrLine[], labels: string[]): Taken | undefined {
  for (let i = 0; i + 1 < lines.length; i++) {
    const text = lines[i]!.words.map((w) => w.text).join(' ')
    const folded = fold(text)[0] ?? ''
    if (!labels.some((l) => folded.includes(l))) continue
    const value = lines[i + 1]!.words.map((w) => w.text).join(' ').trim()
    if (value) return { value: value.toLocaleUpperCase('lt'), source: 'check' }
  }
  return undefined
}

export function readViz(lines: OcrLine[], mrz: MrzFacts, { minConf = 85 }: { minConf?: number } = {}): VizFields {
  const text = lines.map((l) => l.words.map((w) => w.text).join(' ')).join('\n')
  const out: VizFields = {}
  const surname = findName(lines, mrz.surname, mrz.namesFull, minConf)
  const givenNames = mrz.givenNames ? findName(lines, mrz.givenNames, mrz.namesFull, minConf) : undefined
  const issued = findIssued(text, mrz)
  const placeOfBirth = underLabel(lines, LABELS.placeOfBirth)
  const authority = underLabel(lines, LABELS.authority)
  if (surname) out.surname = surname
  if (givenNames) out.givenNames = givenNames
  if (issued) out.issued = issued
  if (placeOfBirth) out.placeOfBirth = placeOfBirth
  if (authority) out.authority = authority
  return out
}
