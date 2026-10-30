import { localized, plural } from '@ppe/i18n'

/** The words the shared components draw, in each language. */
const en = {
  close: 'Close',
  // A form sheet's footer (components/form-sheet.tsx).
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  loading: 'Loading…',
  couldNotLoad: 'Could not load',
  actionFailed: 'Action failed',
  // After Esc on the line under an open record (DetailPane).
  closeHint: 'close',
  retry: 'Retry',
  somethingWentWrong: 'Something went wrong.',
  serverError: 'The server could not do this. Try again; if it happens again, tell an administrator.',
  reference: (ref: string) => `Reference: ${ref}`,
  passwordNotConfirmed: 'Your password was not confirmed, so nothing was changed.',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  sortBy: 'Sort by',
  defaultOrder: 'Default order',
  // Sort ▾'s directions for a column whose values have no words of their own (a status).
  sortAsc: 'Ascending',
  sortDesc: 'Descending',
  sortWords: {
    text: { asc: 'A–Z', desc: 'Z–A' },
    date: { asc: 'oldest first', desc: 'newest first' },
    number: { asc: 'lowest first', desc: 'highest first' },
    duration: { asc: 'shortest first', desc: 'longest first' },
    size: { asc: 'smallest first', desc: 'largest first' },
  },
  // Dates in lists (lib/dates.ts), lower case to sit inside a sentence.
  today: 'today',
  todayAt: (time: string) => `today ${time}`,
  yesterday: 'yesterday',
  yesterdayAt: (time: string) => `yesterday ${time}`,
  tomorrow: 'tomorrow',
  daysAgo: (n: number) => plural(n, { one: '# day ago', other: '# days ago' }),
  inDays: (n: number) => plural(n, { one: 'in # day', other: 'in # days' }),
  // Date fields (components/date-input.tsx): the form to type, the problem, the calendar.
  datePattern: 'YYYY-MM-DD',
  notADate: (example: string) => `Not a date. Type it as ${example}.`,
  pickDate: 'Choose from a calendar',
  // Dashboard tiles and panels (components/panel.tsx).
  refresh: 'Refresh',
  keyFigures: 'Key figures',
  needsAttention: 'Needs attention',
  // Charts (components/charts.tsx).
  scale: (value: string) => `Scale ${value}`,
  // A section's ⓘ (components/info-tip.tsx), named by the section.
  aboutSection: (section: string) => `About ${section}`,
  // A screen's ⋯ (components/page-header.tsx), named by the screen.
  moreActions: (name: string) => `More actions for ${name}`,
  // A record row's back icon below lg (components/record-header.tsx), named by its list.
  backTo: (place: string) => `Back to ${place}`,
}

export type UiText = typeof en

const lt: UiText = {
  close: 'Uždaryti',
  cancel: 'Atšaukti',
  save: 'Išsaugoti',
  saving: 'Saugoma…',
  loading: 'Įkeliama…',
  couldNotLoad: 'Nepavyko įkelti',
  actionFailed: 'Veiksmas nepavyko',
  closeHint: 'uždaryti',
  retry: 'Bandyti dar kartą',
  somethingWentWrong: 'Kažkas nepavyko.',
  serverError: 'Serveriui nepavyko to atlikti. Bandykite dar kartą; jei pasikartos, praneškite administratoriui.',
  reference: (ref: string) => `Nuoroda į užklausą: ${ref}`,
  passwordNotConfirmed: 'Slaptažodis nepatvirtintas, todėl niekas nepakeista.',
  showPassword: 'Rodyti slaptažodį',
  hidePassword: 'Slėpti slaptažodį',
  sortBy: 'Rikiuoti pagal',
  defaultOrder: 'Numatytoji tvarka',
  sortAsc: 'Didėjančiai',
  sortDesc: 'Mažėjančiai',
  sortWords: {
    text: { asc: 'A–Ž', desc: 'Ž–A' },
    date: { asc: 'seniausi pirmi', desc: 'naujausi pirmi' },
    number: { asc: 'mažiausi pirmi', desc: 'didžiausi pirmi' },
    duration: { asc: 'trumpiausi pirmi', desc: 'ilgiausi pirmi' },
    size: { asc: 'mažiausi pirmi', desc: 'didžiausi pirmi' },
  },
  today: 'šiandien',
  todayAt: (time: string) => `šiandien ${time}`,
  yesterday: 'vakar',
  yesterdayAt: (time: string) => `vakar ${time}`,
  tomorrow: 'rytoj',
  daysAgo: (n: number) => plural(n, { one: 'prieš # dieną', few: 'prieš # dienas', other: 'prieš # dienų' }),
  inDays: (n: number) => plural(n, { one: 'po # dienos', few: 'po # dienų', other: 'po # dienų' }),
  datePattern: 'MMMM.MM.DD',
  notADate: (example: string) => `Tai ne data. Įveskite taip: ${example}.`,
  pickDate: 'Pasirinkti kalendoriuje',
  refresh: 'Atnaujinti',
  keyFigures: 'Pagrindiniai rodikliai',
  needsAttention: 'Reikia dėmesio',
  scale: (value: string) => `Skalė ${value}`,
  aboutSection: (section: string) => `Apie skiltį „${section}“`,
  moreActions: (name: string) => `Daugiau veiksmų: ${name}`,
  backTo: (place: string) => `Atgal: ${place}`,
}

const ru: UiText = {
  close: 'Закрыть',
  cancel: 'Отмена',
  save: 'Сохранить',
  saving: 'Сохранение…',
  loading: 'Загрузка…',
  couldNotLoad: 'Не удалось загрузить',
  actionFailed: 'Действие не выполнено',
  closeHint: 'закрыть',
  retry: 'Повторить',
  somethingWentWrong: 'Что-то пошло не так.',
  serverError: 'Сервер не смог это выполнить. Попробуйте ещё раз; если повторится, сообщите администратору.',
  reference: (ref: string) => `Номер запроса: ${ref}`,
  passwordNotConfirmed: 'Пароль не подтверждён, поэтому ничего не изменено.',
  showPassword: 'Показать пароль',
  hidePassword: 'Скрыть пароль',
  sortBy: 'Сортировать по',
  defaultOrder: 'Порядок по умолчанию',
  sortAsc: 'По возрастанию',
  sortDesc: 'По убыванию',
  sortWords: {
    text: { asc: 'А–Я', desc: 'Я–А' },
    date: { asc: 'сначала старые', desc: 'сначала новые' },
    number: { asc: 'по возрастанию', desc: 'по убыванию' },
    duration: { asc: 'сначала короткие', desc: 'сначала длинные' },
    size: { asc: 'от меньшего', desc: 'от большего' },
  },
  today: 'сегодня',
  todayAt: (time: string) => `сегодня ${time}`,
  yesterday: 'вчера',
  yesterdayAt: (time: string) => `вчера ${time}`,
  tomorrow: 'завтра',
  daysAgo: (n: number) => plural(n, { one: '# день назад', few: '# дня назад', many: '# дней назад', other: '# дня назад' }),
  inDays: (n: number) => plural(n, { one: 'через # день', few: 'через # дня', many: 'через # дней', other: 'через # дня' }),
  datePattern: 'ДД.ММ.ГГГГ',
  notADate: (example: string) => `Это не дата. Введите так: ${example}.`,
  pickDate: 'Выбрать в календаре',
  refresh: 'Обновить',
  keyFigures: 'Основные показатели',
  needsAttention: 'Требует внимания',
  scale: (value: string) => `Шкала ${value}`,
  aboutSection: (section: string) => `О разделе «${section}»`,
  moreActions: (name: string) => `Другие действия: ${name}`,
  backTo: (place: string) => `Назад: ${place}`,
}

export const dictionaries = { en, lt, ru }

/** The shared components' words in the language in use; read when drawing, never at module level. */
export const uiText = localized(dictionaries)
