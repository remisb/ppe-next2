import type { Guide } from './guide'

const who = { admin: 'administratoriams', manager: 'vadovams', employee: 'darbuotojo rolei' } as const

export const lt: Guide = {
  title: 'Naudotojo vadovas',
  lede: 'Programa registruoja darbuotojams išduotus darbo drabužius ir apsaugos priemones. Paruošiate užsakymą ir pažymite jį kaip užsakytą. Gavęs prekes, darbuotojas patvirtina gavimą, o programa išsaugo užrakintą įrašą anglų ir rusų kalbomis.',
  language: 'Vadovo kalba',
  device: 'Įrenginys',
  devices: { phone: 'Telefonas', tablet: 'Planšetė', desktop: 'Kompiuteris' },
  contents: 'Turinys',
  key: 'Klavišas',
  does: 'Ką daro',
  onlyFor: (roles) => `Tik ${roles.map((r) => who[r]).join(' ir ')}`,
  sections: [
    {
      id: 'sign-in',
      title: 'Prisijungimas',
      blocks: [
        {
          ol: [
            'Atidarykite **workwear.gavort.nl** ir prisijunkite savo el. paštu ir slaptažodžiu.',
            {
              text: 'Pirmasis ekranas priklauso nuo jūsų rolės:',
              items: [
                { text: 'administratoriai pradeda ekrane **Suvestinė**;', roles: ['admin'] },
                { text: 'vadovai – ekrane **Vadovo suvestinė**;', roles: ['manager'] },
                { text: 'darbuotojo rolė – ekrane **Darbuotojo suvestinė**.', roles: ['employee'] },
              ],
            },
          ],
        },
        { p: 'Apatinėje juostoje yra **Pradžia**, **Užsakymai**, **Užsakyti** ir **Darbuotojai**. Mygtuke **Daugiau** – visa kita: kiti skyriai, **Paieška**, **Pagalba**, jūsų paskyra ir **Atsijungti**.', devices: ['phone'] },
        { p: 'Juostoje kairėje yra visi skyriai, viršuje – **Paieška**. **Pagalba**, jūsų paskyra ir **Atsijungti** yra jos apačioje.', devices: ['tablet'] },
        { p: 'Šoninėje juostoje yra visi skyriai ir **Ieškoti…** (`⌘K`). **Pagalba**, **Spartieji klavišai**, jūsų paskyra ir **Atsijungti** yra jos apačioje.', devices: ['desktop'] },
        { p: 'Pažymėjus **Likti prisijungus**, šiame įrenginyje liekate prisijungę ir uždarę programėlę ar perkrovę įrenginį – iki 30 dienų arba kol jo nenaudojate 14 dienų. Bendrame kompiuteryje varnelę nuimkite: būsite atjungti uždarius naršyklę ir ne vėliau kaip po 12 valandų.' },
        { p: '**Atsijungti** užbaigia prisijungimą šiame įrenginyje. Pakeitus slaptažodį, kiti jūsų įrenginiai atjungiami. Jei administratorius atkuria jūsų slaptažodį ar išjungia paskyrą, esate atjungiami visur.' },
        { shots: [{ name: 'sign-in', alt: 'Prisijungimo ekranas su el. paštu, slaptažodžiu ir „Likti prisijungus“', phone: true }] },
      ],
    },
    {
      id: 'dashboard',
      title: 'Suvestinė',
      blocks: [
        { p: 'Viršuje rodomi patvirtinimo laukiantys užsakymai, šio mėnesio išlaidos ir artėjantys pakeitimai.', roles: ['admin'] },
        { p: '**Reikia jūsų dėmesio** rodo, ką daryti toliau, pradedant skubiausiais darbais. Kiekvienoje eilutėje yra jos užduoties mygtukas:', roles: ['admin'] },
        {
          ul: ['pavėluota prekė – **Užsakyti vėl**;', 'nepatvirtintas užsakymas – **Siųsti nuorodą**;', 'trūkstamas dydis – **Pridėti dydžius**;', 'prekė be kainos – **Taisyti**.'],
          roles: ['admin'],
        },
        { p: 'Kortelė **Atsarginės kopijos** rodo, ar duomenų bazė kopijuojama. Pasirinkite ją, kad atidarytumėte **Atsarginės kopijos**.', roles: ['admin'] },
        { shots: [{ name: 'dashboard', alt: 'Suvestinė: rodikliai ir sąrašas „Reikia jūsų dėmesio“' }], roles: ['admin'] },
        {
          p: '**Vadovo suvestinė** skirta prekėms, kainoms ir pirkimams: kas užsakyta, išlaidos pagal prekes, kokius pakeitimus teks pirkti, naujausi kainų pokyčiai, kas kataloge ir rinkiniuose trukdo užsakyti, ir kokių dydžių laikyti atsargų.',
          roles: ['manager'],
        },
        {
          p: '**Darbuotojo suvestinė** prasideda nuo to, ką reikia padaryti: jūsų užsakymai, dar laukiantys darbuotojo patvirtinimo (**Siųsti nuorodą**), keistinos prekės ir darbuotojai, kuriems trūksta dydžio. Žemiau – jūsų užsakymai pagal mėnesius ir neseniai išduoti.',
          roles: ['employee'],
        },
      ],
    },
    {
      id: 'create',
      title: 'Užsakymo kūrimas',
      blocks: [
        {
          ol: [
            { text: 'Palieskite **Užsakyti** apatinėje juostoje arba **Kurti užsakymą** skyriaus **Užsakymai** viršuje.', devices: ['phone'] },
            { text: 'Skyriuje **Užsakymai** viršuje pasirinkite **Kurti užsakymą**.', devices: ['tablet', 'desktop'] },
            'Lauke **Kam skirta** įveskite darbuotojo vardo dalį. Naujam darbuotojui pasirinkite **+ Naujas darbuotojas**.',
            {
              text: 'Pridėkite prekes:',
              items: ['**Prekių rinkinys** vienu paspaudimu prideda visą komplektą.', { text: '**Pridėti prekę** prideda vieną prekę.', devices: ['phone', 'tablet'] }, { text: '**Pridėti prekę** prideda vieną prekę. Paspaudę `/`, pereisite į šį lauką.', devices: ['desktop'] }],
            },
            {
              text: 'Patikrinkite kiekvienos eilutės dydį ir kiekį:',
              items: ['Dydžiai imami iš darbuotojo išsaugotų dydžių. Drabužių dydis renkamas raide, pvz., `S (44–46)`.', 'Kol nepasirinkti visi trūkstami dydžiai, užsakyti negalima.', 'Jei pasirinksite kitą dydį nei išsaugotas darbuotojo, programa paklaus **Pasirinktas kitas dydis. Išsaugoti jį darbuotojo profilyje?** **Išsaugoti** – dydis bus naudojamas ir būsimiems užsakymams; **Praleisti dydžio atnaujinimą** – tik šiam užsakymui.'],
            },
            { text: 'Ekrano apačios juostoje palieskite **Peržiūrėti**. Joje matyti ir eilučių skaičius, ir suma.', devices: ['phone', 'tablet'] },
            { text: 'Dešinėje esančiame skydelyje pasirinkite **Peržiūrėti ir pažymėti kaip užsakytą** arba paspauskite `⌘/Ctrl` `Enter`.', devices: ['desktop'] },
          ],
        },
        { p: 'Kol dirbate, šis įrenginys saugo užsakymo juodraštį. **Kopijuoti į WhatsApp** (žinutė tiekėjui) yra peržiūroje.' },
        { shots: [{ name: 'create-order', alt: 'Užsakymo kūrimas: pasirinktas darbuotojas, pritaikytas rinkinys ir dydžiai' }] },
      ],
    },
    {
      id: 'review',
      title: 'Peržiūra ir „Pažymėti kaip užsakytą“',
      blocks: [
        {
          ol: [
            'Patikrinkite eilutes ir bendrą sumą.',
            'Pasirinkite **Pažymėti kaip užsakytą**. Užsakymo būsena tampa **Užsakyta**, ir jo nebegalima keisti. Programa kartu sukuria darbuotojo patvirtinimo nuorodą.',
            'Nusiųskite darbuotojui nuorodą: **Siųsti nuorodą per WhatsApp** arba **Kopijuoti nuorodą**. Nuoroda galioja 7 dienas ir rodoma tik vieną kartą.',
          ],
        },
        { p: 'Jei darbuotojas pasirašys popieriuje, vietoj to pasirinkite **Spausdinti įrašą**.' },
        { p: '**Kopijuoti į WhatsApp** peržiūroje nukopijuoja žinutę tiekėjui. Kai administratorius **Nustatymuose** yra nurodęs tiekėjo WhatsApp grupę, programa pasiūlo ją atidaryti: įklijuokite žinutę ten.' },
        {
          shots: [
            { name: 'review', alt: 'Užsakymo peržiūros langas' },
            { name: 'ordered', alt: 'Užsakytas užsakymas su patvirtinimo nuoroda' },
          ],
        },
      ],
    },
    {
      id: 'confirm',
      title: 'Darbuotojas patvirtina',
      blocks: [
        {
          ol: [
            'Darbuotojas atidaro nuorodą. Paskyros jam nereikia.',
            'Jis peržiūri prekes, jų kainas ir bendrą sumą anglų arba rusų kalba (**EN / RU**). Puslapis atsidaro darbuotojo pageidaujama kalba, jei tai anglų ar rusų; lietuviškai jis nerodomas.',
            'Jis pažymi sutikimą ir paspaudžia **Confirm receipt** (**Подтвердить получение**). Užsakymo būsena tampa **Išduota**.',
          ],
        },
        { shots: [{ name: 'confirm-phone', alt: 'Patvirtinimo puslapis telefone', phone: true }] },
      ],
    },
    {
      id: 'orders',
      title: 'Užsakymai',
      blocks: [
        { p: '**Užsakymuose** – visi pateikti užsakymai. **Kurti užsakymą** viršuje pradeda naują.' },
        {
          p: '**Laukia**, **Išduota** ir **Visi** filtruoja užsakymus pagal būseną. Taip pat galima filtruoti pagal darbuotoją ir datą. Spustelėjus įrašo numerį, užsakymas atsidaro šalia sąrašo. `J` ir `K` pereina tarp užsakymų, o `Esc` užsakymą uždaro.',
          devices: ['desktop'],
        },
        { p: '**Laukia**, **Išduota** ir **Visi** filtruoja užsakymus pagal būseną. Taip pat galima filtruoti pagal darbuotoją ir datą. Palieskite užsakymą, kad jį atidarytumėte; **Užsakymai** jo viršuje grąžina į sąrašą.', devices: ['tablet'] },
        { p: '**Laukia**, **Išduota** ir **Visi** filtruoja užsakymus pagal būseną; mygtuke **Filtrai** – filtrai pagal darbuotoją ir datą. Palieskite užsakymą, kad jį atidarytumėte; **Užsakymai** jo viršuje grąžina į sąrašą.', devices: ['phone'] },
        { p: 'Užsakymas, kurio būsena **Užsakyta**, turi šiuos veiksmus:' },
        {
          ul: [
            '**Atidaryti darbuotojo patvirtinimą** sukuria naują nuorodą. Ten pat galima pažymėti pasirašytą popierinį egzempliorių (**Pažymėti pasirašytą popierinį patvirtinimą**).',
            '**Išduoti dabar** perduoda šį įrenginį darbuotojui, ir jis patvirtina gavimą vietoje.',
            '**Spausdinti įrašą** atspausdina įrašą pasirašyti.',
          ],
        },
        { p: '**⋯ → Ištrinti užsakymą…** pašalina užsakymą, pvz., bandomąjį. Prieš tai programa paklausia.', roles: ['manager'] },
        { shots: [{ name: 'history', alt: 'Užsakymai su atidarytu užsakymu' }] },
      ],
    },
    {
      id: 'record',
      title: 'Išdavimo įrašas',
      blocks: [
        { p: 'Užsakymas, kurio būsena **Išduota**, turi užrakintą įrašą anglų ir rusų kalbomis (Items Given Record / Акт выдачи). Atidarykite jį mygtuku **Peržiūrėti įrašą**.' },
        { ul: ['**Spausdinti įrašą** atspausdina jį viename A4 lape.', '**Siųsti per WhatsApp** jį išsiunčia.'] },
        { shots: [{ name: 'record', alt: 'Dvikalbis išdavimo įrašas' }] },
      ],
    },
    {
      id: 'employees',
      title: 'Darbuotojai',
      blocks: [
        { p: 'Sąraše matyti kiekvieno darbuotojo dydžiai ir pastabos. Darbuotojai, kuriems trūksta dydžio, pažymėti. Ilga pastaba sutrumpinama iki vienos eilutės; visą ją matysite atidarę darbuotoją.', devices: ['phone', 'tablet'] },
        { p: 'Sąraše matyti kiekvieno darbuotojo dydžiai ir pastabos. Darbuotojai, kuriems trūksta dydžio, pažymėti. Ilga pastaba sutrumpinama iki vienos eilutės; visą ją matysite užvedę žymeklį arba atidarę darbuotoją.', devices: ['desktop'] },
        { p: 'Darbuotojo puslapyje rodoma:' },
        { ul: ['jo dydžiai ir pageidaujama kalba;', 'visos išduotos prekės su naudojimo trukme ir pakeitimo data;', 'dar neišduoti užsakymai.'] },
        { p: 'Šiame puslapyje **Naujas užsakymas** pradeda užsakymą šiam darbuotojui, o **Keisti dydžius** pakeičia jo dydžius.' },
        {
          shots: [
            { name: 'employees', alt: 'Darbuotojų sąrašas' },
            { name: 'employee', alt: 'Darbuotojo puslapis su išduotomis prekėmis' },
          ],
        },
      ],
    },
    {
      id: 'catalogue',
      title: 'Prekių katalogas ir prekių rinkiniai',
      blocks: [
        {
          p: 'Kiekviena katalogo prekė turi kainą, naudojimo laikotarpį ir dydžių grupę. Užsakymuose rodoma ir sumuojama ši kaina. Prekės be kainos ar naudojimo laikotarpio užsakyti negalima. Pakeitus kainą, esami užsakymai nesikeičia.',
        },
        { p: 'Prekė gali turėti ir **Pirkimo kainą** – kiek mokame tiekėjui. Ji neprivaloma, užsakyti jos nereikia, o užsakymuose ji nerodoma. Prekės puslapyje matyti abi kainos ir kaip jos keitėsi.' },
        { p: 'Prekių rinkinys – tai prekių komplektas su numatytais kiekiais. Ekrane „Kurti užsakymą“ jį pritaikote vienu paspaudimu.' },
        { p: 'Prekes kuriate ir keičiate ekrane **Prekių katalogas**, o komplektus – ekrane **Prekių rinkiniai**.', roles: ['admin', 'manager'] },
        {
          shots: [
            { name: 'catalogue', alt: 'Prekių katalogas' },
            { name: 'item-sets', alt: 'Prekių rinkiniai' },
          ],
        },
      ],
    },
    {
      id: 'users',
      title: 'Naudotojai',
      roles: ['admin'],
      blocks: [
        {
          ul: [
            'Kurkite, redaguokite ar deaktyvuokite paskyras ir priskirkite roles: administratorius, vadovas arba darbuotojas.',
            'Slaptažodžiui atkurti naudokite **⋯ → Nustatyti naują slaptažodį…**.',
            'Jei prisijungėte daugiau nei prieš 12 valandų, prieš išsaugant pakeitimą programėlė paprašys patvirtinti slaptažodį (**Patvirtinkite slaptažodį**).',
          ],
        },
        { shots: [{ name: 'users', alt: 'Naudotojų ekranas' }] },
      ],
    },
    {
      id: 'settings',
      title: 'Nustatymai',
      roles: ['admin'],
      blocks: [
        {
          p: '**Tiekėjo WhatsApp grupė**: įrašykite grupės pavadinimą ir pakvietimo nuorodą. WhatsApp programėlėje atidarykite grupę, palieskite jos pavadinimą, tada **Pakviesti per nuorodą** ir **Kopijuoti nuorodą**.',
        },
        {
          p: '**Kopijuoti į WhatsApp** tada pasiūlo atidaryti šią grupę, kur įklijuojate užsakymo žinutę. WhatsApp negali atidaryti grupės su jau įrašyta žinute. **Pašalinti grupę** grąžina WhatsApp atidarymą nepasirinkus pokalbio.',
        },
        { shots: [{ name: 'settings', alt: 'Nustatymai: tiekėjo WhatsApp grupė' }] },
      ],
    },
    {
      id: 'backups',
      title: 'Atsarginės kopijos',
      roles: ['admin'],
      blocks: [
        {
          p: '**Atsarginės kopijos** rodo, ar duomenų bazė kopijuojama. Atsarginių kopijų tarnyba serveryje pagal tvarkaraštį kopijuoja visą duomenų bazę, jei nenustatyta kitaip, kiekvieną naktį, ir ištrina senas kopijas pasibaigus laikymo laikui.',
        },
        {
          p: 'Viršutinė eilutė sako, ar viskas gerai. Ji tampa raudona, kai paskutinė kopija nepavyko, kai suplanuota kopija vėluoja arba kai tarnyba nustojo pranešti. Praneškite serverį prižiūrinčiam žmogui.',
        },
        { p: 'Antras įspėjimas rodomas, kol kopijos laikomos tik pačiame serveryje, nes jos dingtų kartu su juo.' },
        {
          ul: [
            '**Paskutinė kopija** ir **Kita kopija**: kada, paskutinės dydis ir kiek ji užtruko.',
            '**Laikoma** ir **Bendras dydis**: dabar laikomos kopijos.',
            '**Naujausios kopijos**: kiekvienas bandymas, naujausi pirmi, nepavykusio – su klaida.',
            '**Nustatymai**: tvarkaraštis, kur kopijos saugomos, kiek laiko laikomos ir ar užšifruotos.',
          ],
        },
        { p: 'Nustatymai keičiami serveryje, ten ir atkuriama kopija: programėlė juos tik rodo.' },
        { shots: [{ name: 'backups', alt: 'Atsarginės kopijos: paskutinė kopija, naujausios kopijos ir nustatymai' }] },
      ],
    },
    {
      id: 'account',
      title: 'Jūsų paskyra',
      blocks: [
        {
          ul: [
            '**Kalba**: English, Lietuvių arba Русский. Pasirinkimas išsaugomas jūsų paskyroje, todėl galioja kiekviename įrenginyje, kuriame prisijungiate. Darbuotojo patvirtinimo puslapis ir įrašas lieka anglų ir rusų kalbomis.',
            '**Tema**: **Šviesi**, **Tamsi** arba **Kaip įrenginyje**. Ji išsaugoma šiame įrenginyje ir galioja ir prisijungimo puslapyje.',
            '**Keisti slaptažodį**: kiti jūsų įrenginiai atjungiami, o šis lieka prisijungęs.',
            '**Prisijungę įrenginiai**: visos naršyklės, kuriose esate prisijungę, ir kada jos naudotos paskutinį kartą. **Šis įrenginys** – pirmas. Atjunkite įrenginį, kurio nebenaudojate ar neatpažįstate, arba pasirinkite **Atjungti visus kitus įrenginius**.',
            { text: '**Lentelės eilutės**: **Kompaktiškos** ekrane sutalpina daugiau eilučių.', devices: ['desktop'] },
          ],
        },
        { shots: [{ name: 'account', alt: 'Paskyra: kalba, tema ir slaptažodis' }, { name: 'devices', alt: 'Prisijungę įrenginiai: šis įrenginys ir telefonas' }] },
      ],
    },
    {
      id: 'shortcuts',
      title: 'Paieška ir spartieji klavišai',
      titleOn: { phone: 'Paieška', tablet: 'Paieška' },
      blocks: [
        { p: 'Atidarykite **Daugiau**, tada **Paieška** – rasite įrašų numerius, darbuotojus, prekes ir ekranus. Pavyzdžiui, įveskite vardą ir pasirinkite **Naujas užsakymas: …**.', devices: ['phone'] },
        { p: '**Paieška** juostos viršuje randa įrašų numerius, darbuotojus, prekes ir ekranus. Pavyzdžiui, įveskite vardą ir pasirinkite **Naujas užsakymas: …**.', devices: ['tablet'] },
        {
          keys: [
            ['`⌘K` / `Ctrl K`', 'Ieško įrašų numerių, darbuotojų, prekių ir ekranų. Pavyzdžiui, įveskite vardą ir pasirinkite **Naujas užsakymas: …**.'],
            ['`/`', 'Pereina į paieškos arba „Pridėti prekę“ lauką.'],
            ['`G`, tada `D` `O` `H` `E` `C` `S` `U`', 'Pereina į Suvestinę, Kurti užsakymą, Užsakymus, Darbuotojus, Katalogą, Prekių rinkinius arba Naudotojus.'],
            ['`J` / `K`, `Esc`', 'Pereina per Užsakymus arba uždaro atidarytą užsakymą.'],
            ['`⌘/Ctrl` `Enter`', 'Ekrane „Kurti užsakymą“ atidaro užsakymo peržiūrą.'],
            ['`?`', 'Rodo visus sparčiuosius klavišus.'],
          ],
          devices: ['desktop'],
        },
        { shots: [{ name: 'palette', alt: '⌘K paieška randa darbuotoją' }] },
      ],
    },
  ],
  footer: 'Ekrano nuotraukose rodomi demonstraciniai duomenys. Prekių pavadinimai yra duomenys, todėl rodomi taip, kaip įvesti.',
}
