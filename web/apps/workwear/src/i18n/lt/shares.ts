import { plural } from '@ppe/i18n'

import type { SharesText } from '../en/shares'

export const shares: SharesText = {
  title: 'Bendrinimo nuorodos',
  description: 'Jūsų bendrintos nuorodos, kurios dar galioja. Kiekvienas, turintis nuorodą, gali ją atverti, kol baigsis galiojimas; atšaukite, kad ji nebeatsivertų.',
  name: 'Pavadinimas',
  type: 'Tipas',
  rows: 'Eilutės',
  shared: 'Bendrinta',
  openUntil: 'Galioja iki',
  kinds: { employees: 'Darbuotojai' },
  revoke: 'Atšaukti',
  revokeName: (name: string) => `Atšaukti: ${name}`,
  revokeQuestion: (name: string) => `Atšaukti nuorodą „${name}“? Ji iškart nebeatsivers, o joje buvę duomenys bus ištrinti. To atšaukti negalima.`,
  revoked: (name: string) => `Nuoroda „${name}“ atšaukta.`,
  none: 'Galiojančių bendrinimo nuorodų nėra',
  noneHelp: 'Bendrinkite kelis darbuotojus skiltyje „Darbuotojai“: Eksportuoti (arba Bendrinti), tada Bendrinimo nuoroda.',
  openEmployees: 'Atidaryti darbuotojus',
  // The name Share Link proposes for more than three people: the first two, and how many more.
  namesAndMore: (names: string, more: number) => `${names} ${plural(more, { one: 'ir dar #', few: 'ir dar #', many: 'ir dar #', other: 'ir dar #' })}`,
  pageSharedBy: (who: string, when: string) => `Bendrino ${who}, ${when}`,
  pageOpenUntil: (when: string) => `Ši nuoroda galioja iki ${when}.`,
  pageAsOf: 'Duomenys tokie, kokie buvo bendrinant.',
  pageGone: 'Ši nuoroda nebegalioja',
  pageGoneHelp: 'Jos galiojimas baigėsi arba ji atšaukta. Paprašykite bendrinusio asmens naujos.',
  pageNotFound: 'Tokios nuorodos nėra',
  pageNotFoundHelp: 'Patikrinkite, ar ji nukopijuota visa, arba paprašykite naujos.',
  pageCount: (n: number) => plural(n, { one: '# asmuo', few: '# asmenys', many: '# asmens', other: '# asmenų' }),
}
