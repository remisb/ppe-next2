import type { AppChannel, LauncherApp, LauncherList } from '@ppe/api-client'
import { currentLang } from '@ppe/i18n'

import { launcherText } from './text.ts'

/**
 * Published apps' channels (ADR 0006, phase 3): names that point at one
 * version of an app, Stable for everyone the tile is for, Beta, Preview and
 * named variants for testers or a chosen audience. The list the API gave holds
 * the ones each user sees and the one they chose.
 */

/** The fixed channels; any other name is a variant. */
export const FIXED_CHANNELS = ['stable', 'beta', 'preview'] as const

export const isVariant = (name: string) => !(FIXED_CHANNELS as readonly string[]).includes(name)

/** The channels of a published app the user sees, Stable first; none for an app on an address of its own. */
export const channelsOf = (list: LauncherList | null, slug: string): AppChannel[] => list?.channels?.[slug] ?? []

/** The channel the user opens an app on: the one they chose, else Stable. */
export const chosenChannel = (list: LauncherList | null, slug: string): string => list?.choices?.[slug] ?? 'stable'

/** Where a channel of a published app opens: Stable at the app's address, any other under it. */
export function channelHref(app: LauncherApp, channel: string): string {
  if (channel === 'stable' || !app.href.endsWith('/')) return app.href
  return `${app.href}${channel}/`
}

/** Where a tile opens: a published app on the user's chosen channel, anything else at its address. */
export function openHref(app: LauncherApp, list: LauncherList | null): string {
  if (app.kind !== 'app' || channelsOf(list, app.slug).length === 0) return app.href
  return channelHref(app, chosenChannel(list, app.slug))
}

/** A channel's name in the language in use: Stable, Beta, Preview, a variant's label, or a version's name. */
export function channelName(name: string, channels: readonly AppChannel[] = []): string {
  const t = launcherText()
  if (name === 'stable' || name === 'beta' || name === 'preview') return t.channels[name]
  if (name.startsWith('@')) return name.slice(1)
  const c = channels.find((x) => x.name === name)
  return (c && (c.label[currentLang()] || c.label.en)) || name
}

/**
 * Whether the user may stay on the channel the page was opened on (appChannel
 * from @ppe/routing): Stable, and any channel they see; a version's own
 * address (@<version>) for testers and whoever manages apps. Anyone else goes
 * to Stable.
 */
export function mayOpenChannel(list: LauncherList, slug: string, channel: string | null, managesApps: boolean): boolean {
  if (!channel || channel === 'stable') return true
  if (channel.startsWith('@')) return list.preview || managesApps
  return channelsOf(list, slug).some((c) => c.name === channel)
}
