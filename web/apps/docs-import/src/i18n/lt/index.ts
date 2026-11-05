import type { Messages } from '../index'

const shell: Messages['shell'] = {
  appName: 'Dokumentų importas',
  signInTagline: 'Sistemos „Darbo drabužiai ir įranga“ dalis.',
  mainNav: 'Pagrindinis',
  employees: 'Darbuotojai',
  notForYouTitle: 'Dokumentų importas skirtas ne jūsų rolei',
  notForYou: 'Asmens dokumentams nuskaityti reikia rolės „Asmens dokumentai“. Jei jos reikia, kreipkitės į administratorių.',
  backToWorkwear: 'Grįžti į „Darbo drabužius ir įrangą“',
  signOut: 'Atsijungti',
}

const steps: Messages['steps'] = {
  label: 'Žingsniai',
  person: 'Asmuo',
  capture: 'Dokumentas',
  review: 'Peržiūra',
  done: 'Išsaugota',
}

const person: Messages['person'] = {
  title: 'Kieno tai dokumentas?',
  description: 'Pasirinkite darbuotoją arba sukurkite naują pagal dokumentą.',
  search: 'Rasti darbuotoją',
  searchHint: 'Vardas, pavardė arba kodas.',
  noMatch: 'Tokio darbuotojo nėra.',
  choose: 'Pasirinkti',
  newEmployee: 'Naujas darbuotojas pagal dokumentą',
  newEmployeeHint: 'Darbuotojas sukuriamas su dokumente įrašytu vardu ir pavarde.',
  chosen: 'Kam',
  newChosen: 'Naujas darbuotojas pagal dokumentą',
  change: 'Keisti',
}

const capture: Messages['capture'] = {
  title: 'Nufotografuokite dokumentą',
  description: 'Nuotraukoje turi matytis visas puslapis ar kortelė, lygiai, be atspindžių ant raidžių ir < eilučių apačioje.',
  passport: 'Pasas',
  card: 'Asmens tapatybės kortelė ar leidimas gyventi',
  typeLabel: 'Dokumentas',
  page: 'Paso puslapis su nuotrauka',
  back: 'Kitoji pusė, su kodo eilutėmis',
  front: 'Priekinė pusė, su nuotrauka',
  takePhoto: 'Fotografuoti',
  choosePhoto: 'Pasirinkti nuotrauką',
  reading: 'Dokumentas nuskaitomas…',
  readerFailed: 'Skaitytuvas nepasileido. Patikrinkite ryšį ir bandykite dar kartą.',
  found: 'Kodo eilutės rastos.',
  agreedNote: 'Nuskaityta du kartus, abu kartus vienodai.',
  notAgreed: 'Nuskaityta, bet du kartus skirtingai: kitame žingsnyje palyginkite su dokumentu.',
  noMrz: 'Šioje nuotraukoje kodo eilučių nerasta.',
  frontOnly: 'Tai priekinė pusė. Nufotografuokite ir kitąją, su kodo eilutėmis.',
  typeInstead: 'Įvesti eilutes ranka',
  continue: 'Peržiūrėti',
}

const review: Messages['review'] = {
  title: 'Patikrinkite, kas nuskaityta',
  description: 'Numerį ir datas lemia kodo eilutės. Vardą ir pavardę įveskite kaip atspausdinta, su raidėmis (Ž, Ė…).',
  lines: 'Kodo eilutės (MRZ)',
  linesHint: 'Dvi ar trys eilutės didžiųjų raidžių, skaitmenų ir <. Pakeitus ženklą, žemiau esantys laukai atsinaujina.',
  checked: 'Palyginau kodo eilutes su dokumentu.',
  checkedHint: 'Reikia, kai du nuskaitymai skyrėsi arba numeris buvo pataisytas.',
  fields: 'Nuskaityta iš kodo eilučių',
  kind: 'Rūšis',
  number: 'Numeris',
  issuingState: 'Išdavė',
  nationality: 'Pilietybė',
  birthDate: 'Gimimo data',
  sex: 'Lytis',
  expiresOn: 'Galioja iki',
  personalCode: 'Asmens kodas',
  corrected: 'Pataisyta',
  names: 'Vardas ir pavardė, kaip atspausdinta',
  surname: 'Pavardė',
  givenNames: 'Vardai',
  namesDiffer: 'Vardas ar pavardė skiriasi nuo dokumento kodo: patikrinkite.',
  namesTruncated: 'Kodas vardus sutrumpino; išsaugomi atspausdinti.',
  optional: 'Kodo eilutėse nėra (neprivaloma)',
  issuedOn: 'Išduotas',
  placeOfBirth: 'Gimimo vieta',
  authority: 'Išdavusi institucija',
  addToRecord: 'Įrašyti į darbuotojo duomenis',
  addToRecordHint: 'Išjungta: dokumentas saugomas tik asmens bylose. Įjungta: jis rodomas darbuotojo puslapyje, o žemiau galite perkelti jo duomenis.',
  differences: 'Skiriasi nuo darbuotojo duomenų',
  takeLabel: (field: string) => `Perkelti: ${field}`,
  current: 'Dabar',
  document: 'Dokumente',
  none: 'nėra',
  checking: 'Tikrinama registre…',
  save: 'Išsaugoti dokumentą',
  saving: 'Išsaugoma…',
  back: 'Atgal',
  photos: 'Nuotraukos',
}

const blockers: Messages['blockers'] = {
  no_mrz: 'Įveskite kodo eilutes iš dokumento.',
  problems: 'Pataisykite, kas kodo eilutėse nurodyta kaip klaida.',
  surname: 'Įveskite pavardę.',
  given_names: 'Įveskite vardus: pagal juos sukuriamas naujas darbuotojas.',
  issued_on: 'Išdavimo data turi būti data prieš galiojimo pabaigą.',
  not_checked: 'Palyginkite kodo eilutes su dokumentu ir tai pažymėkite.',
  document_on_file: 'Šis dokumentas jau išsaugotas.',
  other_employee: 'Šis asmens kodas priklauso kitam darbuotojui.',
}

const problems: Messages['problems'] = {
  check_digit: 'Kontrolinis skaitmuo nesutampa: kuris nors ženklas nuskaitytas klaidingai. Palyginkite su dokumentu.',
  ambiguous_correction: 'Kontroliniam skaitmeniui tinka keli variantai. Įveskite ženklus iš dokumento.',
  invalid_character: 'Šiame lauke toks ženklas negalimas.',
  invalid_date: 'Tai ne data.',
  invalid_sex: 'Turi būti M, F arba <.',
  unknown_state: 'Nežinomas valstybės kodas.',
  no_surname: 'Nėra pavardės.',
  names_unreadable: 'Vardai atrodo nuskaityti klaidingai (užpildai perskaityti kaip raidės).',
  expiry_before_birth: 'Galioja trumpiau nei iki gimimo datos.',
  birth_in_future: 'Gimimo data ateityje.',
  unsupported_document: 'Vizos čia neskaitomos.',
  personal_code_checksum: 'Asmens kodo kontrolinis skaitmuo nesutampa.',
  personal_code_birth_date: 'Asmens kode nurodyta kita gimimo data.',
  personal_code_sex: 'Asmens kode nurodyta kita lytis.',
}

const notes: Messages['notes'] = {
  expired: 'Dokumento galiojimas pasibaigęs. Jį vis tiek galima išsaugoti.',
  specimen: 'Pavyzdinis dokumentas (Utopija).',
  incomplete_date: 'Dokumente gimimo data nepilna.',
  corrected: 'Pataisyta iš panašaus ženklo.',
}

const fieldNames: Messages['fieldNames'] = {
  documentCode: 'Dokumento kodas',
  issuingState: 'Išdavusi valstybė',
  documentNumber: 'Dokumento numeris',
  documentNumberCheck: 'Dokumento numerio kontrolinis skaitmuo',
  optionalData1: 'Papildomi duomenys',
  birthDate: 'Gimimo data',
  birthDateCheck: 'Gimimo datos kontrolinis skaitmuo',
  sex: 'Lytis',
  expiryDate: 'Galiojimo pabaiga',
  expiryDateCheck: 'Galiojimo pabaigos kontrolinis skaitmuo',
  nationality: 'Pilietybė',
  optionalData2: 'Papildomi duomenys',
  personalNumber: 'Asmens numeris',
  personalNumberCheck: 'Asmens numerio kontrolinis skaitmuo',
  compositeCheck: 'Galutinis kontrolinis skaitmuo',
  names: 'Vardas ir pavardė',
  composite: 'Galutinis kontrolinis skaitmuo',
}

const kinds: Messages['kinds'] = { passport: 'Pasas', id_card: 'Asmens tapatybės kortelė', residence_permit: 'Leidimas gyventi' }
const sexes: Messages['sexes'] = { M: 'Vyras', F: 'Moteris', X: 'Nenurodyta' }
const takes: Messages['takes'] = { names: 'vardą ir pavardę', birth_date: 'gimimo datą', nationality: 'pilietybę', sex: 'lytį' }

const done: Messages['done'] = {
  title: 'Dokumentas išsaugotas',
  description: (kind: string, state: string, until: string) => `${kind} · ${state} · galioja iki ${until}`,
  sealed: 'Jo numeris, asmens kodas ir kopijos užšifruoti asmens bylose.',
  openEmployee: 'Atidaryti darbuotoją',
  another: 'Importuoti kitą',
}

const errors: Messages['errors'] = {
  title: 'Neišsaugota',
  conflictDocument: 'Šis dokumentas jau išsaugotas.',
  conflictEmployee: 'Šis asmens kodas priklauso kitam darbuotojui.',
  notConfigured: 'Šiame serveryje asmens bylos dar neparuoštos.',
}

export const lt = { shell, steps, person, capture, review, blockers, problems, notes, fieldNames, kinds, sexes, takes, done, errors }
