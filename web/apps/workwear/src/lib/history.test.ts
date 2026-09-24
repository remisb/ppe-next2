import { describe, expect, it } from 'vitest'

import { activityAt, formatDateTime, formatUsage, historyActions } from './history'

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
