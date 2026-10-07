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
        {
          shots: [
            { name: 'sign-in', alt: 'Prisijungimo ekranas su el. paštu, slaptažodžiu ir „Likti prisijungus“', phone: true },
            { name: 'sign-in-dark', alt: 'Tas pats ekranas su tamsia tema', phone: true },
          ],
        },
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
        { p: 'Kortelė **Atsarginės kopijos** rodo, ar duomenų bazė kopijuojama. Pasirinkite ją, kad **Administravime** atidarytumėte **Atsarginės kopijos**.', roles: ['admin'] },
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
        { p: '**Kopijuoti į WhatsApp** peržiūroje nukopijuoja žinutę tiekėjui. Kai administratorius **Administravime**, ekrane **Nustatymai**, yra nurodęs tiekėjo WhatsApp grupę, programa pasiūlo ją atidaryti: įklijuokite žinutę ten.' },
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
        { p: 'Užsakymo **Pakeitimai** rodo, kas jam nutiko ir kas tai padarė: užsakyta, sukurta ar atidaryta nuoroda, išduota.' },
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
        { ul: ['jo dydžiai ir pageidaujama kalba;', 'visos išduotos prekės su naudojimo trukme ir pakeitimo data;', 'dar neišduoti užsakymai;', '**Pakeitimai**: kas ir kada keitė jo duomenis ar dydžius.'] },
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
        { p: 'Prekė gali turėti ir **Pirkimo kainą** – kiek mokame tiekėjui. Ji neprivaloma, užsakyti jos nereikia, o užsakymuose ji nerodoma. Prekės puslapyje matyti abi kainos ir kaip jos keitėsi, o jos **Pakeitimai** rodo, kas ir kada keitė prekę.' },
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
      id: 'administration',
      title: 'Administravimas',
      roles: ['admin'],
      blocks: [
        { p: '**Administravime** tvarkote, kas gali naudotis programėle ir ką gali daryti, prižiūrite, kaip ji veikia, ir tvarkote organizacijos nustatymus. Jis atsidaro **Apžvalgoje**. Kiti jo ekranai: **Naudotojai**, **Rolės ir teisės**, **Audito žurnalas**, **Sauga**, **Sistema**, **Naudojimas** ir **Nustatymai**.' },
        { p: 'Atidarykite jį iš **Daugiau**. Jis turi savo apatinę juostą su **Apžvalga**, **Naudotojai**, **Auditas** ir **Sauga**. Jos **Daugiau** yra **Rolės ir teisės**, **Sistema**, **Naudojimas** ir **Nustatymai**, toliau **Darbo drabužiai ir įranga** (grįžti atgal), jūsų paskyra ir **Atsijungti**.', devices: ['phone'] },
        { p: 'Atidarykite jį mygtuku **Admin.** juostos apačioje. Jis turi savo juostą; **Drabužiai** jos apačioje grąžina atgal.', devices: ['tablet'] },
        { p: 'Atidarykite jį mygtuku **Administravimas** šoninės juostos apačioje. Jis turi savo šoninę juostą; **Darbo drabužiai ir įranga** jos apačioje grąžina atgal.', devices: ['desktop'] },
        { p: 'Prisijungiate prie abiejų iš karto, o **Atsijungti** bet kuriame atjungia nuo abiejų. **Administravimą** mato visi, kurių rolės leidžia tvarkyti naudotojus, roles ar nustatymus arba skaityti audito žurnalą, saugą, sistemą, naudojimą ar atsargines kopijas, su tik tais ekranais, kuriuos atveria jų rolės.' },
      ],
    },
    {
      id: 'overview',
      title: 'Apžvalga',
      roles: ['admin'],
      blocks: [
        { p: '**Apžvalga** atsako į klausimą: ar kas nors negerai? **Reikia dėmesio** išvardija, į ką pažiūrėti, svarbiausia pirmiau, su nuoroda, kur tai sutvarkyti. Kai viskas gerai, rodoma **Niekam nereikia jūsų dėmesio.**' },
        { ul: [
          'Atsarginė kopija nepavyko arba kopijos nebedaromos.',
          'Buvo panaudotas nukopijuotas prisijungimas arba daug prisijungimų nepavyko.',
          'Užklausos nepavyksta arba atsirado nauja klaidos rūšis.',
          'Laikas peržiūrėti prieigą. Peržiūrėkite ją kas 90 dienų.',
          'Audito žurnalas nesutampa su savo antspaudais: kažkas jį pakeitė apeidamas programėlę.',
          'Antspaudams nesuteikiamos laiko žymos: laiko žymų tarnyba neatsako jau parą.',
        ] },
        { p: 'Žemiau esantys **Rodikliai** rodo aktyvius naudotojus, kas prisijungę dabar, šiandienos prisijungimus, paskutinių 24 valandų užklausas, duomenų bazę ir paskutinę atsarginę kopiją.' },
        { shots: [{ name: 'overview', alt: 'Apžvalga: kam reikia dėmesio, toliau rodikliai' }] },
      ],
    },
    {
      id: 'users',
      title: 'Naudotojai',
      roles: ['admin'],
      blocks: [
        {
          ul: [
            'Kurkite, redaguokite ar deaktyvuokite paskyras. Kiekvienai paskyrai priskirkite vieną ar kelias roles: naudotojas gali tai, ką leidžia bet kuri jo rolė. Ką leidžia kiekviena rolė, rodo **Rolės ir teisės**.',
            'Rolės pakeitimas naudotoją pasiekia per kelias minutes, nereikia jungtis iš naujo. Deaktyvuotas naudotojas atjungiamas visuose įrenginiuose.',
            'Slaptažodžiui atkurti naudokite **⋯ → Nustatyti naują slaptažodį…**.',
            'Negalite deaktyvuoti savo paskyros ar atimti iš savęs rolės, kuri leidžia tvarkyti naudotojus ar roles. Rolę **Administratorius** visada turi bent vienas aktyvus naudotojas.',
            'Jei prisijungėte daugiau nei prieš 12 valandų, prieš išsaugant pakeitimą programėlė paprašys patvirtinti slaptažodį (**Patvirtinkite slaptažodį**).',
          ],
        },
        { shots: [{ name: 'users', alt: 'Naudotojų ekranas' }] },
      ],
    },
    {
      id: 'roles',
      title: 'Rolės ir teisės',
      roles: ['admin'],
      blocks: [
        { p: '**Rolės ir teisės** rodo kiekvieną rolę, ką ji leidžia ir kiek naudotojų ją turi. Rolė – tai teisių rinkinys, pavyzdžiui, **Tvarkyti prekių katalogą** ar **Trinti darbuotojus**. Roles naudotojams skiriate skiltyje **Naudotojai**.' },
        {
          ul: [
            '**Administratorius**, **Vadovas** ir **Darbuotojas** yra įtaisytos rolės. **Administratorius** gali viską ir jo pakeisti negalima: **Peržiūrėti** parodo, ką jis leidžia. Ką leidžia **Vadovas** ir **Darbuotojas**, galite keisti, bet ne jų pavadinimus ar aprašymus, o ištrinti jų negalima.',
            '**Pridėti rolę** sukuria naują: pavadinimas, kam ji skirta, ir jos teisės. Kai kurioms teisėms reikia kitos, kuri pažymima kartu: teisei **Tvarkyti naudotojus** reikia teisės **Matyti naudotojus**.',
            'Pakeitimas rolę turinčius naudotojus pasiekia per kelias minutes.',
            '**⋯ → Ištrinti rolę…** ištrina rolę, kurios neturi nė vienas naudotojas. Pirmiausia atimkite ją iš naudotojų skiltyje **Naudotojai**.',
            'Jei prisijungėte daugiau nei prieš 12 valandų, prieš išsaugant pakeitimą programėlė paprašys patvirtinti slaptažodį (**Patvirtinkite slaptažodį**).',
          ],
        },
        {
          shots: [
            { name: 'roles', alt: 'Rolės ir teisės: įtaisytos rolės ir jas turintys naudotojai' },
            { name: 'role', alt: 'Rolės teisės, sugrupuotos, prie kiekvienos – ką ji leidžia' },
          ],
        },
      ],
    },
    {
      id: 'audit',
      title: 'Audito žurnalas',
      roles: ['admin'],
      blocks: [
        { p: '**Audito žurnalas** rodo kiekvieną užfiksuotą pakeitimą: kas pakeista, kas pakeitė, kada ir kur. Pakeitimas daromas programoje **Darbo drabužiai ir įranga**, **Administravime**, per darbuotojo **Patvirtinimo nuorodą** arba pačios **Sistemos**.' },
        { p: 'Filtruokite pagal **Sritis**, **Pakeitimas**, **Naudotojas** ir datas. Spustelėkite pakeitimą, kad jis atsivertų šalia sąrašo. Jame matyti kiekvienas laukas prieš ir po, o **Atidaryti programoje „Darbo drabužiai ir įranga“** atidaro įrašą. **Visi šio įrašo pakeitimai** susiaurina sąrašą iki jo.', devices: ['desktop'] },
        { p: 'Filtruokite pagal **Sritis**, **Pakeitimas**, **Naudotojas** ir datas. Bakstelėkite pakeitimą, kad jį atidarytumėte. Jame matyti kiekvienas laukas prieš ir po, o **Atidaryti programoje „Darbo drabužiai ir įranga“** atidaro įrašą. **Visi šio įrašo pakeitimai** susiaurina sąrašą iki jo.', devices: ['tablet'] },
        { p: '**Filtrai** yra srities, pakeitimo, naudotojo ir datų filtrai. Bakstelėkite pakeitimą, kad jį atidarytumėte. Jame matyti kiekvienas laukas prieš ir po, o **Atidaryti programoje „Darbo drabužiai ir įranga“** atidaro įrašą. **Visi šio įrašo pakeitimai** susiaurina sąrašą iki jo.', devices: ['phone'] },
        { ul: [
          '**Antspaudai**, viršuje: kiekvienos dienos pakeitimai užantspauduojami praėjus valandai po dienos pabaigos maiša, kuri apima ir ankstesnę dieną, todėl vėliau pakeistas, pridėtas ar pašalintas pakeitimas išryškėja. **Patikrinti** iš naujo patikrina visus antspaudus; programėlė juos tikrina ir kas valandą.',
          'Kiekvienam antspaudui suteikiama ir laiko žyma: viešoji laiko žymų tarnyba pasirašo antspaudą kartu su laiku. Vėliau iš naujo sudarytas antspaudas negali gauti pradinio laiko, todėl net turintis prieigą prie serverio negali nepastebimai perrašyti žurnalo. Skydelis rodo, iki kurios dienos antspaudams suteiktos laiko žymos.',
          'Jei užantspauduota diena nesutampa arba jos laiko žyma netinkama, pavėluota ar jos nėra, tai parodo Apžvalga. Praneškite serverį prižiūrinčiam asmeniui ir išsaugokite atsargines kopijas iš laiko prieš tą dieną.',
          '**Eksportuoti** atsisiunčia filtrų atrinktus pakeitimus tarp dviejų dienų, ne ilgiau kaip per metus, kaip **CSV, skaičiuoklei** arba **JSON eilutės, archyvui**. Pats eksportas taip pat užfiksuojamas audito žurnale.',
          'Pakeitimai laikomi metų metus (10 metų, jei serveryje nenustatyta kitaip), paskui ištrinami po dieną.',
        ] },
        { shots: [{ name: 'audit-log', alt: 'Audito žurnalas: atidarytas kainos pakeitimas su laukais prieš ir po' }] },
      ],
    },
    {
      id: 'security',
      title: 'Sauga',
      roles: ['admin'],
      blocks: [
        { p: '**Sauga** turi tris skirtukus:' },
        { ul: [
          '**Prisijungimai**: kiekvienas prisijungimas, nepavykęs bandymas, patvirtintas slaptažodis ir atsijungimas su paskyra, adresu, iš kurio jungtasi, ir įrenginiu. Filtruokite pagal įvykį, naudotoją ir datas. Prie nepavykusio bandymo nurodyta priežastis, pvz., **Neteisingas slaptažodis**. Prisijungimų įrašai laikomi 180 dienų.',
          '**Prisijungę įrenginiai**: kiekviena naršyklė, kurioje kas nors šiuo metu prisijungęs. Mygtuku **Atjungti** atjunkite pamestą ar neatpažintą įrenginį: tas asmuo ten turės vėl prisijungti savo slaptažodžiu.',
          '**Prieigos peržiūra**: kiekvienas naudotojas su rolėmis, tuo, ką jos leidžia, ir paskutiniu prisijungimu. Administratoriai ir paskyros, nenaudotos 90 dienų, pažymėti. Patikrinkite, ar kiekvienam vis dar reikia jo prieigos, pakeiskite ją ekrane **Naudotojai**, tada pasirinkite **Pažymėti kaip peržiūrėtą**. Darykite tai kas 90 dienų: Apžvalga primins.',
        ] },
        { p: '**Nukopijuotas prisijungimas sustabdytas** reiškia, kad kažkas panaudojo seną prisijungimo kopiją, todėl jis buvo nutrauktas visuose jį turėjusiuose įrenginiuose. Paklauskite naudotojo, ar tai buvo jis. Jei ne, tegul pasikeičia slaptažodį.' },
        {
          shots: [
            { name: 'security', alt: 'Sauga: prisijungimai su adresu ir įrenginiu' },
            { name: 'access-review', alt: 'Prieigos peržiūra: naudotojai, jų rolės ir paskutinis prisijungimas' },
          ],
        },
      ],
    },
    {
      id: 'system',
      title: 'Sistema',
      roles: ['admin'],
      blocks: [
        { p: '**Sistema** rodo, kaip veikia programėlė. Ji turi tris skirtukus: **Būsena**, **Klaidos** ir **Atsarginės kopijos**.' },
        { ul: [
          '**Būsena**: ar programėlė **Veikia**, jos versija ir kada ji paleista; paskutinių 24 valandų užklausos, kiek jų nepavyko ir kiek jos truko; duomenų bazės dydis ir paskutinė migracija; kiek laikomi prisijungimai, klaidos ir pakeitimai.',
          '**Klaidos**: kas nepavyko serveryje ar kieno nors naršyklėje, kiek kartų ir kada paskutinį kartą. Atidarykite klaidą, kad matytumėte, kas su ja susidūrė, kur ir kokiu įrenginiu. Klaidos laikomos 30 dienų.',
          '**Atsarginės kopijos**: žr. toliau.',
        ] },
        { p: 'Kai kas nors nepavyksta, programėlė parodo **Nuoroda į užklausą**, pvz., `9f2c1a7e`. Klaida ekrane **Klaidos** rodo tą pačią nuorodą. Perduokite ją serverį prižiūrinčiam asmeniui: pagal ją jis randa klaidą serverio žurnale.' },
        {
          shots: [
            { name: 'system', alt: 'Sistema: programėlė, jos užklausos ir duomenų bazė' },
            { name: 'errors', alt: 'Klaidos: atidaryta klaida su nuoroda į užklausą' },
          ],
        },
      ],
    },
    {
      id: 'backups',
      title: 'Atsarginės kopijos',
      roles: ['admin'],
      blocks: [
        {
          p: '**Sistema → Atsarginės kopijos** rodo, ar duomenų bazė kopijuojama. Atsarginių kopijų tarnyba serveryje pagal tvarkaraštį kopijuoja visą duomenų bazę, jei nenustatyta kitaip, kiekvieną naktį, ir ištrina senas kopijas pasibaigus laikymo laikui.',
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
      id: 'usage',
      title: 'Naudojimas',
      roles: ['admin'],
      blocks: [
        { p: '**Naudojimas** rodo, kaip naudojamasi programėlėmis. Jokie puslapiai nesekami: viskas gaunama iš to, ką programėlė ir taip užfiksuoja.' },
        { ul: [
          'Viršuje: šiandien, per paskutines 7 ir per 30 dienų aktyvūs asmenys iš visų aktyvių paskyrų ir šiandienos prisijungimai.',
          '**Aktyvūs asmenys per dieną** pagal programėlę, su linija kiekvienai rolei. **Prisijungimai per dieną**, su nepavykusiais.',
          '**Patvirtinimo nuorodos per 90 dienų**: kiek nuorodų darbuotojams išsiųsta, atidaryta ir patvirtinta, kiek dar laukia, nebegalioja ar buvo pakeistos.',
          '**Pakeitimai per savaitę** pagal sritį (kuo tamsiau, tuo daugiau) ir daugiausia pakeitimų atlikę asmenys.',
          '**Įrenginiai per 30 dienų** ir **Kalbos**: telefonai, planšetės ir kompiuteriai su jų sistemomis ir naršyklėmis, naudotojų ir darbuotojų kalbos.',
          '**Duomenų kokybė per 90 dienų**: darbuotojai be dydžių ir prekės be kainos ar naudojimo laikotarpio. Kuo mažiau, tuo geriau.',
        ] },
        { shots: [{ name: 'usage', alt: 'Naudojimas: aktyvūs asmenys, prisijungimai ir kita' }] },
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
            ['`G`, tada `D` `O` `H` `E` `C` `S` `U`', 'Pereina į Suvestinę, Kurti užsakymą, Užsakymus, Darbuotojus, Katalogą, Prekių rinkinius arba Naudotojus (Administravime).'],
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
