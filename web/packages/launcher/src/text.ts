import type { AppGroup, LauncherApp } from '@ppe/api-client'
import { currentLang, localized } from '@ppe/i18n'
import { appName as nameIn, appNames as namesIn, dictionaries as words, parentName as parentIn, type Words } from '@remisb/launcher-core'

/**
 * App Launcher's words, in each language: @remisb/launcher-core's, with this
 * site's group names (the API's launcherConfig.Groups). Tiles' names come
 * with them from the registry.
 */
const groups = {
  en: { workwear: 'Workwear & PPE', assets: 'Company Assets', people: 'People & Crew', admin: 'Administration' },
  lt: { workwear: 'Darbo drabužiai ir AAP', assets: 'Įmonės turtas', people: 'Žmonės ir brigados', admin: 'Administravimas' },
  ru: { workwear: 'Спецодежда и СИЗ', assets: 'Имущество компании', people: 'Люди и бригады', admin: 'Администрирование' },
} satisfies Record<'en' | 'lt' | 'ru', Record<AppGroup, string>>

type Messages = Words & { groups: Record<AppGroup, string> }

export const dictionaries: Record<'en' | 'lt' | 'ru', Messages> = {
  en: { ...words.en!, groups: groups.en },
  lt: { ...words.lt!, groups: groups.lt },
  ru: { ...words.ru!, groups: groups.ru },
}

/** The launcher's words in the language in use. Never read at module level. */
export const launcherText = localized(dictionaries)

/** A tile's name in the language in use. */
export const appName = (app: LauncherApp): string => nameIn(app, currentLang())

/** The apps' names by slug, in the language in use: what the Audit log, System and Usage call a source. */
export const appNames = (apps: readonly LauncherApp[]): Record<string, string> => namesIn(apps, currentLang())

/** The name of a shortcut's app, when it is one and the app is in the list. */
export const parentName = (app: LauncherApp, apps: readonly LauncherApp[]): string | undefined => parentIn(app, apps, currentLang())
