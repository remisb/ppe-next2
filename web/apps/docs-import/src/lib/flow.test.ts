import type { Employee } from '@ppe/api-client'
import { parseMrz } from '@ppe/mrz'

import {
  blockers,
  differences,
  draftFromReading,
  emptyDraft,
  guideFor,
  kindOf,
  linesOf,
  namesFromMrz,
  parseDraft,
  placePhoto,
  readPhotoOf,
  saveInput,
  titleCase,
  type Holder,
  type Photo,
} from './flow'

const today = '2026-11-05'
// testdata/mrz/vectors.json's made-up Lithuanian passport and ID card.
const passport = ['P<LTUPAVYZDYS<<JONAS<<<<<<<<<<<<<<<<<<<<<<<<', '91234567<9LTU3309243M310515733309240064<<<42']
const card = ['IDLTU91234567<933309240064<<<<', '3309243M3105157LTU<<<<<<<<<<<4', 'PAVYZDYS<<JONAS<<<<<<<<<<<<<<<']
const m = parseMrz(passport, { today })!

const employee: Employee = {
  id: 'e1',
  first_name: 'Jonas',
  last_name: 'Pavyzdys',
  full_name: 'Jonas Pavyzdys',
  code: null,
  height_cm: null,
  clothing_size: null,
  shoe_size: null,
  notes: '',
  preferred_language: null,
  default_photo_id: null,
  birth_date: null,
  nationality: 'LTU',
  sex: null,
  created_at: '',
  updated_at: '',
}
const onFile: Holder = { kind: 'existing', employee }
const photo = (over: Partial<Photo> = {}): Photo => ({ id: 'p', found: true, mrz: m, agreed: true, ...over })

describe('reading', () => {
  it('title-cases the MRZ names, which the user then types with diacritics', () => {
    expect(titleCase('ZUKAUSKAITE')).toBe('Zukauskaite')
    expect(titleCase('JONAS PETRAS')).toBe('Jonas Petras')
    expect(titleCase('PAVYZDYTE-BANDOMOJI')).toBe('Pavyzdyte-Bandomoji')
    expect(namesFromMrz(m)).toEqual({ surname: 'Pavyzdys', givenNames: 'Jonas' })
  })

  it('says the kind from the document code', () => {
    expect(kindOf(m)).toBe('passport')
    expect(kindOf(parseMrz(card, { today })!)).toBe('id_card')
    expect(kindOf({ ...parseMrz(card, { today })!, documentCode: 'IR' })).toBe('residence_permit')
  })

  it('cleans typed lines', () => {
    expect(linesOf(' p<ltu pavyzdys \n\n 9123 4567<9\n')).toEqual(['P<LTUPAVYZDYS', '91234567<9'])
  })

  it("places a card's photos by the MRZ, in either order", () => {
    const back = photo({ id: 'b' })
    const front = photo({ id: 'f', found: false, agreed: false })
    delete front.mrz
    expect(placePhoto('card', {}, front)).toEqual({ photos: { front } })
    expect(placePhoto('card', { front }, back)).toEqual({ photos: { front, back } })
    expect(placePhoto('card', { back }, front)).toEqual({ photos: { back, front } })
    const again = photo({ id: 'b2' })
    expect(placePhoto('card', { back, front }, again)).toEqual({ photos: { back: again, front }, dropped: back })
    expect(placePhoto('passport', { page: back }, again)).toEqual({ photos: { page: again }, dropped: back })
    expect(readPhotoOf('card', { back, front })).toBe(back)
  })
})

describe('review', () => {
  it('starts from the reading', () => {
    const d = draftFromReading('passport', photo())
    expect(d.lines).toBe(passport.join('\n'))
    expect(d.surname).toBe('Pavyzdys')
    expect(d.kind).toBe('passport')
    expect(d.agreed).toBe(true)
    expect(d.addToRecord).toBe(false)
    expect(parseDraft(d, today)?.valid).toBe(true)
  })

  it('lists only what differs from the employee on file', () => {
    const d = { ...draftFromReading('passport', photo()), surname: 'Pavyzdys', givenNames: 'Jonas' }
    expect(differences(onFile, d, m)).toEqual([
      { field: 'birth_date', current: null, document: '1933-09-24' },
      { field: 'sex', current: null, document: 'M' },
    ])
    expect(differences(onFile, { ...d, givenNames: 'Jonas Petras' }, m)[0]).toEqual({
      field: 'names',
      current: 'Jonas Pavyzdys',
      document: 'Jonas Petras Pavyzdys',
    })
    expect(differences({ kind: 'new' }, d, m)).toEqual([])
  })

  it('stops Save for what is wrong or unchecked', () => {
    const ok = draftFromReading('passport', photo())
    expect(blockers(onFile, ok, m, undefined)).toEqual([])
    expect(blockers(onFile, ok, undefined, undefined)).toEqual(['no_mrz'])
    expect(blockers(onFile, { ...ok, surname: ' ' }, m, undefined)).toEqual(['surname'])
    expect(blockers({ kind: 'new' }, { ...ok, givenNames: '' }, m, undefined)).toEqual(['given_names'])
    expect(blockers(onFile, { ...ok, issuedOn: '2032-01-01' }, m, undefined)).toEqual(['issued_on'])
    // Two reads that did not agree: the user compares the lines with the document first.
    const unagreed = { ...ok, agreed: false }
    expect(blockers(onFile, unagreed, m, undefined)).toEqual(['not_checked'])
    expect(blockers(onFile, { ...unagreed, checked: true }, m, undefined)).toEqual([])
    const broken = { ...ok, lines: ok.lines.replace('3309243', '3309253') }
    expect(blockers(onFile, broken, parseDraft(broken, today), undefined)).toContain('problems')
    const check = { valid: true, problems: [], notes: [], needs_second_read: false, name_match: 'same' as const, possible_duplicates: [] }
    expect(blockers(onFile, ok, m, { ...check, document_on_file: { employee_id: 'e', document_id: 'd' }, other_employee: null })).toEqual([
      'document_on_file',
    ])
    expect(blockers(onFile, ok, m, { ...check, document_on_file: null, other_employee: 'e2' })).toEqual(['other_employee'])
  })
})

describe('save', () => {
  it('sends the employee on file, and what the user chose to take', () => {
    const d = { ...draftFromReading('passport', photo()), addToRecord: true, take: ['birth_date' as const], issuedOn: '2021-05-16', authority: ' ' }
    expect(saveInput(onFile, d, m)).toEqual({
      employee: { id: 'e1' },
      mrz: passport,
      kind: 'passport',
      surname: 'Pavyzdys',
      given_names: 'Jonas',
      add_to_employee_record: true,
      issued_on: '2021-05-16',
      take: ['birth_date'],
    })
    expect(saveInput(onFile, { ...d, addToRecord: false }, m).take).toBeUndefined()
  })

  it('makes a new employee from the names typed', () => {
    const d = { ...emptyDraft('card'), ...draftFromReading('card', photo()), surname: 'Žukauskaitė', givenNames: 'Miglė', addToRecord: true }
    const input = saveInput({ kind: 'new' }, d, m)
    expect(input.employee).toEqual({ new: { first_name: 'Miglė', last_name: 'Žukauskaitė' } })
    expect(input.take).toEqual(['birth_date', 'nationality', 'sex'])
  })
})

describe('live view', () => {
  it("frames the document in its own shape, centred, with its code lines' band at its bottom", () => {
    const { guide, band } = guideFor('card')
    expect(guide.w).toBeCloseTo(0.88)
    // A card is wider for its height than a passport's page.
    expect(guideFor('passport').guide.h).toBeGreaterThan(guide.h)
    expect(guide.x + guide.w / 2).toBeCloseTo(0.5)
    expect(guide.y + guide.h / 2).toBeCloseTo(0.5)
    expect(band.y + band.h).toBeCloseTo(guide.y + guide.h)
    expect(band.y).toBeGreaterThan(guide.y + guide.h / 2)
    for (const type of ['passport', 'card'] as const) {
      const g = guideFor(type).guide
      expect(g.y).toBeGreaterThanOrEqual(0)
      expect(g.y + g.h).toBeLessThanOrEqual(1)
    }
  })
})
