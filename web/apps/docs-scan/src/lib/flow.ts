/**
 * Scan Documents' rules, as pure functions (docs/apps/docs-scan-plan.md; the reading's own
 * rules are @ppe/id-docs' and @ppe/mrz's): a page's side, the scan's draft and what stops Find
 * Employee, what a kept scan says about itself, how a candidate compares with the document,
 * what the record would take from it (decision D5's ticks), and the request Save sends. The
 * screens only wire events to them; the API checks everything again.
 */
import type { DocumentCandidate, DocumentTake, IdentityDocumentInput, IdentityDocumentKind, KeptScanState, ScanMetaInput } from '@ppe/api-client'
import { kindOf, linesOf, namesFromMrz } from '@ppe/id-docs/flow'
import type { PrintedFields } from '@ppe/id-docs/printed'
import { fold, parseMrz, type Mrz } from '@ppe/mrz'

/** Where a page goes: a passport's data page, a card's back (with the MRZ) or front. */
export type Side = 'page' | 'front' | 'back'

/** A card's page with code lines is its back; one without, its front. A passport has its page. */
export const sideOf = (kind: IdentityDocumentKind, hasMrz: boolean): Side => (kind === 'passport' ? 'page' : hasMrz ? 'back' : 'front')

/** The Document Copy part each side is saved as. */
export const COPY_PART: Record<Side, 'copy_page' | 'copy_front' | 'copy_back'> = { page: 'copy_page', front: 'copy_front', back: 'copy_back' }

/** What the Details screen holds besides the pages: the lines and what the user typed. */
export interface ScanDraft {
  /** The MRZ as read, or typed (Type the MRZ). */
  lines: string
  /** As the document prints them, with their accents: the MRZ has none, so the user checks them. */
  surname: string
  givenNames: string
  /** I have compared the names with the document. */
  namesChecked: boolean
  /** Not in the MRZ: typed, optional. */
  issuedOn: string
  placeOfBirth: string
  authority: string
}

export const emptyDraft = (): ScanDraft => ({ lines: '', surname: '', givenNames: '', namesChecked: false, issuedOn: '', placeOfBirth: '', authority: '' })

/** The draft a reading starts: its lines, and its names title-cased (PAVYZDYS → Pavyzdys). */
export function draftFrom(m: Mrz | undefined): ScanDraft {
  return m ? { ...emptyDraft(), lines: m.lines.join('\n'), ...namesFromMrz(m) } : emptyDraft()
}

/** The draft's lines, parsed; undefined when they have no MRZ's shape. */
export const parseDraft = (d: ScanDraft, today: string): Mrz | undefined => parseMrz(linesOf(d.lines), { today })

/** The kind the lines say, else the camera's. */
export const kindFrom = (m: Mrz | undefined, fallback: IdentityDocumentKind): IdentityDocumentKind => (m ? kindOf(m) : fallback)

/** What stops Find Employee, each said on Details; none, and it is offered. */
export type FindBlocker = 'no_mrz' | 'problems' | 'surname' | 'names' | 'issued_on'

export function findBlockers(d: ScanDraft, m: Mrz | undefined): FindBlocker[] {
  if (!m) return ['no_mrz']
  const out: FindBlocker[] = []
  if (!m.valid) out.push('problems')
  if (d.surname.trim() === '') out.push('surname')
  else if (!d.namesChecked) out.push('names')
  if (d.issuedOn !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.issuedOn) || (m.expiryDate !== undefined && d.issuedOn > m.expiryDate))) out.push('issued_on')
  return out
}

/**
 * What a kept scan says about itself (POST /api/v1/personnel/scans): with a reading that
 * passes, its lines and names, so the API keeps it read; else nothing, and it is unread.
 */
export function keepMetaOf(kind: IdentityDocumentKind, d: ScanDraft, m: Mrz | undefined, replaces?: string): ScanMetaInput {
  const read = m?.valid === true && d.surname.trim() !== ''
  const meta: ScanMetaInput = read
    ? { surname: d.surname.trim(), given_names: d.givenNames.trim(), kind: kindOf(m), number: m.documentNumber, mrz: m.lines }
    : { surname: '', given_names: '', kind, number: '' }
  if (replaces) meta.replaces = replaces
  return meta
}

/** A tile's badge on Scans. */
export const badgeOf = (state: KeptScanState): 'saved' | 'open' | 'unread' => (state === 'saved' ? 'saved' : state === 'read' ? 'open' : 'unread')

/** How a record's value compares with the document's: the same, the same but for accents, different, or not on file. */
export type Mark = 'same' | 'accents' | 'differs' | 'none'

export function markOf(onFile: string | null | undefined, document: string | null | undefined): Mark {
  if (!onFile) return 'none'
  if (!document) return 'differs'
  const a = onFile.trim().replace(/\s+/g, ' ')
  const b = document.trim().replace(/\s+/g, ' ')
  if (a.toLocaleUpperCase('lt') === b.toLocaleUpperCase('lt')) return 'same'
  return fold(a)[0] === fold(b)[0] ? 'accents' : 'differs'
}

/** The document's names as people write them: given names, then surname. */
export const fullNameOf = (d: ScanDraft) => `${d.givenNames.trim()} ${d.surname.trim()}`.trim()

/** What the record would take from the document, field by field, and why. */
export interface Change {
  field: DocumentTake
  current: string | null
  document: string
  why: 'not_on_file' | 'accents' | 'differs'
}

/** The record as Match gives it; null fields are not on file (or, from a search, not shown). */
export type OnFile = Pick<DocumentCandidate, 'birth_date' | 'nationality' | 'sex'> & { full_name: string }

/** Only what differs is listed; what is already the same is said apart. */
export function changesOf(onFile: OnFile, d: ScanDraft, m: Mrz): { changes: Change[]; same: DocumentTake[] } {
  const changes: Change[] = []
  const same: DocumentTake[] = []
  const add = (field: DocumentTake, current: string | null, document: string | undefined) => {
    if (!document) return
    const k = markOf(current, document)
    if (k === 'same') same.push(field)
    else changes.push({ field, current, document, why: k === 'none' ? 'not_on_file' : k === 'accents' ? 'accents' : 'differs' })
  }
  add('names', onFile.full_name, fullNameOf(d))
  add('birth_date', onFile.birth_date, m.birthDate)
  add('nationality', onFile.nationality, m.nationality)
  add('sex', onFile.sex, m.sex)
  return { changes, same }
}

/** Decision D5: what the record lacks, and a name that differs only by accents, start ticked; a real difference does not. */
export const tickedAtFirst = (changes: readonly Change[]): DocumentTake[] => changes.filter((c) => c.why !== 'differs').map((c) => c.field)

/** Whom the document is saved for. */
export type Target = { kind: 'existing'; id: string } | { kind: 'new'; firstName: string; lastName: string; code: string }

/** Save's document part, naming the kept scan it was read from. */
export function saveInputOf(target: Target, d: ScanDraft, m: Mrz, addToRecord: boolean, take: readonly DocumentTake[], scanId: string): IdentityDocumentInput {
  const input: IdentityDocumentInput = {
    employee:
      target.kind === 'existing'
        ? { id: target.id }
        : { new: { first_name: target.firstName.trim(), last_name: target.lastName.trim(), ...(target.code.trim() ? { code: target.code.trim() } : {}) } },
    mrz: m.lines,
    kind: kindOf(m),
    surname: d.surname.trim(),
    given_names: d.givenNames.trim(),
    add_to_employee_record: addToRecord,
    scan_id: scanId,
  }
  if (d.issuedOn !== '') input.issued_on = d.issuedOn
  if (d.placeOfBirth.trim() !== '') input.place_of_birth = d.placeOfBirth.trim()
  if (d.authority.trim() !== '') input.authority = d.authority.trim()
  if (addToRecord) {
    // A new employee is made from the document: everything it gives goes on the record.
    const fields: DocumentTake[] = target.kind === 'new' ? ['birth_date', 'nationality', 'sex'] : [...take]
    if (fields.length > 0) input.take = fields
  }
  return input
}

/** Two candidates Merge Employees may join here: one without documents to remove. */
export function mergeable(a: DocumentCandidate, b: DocumentCandidate): { keep: string; remove: string } | null {
  if (!b.has_documents) return { keep: a.employee.id, remove: b.employee.id }
  if (!a.has_documents) return { keep: b.employee.id, remove: a.employee.id }
  return null
}

/**
 * The draft with the printed fields put in (DS-14): the names as printed, with their accents,
 * only over the MRZ's own (never over what the user typed or confirmed), and the date of issue
 * when none was typed. The names stay to be compared: the tick is the user's.
 */
export function withPrinted(d: ScanDraft, m: Mrz, p: PrintedFields): ScanDraft {
  const fromMrz = namesFromMrz(m)
  const untouched = !d.namesChecked && d.surname === fromMrz.surname && d.givenNames === fromMrz.givenNames
  return {
    ...d,
    ...(untouched && p.surname ? { surname: p.surname.value } : {}),
    ...(untouched && p.givenNames ? { givenNames: p.givenNames.value } : {}),
    ...(d.issuedOn === '' && p.issuedOn ? { issuedOn: p.issuedOn } : {}),
  }
}

