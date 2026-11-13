import { plural } from '@ppe/i18n'

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
  importTab: 'Importuoti į asmens bylas',
  scanTab: 'Nuskaityti dokumentą',
}

const steps: Messages['steps'] = {
  label: 'Žingsniai',
  person: 'Asmuo',
  capture: 'Dokumentas',
  review: 'Peržiūra',
  portrait: 'Portretas',
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
  liveCamera: 'Kamera',
  stopCamera: 'Išjungti kamerą',
  liveLabel: 'Kameros vaizdas',
  aim: (type: 'passport' | 'card') =>
    type === 'passport'
      ? 'Laikykite puslapį su nuotrauka rėmelyje, kodo eilutes – juostoje apačioje.'
      : 'Laikykite kitąją pusę rėmelyje, kodo eilutes – juostoje apačioje.',
  liveRead: 'Du kadrai nuskaityti vienodai. Jei tai kortelė, dabar fotografuokite jos priekinę pusę.',
  takePicture: 'Fotografuoti kadrą',
  cameraDenied: 'Kamera neleista. Leiskite ją naršyklėje arba darykite nuotraukas.',
  cameraUnavailable: 'Kamera nepasileido. Darykite nuotraukas.',
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
  next: 'Toliau: portretas',
  save: 'Išsaugoti dokumentą',
  saving: 'Išsaugoma…',
  back: 'Atgal',
  photos: 'Nuotraukos',
}

const portrait: Messages['portrait'] = {
  title: 'Portretas',
  description: 'Dokumento nuotrauka, iškirpta. Perkelkite rėmelį ant veido ir pritaikykite jo dydį galvai ir pečiams.',
  keep: 'Išsaugoti portretą',
  keepHint: 'Saugomas su dokumento kopijomis, užšifruotas.',
  asPhoto: 'Taip pat padaryti jį darbuotojo nuotrauka',
  asPhotoHint: 'Pridedama prie jo nuotraukų, matoma visiems, kas atidaro darbuotoją; pirmoji nuotrauka tampa jo paveikslėliu.',
  documentAlt: 'Dokumentas su portreto rėmeliu',
  cropLabel: 'Portreto rėmelis',
  cropHint: 'Vilkite rėmelį, kad perkeltumėte, ir jo kampą, kad pakeistumėte dydį; klaviatūra rodyklės jį perkelia, o + ir − keičia dydį.',
  larger: 'Didesnis',
  smaller: 'Mažesnis',
  loading: 'Atidaromas vaizdas…',
  noPicture: (type: 'passport' | 'card'): string =>
    type === 'passport' ? 'Nėra puslapio su nuotrauka vaizdo: išsaugoma be portreto.' : 'Nėra kortelės priekinės pusės vaizdo: išsaugoma be portreto.',
}

const colour: Messages['colour'] = {
  title: 'Spalvota nuotrauka (DI)',
  hint: 'OpenAI nuspalvina pilką portretą be vardo; kiekviena veido linija lieka dokumento. Tik žmogui sutikus.',
  consent: 'Žmogus sutinka',
  consents: { verbal: 'Žodžiu, čia ir dabar', written: 'Raštu' },
  given: { verbal: 'žodžiu', written: 'raštu' },
  consentHint: 'Jis gali atsisakyti: tada naudojamas pilkas portretas.',
  make: 'Spalvota nuotrauka (DI)',
  making: 'Spalvinama…',
  before: 'Dokumentas',
  beforeAlt: 'Pilkas portretas iš dokumento',
  afterAlt: 'DI nuspalvinta nuotrauka',
  label: 'Nuspalvinta DI',
  guess: 'Spalvos spėjamos: akys, plaukai ir oda gali būti netikslūs.',
  use: 'Naudoti',
  again: 'Bandyti dar kartą',
  discard: 'Atmesti',
  chosen: (how: string) => `Išsaugoma kaip darbuotojo nuotrauka, pažymėta „Nuspalvinta DI“. Sutikimas: ${how}.`,
  dontUse: 'Nenaudoti',
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

const scan: Messages['scan'] = {
  title: 'Nuskaityti dokumentą',
  description: 'Vieno asmens paso ar asmens tapatybės kortelės nuotraukos. Kiekvienas puslapis pasukamas, randami jo kampai ir jis ištiesinamas. Atsisiųskite puslapius vienu archyvu arba išsaugokite dokumentą asmens bylose.',
  choosePhotos: 'Pasirinkti nuotraukas',
  takePhoto: 'Fotografuoti',
  photosHint: 'Iki 10 nuotraukų: puslapis su kodo eilutėmis ir kiti puslapiai. Pasuktos ar apverstos nuotraukos atsukamos.',
  making: (done: number, all: number) => `Ruošiami puslapiai: ${done} iš ${all}…`,
  tooMany: 'Viename archyve telpa 10 puslapių. Kitos nuotraukos praleistos.',
  detailsTitle: 'Dokumentas',
  surname: 'Pavardė',
  givenNames: 'Vardai',
  kind: 'Dokumento tipas',
  number: 'Dokumento numeris',
  readAgreed: 'Nuskaityta iš kodo eilučių, abu kartus vienodai.',
  checkThis: 'Kodo eilutės nuskaitytos vieną kartą: palyginkite su dokumentu.',
  notRead: 'Kodo eilučių dar nenuskaityta: įveskite pavardę.',
  fileName: 'Archyvo pavadinimas',
  pagesTitle: 'Puslapiai',
  pageLabel: (n: number) => `${n} puslapis`,
  makingPage: 'Ruošiamas puslapis…',
  failed: 'Iš šios nuotraukos puslapio padaryti nepavyko. Pašalinkite ją arba fotografuokite iš naujo.',
  checkCorners: 'Patikrinkite kampus',
  checkCornersHint: 'Puslapio kraštus rasti buvo sunku. Pataisykite kampus, jei puslapis nukirptas ar matosi fonas.',
  codeLines: 'Kodo eilutės nuskaitytos',
  turnLeft: 'Pasukti kairėn',
  turnRight: 'Pasukti dešinėn',
  adjustCorners: 'Pataisyti kampus',
  remove: 'Pašalinti',
  addPhotos: 'Pridėti nuotraukų',
  clear: 'Išvalyti',
  download: 'Atsisiųsti archyvą',
  downloading: 'Ruošiamas archyvas…',
  saveToPersonnel: 'Išsaugoti asmens bylose',
  keptNote: 'Archyvas kelias dienas saugomas jums skiltyje „Naujausi nuskaitymai“, paskui ištrinamas.',
  blockers: {
    no_pages: 'Pridėkite dokumento nuotrauką.',
    working: 'Palaukite, kol bus paruošti visi puslapiai.',
    surname: 'Įveskite pavardę: pagal ją pavadinamas archyvas.',
  },
  recentTitle: 'Naujausi nuskaitymai',
  recentHint: 'Jūsų archyvai. Kiekvienas ištrinamas iš serverio praėjus kelioms dienoms po jo sukūrimo.',
  recentEmpty: 'Saugomų archyvų nėra.',
  pages: (n: number) => plural(n, { one: '# puslapis', few: '# puslapiai', other: '# puslapių' }),
  deletedIn: (days: number) => (days <= 1 ? 'Bus ištrintas per parą' : plural(days, { one: 'Bus ištrintas po # dienos', few: 'Bus ištrintas po # dienų', other: 'Bus ištrintas po # dienų' })),
  downloadAgain: 'Atsisiųsti',
  removeAsk: 'Pašalinti šį archyvą iš serverio?',
  removeYes: 'Pašalinti',
  cancel: 'Atšaukti',
  cornersTitle: 'Pataisyti kampus',
  cornersHint: 'Nutempkite kiekvieną kampą į puslapio kampą. Klaviatūra: Tab pereina prie kampo, rodyklės jį perkelia (su Shift – toliau).',
  cornerNames: ['Viršutinis kairysis kampas', 'Viršutinis dešinysis kampas', 'Apatinis dešinysis kampas', 'Apatinis kairysis kampas'],
  photoAlt: 'Pasukta nuotrauka',
  pageAlt: (n: number) => `${n} puslapis, ištiesintas`,
  cornersDone: 'Baigti',
}

export const lt = { shell, steps, person, capture, review, portrait, colour, blockers, problems, notes, fieldNames, kinds, sexes, takes, done, errors, scan }
