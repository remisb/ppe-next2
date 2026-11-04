import { applyLanguage } from '@ppe/i18n'
import { tile } from '@ppe/launcher/testing'
import { afterEach, describe, expect, it } from 'vitest'

import { deviceOf, matching, pinnedOf, recentOf, sections, shownTiles } from './tiles'

afterEach(() => applyLanguage('en'))

const ids = (xs: { slug: string }[]) => xs.map((x) => x.slug)

const workwear = tile('workwear', { names: { en: 'Workwear & Equipment', lt: 'Darbo drabužiai ir įranga', ru: 'Спецодежда и снаряжение' } })
const orders = tile('orders', { kind: 'shortcut', parent: 'workwear', names: { en: 'Orders', lt: 'Užsakymai', ru: 'Заказы' } })
const createOrder = tile('create-order', { kind: 'shortcut', parent: 'workwear', names: { en: 'Create Order', lt: 'Kurti užsakymą', ru: 'Создать заказ' } })
const simCards = tile('sim-cards', { kind: 'shortcut', parent: 'workwear', group: 'assets', names: { en: 'SIM Cards', lt: 'SIM kortelės', ru: 'SIM-карты' } })
const equipment = tile('equipment', { kind: 'shortcut', parent: 'workwear', group: 'assets', names: { en: 'Equipment', lt: 'Įranga', ru: 'Оборудование' } })
const simScan = tile('sim-scan', { group: 'assets', stage: 'pilot', names: { en: 'Scan SIMs', lt: 'Skenuoti SIM', ru: 'Сканировать SIM' } })
const crew = tile('crew', { group: 'people', tier: 'linked', names: { en: 'PPE Crew', lt: 'PPE Crew', ru: 'PPE Crew' } })
const admin = tile('admin', { group: 'admin', names: { en: 'Administration', lt: 'Administravimas', ru: 'Администрирование' } })
const poc = tile('size-helper', { stage: 'poc', names: { en: 'Size Helper', lt: 'Dydžių pagalbininkas', ru: 'Помощник по размерам' } })
const all = [workwear, createOrder, orders, simCards, equipment, simScan, crew, admin]

describe('matching', () => {
  it('finds tiles by name, by their app and by group, ignoring case', () => {
    expect(ids(matching(all, 'sim'))).toEqual(['sim-cards', 'sim-scan'])
    expect(ids(matching(all, 'COMPANY ASSETS'))).toEqual(['sim-cards', 'equipment', 'sim-scan'])
    expect(ids(matching(all, 'workwear &'))).toContain('orders')
    expect(matching(all, '  ')).toHaveLength(all.length)
  })

  it('reads the language in use, and forgives missing marks', () => {
    applyLanguage('lt')
    expect(ids(matching(all, 'iranga'))).toContain('equipment')
    applyLanguage('ru')
    expect(ids(matching(all, 'заказ'))).toEqual(['create-order', 'orders'])
  })
})

describe('apps in testing', () => {
  it('shows them only with Show apps in testing', () => {
    expect(ids(shownTiles([workwear, poc], false))).toEqual(['workwear'])
    expect(ids(shownTiles([workwear, poc], true))).toEqual(['workwear', 'size-helper'])
  })
})

describe('pinned and recent', () => {
  it('keeps the stored order and drops tiles the user no longer sees', () => {
    const shown = all.filter((a) => a.slug !== 'admin')
    expect(ids(pinnedOf(shown, ['crew', 'admin', 'workwear']))).toEqual(['crew', 'workwear'])
    expect(ids(recentOf(shown, ['admin', 'sim-scan']))).toEqual(['sim-scan'])
  })
})

describe('sections', () => {
  it('lists the groups with tiles, in order, or one group on its shelf', () => {
    expect(sections(all, 'all').map((s) => s.group)).toEqual(['workwear', 'assets', 'people', 'admin'])
    expect(sections(all.filter((a) => a.group !== 'people'), 'all').map((s) => s.group)).toEqual(['workwear', 'assets', 'admin'])
    expect(sections(all, 'assets').map((s) => s.group)).toEqual(['assets'])
  })
})

describe('deviceOf', () => {
  it('names the device by the apps’ breakpoints', () => {
    expect([375, 767, 768, 1023, 1024, 1920].map(deviceOf)).toEqual(['phone', 'phone', 'tablet', 'tablet', 'desktop', 'desktop'])
  })
})
