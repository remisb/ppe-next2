import type { AppGroup, FeedbackDevice, LauncherApp } from '@ppe/api-client'
import { APP_GROUPS, appName, inTesting, launcherText, parentName } from '@ppe/launcher'

/** What the launcher shows: everything, the pinned tiles, or one group (the rail, from lg). */
export type Shelf = 'all' | 'pinned' | AppGroup

/** Ignores case and Lithuanian and Russian marks a phone keyboard may leave out: "isige" finds "Įranga". */
const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/**
 * The tiles to show: apps in testing (POC, In development) only when a tester
 * turned on Show apps in testing; the API sends them to testers alone.
 */
export const shownTiles = (apps: readonly LauncherApp[], showTesting: boolean) => apps.filter((a) => showTesting || !inTesting(a))

/** The tiles whose name, app or group has what was typed, in the language in use. */
export function matching(apps: readonly LauncherApp[], q: string): LauncherApp[] {
  const term = fold(q.trim())
  if (!term) return [...apps]
  const groups = launcherText().groups
  return apps.filter((a) => [appName(a), parentName(a, apps) ?? '', groups[a.group]].some((s) => fold(s).includes(term)))
}

const inOrder = (apps: readonly LauncherApp[], slugs: readonly string[]) =>
  slugs.map((slug) => apps.find((a) => a.slug === slug)).filter((a): a is LauncherApp => a !== undefined)

/** The pinned tiles a user sees, in the order they were pinned. */
export const pinnedOf = (apps: readonly LauncherApp[], pins: readonly string[]) => inOrder(apps, pins)

/** The recently opened tiles a user sees, newest first. */
export const recentOf = (apps: readonly LauncherApp[], recent: readonly string[]) => inOrder(apps, recent)

/** The groups with tiles, each with its tiles, in the groups' order; one group only on its shelf. */
export function sections(apps: readonly LauncherApp[], shelf: Shelf): { group: AppGroup; apps: LauncherApp[] }[] {
  return APP_GROUPS.filter((g) => shelf === 'all' || shelf === g)
    .map((group) => ({ group, apps: apps.filter((a) => a.group === group) }))
    .filter((s) => s.apps.length > 0)
}

/** The device feedback was sent from, by the window's width (the apps' breakpoints, md and lg). */
export const deviceOf = (width: number): FeedbackDevice => (width < 768 ? 'phone' : width < 1024 ? 'tablet' : 'desktop')
