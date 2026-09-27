import { describe, expect, it } from 'vitest'

import { activityAt, formatDateTime, formatUsage, formatWaiting, historyActions, looksLikeRecord, waitingDays } from './history'

describe('historyActions', () => {
  it('follows the action visibility table', () => {
    expect(historyActions('ORDERED')).toEqual(['viewItems', 'openConfirmation', 'copyWhatsApp'])
    expect(historyActions('GIVEN')).toEqual(['viewItems', 'viewRecord', 'printRecord', 'shareWhatsApp'])
    expect(historyActions('GIVEN')).not.toContain('openConfirmation')
  })
})

describe('display', () => {
  it('formats usage time with one decimal', () => {
    expect(formatUsage(2.1)).toBe('2.1 months')
    expect(formatUsage(0)).toBe('0.0 months')
    expect(formatUsage(null)).toBe('')
  })
  it('formats timestamps in the organisation timezone', () => {
    expect(formatDateTime('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('2026-09-24 01:30')
    expect(formatDateTime('2026-09-23T22:30:00Z', 'UTC')).toBe('2026-09-23 22:30')
    expect(formatDateTime('garbage', 'UTC')).toBe('—')
  })
  it('uses given_at as activity when present', () => {
    expect(activityAt({ given_at: 'g', ordered_at: 'o' })).toBe('g')
    expect(activityAt({ given_at: null, ordered_at: 'o' })).toBe('o')
  })
})

describe('waiting for confirmation', () => {
  it('counts calendar days in the organisation timezone', () => {
    const now = new Date('2026-09-27T06:00:00Z') // 09:00 in Vilnius
    expect(waitingDays('2026-09-15T06:30:00Z', now, 'Europe/Vilnius')).toBe(12)
    // 23:30 yesterday in Vilnius, 20:30 UTC: one day, though under nine hours ago.
    expect(waitingDays('2026-09-26T20:30:00Z', now, 'Europe/Vilnius')).toBe(1)
    // 00:30 today in Vilnius is still 26 September in UTC.
    expect(waitingDays('2026-09-26T21:30:00Z', now, 'Europe/Vilnius')).toBe(0)
    expect(waitingDays('2026-09-26T21:30:00Z', now, 'UTC')).toBe(1)
  })
  it('says it in words', () => {
    expect(formatWaiting(0)).toBe('today')
    expect(formatWaiting(1)).toBe('1 day')
    expect(formatWaiting(12)).toBe('12 days')
  })
})

describe('record number search', () => {
  it('recognises a record number however it is typed', () => {
    for (const q of ['WE-000004', 'we4', 'WE 12', ' 000123 ', '7']) expect(looksLikeRecord(q)).toBe(true)
    for (const q of ['', 'WE-', 'Ona', 'WE-12a', 'gloves 10']) expect(looksLikeRecord(q)).toBe(false)
  })
})
