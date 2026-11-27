import type { Client, LauncherApp, LauncherList } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { loadLauncher as load } from '@remisb/launcher-core'
import { type Launcher as Loaded, useLauncherList } from '@remisb/launcher-react'

/**
 * One GET /api/v1/launcher per signed-in user and page (@remisb/launcher-core
 * keeps it): every app's frame asks (for its Apps entry), the staff app at
 * sign-in, and the launcher.
 */
export const loadLauncher = (client: Client, userId: string): Promise<LauncherList> => load(client.launcher, userId)

export { rememberChoice, rememberPins } from '@remisb/launcher-core'

export type Launcher = Loaded<LauncherApp>

/**
 * The signed-in user's launcher list (null for no one), given only to that
 * user: on a shared device the next person to sign in never sees the
 * previous one's tiles, pins and channels.
 */
export function useLauncher(): Launcher {
  const { client, session } = useApi()
  return useLauncherList(client.launcher, session?.userId)
}
