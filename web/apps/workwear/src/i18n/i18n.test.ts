import { dictionaryProblems, noProblems } from '@ppe/i18n/testing'
import { afterEach, describe, expect, it } from 'vitest'

import { formatEuro, formatMonths } from '@/lib/utils'

import { en } from './en'
import { type Lang, setLanguage, t } from './index'
import { lt } from './lt'
import { ru } from './ru'

afterEach(() => setLanguage('en'))

describe('setLanguage', () => {
  it('swaps the text, the amounts, the counted phrases and the page language', () => {
    expect(t.common.cancel).toBe('Cancel')
    expect(formatEuro(4999)).toBe('€49.99')
    setLanguage('lt')
    expect(t.common.cancel).toBe('Atšaukti')
    expect(t.common.days(2.5)).toBe('2,5 dienos')
    expect(formatEuro(4999).replace(/\s/g, ' ')).toBe('49,99 €')
    expect(formatMonths(12)).toBe('12 mėnesių')
    expect(document.documentElement.lang).toBe('lt')
    setLanguage('ru')
    expect(t.common.days(2.5)).toBe('2,5 дня')
    expect(formatMonths(3)).toBe('3 месяца')
    expect(document.documentElement.lang).toBe('ru')
  })
})

describe('dictionaries', () => {
  for (const [lang, dict] of [['lt', lt], ['ru', ru]] as [Lang, object][]) {
    it(`${lang} has every English text, none empty and none left in English`, () => {
      expect(dictionaryProblems(en, dict)).toEqual(noProblems)
    })
  }
})
