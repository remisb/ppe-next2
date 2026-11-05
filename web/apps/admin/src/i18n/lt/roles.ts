import { plural } from '@ppe/i18n'

import type { RolesText } from '../en/roles'

export const roles: RolesText = {
  title: 'Rolės ir teisės',
  description: 'Ką leidžia kiekviena rolė. Naudotojas gali tai, ką leidžia bet kuri jo rolė; roles naudotojams skirkite skiltyje Naudotojai.',
  onlyRoleManagers: 'Roles keisti gali tik tie, kurie tvarko roles.',
  addRole: 'Pridėti rolę',
  name: 'Pavadinimas',
  descriptionLabel: 'Aprašymas',
  permissions: 'Teisės',
  users: 'Naudotojai',
  actions: 'Veiksmai',
  builtIn: 'Įtaisyta',
  usersCount: (n: number) => plural(n, { one: '# naudotojas', few: '# naudotojai', other: '# naudotojų' }),
  permissionsCount: (n: number) => plural(n, { one: '# teisė', few: '# teisės', other: '# teisių' }),
  editRoleLabel: (name: string) => `Redaguoti: ${name}`,
  viewRoleLabel: (name: string) => `Peržiūrėti: ${name}`,
  editRole: (name: string) => `Redaguoti rolę: ${name}`,
  viewRole: (name: string) => `Rolė: ${name}`,
  editDescription: (users: number) =>
    users === 0
      ? 'Šios rolės kol kas niekas neturi.'
      : plural(users, {
          one: 'Pakeitimas per kelias minutes pasieks # šią rolę turintį naudotoją.',
          few: 'Pakeitimas per kelias minutes pasieks # šią rolę turinčius naudotojus.',
          other: 'Pakeitimas per kelias minutes pasieks # šią rolę turinčių naudotojų.',
        }),
  confirmRemovePermissions: (permissions: number, users: number) =>
    `Atimti ${plural(permissions, { one: '# teisę', few: '# teises', other: '# teisių' })} iš ${plural(users, { one: '# naudotojo', few: '# naudotojų', other: '# naudotojų' })}? Jie nebegalės daryti to, ką ji leidžia, nebent tai leidžia kita jų rolė.`,
  addDescription: 'Paskui skirkite ją naudotojams skiltyje Naudotojai.',
  lockedNote: 'Administratorius gali viską Administravime ir jo pakeisti negalima, kad kas nors visada galėtų tvarkyti naudotojus ir roles.',
  builtInFixed: 'Įtaisytos rolės pavadinimas ir aprašymas nesikeičia.',
  neededBy: (names: string) => `Reikia teisei: ${names}.`,
  enterName: 'Įveskite pavadinimą.',
  nameTooLong: 'Naudokite ne daugiau kaip 100 simbolių.',
  descriptionTooLong: 'Naudokite ne daugiau kaip 500 simbolių.',
  nameTaken: 'Rolė tokiu pavadinimu jau yra.',
  deleteRole: 'Ištrinti rolę…',
  deleteQuestion: (name: string) => `Ištrinti rolę „${name}“? Jos neturi nė vienas naudotojas.`,
  inUse: 'Šią rolę turi naudotojai. Pirmiausia atimkite ją skiltyje Naudotojai.',
  groups: {
    administration: 'Administravimas',
    launcher: 'Programų sąrašas',
    workwear: 'Darbo drabužiai ir įranga',
    personnel: 'Asmens bylos',
    dashboards: 'Suvestinės',
  },
  permission: {
    'users.read': { label: 'Matyti naudotojus', grants: 'Naudotojų ir jų rolių sąrašas.' },
    'users.manage': {
      label: 'Tvarkyti naudotojus',
      grants: 'Pridėti, keisti, išjungti ir trinti naudotojus, keisti jų slaptažodžius ir skirti jiems roles.',
    },
    'roles.manage': { label: 'Tvarkyti roles', grants: 'Pridėti, keisti ir trinti roles bei suteikti bet kokią teisę.' },
    'settings.manage': { label: 'Keisti nustatymus', grants: 'Įmonės pavadinimas, tiekėjo WhatsApp grupė ir SIM tiekėjai.' },
    'mail_templates.manage': { label: 'Keisti laiškų šablonus', grants: 'Programos ruošiamų laiškų tekstas, pvz., SIM aktyvavimo ir blokavimo laiškų.' },
    'backups.read': { label: 'Matyti atsargines kopijas', grants: 'Ar duomenų bazė kopijuojama, ir naujausios kopijos.' },
    'audit.read': { label: 'Matyti audito žurnalą', grants: 'Kiekvienas užfiksuotas pakeitimas visuose įrašuose: kas ir kada jį atliko.' },
    'audit.export': {
      label: 'Eksportuoti audito žurnalą',
      grants: 'Atsisiųsti pakeitimus pagal filtrus, ne daugiau kaip metus, CSV arba JSON eilutėmis. Kiekvienas eksportas užfiksuojamas.',
    },
    'security.read': {
      label: 'Matyti saugą',
      grants: 'Prisijungimai ir nesėkmingi bandymai su adresais, visų prisijungę įrenginiai ir prieigos peržiūra.',
    },
    'system.read': {
      label: 'Matyti sistemą',
      grants: 'API būsena ir užklausos, duomenų bazė ir klaidų sąrašas su kiekvienos klaidos nuoroda.',
    },
    'usage.read': {
      label: 'Matyti naudojimą',
      grants: 'Kas ir iš ko naudojasi programomis, prisijungimai ir pakeitimai laike, patvirtinimo nuorodų eiga ir duomenų kokybė.',
    },
    'ai_usage.read': { label: 'Matyti DI naudojimą', grants: 'Kiekvienas programos kreipimasis į DI modelį (spalvota nuotrauka), jo žetonai ir kaina, kas ir kada.' },
    'apps.manage': { label: 'Tvarkyti programas', grants: 'Programų sąrašo programos ir nuorodos: registruoti, keisti, kas kurią mato, tvarka ir atsiliepimai.' },
    'apps.preview': { label: 'Matyti bandomas programas', grants: 'Prototipai ir kuriamos programos programų sąraše, įjungus „Rodyti bandomas programas“.' },
    'employee_profiles.read': {
      label: 'Matyti darbuotojų profilius',
      grants: 'Darbuotojo kodą, pastabas, pageidaujamą kalbą ir nuotraukas, taip pat gimimo datą, pilietybę ir lytį iš asmens dokumento. Vardus mato visi.',
    },
    'employee_profiles.manage': {
      label: 'Tvarkyti darbuotojų profilius',
      grants: 'Pridėti naują darbuotoją, keisti darbuotojo vardą, kodą, pastabas ir kalbą, pridėti, keisti ir šalinti jo nuotraukas. Reikia leidimo „Matyti darbuotojų profilius“.',
    },
    'employee_sizes.read': {
      label: 'Matyti darbuotojų dydžius',
      grants: 'Darbuotojo ūgį, drabužių ir avalynės dydį ir kam jų trūksta. Kuriant užsakymą jie naudojami ir be šio leidimo.',
    },
    'employee_sizes.manage': {
      label: 'Tvarkyti darbuotojų dydžius',
      grants: '„Keisti dydžius“, dydžiai pridedant ir keičiant darbuotoją, „Išsaugoti kaip numatytąjį“ kuriant užsakymą. Reikia leidimo „Matyti darbuotojų dydžius“.',
    },
    'employees.delete': { label: 'Trinti darbuotojus', grants: 'Jų užsakymai ir įrašai lieka.' },
    'catalogue.manage': {
      label: 'Tvarkyti prekių katalogą',
      grants: 'Pridėti ir keisti prekes ir jų naudojimo laikotarpius; išjungti ir trinti jas. Kainoms reikia leidimo „Keisti prekių kainas“.',
    },
    'item_prices.manage': { label: 'Keisti prekių kainas', grants: 'Nustatyti ir keisti prekės kainą ir pirkimo kainą.' },
    'item_sets.read': {
      label: 'Matyti prekių rinkinius',
      grants: 'Prekių rinkinių ekranas ir kurie rinkiniai turi prekę. Kuriant užsakymą aktyvūs rinkiniai siūlomi visiems.',
    },
    'item_sets.manage': { label: 'Tvarkyti prekių rinkinius', grants: 'Pridėti, keisti ir trinti prekių rinkinius.' },
    'orders.delete': { label: 'Trinti užsakymus', grants: 'Pašalinti demonstracinius ir bandomuosius užsakymus; įrašas ir jo istorija lieka.' },
    'assets.manage': {
      label: 'Tvarkyti įrangą ir baldus',
      grants: 'Pridėti įrangą ir baldus, išduoti juos darbuotojams ir registruoti grąžinimą. Dar reikia leidimo „Matyti įrangą ir baldus“.',
    },
    'sim_cards.read': {
      label: 'Matyti SIM korteles',
      grants: 'SIM kortelių ekraną, kiekvieną SIM ir pas ką ji yra: darbuotojų puslapiuose, paieškoje ir suvestinėse. Be šio leidimo SIM nematomos.',
    },
    'sim_cards.manage': {
      label: 'Tvarkyti SIM',
      grants: 'Pridėti ir skenuoti SIM, jas keisti, keisti jų būseną, išduoti darbuotojams, registruoti grąžinimą ir paruošti jų laiškus. Reikia leidimo „Matyti SIM korteles“.',
    },
    'sim_codes.read': {
      label: 'Rodyti PIN ir PUK',
      grants: 'Matyti SIM PIN ir PUK, patvirtinus slaptažodį; kiekvienas kartas užfiksuojamas. Reikia leidimo „Matyti SIM korteles“.',
    },
    'equipment.read': {
      label: 'Matyti įrangą ir baldus',
      grants: 'Kiekvieną daiktą ir pas ką jis yra: įmonės turte, darbuotojų puslapiuose ir paieškoje. Be šio leidimo jų nemato net administratorius.',
    },
    'personnel.documents.read': {
      label: 'Matyti asmens dokumentus',
      grants: 'Asmens dokumentus jo puslapyje ir „Rodyti dokumentą“: numerį, asmens kodą ir kopijas, patvirtinus slaptažodį. Kiekvienas parodymas įrašomas.',
    },
    'personnel.documents.manage': {
      label: 'Importuoti asmens dokumentus',
      grants: 'Nuskaityti ir išsaugoti pasus ir asmens tapatybės korteles „Dokumentų importe“, pridėti ar atnaujinti darbuotoją, pažymėti darbo pabaigą ir draudimą naikinti.',
    },
    'personnel.portraits.colorize': {
      label: 'Kurti DI spalvotas nuotraukas',
      grants: 'Nuspalvinti dokumento portretą DI (OpenAI), asmeniui sutikus. Kiekvienas naudojimas skaičiuojamas „DI naudojime“.',
    },
    'dashboard.overview': { label: 'Suvestinė', grants: 'Išlaidos, laukiantys užsakymai ir trūkumai.' },
    'dashboard.manager': { label: 'Vadovo suvestinė', grants: 'Prekės, kainos ir pirkimai.' },
    'dashboard.employee': { label: 'Darbuotojo suvestinė', grants: 'Paties naudotojo užsakymai ir ką užsakyti toliau.' },
  },
}
