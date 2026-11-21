import { describe, expect, it } from 'vitest'

import { datesIn, readPrinted, type PrintedLine } from './printed.ts'

let x = 0
const line = (text: string): PrintedLine => ({ words: text.split(' ').map((t) => ({ text: t, x0: x, y0: 10, x1: (x += 50), y1: 30 })) })

const mrz = { surname: 'ZUKAUSKAITE BANDOMOJI', givenNames: 'MIGLE ONA', birthDate: '1986-01-01', expiryDate: '2030-09-09', namesFull: false }

describe('readPrinted', () => {
  it('offers the printed names whose folded letters are the MRZ’s, title-cased with their accents, and where they are', () => {
    const got = readPrinted([line('SURNAME / PAVARDĖ'), line('ŽUKAUSKAITĖ-BANDOMOJI'), line('GIVEN NAMES / VARDAI'), line('MIGLĖ ONA')], mrz)
    expect(got.surname?.value).toBe('Žukauskaitė-Bandomoji')
    expect(got.givenNames?.value).toBe('Miglė Ona')
    expect(got.surname?.box.x1).toBeGreaterThan(got.surname!.box.x0)
  })

  it('offers nothing whose letters are not the MRZ’s, and leaves the MRZ’s own lines out', () => {
    expect(readPrinted([line('ŽUKAUSKAITĖ-BANDOMOJE'), line('ZUKAUSKAITE<BANDOMOJI<<MIGLE<ONA<<<<<')], mrz).surname).toBeUndefined()
  })

  it('takes the Latin half of a bilingual line', () => {
    const ua = { surname: 'VOLKOV', givenNames: 'ANDRII', namesFull: false }
    expect(readPrinted([line('ВОЛКОВ / VOLKOV'), line('АНДРІЙ / ANDRII')], ua)).toMatchObject({ surname: { value: 'Volkov' }, givenNames: { value: 'Andrii' } })
  })

  it('takes a long name the MRZ cut short, when its name field is full', () => {
    const cut = { surname: 'KAZLAUSKAITE JANKAUSKIENE', givenNames: 'ALEKS', namesFull: true }
    expect(readPrinted([line('ALEKSANDRA KONSTANCIJA')], cut).givenNames?.value).toBe('Aleksandra Konstancija')
    expect(readPrinted([line('ALEKSANDRA KONSTANCIJA')], { ...cut, namesFull: false }).givenNames).toBeUndefined()
  })

  it('takes the date of issue 5 or 10 years before the expiry, and no other', () => {
    expect(readPrinted([line('01.01.1986'), line('10.09.2020'), line('09.09.2030')], mrz).issuedOn).toBe('2020-09-10')
    expect(readPrinted([line('03 MAR 2022')], mrz).issuedOn).toBeUndefined()
    expect(readPrinted([line('09.09.2020'), line('09 09 2025')], mrz).issuedOn).toBeUndefined()
  })
})

describe('datesIn', () => {
  it('reads four styles and refuses impossible dates', () => {
    expect(datesIn('15.05.2031 15 05 2031 15 MAY 2031 2031-05-15 31.02.2031')).toEqual(['2031-05-15', '2031-05-15', '2031-05-15', '2031-05-15'])
  })
})
