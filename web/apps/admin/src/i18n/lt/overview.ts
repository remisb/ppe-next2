import { plural } from '@ppe/i18n'

import type { OverviewText } from '../en/overview'

export const overview: OverviewText = {
  title: 'Apžvalga',
  description: 'Pirmiausia tai, kam reikia jūsų dėmesio, paskui rodikliai. Kiekvienas punktas veda ten, kur tai sutvarkoma.',
  attention: 'Reikia dėmesio',
  allClear: 'Niekam nereikia jūsų dėmesio.',
  allClearHint: 'Atsarginės kopijos, prisijungimai, klaidos ir prieigos peržiūra tikrinami kaskart įkeliant šį puslapį.',
  severity: { critical: 'Kritinė', warning: 'Įspėjimas', info: 'Pastaba' },
  items: {
    audit_seal_mismatch: {
      title: 'Audito žurnalas nesutampa su antspaudais',
      detail: () => 'Užantspauduotos dienos pakeitimai pakeisti, pridėti ar pašalinti aplenkiant programą. Išsaugokite ankstesnes atsargines kopijas.',
      action: 'Atidaryti audito žurnalą',
    },
    backups_not_running: {
      title: 'Atsarginės kopijos nedaromos',
      detail: () => 'Naujos kopijos nėra arba atsarginių kopijų tarnyba nebepraneša.',
      action: 'Atidaryti atsargines kopijas',
    },
    last_backup_failed: {
      title: 'Paskutinė kopija nepavyko',
      detail: () => 'Ankstesnės kopijos dar naujos. Kopijavimo įraše nurodyta, kodėl nepavyko.',
      action: 'Atidaryti atsargines kopijas',
    },
    copied_sign_in: {
      title: 'Panaudotas nukopijuotas prisijungimas',
      detail: ({ count }) =>
        plural(count, {
          one: 'Per 7 dienas # kartą panaudota sena prisijungimo kopija, todėl jis baigtas. Paklauskite naudotojo, ar tai buvo jis; jei ne, tegul pakeičia slaptažodį.',
          few: 'Per 7 dienas # kartus panaudotos senos prisijungimų kopijos, todėl jie baigti. Paklauskite naudotojų, ar tai buvo jie; jei ne, tegul pakeičia slaptažodžius.',
          other: 'Per 7 dienas # kartų panaudotos senos prisijungimų kopijos, todėl jie baigti. Paklauskite naudotojų, ar tai buvo jie; jei ne, tegul pakeičia slaptažodžius.',
        }),
      action: 'Atidaryti prisijungimus',
    },
    failed_sign_ins: {
      title: 'Daug nesėkmingų prisijungimų',
      detail: ({ count }) =>
        plural(count, {
          one: 'Per paskutinę valandą # nesėkmingas prisijungimas.',
          few: 'Per paskutinę valandą # nesėkmingi prisijungimai arba daug į vieną paskyrą.',
          other: 'Per paskutinę valandą # nesėkmingų prisijungimų arba daug į vieną paskyrą.',
        }),
      action: 'Atidaryti prisijungimus',
    },
    error_rate: {
      title: 'Užklausos nepavyksta',
      detail: ({ count, percent }) => `Per paskutinę valandą nepavyko ${percent} % užklausų (${count}).`,
      action: 'Atidaryti klaidas',
    },
    new_errors: {
      title: 'Naujos klaidos',
      detail: ({ count }) =>
        plural(count, { one: 'Per paskutinę parą # nauja klaidos rūšis.', few: 'Per paskutinę parą # naujos klaidų rūšys.', other: 'Per paskutinę parą # naujų klaidų rūšių.' }),
      action: 'Atidaryti klaidas',
    },
    review_overdue: {
      title: 'Laikas peržiūrėti prieigą',
      detail: ({ days }) =>
        days > 0 ? `Prieiga paskutinį kartą peržiūrėta prieš ${days} d. Peržiūrėkite ją kas 90 dienų.` : 'Prieiga dar nebuvo peržiūrėta. Peržiūrėkite ją kas 90 dienų.',
      action: 'Atidaryti prieigos peržiūrą',
    },
    database_owner_rights: {
      title: 'API jungiasi kaip duomenų bazės savininkas',
      detail: () => 'Ji galėtų išjungti tai, kas saugo audito žurnalą nuo pakeitimų. Suteikite jai ppe_app rolę: serveryje nustatykite API_DB_USER ir API_DB_PASSWORD.',
      action: 'Atidaryti sistemą',
    },
    database_growth: {
      title: 'Duomenų bazė sparčiai auga',
      detail: ({ percent, days }) => `Per ${days} d. ji padidėjo ${percent} %. Patikrinkite, ar diske užtenka vietos.`,
      action: 'Atidaryti sistemą',
    },
  },
  figures: 'Rodikliai',
  activeUsers: 'Aktyvūs naudotojai',
  inactiveUsers: (n: number) => plural(n, { one: '# neaktyvus', few: '# neaktyvūs', other: '# neaktyvių' }),
  signedIn: 'Prisijungę dabar',
  signedInDetail: (devices: number) => plural(devices, { one: '# įrenginyje', few: '# įrenginiuose', other: '# įrenginių' }),
  signInsToday: 'Prisijungimai šiandien',
  failedToday: (n: number) => plural(n, { one: '# nesėkmingas', few: '# nesėkmingi', other: '# nesėkmingų' }),
  requests: 'Užklausos per 24 val.',
  requestErrors: (n: number) => plural(n, { one: '# nepavyko', few: '# nepavyko', other: '# nepavyko' }),
  database: 'Duomenų bazė',
  databaseDetail: 'dydis diske',
  lastBackup: 'Paskutinė kopija',
  noBackup: 'Dar nėra',
}
