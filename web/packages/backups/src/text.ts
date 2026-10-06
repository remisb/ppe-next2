import { localized, plural } from '@ppe/i18n'

/** How a backup's state and schedule read, in each language. */
const en = {
  upToDate: (when: string) => `Backups are up to date. The last one was taken ${when}.`,
  noAgent: 'The backup service has not reported: nothing is backed up on schedule. Check that it runs on the server.',
  offline: (when: string) => `The backup service last reported ${when}. It may have stopped: check the server.`,
  noneYet: 'No backup has been taken yet.',
  firstAt: (when: string) => `The first is due ${when}.`,
  lastFailed: 'The last backup failed:',
  stale: (when: string) => `The last successful backup was taken ${when}: a scheduled one is overdue.`,
  daily: (time: string) => `Every day at ${time}`,
  every: (hours: number) => plural(hours, { one: 'Every hour', other: 'Every # hours' }),
}

export type BackupText = typeof en

const lt: BackupText = {
  upToDate: (when: string) => `Atsarginės kopijos naujos. Paskutinė padaryta ${when}.`,
  noAgent: 'Atsarginių kopijų tarnyba nepranešė: pagal tvarkaraštį niekas nekopijuojama. Patikrinkite, ar ji veikia serveryje.',
  offline: (when: string) => `Atsarginių kopijų tarnyba paskutinį kartą pranešė ${when}. Galbūt ji sustojo: patikrinkite serverį.`,
  noneYet: 'Dar nepadaryta nė viena atsarginė kopija.',
  firstAt: (when: string) => `Pirmoji numatyta ${when}.`,
  lastFailed: 'Paskutinė atsarginė kopija nepavyko:',
  stale: (when: string) => `Paskutinė pavykusi kopija padaryta ${when}: suplanuota kopija vėluoja.`,
  daily: (time: string) => `Kasdien ${time}`,
  every: (hours: number) => plural(hours, { one: 'Kas valandą', few: 'Kas # valandas', other: 'Kas # valandų' }),
}

const ru: BackupText = {
  upToDate: (when: string) => `Резервные копии актуальны. Последняя сделана ${when}.`,
  noAgent: 'Служба резервного копирования не выходила на связь: по расписанию ничего не копируется. Проверьте, работает ли она на сервере.',
  offline: (when: string) => `Служба резервного копирования последний раз выходила на связь ${when}. Возможно, она остановилась: проверьте сервер.`,
  noneYet: 'Ещё не сделано ни одной резервной копии.',
  firstAt: (when: string) => `Первая запланирована на ${when}.`,
  lastFailed: 'Последняя резервная копия не удалась:',
  stale: (when: string) => `Последняя удачная копия сделана ${when}: плановая копия запаздывает.`,
  daily: (time: string) => `Каждый день в ${time}`,
  every: (hours: number) => plural(hours, { one: 'Каждый час', few: 'Каждые # часа', many: 'Каждые # часов', other: 'Каждые # часа' }),
}

export const dictionaries = { en, lt, ru }

export const backupText = localized(dictionaries)
