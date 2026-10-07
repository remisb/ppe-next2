import { localized, plural } from '@ppe/i18n'

/** The words the shared components draw, in each language. */
const en = {
  close: 'Close',
  loading: 'Loading…',
  couldNotLoad: 'Could not load',
  retry: 'Retry',
  somethingWentWrong: 'Something went wrong.',
  serverError: 'The server could not do this. Try again; if it happens again, tell an administrator.',
  reference: (ref: string) => `Reference: ${ref}`,
  passwordNotConfirmed: 'Your password was not confirmed, so nothing was changed.',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  sortBy: 'Sort by',
  defaultOrder: 'Default order',
  ascending: 'Ascending; switch to descending',
  descending: 'Descending; switch to ascending',
  // Dates in lists (lib/dates.ts), lower case to sit inside a sentence.
  today: 'today',
  todayAt: (time: string) => `today ${time}`,
  yesterday: 'yesterday',
  yesterdayAt: (time: string) => `yesterday ${time}`,
  tomorrow: 'tomorrow',
  daysAgo: (n: number) => plural(n, { one: '# day ago', other: '# days ago' }),
  inDays: (n: number) => plural(n, { one: 'in # day', other: 'in # days' }),
  // Dashboard tiles and panels (components/panel.tsx).
  refresh: 'Refresh',
  keyFigures: 'Key figures',
  needsAttention: 'Needs attention',
}

export type UiText = typeof en

const lt: UiText = {
  close: 'Uždaryti',
  loading: 'Įkeliama…',
  couldNotLoad: 'Nepavyko įkelti',
  retry: 'Bandyti dar kartą',
  somethingWentWrong: 'Kažkas nepavyko.',
  serverError: 'Serveriui nepavyko to atlikti. Bandykite dar kartą; jei pasikartos, praneškite administratoriui.',
  reference: (ref: string) => `Nuoroda į užklausą: ${ref}`,
  passwordNotConfirmed: 'Slaptažodis nepatvirtintas, todėl niekas nepakeista.',
  showPassword: 'Rodyti slaptažodį',
  hidePassword: 'Slėpti slaptažodį',
  sortBy: 'Rikiuoti pagal',
  defaultOrder: 'Numatytoji tvarka',
  ascending: 'Didėjančiai; perjungti į mažėjančiai',
  descending: 'Mažėjančiai; perjungti į didėjančiai',
  today: 'šiandien',
  todayAt: (time: string) => `šiandien ${time}`,
  yesterday: 'vakar',
  yesterdayAt: (time: string) => `vakar ${time}`,
  tomorrow: 'rytoj',
  daysAgo: (n: number) => plural(n, { one: 'prieš # dieną', few: 'prieš # dienas', other: 'prieš # dienų' }),
  inDays: (n: number) => plural(n, { one: 'po # dienos', few: 'po # dienų', other: 'po # dienų' }),
  refresh: 'Atnaujinti',
  keyFigures: 'Pagrindiniai rodikliai',
  needsAttention: 'Reikia dėmesio',
}

const ru: UiText = {
  close: 'Закрыть',
  loading: 'Загрузка…',
  couldNotLoad: 'Не удалось загрузить',
  retry: 'Повторить',
  somethingWentWrong: 'Что-то пошло не так.',
  serverError: 'Сервер не смог это выполнить. Попробуйте ещё раз; если повторится, сообщите администратору.',
  reference: (ref: string) => `Номер запроса: ${ref}`,
  passwordNotConfirmed: 'Пароль не подтверждён, поэтому ничего не изменено.',
  showPassword: 'Показать пароль',
  hidePassword: 'Скрыть пароль',
  sortBy: 'Сортировать по',
  defaultOrder: 'Порядок по умолчанию',
  ascending: 'По возрастанию; переключить на убывание',
  descending: 'По убыванию; переключить на возрастание',
  today: 'сегодня',
  todayAt: (time: string) => `сегодня ${time}`,
  yesterday: 'вчера',
  yesterdayAt: (time: string) => `вчера ${time}`,
  tomorrow: 'завтра',
  daysAgo: (n: number) => plural(n, { one: '# день назад', few: '# дня назад', many: '# дней назад', other: '# дня назад' }),
  inDays: (n: number) => plural(n, { one: 'через # день', few: 'через # дня', many: 'через # дней', other: 'через # дня' }),
  refresh: 'Обновить',
  keyFigures: 'Основные показатели',
  needsAttention: 'Требует внимания',
}

export const dictionaries = { en, lt, ru }

/** The shared components' words in the language in use; read when drawing, never at module level. */
export const uiText = localized(dictionaries)
