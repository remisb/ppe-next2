import { describe, expect, it } from 'vitest'

import { datesIn, readViz, type OcrLine } from './viz.ts'

const line = (text: string, conf = 95): OcrLine => ({ words: text.split(' ').map((t) => ({ text: t, conf })) })

const mrz = { surname: 'ZUKAUSKAITE BANDOMOJI', givenNames: 'MIGLE ONA', birth: '1986-01-01', expiry: '2030-09-09', namesFull: false }

describe('readViz', () => {
  it('takes the printed names whose folded letters are the MRZ’s, with their accents', () => {
    const got = readViz([line('Surname / Pavardė'), line('ŽUKAUSKAITĖ-BANDOMOJI'), line('Given names / Vardai'), line('MIGLĖ ONA')], mrz)
    expect(got.surname).toEqual({ value: 'ŽUKAUSKAITĖ-BANDOMOJI', source: 'agrees' })
    expect(got.givenNames).toEqual({ value: 'MIGLĖ ONA', source: 'agrees' })
  })

  it('offers a name read unsurely to check, since folding cannot see a lost accent', () => {
    const got = readViz([line('ZUKAUSKAITE-BANDOMOJI', 70)], mrz)
    expect(got.surname).toEqual({ value: 'ZUKAUSKAITE-BANDOMOJI', source: 'check' })
  })

  it('takes nothing whose letters are not the MRZ’s', () => {
    expect(readViz([line('ŽUKAUSKAITĖ-BANDOMOJE')], mrz).surname).toBeUndefined()
  })

  it('takes the Latin half of a bilingual line', () => {
    const ua = { surname: 'VOLKOV', givenNames: 'ANDRII', namesFull: false }
    expect(readViz([line('ВОЛКОВ / VOLKOV'), line('АНДРІЙ / ANDRII')], ua)).toMatchObject({ surname: { value: 'VOLKOV' }, givenNames: { value: 'ANDRII' } })
  })

  it('takes a long name the MRZ cut short, when its name field is full', () => {
    const cut = { surname: 'KAZLAUSKAITE JANKAUSKIENE', givenNames: 'ALEKS', namesFull: true }
    expect(readViz([line('ALEKSANDRA KONSTANCIJA')], cut).givenNames?.value).toBe('ALEKSANDRA KONSTANCIJA')
    expect(readViz([line('ALEKSANDRA KONSTANCIJA')], { ...cut, namesFull: false }).givenNames).toBeUndefined()
  })

  it('takes the date of issue 10 years before the expiry, and offers another date between birth and expiry to check', () => {
    expect(readViz([line('09.09.1986'), line('10.09.2020'), line('09.09.2030')], mrz).issued).toEqual({ value: '2020-09-10', source: 'printed' })
    expect(readViz([line('03 MAR 2022')], mrz).issued).toEqual({ value: '2022-03-03', source: 'check' })
  })

  it('reads place of birth and authority from under their labels, always to check', () => {
    const got = readViz([line('Place of birth / Gimimo vieta'), line('PANEVĖŽYS'), line('Issued by / Išdavė'), line('MIGRACIJOS DEPARTAMENTAS')], mrz)
    expect(got.placeOfBirth).toEqual({ value: 'PANEVĖŽYS', source: 'check' })
    expect(got.authority).toEqual({ value: 'MIGRACIJOS DEPARTAMENTAS', source: 'check' })
  })
})

describe('datesIn', () => {
  it('reads three styles and refuses impossible dates', () => {
    expect(datesIn('15.05.2031 15 05 2031 15 MAY 2031 31.02.2031 15 MAYO 2031')).toEqual(['2031-05-15', '2031-05-15', '2031-05-15', '2031-05-15'])
  })
})
