import { channelName as nameIn } from '@remisb/launcher-core'

import { launcherText } from './text.ts'

/**
 * Published apps' channels (ADR 0006, phase 3): @remisb/launcher-core's
 * rules, with channel names in the language in use.
 */
export {
  FIXED_CHANNELS,
  channelHref,
  channelPath,
  channelsOf,
  chosenChannel,
  chosenHref,
  mayOpenChannel,
  mayStay,
  openHref,
  stablePath,
} from '@remisb/launcher-core'

/** A channel's name in the language in use: Stable, Beta, Preview, or a version's name (@<version>). */
export const channelName = (name: string): string => nameIn(name, launcherText())
