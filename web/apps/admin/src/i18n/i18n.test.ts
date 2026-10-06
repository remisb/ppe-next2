import { dictionaryProblems, noProblems } from '@ppe/i18n/testing'
import { afterEach, describe, expect, it } from 'vitest'

import { en } from './en'
import { setLanguage, t } from './index'
import { lt } from './lt'
import { ru } from './ru'

afterEach(() => setLanguage('en'))

describe('setLanguage', () => {
  it('swaps the text and the page language', () => {
    expect(t.shell.users).toBe('Users')
    setLanguage('lt')
    expect(t.shell.users).toBe('Naudotojai')
    expect(document.documentElement.lang).toBe('lt')
  })
})

describe('dictionaries', () => {
  for (const [lang, dict] of [['lt', lt], ['ru', ru]] as const) {
    it(`${lang} has every English text, none empty and none left in English`, () => {
      expect(dictionaryProblems(en, dict)).toEqual(noProblems)
    })
  }
})
