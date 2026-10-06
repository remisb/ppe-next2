import { describe, expect, it } from 'vitest'

import { capitalize, formatDateTime, formatRelative, formatShortDate } from './dates.ts'

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
    expect(formatRelative('2025-12-30T12:00:00Z', now, tz)).toBe('30 Dec 2025')
    expect(formatRelative('nonsense', now, tz)).toBe('—')
  })
  it('capitalizes for a table cell', () => {
    expect(capitalize('today 08:30')).toBe('Today 08:30')
    expect(capitalize('22 Sept')).toBe('22 Sept')
  })
})
