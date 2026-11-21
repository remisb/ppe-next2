/**
 * Import Documents' rules, as pure functions (docs/apps/docs-import-plan.md
 * §4.1, docs/specs/personnel-service.md): which photos a document needs, the
 * card's sides in either order, the names and kind the MRZ suggests, what
 * differs from the employee on file, what stops Save, and the request Save
 * sends. The API checks everything again; these say it at once, as the user
 * types. The screens only wire events to them.
 */
import type {
  DocumentCheck,
  DocumentTake,
  Employee,
  IdentityDocumentInput,
  IdentityDocumentKind,
} from '@ppe/api-client'
import { parseMrz, type Mrz } from '@ppe/mrz'
import type { BandPlace } from '@ppe/mrz/reader'

/** Who the document is for: an employee on file, or a new one made from it (D6). */
export type Holder = { kind: 'existing'; employee: Employee } | { kind: 'new' }

/** What is being read: a passport's data page, or a card's two sides. */
export type DocType = 'passport' | 'card'

/** A photo's place: a passport's data page, a card's back (with the MRZ) and front (with the portrait). */
export type Slot = 'page' | 'back' | 'front'

export function slotsOf(type: DocType): Slot[] {
  return type === 'passport' ? ['page'] : ['back', 'front']
}

/** One photo and what was read on it. */
export interface Photo {
  /** Its picture's key (@ppe/scan-kit's PictureStore). */
  id: string
  /** An MRZ band was found on it: a card's back. */
  found: boolean
  mrz?: Mrz
  /** Both reads gave the same valid lines (FR-4). */
  agreed: boolean
  /** Where the MRZ band is on it, which places the portrait on a passport's page. */
  band?: BandPlace
}

/** The photos by slot. */
export type Photos = Partial<Record<Slot, Photo>>

/**
 * Where a new photo goes, and the photo it replaces (whose picture goes). A
 * passport has one page. A card's photos come in either order: one with an
 * MRZ is the back, one without it the front (FR-3); a second back or front
 * replaces the first.
 */
export function placePhoto(type: DocType, cur: Photos, photo: Photo): { photos: Photos; dropped?: Photo } {
  const slot: Slot = type === 'passport' ? 'page' : photo.found ? 'back' : 'front'
  const dropped = cur[slot]
  return { photos: { ...cur, [slot]: photo }, ...(dropped ? { dropped } : {}) }
}

/** The photo whose reading the review starts from: the page, or the card's back. */
export function readPhotoOf(type: DocType, photos: Photos): Photo | undefined {
  return type === 'passport' ? photos.page : photos.back
}

/** A name as people write it, from the MRZ's capitals: PAVYZDYS → Pavyzdys, JONAS-PETRAS → Jonas-Petras. */
export function titleCase(s: string): string {
  return s
    .toLocaleLowerCase('lt')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('lt'))
}

/**
 * The names to start the review with: the MRZ's, title-cased. The MRZ has no
 * diacritics, so the user types them (Žukauskaitė, not Zukauskaite: FR-7).
 */
export function namesFromMrz(m: Mrz): { surname: string; givenNames: string } {
  return { surname: titleCase(m.surname), givenNames: titleCase(m.givenNames) }
}

/** The kind the document's code says: P a passport; a second letter R a residence permit; else an ID card. */
export function kindOf(m: Mrz): IdentityDocumentKind {
  if (m.documentCode.startsWith('P')) return 'passport'
  return m.documentCode[1] === 'R' ? 'residence_permit' : 'id_card'
}

/** The lines typed or read, as the parser takes them: capitals, no spaces, no empty lines. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => l !== '')
}

/** What the review holds besides the photos: the lines, the names and fields typed, the switches. */
export interface Draft {
  type: DocType
  /** The MRZ as in the review's text box. */
  lines: string
  surname: string
  givenNames: string
  kind: IdentityDocumentKind
  issuedOn: string
  placeOfBirth: string
  authority: string
  /** Add to Employee Record (D1), off by default. */
  addToRecord: boolean
  /** The differing fields the user chose to take onto the employee (FR-8). */
  take: DocumentTake[]
  /** The reading was agreed by two reads (FR-4). */
  agreed: boolean
  /** The user has compared the lines with the document. */
  checked: boolean
}

export function emptyDraft(type: DocType): Draft {
  return {
    type,
    lines: '',
    surname: '',
    givenNames: '',
    kind: type === 'passport' ? 'passport' : 'id_card',
    issuedOn: '',
    placeOfBirth: '',
    authority: '',
    addToRecord: false,
    take: [],
    agreed: false,
    checked: false,
  }
}

/** The review's draft from a photo's reading. */
export function draftFromReading(type: DocType, photo: Photo): Draft {
  const d = emptyDraft(type)
  if (!photo.mrz) return d
  return { ...d, lines: photo.mrz.lines.join('\n'), ...namesFromMrz(photo.mrz), kind: kindOf(photo.mrz), agreed: photo.agreed }
}

/** The draft's lines, parsed; undefined when they have no MRZ's shape. */
export function parseDraft(d: Draft, today: string): Mrz | undefined {
  return parseMrz(linesOf(d.lines), { today })
}

/** Whether the parsed reading must be compared with the document before Save (FR-4, FR-5). */
export function needsChecking(d: Draft, m: Mrz | undefined): boolean {
  return !!m && (!d.agreed || m.needsSecondRead)
}

/** A field where the document and the employee on file differ (FR-8). */
export interface Difference {
  field: DocumentTake
  current: string | null
  document: string | null
}

/**
 * What the document would change on the employee: the names as typed, and
 * the birth date, nationality and sex as read. Only differences are listed,
 * and only for an employee on file: a new one is made from the document.
 */
export function differences(holder: Holder, d: Draft, m: Mrz | undefined): Difference[] {
  if (holder.kind !== 'existing' || !m) return []
  const e = holder.employee
  const out: Difference[] = []
  const typed = `${d.givenNames.trim()} ${d.surname.trim()}`.trim()
  const onFile = `${e.first_name} ${e.last_name}`.trim()
  if (d.surname.trim() !== '' && typed !== onFile) out.push({ field: 'names', current: onFile, document: typed })
  const add = (field: DocumentTake, current: string | null, document: string | null | undefined) => {
    if (document && document !== current) out.push({ field, current, document })
  }
  add('birth_date', e.birth_date, m.birthDate)
  add('nationality', e.nationality, m.nationality)
  add('sex', e.sex, m.sex)
  return out
}

/** What stops Save, each said on the review. */
export type Blocker =
  | 'no_mrz'
  | 'problems'
  | 'surname'
  | 'given_names'
  | 'issued_on'
  | 'not_checked'
  | 'document_on_file'
  | 'other_employee'

/** The reasons Save is not offered yet; none, and Save is. */
export function blockers(holder: Holder, d: Draft, m: Mrz | undefined, check: DocumentCheck | undefined): Blocker[] {
  if (!m) return ['no_mrz']
  const out: Blocker[] = []
  if (m.problems.length > 0) out.push('problems')
  if (d.surname.trim() === '') out.push('surname')
  if (holder.kind === 'new' && d.givenNames.trim() === '') out.push('given_names')
  if (d.issuedOn !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.issuedOn) || (m.expiryDate !== undefined && d.issuedOn > m.expiryDate))) {
    out.push('issued_on')
  }
  if (needsChecking(d, m) && !d.checked) out.push('not_checked')
  if (check?.document_on_file) out.push('document_on_file')
  if (check?.other_employee) out.push('other_employee')
  return out
}

/** Save's document part (POST /api/v1/personnel/documents). */
export function saveInput(holder: Holder, d: Draft, m: Mrz): IdentityDocumentInput {
  const input: IdentityDocumentInput = {
    employee:
      holder.kind === 'existing'
        ? { id: holder.employee.id }
        : { new: { first_name: d.givenNames.trim(), last_name: d.surname.trim() } },
    mrz: m.lines,
    kind: d.kind,
    surname: d.surname.trim(),
    given_names: d.givenNames.trim(),
    add_to_employee_record: d.addToRecord,
  }
  if (d.issuedOn !== '') input.issued_on = d.issuedOn
  if (d.placeOfBirth.trim() !== '') input.place_of_birth = d.placeOfBirth.trim()
  if (d.authority.trim() !== '') input.authority = d.authority.trim()
  // A new employee is made from the document, so there is nothing to take; on file, only what differs.
  if (d.addToRecord) {
    const take = holder.kind === 'new' ? (['birth_date', 'nationality', 'sex'] as DocumentTake[]) : d.take
    if (take.length > 0) input.take = take
  }
  return input
}

/** The copies' parts for each photo slot. */
export const COPY_PARTS = { page: 'copy_page', back: 'copy_back', front: 'copy_front' } as const

/** The longest side of a Document Copy (the API's limit). */
export const COPY_MAX_SIDE = 2400

/** A document's proportions (ICAO): a passport's data page 125 × 88 mm, an ID-1 card 85.6 × 54 mm. */
const DOC_RATIO: Record<DocType, number> = { passport: 125 / 88, card: 85.6 / 54 }

/** Where the code lines are in a held document, as fractions of its height from the top. */
const BAND_TOP: Record<DocType, number> = { passport: 0.76, card: 0.66 }

/** The live view's picture: 4:3, as phones' cameras take it. */
export const VIEW_RATIO = 4 / 3

/** A box as fractions of the picture's width and height. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The guide frame over the live picture (FR-2): the document's shape, as
 * wide as fits with a margin, centred; and inside it, the band where its
 * code lines are, for the eye. The whole guide is what is read: the band is
 * found in it, as in a photo.
 */
export function guideFor(type: DocType, margin = 0.06): { guide: Box; band: Box } {
  const w = 1 - 2 * margin
  const h = Math.min(1 - 2 * margin, (w * VIEW_RATIO) / DOC_RATIO[type])
  const guide = { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
  const top = BAND_TOP[type]
  return { guide, band: { x: guide.x, y: guide.y + guide.h * top, w: guide.w, h: guide.h * (1 - top) } }
}
