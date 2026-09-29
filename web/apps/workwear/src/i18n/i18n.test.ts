import { afterEach, describe, expect, it } from 'vitest'

import { formatEuro, formatMonths } from '@/lib/utils'

import { en } from './en'
import { type Lang, deviceLanguage, plural, rememberDeviceLanguage, setLanguage, t } from './index'
import { lt } from './lt'
import { ru } from './ru'

afterEach(() => setLanguage('en'))

describe('plural', () => {
  const days = { one: '# day', other: '# days' }
  const dienos = { one: '# diena', few: '# dienos', other: '# dienų' }
  const dni = { one: '# день', few: '# дня', many: '# дней', other: '# дня' }
  it('picks each language’s form', () => {
    expect([1, 3, 10].map((n) => plural(n, days))).toEqual(['1 day', '3 days', '10 days'])
    expect([2.5, 1500].map((n) => plural(n, days))).toEqual(['2.5 days', '1500 days'])
    setLanguage('lt')
    expect([1, 3, 10, 21, 22].map((n) => plural(n, dienos))).toEqual(['1 diena', '3 dienos', '10 dienų', '21 diena', '22 dienos'])
    expect(t.common.days(2.5)).toBe('2,5 dienos')
    setLanguage('ru')
    expect([1, 3, 5, 11, 21, 24].map((n) => plural(n, dni))).toEqual(['1 день', '3 дня', '5 дней', '11 дней', '21 день', '24 дня'])
    expect(t.common.days(2.5)).toBe('2,5 дня')
  })
})

describe('setLanguage', () => {
  it('swaps the text, the amounts and the page language', () => {
    expect(t.common.cancel).toBe('Cancel')
    expect(formatEuro(4999)).toBe('€49.99')
    setLanguage('lt')
    expect(t.common.cancel).toBe('Atšaukti')
    expect(formatEuro(4999).replace(/\s/g, ' ')).toBe('49,99 €')
    expect(formatMonths(12)).toBe('12 mėnesių')
    expect(document.documentElement.lang).toBe('lt')
    setLanguage('ru')
    expect(formatMonths(3)).toBe('3 месяца')
    expect(document.documentElement.lang).toBe('ru')
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

/** Every text in a dictionary, by its path, with functions called on sample values. */
function texts(dict: object, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(path, v)
    else if (typeof v === 'function') out.set(path, String((v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, () => 7))))
    else if (v && typeof v === 'object') for (const [p, s] of texts(v, path)) out.set(p, s)
  }
  return out
}

// The same in every language: names of things that are not translated.
const sameEverywhere = new Set(['WhatsApp', 'Email', 'E-mail', '⌘K', 'OK'])

describe('dictionaries', () => {
  const english = texts(en)
  for (const [lang, dict] of [['lt', lt], ['ru', ru]] as [Lang, object][]) {
    it(`${lang} has every English text, none empty and none left in English`, () => {
      const translated = texts(dict)
      expect([...translated.keys()].sort()).toEqual([...english.keys()].sort())
      const empty = [...translated].filter(([, s]) => s.trim() === '').map(([k]) => k)
      expect(empty).toEqual([])
      // A text identical to the English is almost always one left untranslated.
      const untranslated = [...translated]
        .filter(([k, s]) => s === english.get(k) && /[A-Za-z]{3}/.test(s) && !sameEverywhere.has(s))
        .map(([k]) => k)
      expect(untranslated).toEqual([])
    })
  }
})
