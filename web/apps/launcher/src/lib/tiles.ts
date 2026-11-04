import { APP_GROUPS, type AppGroup, type LauncherApp, type Places, appName, launcherText, parentName } from '@ppe/launcher'

/** What the launcher shows: everything, the pinned tiles, or one group (the rail, from lg). */
export type Shelf = 'all' | 'pinned' | AppGroup

/** Ignores case and Lithuanian and Russian marks a phone keyboard may leave out: "isige" finds "Įranga". */
const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** The tiles whose name, app or group has what was typed, in the language in use. */
export function matching(apps: readonly LauncherApp[], q: string): LauncherApp[] {
  const term = fold(q.trim())
  if (!term) return [...apps]
  const groups = launcherText().groups
  return apps.filter((a) => [appName(a), parentName(a) ?? '', groups[a.group]].some((s) => fold(s).includes(term)))
}

/** The pinned tiles a user still sees, in the order they were pinned. */
export const pinnedOf = (apps: readonly LauncherApp[], places: Places) =>
  places.pinned.map((id) => apps.find((a) => a.id === id)).filter((a): a is LauncherApp => a !== undefined)

/** The recently opened tiles a user still sees, newest first. */
export const recentOf = (apps: readonly LauncherApp[], places: Places) =>
  places.recent.map((id) => apps.find((a) => a.id === id)).filter((a): a is LauncherApp => a !== undefined)

/** The groups with tiles, each with its tiles, in the groups' order; one group only on its shelf. */
export function sections(apps: readonly LauncherApp[], shelf: Shelf): { group: AppGroup; apps: LauncherApp[] }[] {
  return APP_GROUPS.filter((g) => shelf === 'all' || shelf === g)
    .map((group) => ({ group, apps: apps.filter((a) => a.group === group) }))
    .filter((s) => s.apps.length > 0)
}
