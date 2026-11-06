import type { AppGroup, AppStage, FeedbackRating, LauncherApp } from '@ppe/api-client'
import { currentLang, localized } from '@ppe/i18n'

import { appBySlug } from './catalogue.ts'

/**
 * App Launcher's words, in each language: the launcher at /apps/ and every
 * app's Apps entry. Tiles' names come with them from the registry.
 */
const en = {
  apps: 'Apps',
  launcherName: 'App Launcher',
  signInTagline: 'Every app your work needs, in one place.',
  skipToContent: 'Skip to content',
  search: 'Search apps and screens',
  noMatch: (q: string) => `No app or screen matches “${q}”.`,
  pinned: 'Pinned',
  recent: 'Recent',
  groups: { workwear: 'Workwear & PPE', assets: 'Company Assets', people: 'People & Crew', admin: 'Administration' } satisfies Record<AppGroup, string>,
  stages: { live: 'Live', pilot: 'Pilot', poc: 'POC', dev: 'In development', retired: 'Retired' } satisfies Record<AppStage, string>,
  showTesting: 'Show apps in testing',
  showTestingHint: 'POC and In development apps, for testers.',
  loadFailed: 'The apps could not be loaded.',
  pinsNotSaved: 'Your pins could not be saved.',
  choiceNotSaved: 'Your choice of version could not be saved.',
  retry: 'Try again',
  about: 'About',
  feedback: 'Feedback',
  feedbackAsk: (app: string) => `How did ${app} work for you?`,
  ratings: { works: 'Works well', confusing: 'Confusing', broken: 'Something broke' } satisfies Record<FeedbackRating, string>,
  feedbackText: 'What were you trying to do?',
  sendFeedback: 'Send feedback',
  feedbackSent: (app: string) => `Thanks. The ${app} team will read it.`,
  chooseRating: 'Choose how it worked.',
  moreAbout: (name: string) => `More about ${name}`,
  stage: 'Stage',
  address: 'Address',
  where: 'Where it runs',
  here: 'On this site, with your sign-in',
  linked: 'Another site, with its own sign-in',
  screenIn: (app: string) => `A screen in ${app}`,
  newTab: 'Opens in a new tab',
  open: 'Open',
  pin: 'Pin',
  unpin: 'Unpin',
  close: 'Close',
  account: 'Account',
  signOut: 'Sign out',
  channels: { stable: 'Stable', beta: 'Beta', preview: 'Preview' } as Record<'stable' | 'beta' | 'preview', string>,
  versions: 'Versions',
  version: 'Version',
  versionsHint: 'Choose which version of the app opens for you. Stable is the one everyone uses.',
  published: (date: string) => `Published ${date}`,
  onChannel: (channel: string) => `You are using ${channel}`,
  backToStable: 'Back to Stable',
  channelChosen: (channel: string) => `Opens on ${channel} for you.`,
}

type Messages = typeof en

const lt: Messages = {
  apps: 'Programos',
  launcherName: 'Programų sąrašas',
  signInTagline: 'Visos jūsų darbui reikalingos programos – vienoje vietoje.',
  skipToContent: 'Pereiti prie turinio',
  search: 'Ieškoti programų ir ekranų',
  noMatch: (q) => `Nėra programos ar ekrano „${q}“.`,
  pinned: 'Prisegtos',
  recent: 'Neseniai atidarytos',
  groups: { workwear: 'Darbo drabužiai ir AAP', assets: 'Įmonės turtas', people: 'Žmonės ir brigados', admin: 'Administravimas' },
  stages: { live: 'Veikia', pilot: 'Bandoma', poc: 'Prototipas', dev: 'Kuriama', retired: 'Nebenaudojama' },
  showTesting: 'Rodyti bandomas programas',
  showTestingHint: 'Prototipai ir kuriamos programos – bandytojams.',
  loadFailed: 'Nepavyko įkelti programų.',
  pinsNotSaved: 'Nepavyko išsaugoti prisegtų programų.',
  choiceNotSaved: 'Nepavyko išsaugoti pasirinktos versijos.',
  retry: 'Bandyti dar kartą',
  about: 'Apie',
  feedback: 'Atsiliepimas',
  feedbackAsk: (app) => `Kaip jums sekėsi su „${app}“?`,
  ratings: { works: 'Veikia gerai', confusing: 'Neaišku', broken: 'Kažkas sugedo' },
  feedbackText: 'Ką bandėte padaryti?',
  sendFeedback: 'Siųsti atsiliepimą',
  feedbackSent: (app) => `Ačiū. „${app}“ komanda jį perskaitys.`,
  chooseRating: 'Pasirinkite, kaip sekėsi.',
  moreAbout: (name) => `Daugiau apie „${name}“`,
  stage: 'Etapas',
  address: 'Adresas',
  where: 'Kur veikia',
  here: 'Šioje svetainėje, su jūsų prisijungimu',
  linked: 'Kita svetainė, su savu prisijungimu',
  screenIn: (app) => `Ekranas programoje „${app}“`,
  newTab: 'Atsidaro naujame skirtuke',
  open: 'Atidaryti',
  pin: 'Prisegti',
  unpin: 'Atsegti',
  close: 'Uždaryti',
  account: 'Paskyra',
  signOut: 'Atsijungti',
  channels: { stable: 'Stabili', beta: 'Beta', preview: 'Peržiūra' },
  versions: 'Versijos',
  version: 'Versija',
  versionsHint: 'Pasirinkite, kuri programos versija jums atsidaro. Stabili – ta, kuria naudojasi visi.',
  published: (date) => `Paskelbta ${date}`,
  onChannel: (channel) => `Naudojate: ${channel}`,
  backToStable: 'Grįžti į stabilią',
  channelChosen: (channel) => `Jums atsidarys: ${channel}.`,
}

const ru: Messages = {
  apps: 'Приложения',
  launcherName: 'Список приложений',
  signInTagline: 'Все приложения для вашей работы — в одном месте.',
  skipToContent: 'Перейти к содержимому',
  search: 'Поиск приложений и экранов',
  noMatch: (q) => `Нет приложения или экрана «${q}».`,
  pinned: 'Закреплённые',
  recent: 'Недавние',
  groups: { workwear: 'Спецодежда и СИЗ', assets: 'Имущество компании', people: 'Люди и бригады', admin: 'Администрирование' },
  stages: { live: 'Работает', pilot: 'Пилот', poc: 'Прототип', dev: 'В разработке', retired: 'Выведено из работы' },
  showTesting: 'Показывать приложения на испытании',
  showTestingHint: 'Прототипы и приложения в разработке — для тестировщиков.',
  loadFailed: 'Не удалось загрузить приложения.',
  pinsNotSaved: 'Не удалось сохранить закреплённые приложения.',
  choiceNotSaved: 'Не удалось сохранить выбранную версию.',
  retry: 'Повторить',
  about: 'О приложении',
  feedback: 'Отзыв',
  feedbackAsk: (app) => `Как вам «${app}»?`,
  ratings: { works: 'Работает хорошо', confusing: 'Непонятно', broken: 'Что-то сломалось' },
  feedbackText: 'Что вы пытались сделать?',
  sendFeedback: 'Отправить отзыв',
  feedbackSent: (app) => `Спасибо. Команда «${app}» прочитает отзыв.`,
  chooseRating: 'Выберите, как всё прошло.',
  moreAbout: (name) => `Подробнее: «${name}»`,
  stage: 'Этап',
  address: 'Адрес',
  where: 'Где работает',
  here: 'На этом сайте, с вашим входом',
  linked: 'Другой сайт, со своим входом',
  screenIn: (app) => `Экран в «${app}»`,
  newTab: 'Открывается в новой вкладке',
  open: 'Открыть',
  pin: 'Закрепить',
  unpin: 'Открепить',
  close: 'Закрыть',
  account: 'Учётная запись',
  signOut: 'Выйти',
  channels: { stable: 'Стабильная', beta: 'Бета', preview: 'Предпросмотр' },
  versions: 'Версии',
  version: 'Версия',
  versionsHint: 'Выберите, какая версия приложения открывается у вас. Стабильная — та, которой пользуются все.',
  published: (date) => `Опубликована ${date}`,
  onChannel: (channel) => `Вы используете: ${channel}`,
  backToStable: 'Вернуться к стабильной',
  channelChosen: (channel) => `У вас будет открываться: ${channel}.`,
}

export const dictionaries = { en, lt, ru }

/** The launcher's words in the language in use. Never read at module level. */
export const launcherText = localized(dictionaries)

/** A tile's name in the language in use. */
export function appName(app: LauncherApp): string {
  return app.names[currentLang()] || app.names.en
}

/** The apps' names by slug, in the language in use: what the Audit log, System and Usage call a source. */
export function appNames(apps: readonly LauncherApp[]): Record<string, string> {
  return Object.fromEntries(apps.filter((a) => a.kind === 'app').map((a) => [a.slug, appName(a)]))
}

/** The name of a shortcut's app, when it is one and the app is in the list. */
export function parentName(app: LauncherApp, apps: readonly LauncherApp[]): string | undefined {
  const parent = app.parent ? appBySlug(apps, app.parent) : undefined
  return parent ? appName(parent) : undefined
}
