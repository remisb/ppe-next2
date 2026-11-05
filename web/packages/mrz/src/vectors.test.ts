/**
 * testdata/mrz/vectors.json: the cases the Go API's parser will read too
 * (NFR-7). "expect" names only the fields a case is about; null is "absent";
 * problems, notes and corrections are compared as sets.
 */
import vectors from '../../../../testdata/mrz/vectors.json' with { type: 'json' }

import { checkDigit, fold, ltPersonalCode, nameMatch, parseMrz, readMrz, type Mrz } from './index.ts'

const today = vectors.today
const SETS = new Set(['problems', 'notes', 'corrections'])
const key = (x: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(x).sort()))

function expectFields(m: Mrz, wanted: Record<string, unknown>) {
  for (const [k, want] of Object.entries(wanted)) {
    const got = (m as unknown as Record<string, unknown>)[k]
    if (SETS.has(k)) {
      expect(new Set((got as Record<string, unknown>[]).map(key)), k).toEqual(new Set((want as Record<string, unknown>[]).map(key)))
    } else if (k === 'checks' && want && typeof want === 'object') {
      expect(got, k).toMatchObject(want)
    } else {
      expect(got ?? null, k).toEqual(want)
    }
  }
}

describe('cases', () => {
  for (const c of vectors.cases) {
    test(c.name, () => {
      const m = parseMrz(c.lines, { today })
      expect(m).toBeDefined()
      expectFields(m!, c.expect)
    })
  }
})

describe('read from OCR text', () => {
  for (const c of vectors.read) {
    test(c.name, () => {
      const r = readMrz(c.text, { today: c.today })
      expect(!!r.mrz).toBe(c.expect.found)
      if (!c.expect.found) return
      expect(r.fitted).toBe(c.expect.fitted)
      expect(r.mrz!.valid).toBe(c.expect.valid)
      expect(r.mrz!.lines).toEqual(c.expect.lines)
      if ('needsSecondRead' in c.expect) expect(r.mrz!.needsSecondRead).toBe(c.expect.needsSecondRead)
    })
  }
})

describe('Lithuanian personal codes', () => {
  for (const c of vectors.ltPersonalCodes) {
    test(`${c.code}${c.note ? ` (${c.note})` : ''}`, () => {
      const got = ltPersonalCode(c.code)
      if ('invalid' in c) return expect(got).toBeUndefined()
      expect(got?.valid).toBe(c.valid)
      expect(got?.birthDate ?? null).toBe(c.birthDate ?? null)
      expect(got?.sex ?? null).toBe(c.sex ?? null)
    })
  }
})

test('check digits', () => {
  for (const [s, d] of vectors.checkDigits) expect(String(checkDigit(s!)), s).toBe(d)
})

test('fold', () => {
  for (const c of vectors.fold) expect(fold(c.name), c.name).toEqual(c.forms)
})

test('nameMatch', () => {
  for (const c of vectors.nameMatch) expect(nameMatch(c.surname, c.givenNames, c.field), `${c.surname} ${c.givenNames}`).toBe(c.expect)
})
