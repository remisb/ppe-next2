import type { Client, LauncherApp, LauncherList } from '@ppe/api-client'
import { applyLanguage } from '@ppe/i18n'
import { dictionaryProblems, noProblems } from '@ppe/i18n/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasSeveralApps, inTesting } from './catalogue.ts'
import { loadLauncher, rememberPins } from './load.ts'
import { RECENT_MAX, loadRecent, noteOpened, takeDevicePins, togglePin } from './places.ts'
import { tile } from './testing.ts'
import { appName, dictionaries, launcherText, parentName } from './text.ts'

afterEach(() => applyLanguage('en'))

describe('the rules over a user’s tiles', () => {
  it('counts apps, never shortcuts, for "several apps"', () => {
    const workwear = tile('workwear')
    const orders = tile('orders', { kind: 'shortcut', parent: 'workwear' })
    expect(hasSeveralApps([workwear, orders])).toBe(false)
    expect(hasSeveralApps([workwear, orders, tile('admin')])).toBe(true)
  })

  it('knows the apps in testing', () => {
    expect(['live', 'pilot', 'poc', 'dev'].map((stage) => inTesting(tile('x', { stage: stage as LauncherApp['stage'] })))).toEqual([false, false, true, true])
  })

  it('names a tile in the language in use, and a shortcut’s app', () => {
    const workwear = tile('workwear', { names: { en: 'Workwear & Equipment', lt: 'Darbo drabužiai ir įranga', ru: 'Спецодежда и снаряжение' } })
    const orders = tile('orders', { kind: 'shortcut', parent: 'workwear' })
    expect(appName(workwear)).toBe('Workwear & Equipment')
    applyLanguage('lt')
    expect(appName(workwear)).toBe('Darbo drabužiai ir įranga')
    expect(parentName(orders, [workwear, orders])).toBe('Darbo drabužiai ir įranga')
    expect(parentName(orders, [orders])).toBeUndefined()
  })
})

describe('loading', () => {
  it('asks the API once per user, and again after a failure', async () => {
    const list: LauncherList = { apps: [tile('workwear')], pins: [], preview: false, channels: {}, choices: {} }
    const get = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(list)
    const client = { launcher: { get } } as unknown as Client
    await expect(loadLauncher(client, 'u-fail')).rejects.toThrow('offline')
    await Promise.resolve()
    expect(await loadLauncher(client, 'u-fail')).toBe(list)
    expect(await loadLauncher(client, 'u-fail')).toBe(list)
    expect(get).toHaveBeenCalledTimes(2)
    rememberPins('u-fail', ['workwear'])
    expect((await loadLauncher(client, 'u-fail')).pins).toEqual(['workwear'])
  })
})

describe('dictionaries', () => {
  for (const lang of ['lt', 'ru'] as const) {
    it(`${lang} has every English text, none empty and none left in English`, () => {
      expect(dictionaryProblems(dictionaries.en, dictionaries[lang])).toEqual(noProblems)
    })
  }
  it('follows the language in use', () => {
    applyLanguage('ru')
    expect(launcherText().apps).toBe('Приложения')
  })
})

describe('recent apps and pins', () => {
  beforeEach(() => localStorage.clear())

  it('pins and unpins, keeping the order pins were made in', () => {
    expect(togglePin(togglePin([], 'sim-scan'), 'workwear')).toEqual(['sim-scan', 'workwear'])
    expect(togglePin(['sim-scan', 'workwear'], 'sim-scan')).toEqual(['workwear'])
  })

  it('keeps the last opened first, without repeats, up to the limit, per user on this device', () => {
    for (const id of ['workwear', 'sim-scan', 'crew', 'admin', 'orders', 'help', 'employees', 'sim-scan']) noteOpened('u1', id)
    const recent = loadRecent('u1')
    expect(recent).toHaveLength(RECENT_MAX)
    expect(recent[0]).toBe('sim-scan')
    expect(new Set(recent).size).toBe(recent.length)
    expect(loadRecent('u2')).toEqual([])
    localStorage.setItem('workwear.launcher.u3', '{not json')
    expect(loadRecent('u3')).toEqual([])
  })

  it('hands phase 1’s device pins over once, keeping the recent apps', () => {
    localStorage.setItem('workwear.launcher.u1', JSON.stringify({ pinned: ['crew', 'admin'], recent: ['orders'] }))
    expect(takeDevicePins('u1')).toEqual(['crew', 'admin'])
    expect(takeDevicePins('u1')).toEqual([])
    expect(loadRecent('u1')).toEqual(['orders'])
  })
})
