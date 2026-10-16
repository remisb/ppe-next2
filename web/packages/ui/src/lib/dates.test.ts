import { applyLanguage } from '@ppe/i18n'
import { afterEach, describe, expect, it } from 'vitest'

import { capitalize, formatDate, formatDateTime, formatDay, formatRelative, formatShortDate, formatTime, isoDay, parseDay, parseDayInYear, printDateTime, printDay, typeDate } from './dates.ts'

afterEach(() => applyLanguage('en'))

describe('the one date form per language', () => {
  it('writes a calendar date as the language does', () => {
    expect(formatDay('2026-10-05')).toBe('2026-10-05')
    applyLanguage('lt')
    expect(formatDay('2026-10-05')).toBe('2026.10.05')
    applyLanguage('ru')
    expect(formatDay('2026-10-05')).toBe('05.10.2026')
    expect(formatDay('not a day')).toBe('not a day')
  })
  it('writes timestamps in it, in the organisation timezone', () => {
    applyLanguage('lt')
    expect(formatDateTime('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('2026.09.24 01:30')
    expect(formatDate('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('2026.09.24')
    expect(formatTime('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('01:30')
    applyLanguage('ru')
    expect(formatDateTime('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('24.09.2026 01:30')
    // Printed documents' and the API's forms do not follow the language.
    expect(printDateTime('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('2026 09 24 01:30')
    expect(printDay('2026-10-15')).toBe('2026 10 15')
    expect(printDay('—')).toBe('—')
    expect(isoDay('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('2026-09-24')
    expect(isoDay('garbage', 'UTC')).toBe('')
  })
})

describe('typed dates', () => {
  it('reads the language form, and a date pasted in another', () => {
    applyLanguage('lt')
    expect(parseDay('2026.10.15')).toBe('2026-10-15')
    expect(parseDay(' 2026-10-15 ')).toBe('2026-10-15')
    expect(parseDay('2026.1.5')).toBe('2026-01-05')
    expect(parseDay('15.10.2026')).toBe('2026-10-15')
    expect(parseDay('15/10/2026')).toBe('2026-10-15')
    expect(parseDay('20261015')).toBe('2026-10-15')
    applyLanguage('ru')
    expect(parseDay('15.10.2026')).toBe('2026-10-15')
    expect(parseDay('15102026')).toBe('2026-10-15')
  })
  it('refuses what is not a real day', () => {
    for (const bad of ['', '2026.10', '2026.13.01', '2026.02.29', '2026.04.31', '2026.00.10', '202610.10.15', '15.10.26', '1899.12.31', 'abc', '2026.10.15x']) {
      expect(parseDay(bad), bad).toBeNull()
    }
    expect(parseDay('2028.02.29')).toBe('2028-02-29')
  })
  it('adds the separators as the parts are typed, never doubled', () => {
    applyLanguage('lt')
    expect(typeDate('202', '2026')).toBe('2026.')
    expect(typeDate('2026.1', '2026.10')).toBe('2026.10.')
    expect(typeDate('2026.10.1', '2026.10.15')).toBe('2026.10.15')
    expect(typeDate('2026.', '2026..')).toBe('2026.')
    expect(typeDate('2026', '2026-')).toBe('2026.')
    expect(typeDate('', '.')).toBe('')
    // Deleting, pasting and editing inside are left alone.
    expect(typeDate('2026.', '2026')).toBe('2026')
    expect(typeDate('', '15.10.2026')).toBe('15.10.2026')
    expect(typeDate('2026.10.15', '2026.1.15')).toBe('2026.1.15')
    applyLanguage('ru')
    expect(typeDate('1', '15')).toBe('15.')
    expect(typeDate('15.1', '15.10')).toBe('15.10.')
    expect(typeDate('15.10.202', '15.10.2026')).toBe('15.10.2026')
  })
  it('starts a field typed from empty in the current year, which can be typed over', () => {
    applyLanguage('lt')
    expect(typeDate('', '1', '2026')).toBe('2026.1')
    expect(typeDate('2026.1', '2026.10', '2026')).toBe('2026.10.')
    expect(typeDate('2026.10.1', '2026.10.15', '2026')).toBe('2026.10.15')
    // Another year: two digits no month has.
    expect(typeDate('2026.2', '2026.20', '2026')).toBe('20')
    expect(typeDate('2026.1', '2026.19', '2026')).toBe('19')
    expect(typeDate('20', '202', '2026')).toBe('202')
    expect(typeDate('202', '2025', '2026')).toBe('2025.')
    // Only from empty: a field with text keeps it; a pasted date is read as it is.
    expect(typeDate('2025.', '2025.1', '2026')).toBe('2025.1')
    expect(typeDate('', '15.10.2025', '2026')).toBe('15.10.2025')
    applyLanguage('en')
    expect(typeDate('', '3', '2026')).toBe('2026-3')
    applyLanguage('ru')
    expect(typeDate('', '1', '2026')).toBe('1')
    expect(typeDate('15.1', '15.10', '2026')).toBe('15.10.2026')
    expect(typeDate('15.10.2026', '15.10.20262', '2026')).toBe('15.10.2')
    expect(typeDate('15.10.202', '15.10.2025', '2026')).toBe('15.10.2025')
  })
  it('reads a day and month without a year in the current one', () => {
    applyLanguage('lt')
    expect(parseDayInYear('10.15', '2026')).toBe('2026-10-15')
    expect(parseDayInYear('2.3.', '2026')).toBe('2026-02-03')
    expect(parseDayInYear('2026.10', '2026')).toBeNull()
    expect(parseDayInYear('13.01', '2026')).toBeNull()
    applyLanguage('ru')
    expect(parseDayInYear('15.10', '2026')).toBe('2026-10-15')
    expect(parseDayInYear('5.1.', '2026')).toBe('2026-01-05')
  })
})

describe('absolute dates', () => {
  it('formats timestamps in the organisation timezone', () => {
    expect(formatDateTime('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('2026-09-24 01:30')
    expect(formatDateTime('2026-09-23T22:30:00Z', 'UTC')).toBe('2026-09-23 22:30')
    expect(formatDateTime('garbage', 'UTC')).toBe('—')
  })
  it('shows a short date in the organisation timezone', () => {
    expect(formatShortDate('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('24 Sept')
    expect(formatShortDate('2026-09-23T22:30:00Z', 'UTC')).toBe('23 Sept')
    expect(formatShortDate('garbage', 'UTC')).toBe('—')
  })
})

describe('relative dates', () => {
  const tz = 'Europe/Vilnius'
  // 29 Sep 2026, 10:00 in Vilnius.
  const now = new Date('2026-09-29T07:00:00Z')
  it('names the nearest days, in the organisation calendar', () => {
    expect(formatRelative('2026-09-29T05:30:00Z', now, tz)).toBe('today')
    expect(formatRelative('2026-09-29T05:30:00Z', now, tz, { time: true })).toBe('today 08:30')
    // 23:30 UTC on the 28th is already the 29th in Vilnius.
    expect(formatRelative('2026-09-28T23:30:00Z', now, tz)).toBe('today')
    expect(formatRelative('2026-09-28T12:00:00Z', now, tz, { time: true })).toBe('yesterday 15:00')
    expect(formatRelative('2026-09-26T12:00:00Z', now, tz)).toBe('3 days ago')
    expect(formatRelative('2026-09-30T12:00:00Z', now, tz, { time: true })).toBe('tomorrow')
    expect(formatRelative('2026-10-04T12:00:00Z', now, tz)).toBe('in 5 days')
  })
  it('gives the date a week or more away, with the year when it is another', () => {
    expect(formatRelative('2026-09-22T12:00:00Z', now, tz)).toBe('22 Sept')
    expect(formatRelative('2026-10-06T12:00:00Z', now, tz)).toBe('6 Oct')
    expect(formatRelative('2025-12-30T12:00:00Z', now, tz)).toBe('2025-12-30')
    expect(formatRelative('nonsense', now, tz)).toBe('—')
  })
  it('capitalizes for a table cell', () => {
    expect(capitalize('today 08:30')).toBe('Today 08:30')
    expect(capitalize('22 Sept')).toBe('22 Sept')
  })
})
