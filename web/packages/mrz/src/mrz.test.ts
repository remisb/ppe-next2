import { candidatesIn, checkDigit, checkDigitOf, cleanLine, fittings, formatOf, mrzDate, parseMrz, todayUTC } from './index.ts'

const today = '2026-11-05'
const TD3 = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10']
const put = (lines: string[], line: number, col: number, s: string) =>
  lines.map((l, i) => (i === line ? l.slice(0, col) + s + l.slice(col + s.length) : l))

describe('check digits', () => {
  test('characters whose values differ by a multiple of 10 give the same digit in any place', () => {
    // Why no check digit can tell K from <, nor G from 6, L from 1, U from 0 (docs-import plan, phase 1).
    for (const [a, b] of [['K', '<'], ['G', '6'], ['L', '1'], ['U', '0'], ['A', '0']] as const) {
      for (let i = 0; i < 3; i++) {
        const s = 'AB12345'
        expect(checkDigit(s.slice(0, i) + a + s.slice(i + 1)), `${a}/${b} at ${i}`).toBe(checkDigit(s.slice(0, i) + b + s.slice(i + 1)))
      }
    }
  })

  test("FR-5's look-alikes other than K and < always change the digit", () => {
    for (const [a, b] of [['O', '0'], ['I', '1'], ['B', '8'], ['S', '5'], ['Z', '2']] as const) {
      for (let i = 0; i < 3; i++) {
        const s = 'XY7'
        expect(checkDigit(s.slice(0, i) + a + s.slice(i + 1))).not.toBe(checkDigit(s.slice(0, i) + b + s.slice(i + 1)))
      }
    }
  })

  test('a character the MRZ never holds has no digit', () => {
    expect(checkDigit('AB-1')).toBeUndefined()
    expect(() => checkDigitOf('é')).toThrow()
  })
})

describe('parseMrz', () => {
  test('lines of no format, or with other characters, are no MRZ', () => {
    expect(parseMrz(['P<UTO', 'L898'], { today })).toBeUndefined()
    expect(parseMrz([TD3[0]!.toLowerCase(), TD3[1]!], { today })).toBeUndefined()
    expect(formatOf(TD3)).toBe('TD3')
  })

  test('the spans cover each line once, for underlining the fields (FR-7)', () => {
    const m = parseMrz(TD3, { today })!
    for (const [i, line] of m.lines.entries()) {
      const cols = m.spans.filter((s) => s.line === i).flatMap((s) => Array.from({ length: s.end - s.start }, (_, k) => s.start + k))
      expect(cols.sort((a, b) => a - b)).toEqual([...line].map((_, k) => k))
    }
  })

  test('a long document number: its spans move into the optional data', () => {
    const l1 = 'I<UTOD23145890<7349<<<<<<<<<<<'
    const l2 = '7408122F1204159UTO<<<<<<<<<<<'
    const lines = [l1, l2 + checkDigitOf(l1.slice(5) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29)), 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<']
    const m = parseMrz(lines, { today })!
    expect(m.valid).toBe(true)
    expect(m.documentNumber).toBe('D23145890734')
    expect(m.spans.filter((s) => s.field === 'documentNumberCheck')).toEqual([{ field: 'documentNumberCheck', line: 0, start: 18, end: 19 }])
    expect(m.spans.find((s) => s.field === 'optionalData1')).toEqual({ field: 'optionalData1', line: 0, start: 19, end: 30 })
  })

  test('known limit: two errors in a document number that balance its digit pass every check', () => {
    // 2 (weight 7) → 3 (+7) and C (12, weight 3) → D (+3): +10. The number starts the composite, so
    // its weights there are its own and the composite does not see it either. A second read is what
    // catches this (the live two-frame rule).
    const m = parseMrz(put(TD3, 1, 6, '3D'), { today })!
    expect(m.valid).toBe(true)
    expect(m.documentNumber).toBe('L898903D3')
    expect(m.needsSecondRead).toBe(false)
  })

  test('a reading the look-alike search chose may be wrong, so it needs a second read', () => {
    // Two misreads (C → D, 3 → 4) in L898902C3: one look-alike combination passes the number's
    // digit and so the composite; it is not the document's number.
    const m = parseMrz(put(TD3, 1, 7, 'D4'), { today })!
    expect(m.valid).toBe(true)
    expect(m.documentNumber).not.toBe('L898902C3')
    expect(m.corrections).toEqual([{ field: 'documentNumber', by: 'lookalike' }])
    expect(m.needsSecondRead).toBe(true)
  })

  test('numberCorrections: false leaves a number with a look-alike failing', () => {
    const l2 = `X7A3H4Q0P${checkDigitOf('X7A3H4Q0P')}UTO7408122F320415${checkDigitOf('320415')}<<<<<<<<<<<<<<<`
    const lines = ['P<UTOERIKSSON<<ANNA'.padEnd(44, '<'), l2 + checkDigitOf(l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43))]
    expect(parseMrz(lines, { today })!.valid).toBe(true)
    const misread = put(lines, 1, 7, 'O')
    expect(parseMrz(misread, { today })!.valid).toBe(true)
    expect(parseMrz(misread, { today, numberCorrections: false })!.problems).toContainEqual({ code: 'check_digit', field: 'documentNumber' })
  })

  test('a number full of look-alikes is tried at most 64 ways, and whatever is found needs a second read', () => {
    const value = ['8B8B8B8BS', '8B8B8B8B5', 'B8B8B8B8S'].find((v) => checkDigitOf(v) !== '6')!
    const m = parseMrz(put(TD3, 1, 0, value), { today })!
    expect(m.checks.documentNumber === false || m.corrections.length > 0).toBe(true)
    expect(m.valid ? m.needsSecondRead : m.problems.some((p) => p.field === 'documentNumber')).toBe(true)
  })

  test('nothing read goes into a problem or note: codes and field names only', () => {
    const m = parseMrz(put(TD3, 1, 0, 'Q'), { today })!
    for (const x of [...m.problems, ...m.notes]) expect(Object.keys(x).sort()).toEqual(x.field ? ['code', 'field'] : ['code'])
  })
})

describe('dates', () => {
  test('29 February only in a leap year', () => {
    expect(mrzDate('000229', 'birth', today)).toBe('2000-02-29')
    expect(mrzDate('010229', 'birth', today)).toBeUndefined()
  })
  test('todayUTC', () => {
    expect(todayUTC(new Date('2026-11-05T23:30:00Z'))).toBe('2026-11-05')
  })
})

describe('lines', () => {
  test('cleanLine', () => {
    expect(cleanLine(' p<uto eriksson«<anna ')).toBe('P<UTOERIKSSON<<ANNA')
  })
  test('fittings: a filler into each run when short; when long, a filler out, an end or any one character dropped', () => {
    expect(fittings('AB<CD<', 7).sort()).toEqual(['AB<<CD<', 'AB<CD<<'].sort())
    expect(fittings('AB<<CD', 5).sort()).toEqual(['AB<CD', 'B<<CD', 'AB<<C'].sort())
    expect(fittings('AB<<CD', 5, true).sort()).toEqual(['AB<CD', 'B<<CD', 'A<<CD', 'AB<<D', 'AB<<C'].sort())
    expect(fittings('XAB<<CDY', 6).sort()).toEqual(['XABCDY', 'AB<CDY', 'XAB<CD', 'B<<CDY', 'AB<<CD', 'XAB<<C'].sort())
    expect(fittings('ABCD', 8)).toEqual([])
  })
  test('the bottom-most group of lines is tried first', () => {
    const text = `${TD3[0]}\n${TD3[1]}\nnoise\n${TD3[0]}\n${TD3[1]}`
    expect(candidatesIn(text)[0]!.lines).toEqual(TD3)
  })
})
