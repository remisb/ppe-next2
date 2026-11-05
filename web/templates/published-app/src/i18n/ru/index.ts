import type { Messages } from '../index'

const shell: Messages['shell'] = {
  appName: '__NAME_RU__',
  signInTagline: 'Часть «Спецодежда и снаряжение».',
  mainNav: 'Главное',
  home: 'Главная',
}

const home: Messages['home'] = {
  empty: 'Здесь пока ничего нет.',
}

export const ru = { shell, home }
