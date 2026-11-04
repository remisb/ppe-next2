import { localized } from '@ppe/i18n'

import { type AppGroup, type AppStage, type LauncherApp, appById } from './catalogue.ts'

/**
 * App Launcher's words, in each language: the launcher at /apps/ and every
 * app's Apps entry. App names follow each app's own dictionary.
 */
const en = {
  apps: 'Apps',
  launcherName: 'App Launcher',
  signInTagline: 'Every app your work needs, in one place.',
  skipToContent: 'Skip to content',
  search: 'Search apps and screens',
  noMatch: (q: string) => `No app or screen matches “${q}”.`,
  all: 'All apps',
  pinned: 'Pinned',
  recent: 'Recent',
  groupsNav: 'Groups',
  groups: { workwear: 'Workwear & PPE', assets: 'Company Assets', people: 'People & Crew', admin: 'Administration' } satisfies Record<AppGroup, string>,
  stages: { live: 'Live', pilot: 'Pilot', poc: 'POC', dev: 'In development' } satisfies Record<AppStage, string>,
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
  names: {
    workwear: 'Workwear & Equipment',
    dashboard: 'Dashboard',
    'create-order': 'Create Order',
    orders: 'Orders',
    employees: 'Employees',
    help: 'Help',
    'sim-cards': 'SIM Cards',
    equipment: 'Equipment',
    'sim-scan': 'Scan SIMs',
    admin: 'Administration',
  } as Record<string, string>,
}

type Messages = typeof en

const lt: Messages = {
  apps: 'Programos',
  launcherName: 'Programų sąrašas',
  signInTagline: 'Visos jūsų darbui reikalingos programos – vienoje vietoje.',
  skipToContent: 'Pereiti prie turinio',
  search: 'Ieškoti programų ir ekranų',
  noMatch: (q) => `Nėra programos ar ekrano „${q}“.`,
  all: 'Visos programos',
  pinned: 'Prisegtos',
  recent: 'Neseniai atidarytos',
  groupsNav: 'Grupės',
  groups: { workwear: 'Darbo drabužiai ir AAP', assets: 'Įmonės turtas', people: 'Žmonės ir brigados', admin: 'Administravimas' },
  stages: { live: 'Veikia', pilot: 'Bandoma', poc: 'Prototipas', dev: 'Kuriama' },
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
  names: {
    workwear: 'Darbo drabužiai ir įranga',
    dashboard: 'Suvestinė',
    'create-order': 'Kurti užsakymą',
    orders: 'Užsakymai',
    employees: 'Darbuotojai',
    help: 'Pagalba',
    'sim-cards': 'SIM kortelės',
    equipment: 'Įranga',
    'sim-scan': 'Skenuoti SIM',
    admin: 'Administravimas',
  },
}

const ru: Messages = {
  apps: 'Приложения',
  launcherName: 'Список приложений',
  signInTagline: 'Все приложения для вашей работы — в одном месте.',
  skipToContent: 'Перейти к содержимому',
  search: 'Поиск приложений и экранов',
  noMatch: (q) => `Нет приложения или экрана «${q}».`,
  all: 'Все приложения',
  pinned: 'Закреплённые',
  recent: 'Недавние',
  groupsNav: 'Группы',
  groups: { workwear: 'Спецодежда и СИЗ', assets: 'Имущество компании', people: 'Люди и бригады', admin: 'Администрирование' },
  stages: { live: 'Работает', pilot: 'Пилот', poc: 'Прототип', dev: 'В разработке' },
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
  names: {
    workwear: 'Спецодежда и снаряжение',
    dashboard: 'Сводка',
    'create-order': 'Создать заказ',
    orders: 'Заказы',
    employees: 'Сотрудники',
    help: 'Справка',
    'sim-cards': 'SIM-карты',
    equipment: 'Оборудование',
    'sim-scan': 'Сканировать SIM',
    admin: 'Администрирование',
  },
}

export const dictionaries = { en, lt, ru }

/** The launcher's words in the language in use. Never read at module level. */
export const launcherText = localized(dictionaries)

/** An app's or shortcut's name in the language in use. */
export function appName(app: LauncherApp): string {
  return app.productName ?? launcherText().names[app.id] ?? app.id
}

/** The name of a shortcut's app, if it is one. */
export function parentName(app: LauncherApp): string | undefined {
  const parent = app.parent ? appById(app.parent) : undefined
  return parent ? appName(parent) : undefined
}
