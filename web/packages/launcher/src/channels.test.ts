import type { LauncherList } from '@ppe/api-client'
import { applyLanguage } from '@ppe/i18n'
import { afterEach, describe, expect, it } from 'vitest'

import { channelHref, channelName, mayOpenChannel, openHref } from './channels.ts'
import { channel, tile } from './testing.ts'

const scan = tile('sim-scan', { href: '/apps/sim-scan/' })
const photos = channel('photos-first', '2026.11.03-aaa', { label: { en: 'Photos first', lt: 'Pirmiausia nuotraukos', ru: 'Сначала фото' } })
const list = (more: Partial<LauncherList> = {}): LauncherList => ({
  apps: [scan, tile('admin', { href: '/admin/' })],
  pins: [],
  preview: false,
  channels: { 'sim-scan': [channel('stable', '2026.11.04-bbb'), photos] },
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
    expect(openHref(scan, list({ choices: { 'sim-scan': 'photos-first' } }))).toBe('/apps/sim-scan/photos-first/')
    expect(openHref(tile('admin', { href: '/admin/' }), list({ choices: { admin: 'beta' } }))).toBe('/admin/')
  })

  it('names the fixed channels in the language in use, a variant by its label and a version by itself', () => {
    expect(channelName('beta')).toBe('Beta')
    expect(channelName('photos-first', [photos])).toBe('Photos first')
    expect(channelName('@2026.11.03-aaa')).toBe('2026.11.03-aaa')
    applyLanguage('lt')
    expect(channelName('stable')).toBe('Stabili')
    expect(channelName('photos-first', [photos])).toBe('Pirmiausia nuotraukos')
  })

  it('lets a user stay on Stable and the channels they see; a version’s address is for testers and app managers', () => {
    expect(mayOpenChannel(list(), 'sim-scan', null, false)).toBe(true)
    expect(mayOpenChannel(list(), 'sim-scan', 'stable', false)).toBe(true)
    expect(mayOpenChannel(list(), 'sim-scan', 'photos-first', false)).toBe(true)
    expect(mayOpenChannel(list(), 'sim-scan', 'beta', false)).toBe(false)
    expect(mayOpenChannel(list(), 'sim-scan', '@2026.11.03-aaa', false)).toBe(false)
    expect(mayOpenChannel(list({ preview: true }), 'sim-scan', '@2026.11.03-aaa', false)).toBe(true)
    expect(mayOpenChannel(list(), 'sim-scan', '@2026.11.03-aaa', true)).toBe(true)
  })
})
