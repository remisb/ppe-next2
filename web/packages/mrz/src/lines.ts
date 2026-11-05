/**
 * From OCR text to MRZ lines (docs-import plan §5.2, step 5): the text's
 * look-alikes of `<` made fillers, spaces dropped, the 2 or 3 lines of the
 * expected length picked, and a line that is a filler or two short or long
 * fitted, where the check digits then say which fitting is right.
 *
 * OCR of long filler runs (`<<<<<<<<`) often drops or adds one; a missing
 * filler inside the second line moves every check digit after it, so the
 * line is fitted by putting a filler back into each run in turn and keeping
 * the one fitting under which every check digit passes, and only if exactly
 * one does.
 */
import { FORMATS, formatOf, parseMrz, type Mrz, type MrzFormat, type ParseOptions } from './mrz.ts'

/** The characters OCR gives for a filler, besides `<` itself. */
const FILLER_LOOKALIKES = /[«‹〈＜‹(\[{]/g

/** One line of OCR text in MRZ characters: capitals, digits and `<`. */
export function cleanLine(s: string): string {
  return s
    .toUpperCase()
    .replace(FILLER_LOOKALIKES, '<')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9<]/g, '')
}

/** How far a line's length may be from the format's for it to be fitted. */
const SLACK = 2

export interface Candidate {
  format: MrzFormat
  /** The lines as they were in the text, cleaned but not fitted. */
  lines: string[]
}

/**
 * The groups of lines in text that could be an MRZ: consecutive lines whose
 * lengths are within SLACK of a format's, the bottom-most group first (the
 * MRZ is at the bottom of the page or card).
 */
export function candidatesIn(text: string): Candidate[] {
  const lines = text.split(/\r?\n/).map(cleanLine).filter((l) => l.length >= 10)
  const found: Candidate[] = []
  for (const [format, shape] of Object.entries(FORMATS) as [MrzFormat, { lines: number; length: number }][]) {
    for (let i = lines.length - shape.lines; i >= 0; i--) {
      const group = lines.slice(i, i + shape.lines)
      if (group.every((l) => Math.abs(l.length - shape.length) <= SLACK)) found.push({ format, lines: group })
    }
  }
  // Bottom-most first; a 30-character pair is also a TD2 near miss, so the fuller match wins.
  return found.sort((a, b) => distance(a) - distance(b))
}

function distance(c: Candidate): number {
  const len = FORMATS[c.format].length
  return c.lines.reduce((s, l) => s + Math.abs(l.length - len), 0)
}

/**
 * Every way to make line exactly length long: fillers put into its filler
 * runs (or at its end) when it is short; when it is long, fillers taken out
 * of its runs or its first or last character dropped (a mark at the band's
 * edge), and with anywhere, one character too long, any one character
 * dropped (OCR read one that is not there). anywhere is a last resort:
 * dropping a character inside the document number lines the rest up again,
 * and the number's one check digit passes about one such reading in ten.
 */
export function fittings(line: string, length: number, anywhere = false): string[] {
  const d = length - line.length
  if (d === 0) return [line]
  if (Math.abs(d) > SLACK) return []
  const out = new Set<string>()
  const go = (s: string, left: number) => {
    if (left === 0) {
      out.add(s)
      return
    }
    const runs = [...s.matchAll(/<+/g)].map((m) => m.index! + m[0].length)
    if (left > 0) {
      for (const at of new Set([...runs, s.length])) go(s.slice(0, at) + '<' + s.slice(at), left - 1)
      return
    }
    const cuts = new Set([...runs.map((r) => r - 1), 0, s.length - 1])
    if (anywhere && d === -1) for (let i = 0; i < s.length; i++) cuts.add(i)
    for (const at of cuts) go(s.slice(0, at) + s.slice(at + 1), left + 1)
  }
  go(line, d)
  return [...out]
}

/** A name line's fittings: padded or cut at its end, or (too long) its first character dropped first. */
function nameFittings(line: string, length: number): string[] {
  if (line.length <= length) return [line.padEnd(length, '<')]
  return [...new Set([line.slice(0, length), line.slice(1, length + 1)])]
}

/** The most fittings of a whole MRZ tried. */
const MAX_FITTINGS = 512

export interface ReadResult {
  /** The MRZ, when one was found: valid or not (its problems say why). */
  mrz?: Mrz
  /** The lines were fitted (a filler put back or taken out, a stray character dropped) before parsing. */
  fitted: boolean
}

/**
 * The MRZ in OCR text. Lines of the right length are parsed as they are.
 * Otherwise each line is fitted (fittings), and a fitting is taken only
 * when every check digit passes under it and no other fitting of the
 * checked lines does too; the name line, under no check digit, takes the
 * fitting with the fewest problems (a known issuing state), its plain end
 * cut first. Without such a fitting, the plainest reading is returned with
 * its problems, for the review screen to show.
 */
export function readMrz(text: string, options: ParseOptions): ReadResult {
  for (const c of candidatesIn(text)) {
    const len = FORMATS[c.format].length
    const nameLine = c.format === 'TD1' ? 2 : 0
    if (formatOf(c.lines)) {
      const mrz = parseMrz(c.lines, options)
      if (mrz) return { mrz, fitted: false }
      continue
    }
    const checkedLines = (m: Mrz) => m.lines.filter((_, i) => i !== nameLine).join('\n')
    let plain: string[] | undefined
    // The likelier fittings first; a later tier only when the earlier gave nothing.
    for (const anywhere of [false, true]) {
      const choices = c.lines.map((l, i) => (i === nameLine ? nameFittings(l, len) : fittings(l, len, anywhere)))
      if (choices.some((o) => o.length === 0)) break
      const combos = cartesian(choices).slice(0, MAX_FITTINGS)
      plain ??= combos[0]
      const passing = combos.map((ls) => parseMrz(ls, options)).filter((m): m is Mrz => !!m && allChecksPass(m))
      if (passing.length === 0) continue
      // Fittings that pass every cross-check too (a known nationality…) before those that do not.
      const valid = passing.filter((m) => m.valid)
      const pool = valid.length > 0 ? valid : passing
      if (new Set(pool.map(checkedLines)).size > 1) break
      const mrz = pool.reduce((a, b) => (b.problems.length < a.problems.length ? b : a))
      // A fitting that moved the document number's characters rests on its one check digit (the
      // composite weighs them as it does): like a look-alike search, it needs a second read.
      const [line, from, to] = c.format === 'TD1' ? [0, 5, 15] : [1, 0, 10]
      const moved = c.lines[line]!.slice(from, to) !== mrz.lines[line]!.slice(from, to) && cleanNumber(c.lines[line]!, from, to) !== cleanNumber(mrz.lines[line]!, from, to)
      return { mrz: moved && mrz.valid ? { ...mrz, needsSecondRead: true } : mrz, fitted: true }
    }
    const mrz = plain && parseMrz(plain, options)
    if (mrz) return { mrz, fitted: false }
  }
  return { fitted: false }
}

/** The number's characters with look-alikes made digits: a fitting that only corrected one did not move the number. */
function cleanNumber(line: string, from: number, to: number): string {
  return line.slice(from, to).replace(/O/g, '0').replace(/I/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2')
}

function allChecksPass(m: Mrz): boolean {
  return Object.values(m.checks).every(Boolean)
}

function cartesian(options: string[][]): string[][] {
  return options.reduce<string[][]>((acc, o) => acc.flatMap((a) => o.map((x) => [...a, x])), [[]])
}
