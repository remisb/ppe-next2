import { dictionaryProblems, noProblems } from '@ppe/i18n/testing'
import { describe, expect, it } from 'vitest'

import {
  Steady,
  batchRequest,
  cardComplete,
  codesFromWords,
  compactSimNo,
  luhn,
  pairPhotos,
  pickSimNo,
  rowMarks,
  simKey,
  simNoProblem,
  type OcrWord,
  type PictureRead,
  type ScanCard,
  withPhoto,
} from './sim-scan.ts'
import { dictionaries } from './text.ts'

// Made-up SIM numbers whose check digits check; none is a real card.
const A = '8937099000000000015'
const B = '8937099000000000023'

describe('SIM No.', () => {
  it('checks the last digit', () => {
    expect(luhn(A)).toBe(true)
    expect(luhn('8937099000000000016')).toBe(false)
    expect(luhn('')).toBe(false)
  })

  it('names what is wrong', () => {
    expect(simNoProblem(A)).toBeNull()
    expect(simNoProblem(`${A}F`)).toBeNull()
    expect(simNoProblem('8937 0990 0000 0000 015')).toBeNull()
    expect(simNoProblem('8937099000000000051')).toBe('check_digit')
    expect(simNoProblem('4770192200828')).toBe('not_sim_no')
    expect(simNoProblem('')).toBe('not_sim_no')
  })

  it('compares without spaces, case or the filler F', () => {
    expect(compactSimNo(' 8937 0990 0000 0000 015f ')).toBe(`${A}F`)
    expect(simKey(`${A}f`)).toBe(simKey(A))
  })

  it("takes the SIM No. among a carrier's barcodes, never the product code", () => {
    expect(pickSimNo(['4770192200828', A])).toBe(A)
    expect(pickSimNo(['4770192200828'])).toBeNull()
    expect(pickSimNo(['8937099000000000016'])).toBeNull()
  })
})

// The words a carrier's back read as, in the reader's order (sparse text puts
// labels and numbers in any order), boxes as on a phone photo.
const back: OcrWord[] = [
  { text: '8134', x0: 400, y0: 1260, x1: 470, y1: 1290 },
  { text: 'PIN', x0: 195, y0: 1268, x1: 240, y1: 1292 },
  { text: '90651799', x0: 325, y0: 1322, x1: 475, y1: 1352 },
  { text: 'PUK', x0: 195, y0: 1330, x1: 248, y1: 1354 },
  { text: '1501', x0: 195, y0: 1445, x1: 260, y1: 1475 },
  { text: 'K', x0: 270, y0: 1445, x1: 285, y1: 1475 },
]

describe('codesFromWords', () => {
  it('takes the number on each label’s line, after it', () => {
    expect(codesFromWords(back)).toEqual({ pin: '8134', puk: '90651799' })
  })

  it('never takes the customer service number, or a number before the label', () => {
    const noPin = back.filter((w) => w.text !== '8134')
    expect(codesFromWords(noPin)).toEqual({ puk: '90651799' })
    const before: OcrWord[] = [
      { text: '1234', x0: 50, y0: 100, x1: 100, y1: 120 },
      { text: 'PIN', x0: 150, y0: 100, x1: 190, y1: 120 },
    ]
    expect(codesFromWords(before)).toEqual({})
  })

  it('reads a label the reader took for P1N', () => {
    expect(codesFromWords([{ ...back[1]!, text: 'P1N' }, back[0]!])).toEqual({ pin: '8134' })
  })
})

const front = (id: string, simNo: string): PictureRead => ({ id, simNo, codes: {} })
const rear = (id: string, pin: string, puk: string): PictureRead => ({ id, simNo: null, codes: { pin, puk } })
const blank = (id: string): PictureRead => ({ id, simNo: null, codes: {} })

describe('pairPhotos', () => {
  it('pairs front, back, front, back', () => {
    const cards = pairPhotos([front('1', A), rear('2', '0306', '93691381'), front('3', B), rear('4', '8134', '90651799')])
    expect(cards.map((c) => [c.simNo, c.pin, c.puk, c.front, c.back])).toEqual([
      [A, '0306', '93691381', '1', '2'],
      [B, '8134', '90651799', '3', '4'],
    ])
  })

  it('pairs back, front when the first photo is a back', () => {
    const cards = pairPhotos([rear('1', '0306', '93691381'), front('2', A), rear('3', '8134', '90651799'), front('4', B)])
    expect(cards.map((c) => [c.simNo, c.pin])).toEqual([
      [A, '0306'],
      [B, '8134'],
    ])
  })

  it('keeps a side without its other side, and a photo with nothing read, as rows of their own', () => {
    const cards = pairPhotos([front('1', A), front('2', B), rear('3', '8134', '90651799'), rear('4', '0306', '93691381'), blank('5')])
    expect(cards.map((c) => [c.simNo, c.pin, c.front ?? null, c.back ?? null, c.unread ?? false])).toEqual([
      [A, '', '1', null, false],
      [B, '8134', '2', '3', false],
      ['', '0306', null, '4', false],
      ['', '', '5', null, true],
    ])
  })
})

const card = (simNo: string, pin = '', puk = '', sides: Partial<ScanCard> = { front: 'f', back: 'b' }): ScanCard => ({
  key: simNo + pin,
  simNo,
  pin,
  puk,
  ...sides,
})

describe('rowMarks', () => {
  it('marks each row as the API would, and the missing sides', () => {
    const marks = rowMarks([
      card(A, '0306', '93691381'),
      card('8937099000000000016'),
      card(`${A}F`),
      card(B, '0306', ''),
      card(B.slice(0, 5), '12', '1234'),
      card(B, '', '', { front: 'f' }),
      card('', '1111', '22222222', { back: 'b' }),
    ])
    expect(marks.map((row) => row.map((m) => `${m.field}:${m.code}`))).toEqual([
      [],
      ['sim_no:check_digit'],
      ['sim_no:duplicate'],
      ['puk:codes_incomplete'],
      ['sim_no:not_sim_no', 'pin:pin', 'puk:puk'],
      ['sim_no:duplicate', 'pin:no_back'],
      ['sim_no:not_sim_no', 'sim_no:no_front'],
    ])
    expect(marks[2]![0]!.other).toBe(0)
  })

  it("adds the API's registered cards", () => {
    const marks = rowMarks([card(A)], [{ index: 0, field: 'sim_no', code: 'registered', existing_id: 'id-1' }])
    expect(marks[0]).toEqual([{ field: 'sim_no', code: 'registered', existingId: 'id-1' }])
  })
})

describe('the card being scanned', () => {
  const empty: ScanCard = { key: 'k', simNo: '', pin: '', puk: '' }

  it('fills each side from its photo, whichever slot took it', () => {
    let c = withPhoto(empty, 'front', front('1', A))
    expect([c.simNo, c.front, c.back]).toEqual([A, '1', undefined])
    c = withPhoto(c, 'front', rear('2', '0306', '93691381'))
    expect([c.pin, c.puk, c.back]).toEqual(['0306', '93691381', '2'])
  })

  it('keeps an unread photo as the slot’s picture, its fields to type', () => {
    const c = withPhoto(empty, 'back', blank('3'))
    expect([c.back, c.front, c.pin]).toEqual(['3', undefined, ''])
  })

  it('is done once both sides are photographed and the three fields are right', () => {
    const done = { ...empty, simNo: A, pin: '0306', puk: '93691381', front: '1', back: '2' }
    expect(cardComplete(done, [])).toBe(true)
    const { back: _, ...frontOnly } = done
    expect(cardComplete(frontOnly, [])).toBe(false)
    expect(cardComplete({ ...done, puk: '' }, [])).toBe(false)
    expect(cardComplete({ ...done, puk: '9369' }, [])).toBe(false)
    expect(cardComplete({ ...done, simNo: '8937099000000000016' }, [])).toBe(false)
    expect(cardComplete(done, [card(`${A}F`)])).toBe(false)
  })
})

describe('batchRequest', () => {
  it('sends what the cards share, then each card compacted', () => {
    const settings = { provider: ' Bitė ', plan: '', valueCents: 5000, receivedDate: '', comment: '' }
    expect(batchRequest(settings, [card('8937 0990 0000 0000 015', ' 0306', '93691381 ')])).toEqual({
      provider: 'Bitė',
      comment: '',
      non_return_value_cents: 5000,
      cards: [{ sim_no: A, pin: '0306', puk: '93691381' }],
    })
  })
})

describe('Steady', () => {
  it('takes a reading seen twice in a row', () => {
    const s = new Steady<string>()
    const id = (v: string) => v
    expect(s.see(A, id)).toBeNull()
    expect(s.see(B, id)).toBeNull()
    expect(s.see(B, id)).toBe(B)
    expect(s.see(null, id)).toBeNull()
    expect(s.see(B, id)).toBeNull()
  })
})

describe('dictionaries', () => {
  for (const lang of ['lt', 'ru'] as const) {
    it(`${lang} has every English text, none empty and none left in English`, () => {
      expect(dictionaryProblems(dictionaries.en, dictionaries[lang])).toEqual(noProblems)
    })
  }
})
