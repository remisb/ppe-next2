import { applyLanguage } from '@ppe/i18n'
import { APPS } from '@ppe/launcher'
import { afterEach, describe, expect, it } from 'vitest'

import { matching, pinnedOf, recentOf, sections } from './tiles'

afterEach(() => applyLanguage('en'))

const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

describe('matching', () => {
  it('finds tiles by name, by their app and by group, ignoring case', () => {
    expect(ids(matching(APPS, 'sim'))).toEqual(['sim-cards', 'sim-scan'])
    expect(ids(matching(APPS, 'COMPANY ASSETS'))).toEqual(['sim-cards', 'equipment', 'sim-scan'])
    expect(ids(matching(APPS, 'workwear &'))).toContain('orders')
    expect(matching(APPS, '  ')).toHaveLength(APPS.length)
  })

  it('reads the language in use, and forgives missing marks', () => {
    applyLanguage('lt')
    expect(ids(matching(APPS, 'iranga'))).toContain('equipment')
    applyLanguage('ru')
    expect(ids(matching(APPS, 'заказ'))).toEqual(['create-order', 'orders'])
  })
})

describe('pinned and recent', () => {
  it('keeps the stored order and drops tiles the user no longer sees', () => {
    const shown = APPS.filter((a) => a.id !== 'admin')
    const places = { pinned: ['crew', 'admin', 'workwear'], recent: ['admin', 'sim-scan'] }
    expect(ids(pinnedOf(shown, places))).toEqual(['crew', 'workwear'])
    expect(ids(recentOf(shown, places))).toEqual(['sim-scan'])
  })
})

describe('sections', () => {
  it('lists the groups with tiles, in order, or one group on its shelf', () => {
    expect(sections(APPS, 'all').map((s) => s.group)).toEqual(['workwear', 'assets', 'people', 'admin'])
    expect(sections(APPS.filter((a) => a.group !== 'people'), 'all').map((s) => s.group)).toEqual(['workwear', 'assets', 'admin'])
    expect(sections(APPS, 'assets').map((s) => s.group)).toEqual(['assets'])
  })
})
