import type { LauncherList } from '@ppe/api-client'
import { applyLanguage } from '@ppe/i18n'
import { afterEach, describe, expect, it } from 'vitest'

import { channelHref, channelName, channelPath, chosenHref, mayOpenChannel, mayStay, openHref, stablePath } from './channels.ts'
import { channel, tile } from './testing.ts'

const scan = tile('sim-scan', { href: '/apps/sim-scan/' })
const preview = channel('preview', '2026.11.03-aaa')
const list = (more: Partial<LauncherList> = {}): LauncherList => ({
  apps: [scan, tile('admin', { href: '/admin/' })],
  pins: [],
  preview: false,
  channels: { 'sim-scan': [channel('stable', '2026.11.04-bbb'), preview] },
  choices: {},
  ...more,
})

afterEach(() => applyLanguage('en'))

describe('channels', () => {
  it('opens Stable at the app’s address and any other channel under it', () => {
    expect(channelHref(scan, 'stable')).toBe('/apps/sim-scan/')
    expect(channelHref(scan, 'beta')).toBe('/apps/sim-scan/beta/')
  })

  it('opens a published app on the channel the user chose, and anything else at its address', () => {
    expect(openHref(scan, list())).toBe('/apps/sim-scan/')
    expect(openHref(scan, list({ choices: { 'sim-scan': 'preview' } }))).toBe('/apps/sim-scan/preview/')
    expect(openHref(tile('admin', { href: '/admin/' }), list({ choices: { admin: 'beta' } }))).toBe('/admin/')
  })

  it('names the channels in the language in use, and a version by itself', () => {
    expect(channelName('beta')).toBe('Beta')
    expect(channelName('preview')).toBe('Preview')
    expect(channelName('@2026.11.03-aaa')).toBe('2026.11.03-aaa')
    applyLanguage('lt')
    expect(channelName('stable')).toBe('Stabili')
  })

  it('lets a user stay on Stable and the channels they see; a version’s address is for testers and app managers', () => {
    expect(mayOpenChannel(list(), 'sim-scan', null, false)).toBe(true)
    expect(mayOpenChannel(list(), 'sim-scan', 'stable', false)).toBe(true)
    expect(mayOpenChannel(list(), 'sim-scan', 'preview', false)).toBe(true)
    expect(mayOpenChannel(list(), 'sim-scan', 'beta', false)).toBe(false)
    expect(mayOpenChannel(list(), 'sim-scan', '@2026.11.03-aaa', false)).toBe(false)
    expect(mayOpenChannel(list({ preview: true }), 'sim-scan', '@2026.11.03-aaa', false)).toBe(true)
    expect(mayOpenChannel(list(), 'sim-scan', '@2026.11.03-aaa', true)).toBe(true)
  })

  it('keeps a page on its channel while the list loads, and fails closed when it cannot load', () => {
    expect(mayStay(null, false, 'sim-scan', 'beta', false)).toBe(true)
    expect(mayStay(null, true, 'sim-scan', 'beta', false)).toBe(false)
    expect(mayStay(null, true, 'sim-scan', '@2026.11.03-aaa', true)).toBe(false)
    expect(mayStay(null, true, 'sim-scan', 'stable', false)).toBe(true)
    expect(mayStay(null, true, 'sim-scan', null, false)).toBe(true)
    expect(mayStay(list(), false, 'sim-scan', 'preview', false)).toBe(true)
    expect(mayStay(list(), false, 'sim-scan', 'beta', false)).toBe(false)
  })

  it('asks for Stable on purpose at /stable/, which no choice redirects', () => {
    expect(stablePath('sim-scan', '/find', '?q=1')).toBe('/apps/sim-scan/stable/find?q=1')
    expect(stablePath('sim-scan', '/')).toBe('/apps/sim-scan/stable/')
    const chose = list({ choices: { 'sim-scan': 'preview' } })
    expect(chosenHref(chose, 'sim-scan', 'stable', '/apps/sim-scan/stable', '/apps/sim-scan/stable/find')).toBeNull()
    expect(chosenHref(chose, 'sim-scan', 'stable', '/apps/sim-scan', '/apps/sim-scan/find')).toBe('/apps/sim-scan/preview/find')
  })

  it('opens the screen asked for on another channel, Stable at the app’s own address', () => {
    expect(channelPath('sim-scan', 'stable', '/find', '?q=1')).toBe('/apps/sim-scan/find?q=1')
    expect(channelPath('sim-scan', 'beta', '/')).toBe('/apps/sim-scan/beta/')
  })

  it('takes a user who chose another channel there from the Stable address, and no one else', () => {
    const chose = list({ choices: { 'sim-scan': 'preview' } })
    expect(chosenHref(chose, 'sim-scan', 'stable', '/apps/sim-scan', '/apps/sim-scan/find', '?x=1')).toBe('/apps/sim-scan/preview/find?x=1')
    expect(chosenHref(chose, 'sim-scan', 'stable', '/apps/sim-scan', '/apps/sim-scan/')).toBe('/apps/sim-scan/preview/')
    // /stable/ asks for Stable on purpose; a channel page stays; no choice, or one no longer seen, stays.
    expect(chosenHref(chose, 'sim-scan', 'stable', '/apps/sim-scan/stable', '/apps/sim-scan/stable/')).toBeNull()
    expect(chosenHref(chose, 'sim-scan', 'preview', '/apps/sim-scan/preview', '/apps/sim-scan/preview/')).toBeNull()
    expect(chosenHref(list(), 'sim-scan', 'stable', '/apps/sim-scan', '/apps/sim-scan/')).toBeNull()
    expect(chosenHref(list({ choices: { 'sim-scan': 'beta' } }), 'sim-scan', 'stable', '/apps/sim-scan', '/apps/sim-scan/')).toBeNull()
    expect(chosenHref(null, 'sim-scan', 'stable', '/apps/sim-scan', '/apps/sim-scan/')).toBeNull()
  })
})

