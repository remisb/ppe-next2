import type { Permission } from '@ppe/api-client'
import { applyLanguage } from '@ppe/i18n'
import { dictionaryProblems, noProblems } from '@ppe/i18n/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APPS, hasSeveralApps, visibleApps } from './catalogue.ts'
import { type Places, RECENT_MAX, loadPlaces, noteOpened, savePlaces, togglePin } from './places.ts'
import { appName, dictionaries, launcherText, parentName } from './text.ts'

const holding =
  (...perms: Permission[]) =>
  (p: Permission) =>
    perms.includes(p)

// The built-in roles' permissions that decide tiles (internal/domain/role/builtin.go).
const administrator = holding('users.manage', 'roles.manage', 'audit.read', 'assets.manage', 'sim_codes.read', 'dashboard.overview')
const manager = holding('users.read', 'assets.manage', 'dashboard.manager')
const employeeRole = holding('item_sets.read', 'dashboard.employee')
const equipmentRole = holding('equipment.read')

const ids = (can: (p: Permission) => boolean) => visibleApps(can).map((a) => a.id)

describe('who sees which tile', () => {
  it('shows an administrator every app but Equipment', () => {
    expect(ids(administrator)).toEqual(['workwear', 'dashboard', 'create-order', 'orders', 'employees', 'help', 'sim-cards', 'sim-scan', 'crew', 'admin'])
  })

  it('shows a manager Workwear, Scan SIMs and PPE Crew, not Administration', () => {
    const shown = ids(manager)
    expect(shown).toContain('sim-scan')
    expect(shown).toContain('crew')
    expect(shown).not.toContain('admin')
  })

  it('gives the employee role and Equipment Assignments one app each', () => {
    expect(visibleApps(employeeRole).filter((a) => a.kind === 'app').map((a) => a.id)).toEqual(['workwear'])
    expect(ids(equipmentRole)).toContain('equipment')
    expect(hasSeveralApps(employeeRole)).toBe(false)
    expect(hasSeveralApps(equipmentRole)).toBe(false)
  })

  it('lands users with more than one app on the launcher', () => {
    expect(hasSeveralApps(administrator)).toBe(true)
    expect(hasSeveralApps(manager)).toBe(true)
    // Administration alone, with Workwear, is two.
    expect(hasSeveralApps(holding('audit.read'))).toBe(true)
  })
})

describe('the list', () => {
  it('has unique ids, shortcuts into known apps, and https for linked sites', () => {
    expect(new Set(APPS.map((a) => a.id)).size).toBe(APPS.length)
    for (const a of APPS) {
      if (a.kind === 'shortcut') expect(APPS.find((p) => p.id === a.parent)?.kind).toBe('app')
      if (a.tier === 'linked') expect(a.href).toMatch(/^https:\/\//)
      else expect(a.href).toMatch(/^\/(?!\/)/)
    }
  })

  it('names every tile in every language', () => {
    for (const lang of ['en', 'lt', 'ru'] as const) {
      applyLanguage(lang)
      for (const a of APPS) expect(appName(a)).not.toBe(a.id)
    }
    applyLanguage('en')
    expect(parentName(APPS.find((a) => a.id === 'sim-cards')!)).toBe('Workwear & Equipment')
  })
})

describe('dictionaries', () => {
  afterEach(() => applyLanguage('en'))
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

describe('pinned and recent apps', () => {
  beforeEach(() => localStorage.clear())

  it('pins and unpins, keeping the order pins were made in', () => {
    let p: Places = { pinned: [], recent: [] }
    p = togglePin(togglePin(p, 'sim-scan'), 'workwear')
    expect(p.pinned).toEqual(['sim-scan', 'workwear'])
    expect(togglePin(p, 'sim-scan').pinned).toEqual(['workwear'])
  })

  it('keeps the last opened first, without repeats, up to the limit', () => {
    let p: Places = { pinned: [], recent: [] }
    for (const id of ['workwear', 'sim-scan', 'crew', 'admin', 'orders', 'help', 'employees', 'sim-scan']) p = noteOpened(p, id)
    expect(p.recent).toHaveLength(RECENT_MAX)
    expect(p.recent[0]).toBe('sim-scan')
    expect(new Set(p.recent).size).toBe(p.recent.length)
  })

  it('keeps them per user on this device, dropping apps that no longer exist', () => {
    savePlaces('u1', { pinned: ['crew', 'gone'], recent: ['admin'] })
    expect(loadPlaces('u1')).toEqual({ pinned: ['crew'], recent: ['admin'] })
    expect(loadPlaces('u2')).toEqual({ pinned: [], recent: [] })
    localStorage.setItem('workwear.launcher.u3', '{not json')
    expect(loadPlaces('u3')).toEqual({ pinned: [], recent: [] })
  })
})
