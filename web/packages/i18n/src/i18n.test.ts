import { afterEach, describe, expect, it } from 'vitest'

import { applyLanguage, deviceLanguage, localized, plural, rememberDeviceLanguage } from './index.ts'
import { dictionaryProblems, noProblems } from './testing.ts'

afterEach(() => applyLanguage('en'))

describe('plural', () => {
  const days = { one: '# day', other: '# days' }
  const dienos = { one: '# diena', few: '# dienos', many: '# dienos', other: '# dienų' }
  const dni = { one: '# день', few: '# дня', many: '# дней', other: '# дня' }
  it('picks each language’s form', () => {
    expect([1, 3, 10].map((n) => plural(n, days))).toEqual(['1 day', '3 days', '10 days'])
    expect([2.5, 1500].map((n) => plural(n, days))).toEqual(['2.5 days', '1500 days'])
    applyLanguage('lt')
    expect([1, 3, 10, 21, 22].map((n) => plural(n, dienos))).toEqual(['1 diena', '3 dienos', '10 dienų', '21 diena', '22 dienos'])
    expect(plural(2.5, dienos)).toBe('2,5 dienos')
    applyLanguage('ru')
    expect([1, 3, 5, 11, 21, 24].map((n) => plural(n, dni))).toEqual(['1 день', '3 дня', '5 дней', '11 дней', '21 день', '24 дня'])
  })
})

describe('applyLanguage and localized', () => {
  it('switch a package’s words and the page language together', () => {
    const text = localized({ en: { close: 'Close' }, lt: { close: 'Uždaryti' }, ru: { close: 'Закрыть' } })
    expect(text().close).toBe('Close')
    applyLanguage('lt')
    expect(text().close).toBe('Uždaryti')
    expect(document.documentElement.lang).toBe('lt')
  })
})

describe('deviceLanguage', () => {
  it('is the language last used here, else English', () => {
    window.localStorage.clear()
    expect(deviceLanguage()).toBe(navigator.language.startsWith('lt') ? 'lt' : navigator.language.startsWith('ru') ? 'ru' : 'en')
    rememberDeviceLanguage('ru')
    expect(deviceLanguage()).toBe('ru')
    window.localStorage.setItem('workwear.language', 'de')
    expect(deviceLanguage()).not.toBe('de')
  })
})

describe('dictionaryProblems', () => {
  it('finds missing, extra, empty and untranslated texts', () => {
    const en = { a: 'Open', b: { c: (n: number) => `${n} days` }, d: 'Email' }
    expect(dictionaryProblems(en, { a: 'Atidaryti', b: { c: (n: number) => `${n} dienos` }, d: 'Email' })).toEqual(noProblems)
    expect(dictionaryProblems(en, { a: 'Open', b: { c: () => '' }, e: 'x' })).toEqual({
      missing: ['d'],
      extra: ['e'],
      empty: ['b.c'],
      untranslated: ['a'],
    })
  })
})
