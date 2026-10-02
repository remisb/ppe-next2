import { describe, expect, it } from 'vitest'

import { activityAt, capitalize, deleteQuestion, formatDateTime, formatRelative, formatShortDate, formatUsage, formatWaiting, historyActions, looksLikeRecord, monthOf, waitingDays } from './history'

describe('historyActions', () => {
  it('follows the action visibility table', () => {
    expect(historyActions('ORDERED')).toEqual(['viewItems', 'openConfirmation'])
    expect(historyActions('GIVEN')).toEqual(['viewItems', 'viewRecord', 'printRecord'])
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

describe('compact rows', () => {
  it('shows a short date in the organisation timezone', () => {
    expect(formatShortDate('2026-09-23T22:30:00Z', 'Europe/Vilnius')).toBe('24 Sept')
    expect(formatShortDate('2026-09-23T22:30:00Z', 'UTC')).toBe('23 Sept')
    expect(formatShortDate('garbage', 'UTC')).toBe('—')
  })
  it('groups by the month in the organisation timezone', () => {
    expect(monthOf('2026-09-30T22:30:00Z', 'Europe/Vilnius')).toEqual({ key: '2026-10', label: 'October 2026' })
    expect(monthOf('2026-09-30T22:30:00Z', 'UTC')).toEqual({ key: '2026-09', label: 'September 2026' })
    expect(monthOf('garbage', 'UTC')).toEqual({ key: '', label: '' })
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

describe('deleteQuestion', () => {
  const o = { record_number: 'WE-000004', employee_first_name: 'Ona', employee_last_name: 'Kazlauskienė' }
  it('names the order and what deleting it does', () => {
    expect(deleteQuestion({ ...o, status: 'ORDERED' })).toBe(
      'Delete WE-000004 for Ona Kazlauskienė? It leaves Orders and the dashboards, and its confirmation link stops working. Only for demo and test orders; this cannot be undone in the app.',
    )
  })
  it('warns that a given order takes its signed record with it', () => {
    expect(deleteQuestion({ ...o, status: 'GIVEN' })).toContain('given and confirmed')
  })
})
