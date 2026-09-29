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
        { p: 'Apatinėje juostoje yra **Pradžia**, **Istorija**, **Užsakyti** ir **Darbuotojai**. Mygtuke **Daugiau** – visa kita: kiti skyriai, **Paieška**, **Pagalba**, jūsų paskyra ir **Atsijungti**.', devices: ['phone'] },
        { p: 'Juostoje kairėje yra visi skyriai, viršuje – **Paieška**. **Pagalba**, jūsų paskyra ir **Atsijungti** yra jos apačioje.', devices: ['tablet'] },
        { p: 'Šoninėje juostoje yra visi skyriai ir **Ieškoti…** (`⌘K`). **Pagalba**, **Spartieji klavišai**, jūsų paskyra ir **Atsijungti** yra jos apačioje.', devices: ['desktop'] },
        { shots: [{ name: 'sign-in', alt: 'Prisijungimo ekranas su el. paštu ir slaptažodžiu', phone: true }] },
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
            'Atidarykite **Kurti užsakymą**.',
            'Lauke **Kam skirta** įveskite darbuotojo vardo dalį. Naujam darbuotojui pasirinkite **+ Naujas darbuotojas**.',
            {
              text: 'Pridėkite prekes:',
              items: ['**Prekių rinkinys** vienu paspaudimu prideda visą komplektą.', { text: '**Pridėti prekę** prideda vieną prekę.', devices: ['phone', 'tablet'] }, { text: '**Pridėti prekę** prideda vieną prekę. Paspaudę `/`, pereisite į šį lauką.', devices: ['desktop'] }],
            },
            {
              text: 'Patikrinkite kiekvienos eilutės dydį ir kiekį:',
              items: ['Dydžiai imami iš darbuotojo išsaugotų dydžių. Drabužių dydis renkamas raide, pvz., `S (44–46)`.', 'Kol nepasirinkti visi trūkstami dydžiai, užsakyti negalima.'],
            },
            { text: 'Ekrano apačios juostoje palieskite **Peržiūrėti**. Joje matyti ir eilučių skaičius, ir suma.', devices: ['phone', 'tablet'] },
            { text: 'Dešinėje esančiame skydelyje pasirinkite **Peržiūrėti ir pažymėti kaip užsakytą** arba paspauskite `⌘/Ctrl` `Enter`.', devices: ['desktop'] },
          ],
        },
        { p: 'Kol dirbate, šis įrenginys saugo užsakymo juodraštį. **Kopijuoti į WhatsApp** (žinutė tiekėjui) yra peržiūroje.', devices: ['phone', 'tablet'] },
        { p: 'Kol dirbate, šis įrenginys saugo užsakymo juodraštį. **Kopijuoti į WhatsApp** nukopijuoja žinutę tiekėjui.', devices: ['desktop'] },
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
            'Jei darbuotojas patvirtins telefonu, palikite pažymėtą **Kartu sukurti patvirtinimo nuorodą**.',
            'Pasirinkite **Pažymėti kaip užsakytą**. Užsakymo būsena tampa **Užsakyta**, ir jo nebegalima keisti.',
            'Nusiųskite darbuotojui nuorodą: **Siųsti nuorodą per WhatsApp** arba **Kopijuoti nuorodą**. Nuoroda galioja 7 dienas ir rodoma tik vieną kartą.',
          ],
        },
        { p: 'Jei darbuotojas pasirašys popieriuje, vietoj to pasirinkite **Spausdinti įrašą**.' },
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
            'Jis peržiūri prekes anglų arba rusų kalba (**EN / RU**). Šis puslapis lietuviškai nerodomas.',
            'Jis pažymi sutikimą ir paspaudžia **Confirm receipt** (**Подтвердить получение**). Užsakymo būsena tampa **Išduota**.',
          ],
        },
        { shots: [{ name: 'confirm-phone', alt: 'Patvirtinimo puslapis telefone', phone: true }] },
      ],
    },
    {
      id: 'history',
      title: 'Istorija',
      blocks: [
        {
          p: '**Laukia**, **Išduota** ir **Visi** filtruoja užsakymus pagal būseną. Taip pat galima filtruoti pagal darbuotoją ir datą. Spustelėjus įrašo numerį, užsakymas atsidaro šalia sąrašo. `J` ir `K` pereina tarp užsakymų, o `Esc` užsakymą uždaro.',
          devices: ['desktop'],
        },
        { p: '**Laukia**, **Išduota** ir **Visi** filtruoja užsakymus pagal būseną. Taip pat galima filtruoti pagal darbuotoją ir datą. Palieskite užsakymą, kad jį atidarytumėte; **Istorija** jo viršuje grąžina į sąrašą.', devices: ['tablet'] },
        { p: '**Laukia**, **Išduota** ir **Visi** filtruoja užsakymus pagal būseną; mygtuke **Filtrai** – filtrai pagal darbuotoją ir datą. Palieskite užsakymą, kad jį atidarytumėte; **Istorija** jo viršuje grąžina į sąrašą.', devices: ['phone'] },
        { p: 'Užsakymas, kurio būsena **Užsakyta**, turi šiuos veiksmus:' },
        {
          ul: [
            '**Atidaryti darbuotojo patvirtinimą** sukuria naują nuorodą. Ten pat galima pažymėti pasirašytą popierinį egzempliorių (**Pažymėti pasirašytą popierinį patvirtinimą**).',
            '**Išduoti dabar** perduoda šį įrenginį darbuotojui, ir jis patvirtina gavimą vietoje.',
            '**Spausdinti įrašą** atspausdina įrašą pasirašyti.',
            '**Kopijuoti į WhatsApp** nukopijuoja žinutę tiekėjui.',
          ],
        },
        { p: '**⋯ → Ištrinti užsakymą…** pašalina užsakymą, pvz., bandomąjį. Prieš tai programa paklausia.', roles: ['manager'] },
        { shots: [{ name: 'history', alt: 'Istorija su atidarytu užsakymu' }] },
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
          p: 'Kiekviena katalogo prekė turi kainą, naudojimo laikotarpį ir dydžių grupę. Prekės be kainos ar naudojimo laikotarpio užsakyti negalima. Pakeitus kainą, esami užsakymai nesikeičia.',
        },
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
          ],
        },
        { shots: [{ name: 'users', alt: 'Naudotojų ekranas' }] },
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
            '**Keisti slaptažodį**.',
            { text: '**Lentelės eilutės**: **Kompaktiškos** ekrane sutalpina daugiau eilučių.', devices: ['desktop'] },
          ],
        },
        { shots: [{ name: 'account', alt: 'Paskyra: kalba, slaptažodis ir lentelės eilutės' }] },
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
            ['`G`, tada `D` `O` `H` `E` `C` `S` `U`', 'Pereina į Suvestinę, Kurti užsakymą, Istoriją, Darbuotojus, Katalogą, Prekių rinkinius arba Naudotojus.'],
            ['`J` / `K`, `Esc`', 'Pereina per Istoriją arba uždaro atidarytą užsakymą.'],
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
