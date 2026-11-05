/**
 * The MRZ parser (ICAO Doc 9303 Parts 4–6): TD1 (3 × 30, ID cards), TD2
 * (2 × 36) and TD3 (2 × 44, passports), their fields, check digits and the
 * deterministic look-alike corrections of FR-5 (docs-import plan §4.1).
 *
 * The lines it takes are already the right shape (lines.ts makes them so
 * from OCR text). Every rule here has a twin in the Go API's parser, and both
 * read testdata/mrz/vectors.json, so the two cannot drift apart (NFR-7).
 *
 * Nothing read is ever put into an Error or a message: problems and notes
 * are codes with a field's name.
 */
import { checkDigit, checkDigitPasses } from './check-digit.ts'
import { mrzDate } from './dates.ts'
import { ltPersonalCode, type LtPersonalCode } from './lt-personal-code.ts'
import { isKnownState, SPECIMEN_STATE } from './states.ts'

export type MrzFormat = 'TD1' | 'TD2' | 'TD3'

/** Each format's lines and their length. */
export const FORMATS: Record<MrzFormat, { lines: number; length: number }> = {
  TD1: { lines: 3, length: 30 },
  TD2: { lines: 2, length: 36 },
  TD3: { lines: 2, length: 44 },
}

export type FieldName =
  | 'documentCode'
  | 'issuingState'
  | 'documentNumber'
  | 'documentNumberCheck'
  | 'optionalData1'
  | 'birthDate'
  | 'birthDateCheck'
  | 'sex'
  | 'expiryDate'
  | 'expiryDateCheck'
  | 'nationality'
  | 'optionalData2'
  | 'personalNumber'
  | 'personalNumberCheck'
  | 'compositeCheck'
  | 'names'

/** The fields a check digit protects, and the composite over them. */
export type CheckedField = 'documentNumber' | 'birthDate' | 'expiryDate' | 'personalNumber' | 'composite'

/** Where a field lies, for underlining it in the review's MRZ (FR-7): line and columns, end exclusive. */
export interface Span {
  field: FieldName
  line: number
  start: number
  end: number
}

export type ProblemCode =
  | 'check_digit'
  | 'ambiguous_correction'
  | 'invalid_character'
  | 'invalid_date'
  | 'invalid_sex'
  | 'unknown_state'
  | 'no_surname'
  | 'names_unreadable'
  | 'expiry_before_birth'
  | 'birth_in_future'
  | 'unsupported_document'
  | 'personal_code_checksum'
  | 'personal_code_birth_date'
  | 'personal_code_sex'

export type NoteCode = 'expired' | 'specimen' | 'incomplete_date' | 'corrected'

/** A problem stops Save; a note is shown. Codes, never values. */
export interface Issue<C extends string> {
  code: C
  field?: FieldName | CheckedField
}

/**
 * A field the parser changed, and what decided it:
 *
 * - `layout`: the character could not be there (a letter in a date or check
 *   digit, a digit in a name or state code, `K` among the fillers), so its
 *   look-alike is the only reading. Dates are then confirmed by two
 *   independent check digits, their own and the composite.
 * - `lookalike`: a number's field (document number, personal number) where
 *   letters and digits are both allowed, so FR-5's search chose the one
 *   combination of look-alikes that makes its check digit pass. Its only
 *   confirmation is that one digit: the composite adds none, as a number's
 *   characters carry the same weights in it as in their own field (they
 *   start at a multiple of three in it). Such a reading needs a second,
 *   agreeing read before it is accepted (Mrz.needsSecondRead).
 */
export interface Correction {
  field: FieldName
  by: 'layout' | 'lookalike'
}

export interface Mrz {
  format: MrzFormat
  /** The lines as read, with the corrections applied. */
  lines: string[]
  /** `P`, `I`, `ID`, `AC`…: the fillers removed. */
  documentCode: string
  issuingState: string
  documentNumber: string
  nationality: string
  /** ISO dates; undefined when the MRZ's is not a whole date. */
  birthDate: string | undefined
  expiryDate: string | undefined
  sex: 'M' | 'F' | 'X' | undefined
  /** As in the MRZ: capitals, fillers as spaces. */
  surname: string
  givenNames: string
  /** The name field itself, fillers kept (for nameMatch). */
  nameField: string
  /** Optional data, fillers removed: TD1 two fields, TD2 one, TD3 the personal number. */
  optionalData: string[]
  /** The Lithuanian personal code, when the document is Lithuanian and carries one. */
  personalCode?: { code: string } & LtPersonalCode
  checks: Partial<Record<CheckedField, boolean>>
  corrections: Correction[]
  problems: Issue<ProblemCode>[]
  notes: Issue<NoteCode>[]
  spans: Span[]
  /** No problems: every check digit passes and every cross-check agrees. */
  valid: boolean
  /**
   * The document number's reading rests on its one check digit alone: a
   * look-alike search chose it (Correction `lookalike`), or readMrz's
   * fitting moved its characters. Accept it only when a second read (the
   * next live frame, or the photo read again another way) gives the same
   * lines. (Any reading is safer read twice; this one must be.)
   */
  needsSecondRead: boolean
}

export interface ParseOptions {
  /** Today, ISO (YYYY-MM-DD): the century rules and "expired" depend on it. */
  today: string
  /**
   * Whether look-alikes in a number's field (document number, personal
   * number) are swapped to make its check digit pass (FR-5). On by default.
   * For measuring what the corrections cost (docs-import plan, phase 1).
   */
  numberCorrections?: boolean
}

/** The format these lines' shape is, or undefined. */
export function formatOf(lines: readonly string[]): MrzFormat | undefined {
  for (const [f, s] of Object.entries(FORMATS) as [MrzFormat, { lines: number; length: number }][]) {
    if (lines.length === s.lines && lines.every((l) => l.length === s.length)) return f
  }
  return undefined
}

type Class = 'digit' | 'alpha' | 'alnum'
type Pos = readonly [line: number, col: number]

interface FieldDef {
  field: FieldName
  line: number
  start: number
  end: number
  cls: Class
}

const f = (field: FieldName, line: number, start: number, end: number, cls: Class): FieldDef => ({ field, line, start, end, cls })

const LAYOUT: Record<MrzFormat, FieldDef[]> = {
  TD1: [
    f('documentCode', 0, 0, 2, 'alpha'),
    f('issuingState', 0, 2, 5, 'alpha'),
    f('documentNumber', 0, 5, 14, 'alnum'),
    f('documentNumberCheck', 0, 14, 15, 'digit'),
    f('optionalData1', 0, 15, 30, 'alnum'),
    f('birthDate', 1, 0, 6, 'digit'),
    f('birthDateCheck', 1, 6, 7, 'digit'),
    f('sex', 1, 7, 8, 'alpha'),
    f('expiryDate', 1, 8, 14, 'digit'),
    f('expiryDateCheck', 1, 14, 15, 'digit'),
    f('nationality', 1, 15, 18, 'alpha'),
    f('optionalData2', 1, 18, 29, 'alnum'),
    f('compositeCheck', 1, 29, 30, 'digit'),
    f('names', 2, 0, 30, 'alpha'),
  ],
  TD2: [
    f('documentCode', 0, 0, 2, 'alpha'),
    f('issuingState', 0, 2, 5, 'alpha'),
    f('names', 0, 5, 36, 'alpha'),
    f('documentNumber', 1, 0, 9, 'alnum'),
    f('documentNumberCheck', 1, 9, 10, 'digit'),
    f('nationality', 1, 10, 13, 'alpha'),
    f('birthDate', 1, 13, 19, 'digit'),
    f('birthDateCheck', 1, 19, 20, 'digit'),
    f('sex', 1, 20, 21, 'alpha'),
    f('expiryDate', 1, 21, 27, 'digit'),
    f('expiryDateCheck', 1, 27, 28, 'digit'),
    f('optionalData2', 1, 28, 35, 'alnum'),
    f('compositeCheck', 1, 35, 36, 'digit'),
  ],
  TD3: [
    f('documentCode', 0, 0, 2, 'alpha'),
    f('issuingState', 0, 2, 5, 'alpha'),
    f('names', 0, 5, 44, 'alpha'),
    f('documentNumber', 1, 0, 9, 'alnum'),
    f('documentNumberCheck', 1, 9, 10, 'digit'),
    f('nationality', 1, 10, 13, 'alpha'),
    f('birthDate', 1, 13, 19, 'digit'),
    f('birthDateCheck', 1, 19, 20, 'digit'),
    f('sex', 1, 20, 21, 'alpha'),
    f('expiryDate', 1, 21, 27, 'digit'),
    f('expiryDateCheck', 1, 27, 28, 'digit'),
    f('personalNumber', 1, 28, 42, 'alnum'),
    f('personalNumberCheck', 1, 42, 43, 'digit'),
    f('compositeCheck', 1, 43, 44, 'digit'),
  ],
}

/** The parts of the lines the composite check digit covers (ICAO 9303 Parts 4–6). */
const COMPOSITE: Record<MrzFormat, { line: number; start: number; end: number }[]> = {
  TD1: [
    { line: 0, start: 5, end: 30 },
    { line: 1, start: 0, end: 7 },
    { line: 1, start: 8, end: 15 },
    { line: 1, start: 18, end: 29 },
  ],
  TD2: [
    { line: 1, start: 0, end: 10 },
    { line: 1, start: 13, end: 20 },
    { line: 1, start: 21, end: 35 },
  ],
  TD3: [
    { line: 1, start: 0, end: 10 },
    { line: 1, start: 13, end: 20 },
    { line: 1, start: 21, end: 43 },
  ],
}

/** FR-5's look-alikes: what a letter in a digit's place stands for, and back. */
const TO_DIGIT: Record<string, string> = { O: '0', I: '1', B: '8', S: '5', Z: '2' }
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '8': 'B', '5': 'S', '2': 'Z' }
/** Each look-alike's other reading, both ways. K and < are left out: no check digit tells them apart (check-digit.ts). */
const SWAP: Record<string, string> = { ...TO_DIGIT, ...TO_LETTER }

/** The most combinations of look-alikes tried in one field (FR-5). */
export const MAX_TRIES_PER_FIELD = 64
/** The most combinations of the failing fields' candidates the composite is asked about. */
const MAX_COMPOSITE_TRIES = 256

/** A field a check digit protects: where its characters are and where its digit is. */
interface Checked {
  name: Exclude<CheckedField, 'composite'>
  field: FieldName
  value: Pos[]
  check: Pos
  cls: Class
  /** The personal number's digit may be `<` when the field is all fillers. */
  fillerAllowed?: boolean
}

/**
 * Parses lines of the right shape (formatOf), applying FR-5's corrections.
 * Undefined when the shape is no format's or a line holds a character an
 * MRZ never does (lines.ts removes those first).
 */
export function parseMrz(input: readonly string[], options: ParseOptions): Mrz | undefined {
  const format = formatOf(input)
  if (!format || !input.every((l) => /^[A-Z0-9<]*$/.test(l))) return undefined
  const grid = input.map((l) => [...l])
  const at = ([l, c]: Pos) => grid[l]![c]!
  const set = ([l, c]: Pos, ch: string) => {
    grid[l]![c] = ch
  }
  const layout = LAYOUT[format]
  const def = (name: FieldName) => layout.find((d) => d.field === name)!
  const positions = (d: { line: number; start: number; end: number }): Pos[] =>
    Array.from({ length: d.end - d.start }, (_, i) => [d.line, d.start + i] as const)
  const text = (ps: readonly Pos[]) => ps.map(at).join('')

  // 1. What the layout alone decides: a letter where only a digit may be, a
  // digit where only a letter may be, and K among the fillers.
  for (const d of layout) {
    for (const p of positions(d)) {
      const c = at(p)
      if (d.cls === 'digit' && TO_DIGIT[c]) set(p, TO_DIGIT[c])
      if (d.cls === 'digit' && c === 'K' && d.field.endsWith('Check')) set(p, '<')
      if (d.cls === 'alpha' && TO_LETTER[c]) set(p, TO_LETTER[c])
    }
  }
  fillerTail(positions(def('names')), at, set)
  for (const name of ['documentNumber', 'optionalData1', 'optionalData2', 'personalNumber'] as const) {
    const d = layout.find((x) => x.field === name)
    if (d) kAmongFillers(positions(d), at, set)
  }

  // 2. The checked fields, with a long document number (over 9 characters)
  // continued in the optional data (TD1 and TD2: its digit's place is `<`).
  const checked: Checked[] = []
  const spans: Span[] = layout.map(({ field, line, start, end }) => ({ field, line, start, end }))
  const docDef = def('documentNumber')
  const docCheck = def('documentNumberCheck')
  const optDef = format === 'TD1' ? def('optionalData1') : format === 'TD2' ? def('optionalData2') : undefined
  let docValue = positions(docDef)
  let docCheckPos: Pos = [docCheck.line, docCheck.start]
  if (optDef && at(docCheckPos) === '<' && at([optDef.line, optDef.start]) !== '<') {
    const opt = positions(optDef)
    const end = opt.findIndex((p) => at(p) === '<')
    const rest = end === -1 ? opt : opt.slice(0, end)
    if (rest.length >= 2) {
      docValue = [...docValue, ...rest.slice(0, -1)]
      docCheckPos = rest.at(-1)!
      // The spans say where the number and its digit really are: the first
      // digit's place is a filler that belongs to the number.
      const at0 = optDef.start
      spans.find((s) => s.field === 'documentNumberCheck')!.field = 'documentNumber'
      spans.find((s) => s.field === optDef.field)!.start = at0 + rest.length
      spans.push({ field: 'documentNumber', line: optDef.line, start: at0, end: at0 + rest.length - 1 })
      spans.push({ field: 'documentNumberCheck', line: optDef.line, start: at0 + rest.length - 1, end: at0 + rest.length })
    }
  }
  checked.push({ name: 'documentNumber', field: 'documentNumber', value: docValue, check: docCheckPos, cls: 'alnum' })
  const bd = def('birthDate')
  checked.push({ name: 'birthDate', field: 'birthDate', value: positions(bd), check: [bd.line, bd.end], cls: 'digit' })
  const ed = def('expiryDate')
  checked.push({ name: 'expiryDate', field: 'expiryDate', value: positions(ed), check: [ed.line, ed.end], cls: 'digit' })
  if (format === 'TD3') {
    const pn = def('personalNumber')
    checked.push({ name: 'personalNumber', field: 'personalNumber', value: positions(pn), check: [pn.line, pn.end], cls: 'alnum', fillerAllowed: true })
  }
  const compositeCheck: Pos = [def('compositeCheck').line, def('compositeCheck').start]
  const compositeParts = COMPOSITE[format].flatMap(positions)

  const passes = (c: Checked) => {
    const digit = at(c.check)
    const value = text(c.value)
    if (c.fillerAllowed && /^<*$/.test(value)) return digit === '<' || digit === '0'
    return checkDigitPasses(value, digit)
  }
  const compositePasses = () => checkDigitPasses(text(compositeParts), at(compositeCheck))

  // 3. FR-5: a failing field's look-alikes are tried in every combination (a
  // few at most); a combination is taken only when it makes the field's
  // digit and the composite pass, and only if no other combination does too.
  const failing = checked.filter((c) => !passes(c))
  let ambiguous: CheckedField | undefined
  const searched = new Set<FieldName>()
  if (failing.length > 0) {
    const choices = failing.map((c) => (options.numberCorrections === false ? [] : candidates(c, at, set, passes)))
    if (choices.every((o) => o.length > 0) && choices.reduce((n, o) => n * o.length, 1) <= MAX_COMPOSITE_TRIES) {
      const original = failing.map((c) => text(c.value))
      const fits: string[][] = []
      for (const combo of product(choices)) {
        failing.forEach((c, i) => write(c.value, combo[i]!, set))
        if (compositePasses()) fits.push(combo)
      }
      failing.forEach((c, i) => write(c.value, original[i]!, set))
      if (fits.length === 1) {
        failing.forEach((c, i) => {
          if (fits[0]![i] !== original[i]) searched.add(c.field)
          write(c.value, fits[0]![i]!, set)
        })
      }
      else if (fits.length > 1) ambiguous = failing.find((_, i) => new Set(fits.map((x) => x[i])).size > 1)?.name
    }
  }

  // 4. The fields' values and what is wrong with them.
  const lines = grid.map((l) => l.join(''))
  const problems: Issue<ProblemCode>[] = []
  const notes: Issue<NoteCode>[] = []
  const field = (name: FieldName) => {
    const d = def(name)
    return lines[d.line]!.slice(d.start, d.end)
  }
  const trim = (s: string) => s.replace(/<+$/, '').replace(/^<+/, '')

  const checks: Partial<Record<CheckedField, boolean>> = {}
  for (const c of checked) {
    checks[c.name] = passes(c)
    if (!checks[c.name]) problems.push({ code: 'check_digit', field: c.name })
  }
  checks.composite = compositePasses()
  if (!checks.composite) problems.push({ code: 'check_digit', field: 'composite' })
  if (ambiguous) problems.push({ code: 'ambiguous_correction', field: ambiguous })

  for (const d of layout) {
    const s = field(d.field)
    const ok =
      d.cls === 'digit' ? /^[0-9<]*$/.test(s) : d.cls === 'alpha' ? /^[A-Z<]*$/.test(s) : /^[A-Z0-9<]*$/.test(s)
    if (!ok) problems.push({ code: 'invalid_character', field: d.field })
  }

  const documentCode = trim(field('documentCode'))
  if (documentCode.startsWith('V')) problems.push({ code: 'unsupported_document', field: 'documentCode' })
  const issuingState = trim(field('issuingState'))
  const nationality = trim(field('nationality'))
  for (const [name, code] of [
    ['issuingState', issuingState],
    ['nationality', nationality],
  ] as const) {
    if (!isKnownState(code)) problems.push({ code: 'unknown_state', field: name })
  }
  if (issuingState === SPECIMEN_STATE || nationality === SPECIMEN_STATE) notes.push({ code: 'specimen' })

  const today = options.today
  const birthRaw = field('birthDate')
  const expiryRaw = field('expiryDate')
  const birthDate = mrzDate(birthRaw, 'birth', today)
  const expiryDate = mrzDate(expiryRaw, 'expiry', today)
  if (!birthDate) {
    if (/^\d{2}[\d<]{4}$/.test(birthRaw) && birthRaw.includes('<')) notes.push({ code: 'incomplete_date', field: 'birthDate' })
    else problems.push({ code: 'invalid_date', field: 'birthDate' })
  }
  if (!expiryDate) problems.push({ code: 'invalid_date', field: 'expiryDate' })
  if (birthDate && birthDate > today) problems.push({ code: 'birth_in_future', field: 'birthDate' })
  if (birthDate && expiryDate && expiryDate <= birthDate) problems.push({ code: 'expiry_before_birth', field: 'expiryDate' })
  if (expiryDate && expiryDate < today) notes.push({ code: 'expired', field: 'expiryDate' })

  const sexChar = field('sex')
  const sex = sexChar === 'M' ? 'M' : sexChar === 'F' ? 'F' : sexChar === '<' || sexChar === 'X' ? 'X' : undefined
  if (!sex) problems.push({ code: 'invalid_sex', field: 'sex' })

  const nameField = field('names')
  const [surnamePart = '', ...givenParts] = nameField.replace(/<+$/, '').split('<<')
  const surname = surnamePart.replace(/</g, ' ').trim()
  const givenNames = givenParts.join(' ').replace(/</g, ' ').replace(/\s+/g, ' ').trim()
  if (!surname) problems.push({ code: 'no_surname', field: 'names' })
  // No check digit covers the names, so their shape is all that tells a misread: a letter three
  // times running (fillers read as L or C), name parts parted by more than `<<`, or a filler first
  // (a stray mark before the line moved it).
  else if (/([A-Z])\1\1/.test(nameField) || /[A-Z]<{3,}[A-Z]/.test(nameField) || nameField.startsWith('<'))
    problems.push({ code: 'names_unreadable', field: 'names' })

  const documentNumber = text(docValue).replace(/<+$/, '')
  const optionalData =
    format === 'TD1'
      ? [trim(spanText(lines, spans, 'optionalData1')), trim(field('optionalData2'))]
      : format === 'TD2'
        ? [trim(spanText(lines, spans, 'optionalData2'))]
        : [trim(field('personalNumber'))]

  // FR-6: a Lithuanian document's personal code agrees with its birth date and sex.
  let personalCode: Mrz['personalCode']
  if (issuingState === 'LTU') {
    const code = optionalData.map((s) => s.replace(/</g, '')).find((s) => /^\d{11}$/.test(s))
    const lt = code ? ltPersonalCode(code) : undefined
    if (code && lt) {
      personalCode = { code, ...lt }
      if (!lt.valid) problems.push({ code: 'personal_code_checksum', field: format === 'TD3' ? 'personalNumber' : 'optionalData1' })
      else {
        if (lt.birthDate && birthDate && lt.birthDate !== birthDate) problems.push({ code: 'personal_code_birth_date', field: 'birthDate' })
        if (lt.sex && sex && sex !== 'X' && lt.sex !== sex) problems.push({ code: 'personal_code_sex', field: 'sex' })
      }
    }
  }

  // What was changed, and what decided it.
  const corrections: Correction[] = []
  for (const s of spans) {
    const changed = positions(s).some(([l, c]) => lines[l]![c] !== input[l]![c])
    if (!changed || corrections.some((x) => x.field === s.field)) continue
    corrections.push({ field: s.field, by: searched.has(s.field) ? 'lookalike' : 'layout' })
  }
  for (const c of corrections) notes.push({ code: 'corrected', field: c.field })
  const valid = problems.length === 0

  return {
    format,
    lines,
    documentCode,
    issuingState,
    documentNumber,
    nationality,
    birthDate,
    expiryDate,
    sex,
    surname,
    givenNames,
    nameField,
    optionalData,
    ...(personalCode ? { personalCode } : {}),
    checks,
    corrections,
    problems,
    notes,
    spans,
    valid,
    needsSecondRead: valid && searched.size > 0,
  }
}

function spanText(lines: string[], spans: Span[], field: FieldName): string {
  const s = spans.find((x) => x.field === field)!
  return lines[s.line]!.slice(s.start, s.end)
}

function write(ps: readonly Pos[], value: string, set: (p: Pos, c: string) => void) {
  ps.forEach((p, i) => set(p, value[i]!))
}

/**
 * A failing field's other readings that pass its own check digit: each
 * look-alike swapped, fewest swaps first, at most MAX_TRIES_PER_FIELD
 * readings tried. A digit field has none to try (its letters were swapped
 * already, being impossible there).
 */
function candidates(
  c: Checked,
  at: (p: Pos) => string,
  set: (p: Pos, ch: string) => void,
  passes: (c: Checked) => boolean,
): string[] {
  if (c.cls !== 'alnum') return []
  const original = c.value.map(at).join('')
  const swappable = c.value.map((p, i) => (SWAP[at(p)] ? i : -1)).filter((i) => i >= 0)
  const found: string[] = []
  let tries = 0
  // Subsets of the swappable places by size: one swap, then two…
  outer: for (let k = 1; k <= swappable.length; k++) {
    for (const subset of combinations(swappable, k)) {
      if (++tries > MAX_TRIES_PER_FIELD) break outer
      const chars = [...original]
      for (const i of subset) chars[i] = SWAP[chars[i]!]!
      write(c.value, chars.join(''), set)
      if (passes(c)) found.push(chars.join(''))
    }
  }
  write(c.value, original, set)
  return found
}

function* combinations<T>(items: readonly T[], k: number, from = 0): Generator<T[]> {
  if (k === 0) {
    yield []
    return
  }
  for (let i = from; i <= items.length - k; i++) {
    for (const rest of combinations(items, k - 1, i + 1)) yield [items[i]!, ...rest]
  }
}

function* product(options: readonly string[][]): Generator<string[]> {
  if (options.length === 0) {
    yield []
    return
  }
  const [first, ...rest] = options
  for (const x of first!) for (const tail of product(rest)) yield [x, ...tail]
}

/**
 * In the name field, a run of three or more fillers can only be the padding
 * (names are parted by `<` and `<<`), so whatever follows it is a filler
 * misread: `K`, `C`, `E`, `L`… become `<`.
 */
function fillerTail(ps: Pos[], at: (p: Pos) => string, set: (p: Pos, c: string) => void) {
  const s = ps.map(at).join('')
  const i = s.indexOf('<<<')
  if (i === -1) return
  for (let j = i; j < ps.length; j++) if (at(ps[j]!) !== '<') set(ps[j]!, '<')
}

/**
 * In a number's field, a `K` in the trailing run of fillers (a run that
 * starts with `<` and holds nothing but `<` and `K`) is a misread filler:
 * a number never resumes after its padding. A `K` right after the number
 * stays; no check digit can say whether it is one (check-digit.ts).
 */
function kAmongFillers(ps: Pos[], at: (p: Pos) => string, set: (p: Pos, c: string) => void) {
  const s = ps.map(at).join('')
  const m = /<[<K]*$/.exec(s)
  if (!m) return
  for (let j = m.index; j < ps.length; j++) if (at(ps[j]!) === 'K') set(ps[j]!, '<')
}

/** The check digit a field's text should have; for building specimens and test vectors. */
export function checkDigitOf(s: string): string {
  const d = checkDigit(s)
  if (d === undefined) throw new Error('not MRZ characters')
  return String(d)
}
