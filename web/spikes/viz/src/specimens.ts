/**
 * Made-up document pages with the printed fields the MRZ lacks (date of issue, place of
 * birth, issuing authority) and names whose letters the MRZ folds: the e2e specimens
 * (web/e2e/fixtures/documents) extended, and four more. Every person, number and code is
 * invented and every page says SPECIMEN. Never put a real document or person here.
 *
 * Each side is drawn as it comes out of the app's page making (@ppe/id-docs make-page):
 * the document alone, upright, filling the picture.
 */
import { type SpecimenDocument, mrzOf, specimenDocuments, styles } from '../../../e2e/fixtures/documents/specimens.ts'

export type DateStyle = 'dot' | 'space' | 'month'

export interface VizDocument extends SpecimenDocument {
  /** YYMMDD. */
  issued: string
  placeOfBirth: string
  authority: string
  dates: DateStyle
  /** The names as printed when they are not just the upper-cased names (a Cyrillic line above the Latin). */
  printed?: { surname: string; givenNames: string }
}

const extra: Record<string, Pick<VizDocument, 'issued' | 'placeOfBirth' | 'authority' | 'dates'>> = {
  'passport-lt': { issued: '210515', placeOfBirth: 'VILNIUS', authority: 'MIGRACIJOS DEPARTAMENTAS', dates: 'space' },
  'passport-de': { issued: '240713', placeOfBirth: 'KÖLN', authority: 'STADT KÖLN', dates: 'dot' },
  'passport-expired': { issued: '020416', placeOfBirth: 'ZENITH', authority: 'PASSPORT OFFICE', dates: 'month' },
  'passport-lookalike': { issued: '220416', placeOfBirth: 'KAUNAS', authority: 'MIGRACIJOS DEPARTAMENTAS', dates: 'space' },
  'id-lt': { issued: '230303', placeOfBirth: 'ŠIAULIAI', authority: 'MIGRACIJOS DEPARTAMENTAS', dates: 'dot' },
  'id-lt-misread': { issued: '200909', placeOfBirth: 'PANEVĖŽYS', authority: 'MIGRACIJOS DEPARTAMENTAS', dates: 'dot' },
}

const more: VizDocument[] = [
  {
    id: 'passport-lt-accents',
    format: 'TD3',
    code: 'P',
    issuingState: 'LTU',
    nationality: 'LTU',
    surname: 'Šeškevičiūtė',
    givenNames: 'Gražina Rūta',
    documentNumber: '92345678',
    birth: '920817',
    sex: 'F',
    expiry: '330210',
    personalNumber: '49208170111',
    issued: '230211',
    placeOfBirth: 'UTENA',
    authority: 'MIGRACIJOS DEPARTAMENTAS',
    dates: 'space',
  },
  {
    id: 'passport-ua',
    format: 'TD3',
    code: 'P',
    issuingState: 'UKR',
    nationality: 'UKR',
    surname: 'Volkov',
    givenNames: 'Andrii',
    documentNumber: 'GT482915',
    birth: '850702',
    sex: 'M',
    expiry: '300911',
    issued: '200911',
    placeOfBirth: 'KHARKIV',
    authority: '8031',
    dates: 'month',
    printed: { surname: 'ВОЛКОВ / VOLKOV', givenNames: 'АНДРІЙ / ANDRII' },
  },
  {
    id: 'id-lt-long',
    format: 'TD1',
    code: 'ID',
    issuingState: 'LTU',
    nationality: 'LTU',
    surname: 'Kazlauskaitė-Jankauskienė',
    givenNames: 'Aleksandra Konstancija',
    documentNumber: '20567890',
    birth: '790214',
    sex: 'F',
    expiry: '311120',
    personalNumber: '47902140222',
    issued: '211121',
    placeOfBirth: 'KLAIPĖDA',
    authority: 'MIGRACIJOS DEPARTAMENTAS',
    dates: 'dot',
  },
  {
    id: 'id-lt-plain',
    format: 'TD1',
    code: 'ID',
    issuingState: 'LTU',
    nationality: 'LTU',
    surname: 'Petraitis',
    givenNames: 'Tomas',
    documentNumber: '20678901',
    birth: '981105',
    sex: 'M',
    expiry: '320130',
    personalNumber: '39811050456',
    issued: '220131',
    placeOfBirth: 'ALYTUS',
    authority: 'MIGRACIJOS DEPARTAMENTAS',
    dates: 'dot',
  },
]

/** Every document the spike reads: the e2e specimens whose MRZ reads (with their extra fields), and the four above. */
export const vizDocuments: VizDocument[] = [
  ...specimenDocuments.filter((d) => extra[d.id]).map((d) => ({ ...d, ...extra[d.id]! })),
  ...more,
]

export const yyyy = (yymmdd: string, kind: 'birth' | 'other') => {
  const yy = Number(yymmdd.slice(0, 2))
  return `${kind === 'birth' && yy > 26 ? 19 : 20}${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** A date as the document prints it. */
export function printedDate(iso: string, style: DateStyle): string {
  const [y, m, d] = iso.split('-')
  if (style === 'dot') return `${d}.${m}.${y}`
  if (style === 'space') return `${d} ${m} ${y}`
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`
}

/** What a side shows that the reader should take, as the document prints it (the truth to compare with). */
export interface SideTruth {
  surname?: string
  givenNames?: string
  issued?: string
  placeOfBirth?: string
  authority?: string
}

export function truthOf(doc: VizDocument, side: 'page' | 'front' | 'back'): SideTruth {
  const names = { surname: doc.surname.toLocaleUpperCase('lt'), givenNames: doc.givenNames.toLocaleUpperCase('lt') }
  const issue = { issued: yyyy(doc.issued, 'other'), authority: doc.authority }
  if (side === 'page') return { ...names, ...issue, placeOfBirth: doc.placeOfBirth }
  if (side === 'front') return names
  return { ...issue, placeOfBirth: doc.placeOfBirth }
}

const field = (label: string, value: string) => `<div class="label">${label}</div><div class="value">${value}</div>`

/** One side as HTML in millimetres (element .doc), like the e2e specimens with the extra fields. */
export function vizSideHtml(doc: VizDocument, side: 'page' | 'front' | 'back'): string {
  const sur = doc.printed?.surname ?? doc.surname.toLocaleUpperCase('lt')
  const giv = doc.printed?.givenNames ?? doc.givenNames.toLocaleUpperCase('lt')
  const date = (yymmdd: string, kind: 'birth' | 'other') => printedDate(yyyy(yymmdd, kind), doc.dates)
  const mrz = mrzOf(doc)
  const mrzHtml = (left: number, top: number) =>
    `<div class="mrz" style="left:${left}mm;top:${top}mm">${mrz.map((l) => `<div>${[...l].map((c) => `<span>${c === '<' ? '&lt;' : c}</span>`).join('')}</div>`).join('')}</div>`
  const face = (w: number, h: number) =>
    `<svg width="${w}mm" height="${h}mm" viewBox="0 0 30 40" style="position:absolute"><rect width="30" height="40" fill="#d9dde3"/><ellipse cx="15" cy="15" rx="7" ry="9" fill="#8d939c"/><path d="M2 40 C3 28 9 25 15 25 C21 25 27 28 28 40 Z" fill="#6d737c"/></svg>`
  const ground = (hue: number) =>
    `<svg width="100%" height="100%" style="position:absolute;inset:0"><defs><pattern id="g${hue}" width="3mm" height="3mm" patternUnits="userSpaceOnUse"><circle cx="1.5mm" cy="1.5mm" r="1.2mm" fill="none" stroke="hsl(${hue} 40% 70%)" stroke-width=".12mm" opacity=".5"/></pattern></defs><rect width="100%" height="100%" fill="url(#g${hue})"/></svg>`
  if (side === 'page') {
    return `<div class="doc" style="width:125mm;height:88mm;background:#f3f1ea">${ground(190)}
      <div style="position:absolute;left:6mm;top:4mm;font-size:3.2mm;font-weight:700;letter-spacing:.4mm">PASSPORT · PASAS · SPECIMEN</div>
      <div style="position:absolute;left:6mm;top:12mm;width:30mm;height:40mm">${face(30, 40)}</div>
      <div style="position:absolute;left:40mm;top:10mm;width:42mm">
        ${field('Surname / Pavardė', sur)}${field('Given names / Vardai', giv)}${field('Nationality / Pilietybė', doc.nationality)}${field('Date of birth / Gimimo data', date(doc.birth, 'birth'))}${field('Place of birth / Gimimo vieta', doc.placeOfBirth)}
      </div>
      <div style="position:absolute;left:86mm;top:10mm;width:36mm">
        ${field('Passport No. / Paso Nr.', doc.documentNumber)}${field('Sex / Lytis', doc.sex)}${field('Date of issue / Išdavimo data', date(doc.issued, 'other'))}${field('Date of expiry / Galioja iki', date(doc.expiry, 'other'))}${field('Authority / Išdavė', doc.authority)}
      </div>
      <div class="specimen" style="left:46mm;top:40mm;font-size:11mm">SPECIMEN</div>
      ${mrzHtml((125 - 44 * 2.54) / 2, 88 - 15)}
    </div>`
  }
  if (side === 'front') {
    return `<div class="doc" style="width:85.6mm;height:54mm;border-radius:3.2mm;background:#eef2f0">${ground(140)}
      <div style="position:absolute;left:4mm;top:3mm;font-size:2.5mm;font-weight:700;letter-spacing:.3mm">IDENTITY CARD · ASMENS TAPATYBĖS KORTELĖ</div>
      <div style="position:absolute;left:4mm;top:9mm;width:23mm;height:30mm">${face(23, 30)}</div>
      <div style="position:absolute;left:31mm;top:8mm;width:60mm;transform:scale(.86);transform-origin:0 0">
        ${field('Surname / Pavardė', sur)}${field('Given names / Vardai', giv)}${field('Nationality / Pilietybė', doc.nationality)}${field('Date of birth / Gimimo data', date(doc.birth, 'birth'))}${field('Date of expiry / Galioja iki', date(doc.expiry, 'other'))}
      </div>
      <div class="specimen" style="left:30mm;top:22mm;font-size:8mm">SPECIMEN</div>
    </div>`
  }
  return `<div class="doc" style="width:85.6mm;height:54mm;border-radius:3.2mm;background:#eef2f0">${ground(140)}
    <div style="position:absolute;left:4mm;top:3mm;width:80mm;transform:scale(.8);transform-origin:0 0">
      ${field('Personal code / Asmens kodas', doc.personalNumber ?? '—')}${field('Date of issue / Išdavimo data', date(doc.issued, 'other'))}${field('Place of birth / Gimimo vieta', doc.placeOfBirth)}${field('Issued by / Išdavė', doc.authority)}
    </div>
    <div class="specimen" style="left:36mm;top:12mm;font-size:7mm">SPECIMEN</div>
    ${mrzHtml((85.6 - 30 * 2.54) / 2, 54 - 16)}
  </div>`
}

export { mrzOf, styles }
