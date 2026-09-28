import { describe, expect, it } from 'vitest'

import { confirmText, formatDay, formatTime, initialLang } from './confirm-text'

describe('initialLang', () => {
  it('keeps the language chosen last on this device', () => {
    expect(initialLang('ru', ['en-GB'])).toBe('ru')
    expect(initialLang('en', ['ru-RU'])).toBe('en')
  })
  it('otherwise follows the browser, and falls back to English', () => {
    expect(initialLang(null, ['lt-LT', 'ru-RU'])).toBe('ru')
    expect(initialLang(null, ['RU'])).toBe('ru')
    expect(initialLang(null, ['lt-LT', 'en'])).toBe('en')
    expect(initialLang('fr', [])).toBe('en')
  })
})

describe('confirmText', () => {
  it('asks in plain words, with the number of items', () => {
    expect(confirmText.en.ask('Ona', 1)).toBe('Ona, please confirm you received 1 item')
    expect(confirmText.en.ask('Ona', 5)).toBe('Ona, please confirm you received 5 items')
  })
  it('puts the Russian count in the genitive: 1 and 21 предмета, otherwise предметов', () => {
    expect(confirmText.ru.ask('Ona', 1)).toMatch(/1 предмета$/)
    expect(confirmText.ru.ask('Ona', 21)).toMatch(/21 предмета$/)
    expect(confirmText.ru.ask('Ona', 3)).toMatch(/3 предметов$/)
    expect(confirmText.ru.ask('Ona', 11)).toMatch(/11 предметов$/)
  })
  it('has every string in both languages', () => {
    expect(Object.keys(confirmText.ru).sort()).toEqual(Object.keys(confirmText.en).sort())
  })
})

describe('dates', () => {
  it('formats the day in the chosen language and time zone', () => {
    expect(formatDay('2026-07-30T22:30:00Z', 'en', 'Europe/Vilnius')).toBe('31 Jul 2026')
    expect(formatDay('2026-07-30T22:30:00Z', 'en', 'UTC')).toBe('30 Jul 2026')
    expect(formatDay('2026-07-30T12:00:00Z', 'ru', 'UTC')).toMatch(/^30 июл/)
    expect(formatDay('garbage', 'en')).toBe('—')
  })
  it('formats the time on a 24-hour clock', () => {
    expect(formatTime('2026-08-01T11:02:00Z', 'Europe/Vilnius')).toBe('14:02')
    expect(formatTime('garbage')).toBe('—')
  })
})
