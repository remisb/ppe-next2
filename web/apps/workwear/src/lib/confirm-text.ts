/*
 * The interface wording of the employee's confirmation (the public page and
 * hand-over mode) in English and Russian. The switch changes only these words:
 * the Items Given Record itself stays bilingual and locked.
 */

export type ConfirmLang = 'en' | 'ru'

const LANG_KEY = 'workwear.confirm-lang'

/**
 * The employee's preferred language, where this page speaks it (English or
 * Russian); a Lithuanian preference falls back to the device's choice.
 */
export function employeeLang(preferred: string | null | undefined): ConfirmLang | undefined {
  return preferred === 'en' || preferred === 'ru' ? preferred : undefined
}

/** The language to start in: the one chosen last on this device, else the browser's, else English. */
export function initialLang(stored: string | null, browser: readonly string[]): ConfirmLang {
  if (stored === 'en' || stored === 'ru') return stored
  return browser.some((l) => l.toLowerCase().startsWith('ru')) ? 'ru' : 'en'
}

/** The starting language on this device; storage can be missing or throw (a private window). */
export function loadLang(): ConfirmLang {
  let stored: string | null = null
  try {
    stored = globalThis.localStorage?.getItem(LANG_KEY) ?? null
  } catch {
    // Unreadable storage: fall back to the browser's language.
  }
  return initialLang(stored, globalThis.navigator?.languages ?? [])
}

/** Remembers the chosen language on this device, a convenience only. */
export function saveLang(lang: ConfirmLang): void {
  try {
    globalThis.localStorage?.setItem(LANG_KEY, lang)
  } catch {
    // Not remembered; the page still works.
  }
}

/** A date as "30 Jul 2026" (en) or "30 июл. 2026 г." (ru), in timeZone. */
export function formatDay(iso: string, lang: ConfirmLang, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

/** A time of day as "14:02", in timeZone. */
export function formatTime(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
}

const ruOne = new Intl.PluralRules('ru-RU')

export interface ConfirmText {
  /** The language's own name, on the switch. */
  name: string
  language: string
  ask: (firstName: string, items: number) => string
  meta: (record: string, from: string, day: string) => string
  items: string
  statement: string
  viewRecord: string
  hideRecord: string
  consentGroup: string
  consent: string
  confirm: string
  confirmed: string
  thanks: (firstName: string, record: string, day: string, time: string) => string
  closePage: string
  handBack: string
  viewGiven: string
  expiredTitle: string
  expiredBody: string
  loadErrorTitle: string
  retry: string
  loading: string
}

export const confirmText: Record<ConfirmLang, ConfirmText> = {
  en: {
    name: 'English',
    language: 'Language',
    ask: (name, n) => `${name}, please confirm you received ${n === 1 ? '1 item' : `${n} items`}`,
    meta: (record, from, day) => `Order ${record} · from ${from} · ${day}`,
    items: 'Items',
    statement: 'What you confirm',
    viewRecord: 'View full record (EN / RU)',
    hideRecord: 'Hide full record',
    consentGroup: 'Confirm receipt',
    consent: 'I have received the items listed and agree with the confirmation text.',
    confirm: 'Confirm receipt',
    confirmed: 'Receipt confirmed',
    thanks: (name, record, day, time) => `Thank you, ${name}. ${record} is recorded as given on ${day} at ${time}.`,
    closePage: 'You can close this page.',
    handBack: 'Please hand the device back.',
    viewGiven: 'View record',
    expiredTitle: 'This link has expired or was replaced',
    expiredBody: 'Please ask for a new confirmation link.',
    loadErrorTitle: 'Could not load the record',
    retry: 'Retry',
    loading: 'Loading…',
  },
  ru: {
    name: 'Русский',
    language: 'Язык',
    // Genitive after «получение»: 1 (21, 31…) предмета, otherwise предметов.
    ask: (name, n) => `${name}, пожалуйста, подтвердите получение ${n} ${ruOne.select(n) === 'one' ? 'предмета' : 'предметов'}`,
    meta: (record, from, day) => `Заказ ${record} · подготовил(а) ${from} · ${day}`,
    items: 'Предметы',
    statement: 'Что вы подтверждаете',
    viewRecord: 'Полный документ (EN / RU)',
    hideRecord: 'Скрыть документ',
    consentGroup: 'Подтверждение получения',
    consent: 'Я получил(а) перечисленные предметы и согласен(на) с текстом подтверждения.',
    confirm: 'Подтвердить получение',
    confirmed: 'Получение подтверждено',
    thanks: (name, record, day, time) => `Спасибо, ${name}. ${record}: выдача записана ${day} в ${time}.`,
    closePage: 'Эту страницу можно закрыть.',
    handBack: 'Пожалуйста, верните устройство.',
    viewGiven: 'Посмотреть документ',
    expiredTitle: 'Срок действия ссылки истёк или она заменена',
    expiredBody: 'Пожалуйста, запросите новую ссылку для подтверждения.',
    loadErrorTitle: 'Не удалось загрузить документ',
    retry: 'Повторить',
    loading: 'Загрузка…',
  },
}
