import { dictionaryProblems, noProblems } from '@ppe/i18n/testing'
import { describe, expect, it } from 'vitest'

import { dictionaries } from './text.ts'

describe('dictionaries', () => {
  for (const lang of ['lt', 'ru'] as const) {
    it(`${lang} has every English text, none empty and none left in English`, () => {
      expect(dictionaryProblems(dictionaries.en, dictionaries[lang])).toEqual(noProblems)
    })
  }
})
