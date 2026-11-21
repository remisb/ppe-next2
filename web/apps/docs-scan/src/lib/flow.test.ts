import type { DocumentCandidate } from '@ppe/api-client'
import { parseMrz } from '@ppe/mrz'
import { describe, expect, it } from 'vitest'

import {
  badgeOf,
  changesOf,
  draftFrom,
  emptyDraft,
  findBlockers,
  keepMetaOf,
  kindFrom,
  markOf,
  mergeable,
  parseDraft,
  saveInputOf,
  sideOf,
  tickedAtFirst,
  withPrinted,
  type ScanDraft,
} from './flow'

const today = '2026-11-21'
// testdata/mrz/vectors.json's made-up Lithuanian passport.
const passport = ['P<LTUPAVYZDYS<<JONAS<<<<<<<<<<<<<<<<<<<<<<<<', '91234567<9LTU3309243M310515733309240064<<<42']
const m = parseMrz(passport, { today })!
const checked = (d: ScanDraft): ScanDraft => ({ ...d, namesChecked: true })

describe('sides', () => {
  it('puts a card’s page with code lines on its back, the other on its front, and a passport’s on its page', () => {
    expect(sideOf('id_card', true)).toBe('back')
    expect(sideOf('residence_permit', false)).toBe('front')
    expect(sideOf('passport', false)).toBe('page')
  })
})

describe('the draft', () => {
  it('starts from the reading, its names title-cased', () => {
    const d = draftFrom(m)
    expect(d).toMatchObject({ lines: passport.join('\n'), surname: 'Pavyzdys', givenNames: 'Jonas', namesChecked: false })
    expect(parseDraft(d, today)?.documentNumber).toBe('91234567')
    expect(kindFrom(m, 'id_card')).toBe('passport')
    expect(kindFrom(undefined, 'id_card')).toBe('id_card')
  })

  it('stops Find Employee until the MRZ reads, a surname is there and the names were compared', () => {
    expect(findBlockers(emptyDraft(), undefined)).toEqual(['no_mrz'])
    expect(findBlockers(draftFrom(m), m)).toEqual(['names'])
    expect(findBlockers(checked(draftFrom(m)), m)).toEqual([])
    expect(findBlockers({ ...checked(draftFrom(m)), surname: ' ' }, m)).toEqual(['surname'])
    expect(findBlockers({ ...checked(draftFrom(m)), issuedOn: '2032-01-01' }, m)).toEqual(['issued_on'])
    const wrong = parseMrz([passport[0]!, passport[1]!.replace('3309243', '3309253')], { today })!
    expect(findBlockers(checked(draftFrom(wrong)), wrong)).toContain('problems')
  })
})

describe('a kept scan', () => {
  it('says its reading when it passes, so the API keeps it read', () => {
    expect(keepMetaOf('passport', draftFrom(m), m, 'old')).toEqual({
      surname: 'Pavyzdys', given_names: 'Jonas', kind: 'passport', number: '91234567', mrz: passport, replaces: 'old',
    })
  })
  it('says nothing about itself when its MRZ was not read', () => {
    expect(keepMetaOf('id_card', emptyDraft(), undefined)).toEqual({ surname: '', given_names: '', kind: 'id_card', number: '' })
  })
  it('wears a badge by its state', () => {
    expect([badgeOf('saved'), badgeOf('read'), badgeOf('unread')]).toEqual(['saved', 'open', 'unread'])
  })
})

describe('comparing a record with the document', () => {
  it('marks the same, the same but for accents, a difference and nothing on file', () => {
    expect(markOf('Jonas Pavyzdys', 'JONAS PAVYZDYS')).toBe('same')
    expect(markOf('Ruta Zukauskaite', 'Rūta Žukauskaitė')).toBe('accents')
    expect(markOf('Andrei Volkov', 'Andrii Volkov')).toBe('differs')
    expect(markOf(null, '1933-09-24')).toBe('none')
  })

  it('lists only what differs, and ticks what the record lacks and a name that differs only by accents (D5)', () => {
    const d = { ...draftFrom(m), surname: 'Pavyzdys', givenNames: 'Jonas' }
    const accents = changesOf({ full_name: 'Jonas Pavyždys', birth_date: null, nationality: 'LTU', sex: 'F' }, d, m)
    expect(accents.changes.map((c) => [c.field, c.why])).toEqual([
      ['names', 'accents'],
      ['birth_date', 'not_on_file'],
      ['sex', 'differs'],
    ])
    expect(accents.same).toEqual(['nationality'])
    expect(tickedAtFirst(accents.changes)).toEqual(['names', 'birth_date'])
    const other = changesOf({ full_name: 'Jonas Pavyzdis', birth_date: '1933-09-24', nationality: null, sex: 'M' }, d, m)
    expect(tickedAtFirst(other.changes)).toEqual(['nationality'])
  })
})

describe('Save', () => {
  const d = { ...checked(draftFrom(m)), givenNames: 'Jonas', issuedOn: '2021-05-16', placeOfBirth: ' Vilnius ' }

  it('names the scan, and takes only the ticked fields onto an employee on file', () => {
    expect(saveInputOf({ kind: 'existing', id: 'e1' }, d, m, true, ['birth_date'], 's1')).toEqual({
      employee: { id: 'e1' }, mrz: passport, kind: 'passport', surname: 'Pavyzdys', given_names: 'Jonas',
      add_to_employee_record: true, scan_id: 's1', issued_on: '2021-05-16', place_of_birth: 'Vilnius', take: ['birth_date'],
    })
    expect(saveInputOf({ kind: 'existing', id: 'e1' }, d, m, false, ['birth_date'], 's1').take).toBeUndefined()
  })

  it('makes a new employee from the document, with everything it gives', () => {
    const input = saveInputOf({ kind: 'new', firstName: 'Jonas', lastName: 'Pavyzdys', code: '' }, d, m, true, [], 's1')
    expect(input.employee).toEqual({ new: { first_name: 'Jonas', last_name: 'Pavyzdys' } })
    expect(input.take).toEqual(['birth_date', 'nationality', 'sex'])
  })
})

describe('Merge Employees here', () => {
  const cand = (id: string, has: boolean) => ({ employee: { id }, has_documents: has }) as DocumentCandidate
  it('removes a record without documents, and none when both have them', () => {
    expect(mergeable(cand('a', true), cand('b', false))).toEqual({ keep: 'a', remove: 'b' })
    expect(mergeable(cand('a', false), cand('b', true))).toEqual({ keep: 'b', remove: 'a' })
    expect(mergeable(cand('a', true), cand('b', true))).toBeNull()
  })
})

describe('the printed fields', () => {
  const box = { x0: 0, y0: 0, x1: 1, y1: 1 }
  const printed = { surname: { value: 'Pavyždys', box }, givenNames: { value: 'Jonas', box }, issuedOn: '2021-05-15' }
  it('put the names as printed over the MRZ’s, to be compared, and the date of issue when none was typed', () => {
    expect(withPrinted(draftFrom(m), m, printed)).toMatchObject({ surname: 'Pavyždys', givenNames: 'Jonas', issuedOn: '2021-05-15', namesChecked: false })
  })
  it('never over what the user typed or confirmed', () => {
    expect(withPrinted({ ...draftFrom(m), surname: 'Pavyzdys-Typed' }, m, printed).surname).toBe('Pavyzdys-Typed')
    expect(withPrinted(checked(draftFrom(m)), m, printed).surname).toBe('Pavyzdys')
    expect(withPrinted({ ...draftFrom(m), issuedOn: '2021-05-16' }, m, printed).issuedOn).toBe('2021-05-16')
  })
})

