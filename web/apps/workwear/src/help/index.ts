import type { Lang } from '../i18n/current'

import { en } from './en'
import type { Guide } from './guide'
import { lt } from './lt'
import { ru } from './ru'

export type { Device, Guide, Section, Block, Item, Shot, ShotName } from './guide'
export { deviceFor, deviceOrder, forReader, inline, isFor, shotPath } from './guide'

/** The user guide in each language the app speaks. */
export const guides: Record<Lang, Guide> = { en, lt, ru }
