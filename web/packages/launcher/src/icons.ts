import type { AppIcon } from '@ppe/api-client'
import { appIcons as pictures } from '@remisb/launcher-react'
import type { LucideIcon } from 'lucide-react'

/** The picture drawn for each of a tile's icons (the API's launcherConfig.Icons, app-icons.ts). */
export const appIcons = pictures as Record<AppIcon, LucideIcon>
