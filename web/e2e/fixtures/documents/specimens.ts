/**
 * Synthetic identity documents for docs-import (plan §8): a passport data
 * page (TD3) and ID cards (TD1, front and back), drawn as HTML in CSS
 * millimetres at the ICAO sizes, with the MRZ in OCR-B at its 2.54 mm pitch.
 * Every person, number and code is made up (the Lithuanian personal code is
 * the public example from the code's Wikipedia article, others are made-up
 * codes with serial 000–999 on made-up dates); every page says SPECIMEN.
 * Never put a real document or a real person's data here.
 *
 * make.ts draws the flat images the e2e steps use; web/spikes/mrz draws
 * photo-like variants of the same documents for measuring the reader.
 */
import { readFileSync } from 'node:fs'

import { checkDigitOf, fold } from '@ppe/mrz'

export interface SpecimenDocument {
  /** The file stem: <id>.jpg, or <id>-front.jpg and <id>-back.jpg for a card. */
  id: string
  format: 'TD3' | 'TD1'
  code: string
  issuingState: string
  nationality: string
  /** As printed, with diacritics. */
  surname: string
  givenNames: string
  documentNumber: string
  /** YYMMDD, as the MRZ has them. */
  birth: string
  sex: 'M' | 'F'
  expiry: string
  /** Optional data: the personal number (TD3) or the first optional field (TD1). */
  personalNumber?: string
  /**
   * A misread planted in the printed MRZ: the character at line/col is
   * printed as char. `corrected`: a reader must still give the true MRZ
   * (the look-alike is corrected); `rejected`: no reader may accept it.
   */
  plant?: { line: number; col: number; char: string; outcome: 'corrected' | 'rejected' }
}

/** The made-up documents. */
export const specimenDocuments: SpecimenDocument[] = [
  {
    id: 'passport-lt',
    format: 'TD3',
    code: 'P',
    issuingState: 'LTU',
    nationality: 'LTU',
    surname: 'Pavyzdys',
    givenNames: 'Jonas',
    documentNumber: '91234567',
    birth: '330924',
    sex: 'M',
    expiry: '310515',
    personalNumber: '33309240064',
  },
  {
    id: 'passport-de',
    format: 'TD3',
    code: 'P',
    issuingState: 'D',
    nationality: 'D',
    surname: 'Müller-Lüdenscheidt',
    givenNames: 'Jürgen Hans',
    documentNumber: 'C4H7K2M95',
    birth: '880229',
    sex: 'M',
    expiry: '340712',
  },
  {
    id: 'passport-expired',
    format: 'TD3',
    code: 'P',
    issuingState: 'UTO',
    nationality: 'UTO',
    surname: 'Eriksson',
    givenNames: 'Anna Maria',
    documentNumber: 'L898902C3',
    birth: '740812',
    sex: 'F',
    expiry: '120415',
    personalNumber: 'ZE184226B',
  },
  {
    id: 'passport-lookalike',
    format: 'TD3',
    code: 'P',
    issuingState: 'UTO',
    nationality: 'UTO',
    surname: 'Bandomasis',
    givenNames: 'Petras',
    documentNumber: 'X7A3H4Q0P',
    birth: '910303',
    sex: 'M',
    expiry: '320415',
    // The number's 0 printed as O: only the look-alike search can give it back.
    plant: { line: 1, col: 7, char: 'O', outcome: 'corrected' },
  },
  {
    id: 'id-lt',
    format: 'TD1',
    code: 'ID',
    issuingState: 'LTU',
    nationality: 'LTU',
    surname: 'Pavyzdytė',
    givenNames: 'Eglė',
    documentNumber: '20345678',
    birth: '050505',
    sex: 'F',
    expiry: '330303',
    personalNumber: '60505051230',
  },
  {
    id: 'id-lt-misread',
    format: 'TD1',
    code: 'ID',
    issuingState: 'LTU',
    nationality: 'LTU',
    surname: 'Žukauskaitė-Bandomoji',
    givenNames: 'Miglė Ona',
    documentNumber: '20456789',
    birth: '860101',
    sex: 'F',
    expiry: '300909',
    personalNumber: '48601010006',
    // The birth date's last 1 printed as I: the layout corrects it, two check digits confirm it.
    plant: { line: 1, col: 5, char: 'I', outcome: 'corrected' },
  },
  {
    id: 'id-wrong-digit',
    format: 'TD1',
    code: 'I',
    issuingState: 'UTO',
    nationality: 'UTO',
    surname: 'Eriksson',
    givenNames: 'Anna Maria',
    documentNumber: 'D23145890',
    birth: '740812',
    sex: 'F',
    expiry: '320415',
    // The expiry date's 4 printed as 9: no look-alike, so every reader must refuse it.
    plant: { line: 1, col: 11, char: '9', outcome: 'rejected' },
  },
]

const pad = (s: string, n: number) => s.padEnd(n, '<').slice(0, n)

/** The MRZ form of a printed name: the first of fold()'s forms. */
export function mrzName(doc: SpecimenDocument): string {
  const s = fold(doc.surname)[0]!
  const g = fold(doc.givenNames)[0]!
  return g ? `${s}<<${g}` : s
}

/** The document's true MRZ lines, check digits computed. */
export function mrzOf(doc: SpecimenDocument): string[] {
  if (doc.format === 'TD3') {
    const n = pad(doc.documentNumber, 9)
    const pn = pad(doc.personalNumber ?? '', 14)
    const a = n + checkDigitOf(n) + pad(doc.nationality, 3) + doc.birth + checkDigitOf(doc.birth) + doc.sex + doc.expiry + checkDigitOf(doc.expiry) + pn + (/^<+$/.test(pn) ? '<' : checkDigitOf(pn))
    return [pad(pad(doc.code, 2) + pad(doc.issuingState, 3) + mrzName(doc), 44), a + checkDigitOf(a.slice(0, 10) + a.slice(13, 20) + a.slice(21, 43))]
  }
  const n = pad(doc.documentNumber, 9)
  const l1 = pad(pad(doc.code, 2) + pad(doc.issuingState, 3) + n + checkDigitOf(n) + (doc.personalNumber ?? ''), 30)
  const a = doc.birth + checkDigitOf(doc.birth) + doc.sex + doc.expiry + checkDigitOf(doc.expiry) + pad(doc.nationality, 3) + pad('', 11)
  return [l1, a + checkDigitOf(l1.slice(5, 30) + a.slice(0, 7) + a.slice(8, 15) + a.slice(18, 29)), pad(mrzName(doc), 30)]
}

/** The MRZ as printed: the true one, with the planted misread if there is one. */
export function printedMrz(doc: SpecimenDocument): string[] {
  const lines = mrzOf(doc)
  const p = doc.plant
  if (!p) return lines
  return lines.map((l, i) => (i === p.line ? l.slice(0, p.col) + p.char + l.slice(p.col + 1) : l))
}

/** The sides a document has: a passport's data page, a card's front and back. */
export function sidesOf(doc: SpecimenDocument): ('page' | 'front' | 'back')[] {
  return doc.format === 'TD3' ? ['page'] : ['front', 'back']
}

const ocrb = readFileSync(new URL('./ocrb10.otf', import.meta.url)).toString('base64')

/** The styles every side needs: OCR-B for the MRZ, a plain sans for the rest. */
export const styles = `
  @font-face { font-family: 'OCR-B'; src: url(data:font/otf;base64,${ocrb}) format('opentype'); }
  .doc { position: relative; overflow: hidden; font-family: Arial, Helvetica, sans-serif; color: #1d2433; box-sizing: border-box; }
  .doc .label { font-size: 1.6mm; color: #5b6478; text-transform: uppercase; letter-spacing: .05mm; }
  .doc .value { font-size: 3.1mm; font-weight: 600; margin-bottom: 1.6mm; }
  .mrz { position: absolute; font-family: 'OCR-B', monospace; font-size: 3.6mm; color: #111; line-height: 4.23mm; }
  .mrz span { display: inline-block; width: 2.54mm; text-align: center; }
  .specimen { position: absolute; font-weight: 800; color: rgba(190, 40, 40, .16); transform: rotate(-18deg); letter-spacing: 2mm; }
`

/** A light guilloche: sine curves in two colours, as security printing has (and OCR must see past). */
function guilloche(w: number, h: number, hue: number): string {
  const paths: string[] = []
  for (let k = 0; k < 26; k++) {
    let d = ''
    for (let x = 0; x <= w; x += 1) {
      const y = h / 2 + (h / 2.2) * Math.sin(x / (6 + (k % 5)) + k) * Math.cos(x / 31 + k / 3)
      d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(2)} `
    }
    paths.push(`<path d="${d}" fill="none" stroke="hsl(${hue + (k % 2) * 40} 45% 62%)" stroke-width="0.12" opacity="0.55"/>`)
  }
  return `<svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0">${paths.join('')}</svg>`
}

/** A made-up portrait: a grey silhouette, no one's face. */
function portrait(w: number, h: number): string {
  return `<svg width="${w}mm" height="${h}mm" viewBox="0 0 30 40" style="position:absolute">
    <rect width="30" height="40" fill="#d9dde3"/>
    <ellipse cx="15" cy="15" rx="7" ry="9" fill="#8d939c"/>
    <path d="M2 40 C3 28 9 25 15 25 C21 25 27 28 28 40 Z" fill="#6d737c"/>
  </svg>`
}

const mrzHtml = (lines: string[], left: number, top: number) =>
  `<div class="mrz" style="left:${left}mm;top:${top}mm">${lines.map((l) => `<div>${[...l].map((c) => `<span>${c === '<' ? '&lt;' : c}</span>`).join('')}</div>`).join('')}</div>`

const display = (yymmdd: string, century: number) => `${yymmdd.slice(4, 6)}.${yymmdd.slice(2, 4)}.${century}${yymmdd.slice(0, 2)}`
const field = (label: string, value: string) => `<div class="label">${label}</div><div class="value">${value}</div>`

/** One side of the document as HTML, sized in millimetres (element .doc). */
export function sideHtml(doc: SpecimenDocument, side: 'page' | 'front' | 'back'): string {
  const birthCentury = Number(doc.birth.slice(0, 2)) > 26 ? 19 : 20
  const fields = [
    field('Surname / Pavardė', doc.surname.toUpperCase()),
    field('Given names / Vardai', doc.givenNames.toUpperCase()),
    field('Nationality / Pilietybė', doc.nationality),
    field('Date of birth / Gimimo data', display(doc.birth, birthCentury)),
    field('Sex / Lytis', doc.sex),
    field('Date of expiry / Galioja iki', display(doc.expiry, 20)),
  ].join('')
  if (side === 'page') {
    return `<div class="doc" style="width:125mm;height:88mm;background:#f3f1ea">
      ${guilloche(125, 88, 190)}
      <div style="position:absolute;left:6mm;top:4mm;font-size:3.4mm;font-weight:700;letter-spacing:.4mm">PASSPORT · PASAS · SPECIMEN</div>
      <div style="position:absolute;right:6mm;top:4mm;text-align:right">${field('Passport No.', doc.documentNumber)}</div>
      <div style="position:absolute;left:6mm;top:13mm;width:32mm;height:42mm">${portrait(32, 42)}</div>
      <div style="position:absolute;left:44mm;top:13mm">${fields}</div>
      <div class="specimen" style="left:46mm;top:38mm;font-size:11mm">SPECIMEN</div>
      ${mrzHtml(printedMrz(doc), (125 - 44 * 2.54) / 2, 88 - 15)}
    </div>`
  }
  if (side === 'front') {
    return `<div class="doc" style="width:85.6mm;height:54mm;border-radius:3.2mm;background:#eef2f0">
      ${guilloche(85.6, 54, 140)}
      <div style="position:absolute;left:4mm;top:3mm;font-size:2.6mm;font-weight:700;letter-spacing:.3mm">IDENTITY CARD · ASMENS TAPATYBĖS KORTELĖ</div>
      <div style="position:absolute;left:4mm;top:9mm;width:23mm;height:30mm">${portrait(23, 30)}</div>
      <div style="position:absolute;left:31mm;top:9mm;transform:scale(.86);transform-origin:0 0">${fields}</div>
      <div style="position:absolute;left:4mm;bottom:3mm">${field('Card No.', doc.documentNumber)}</div>
      <div class="specimen" style="left:30mm;top:22mm;font-size:8mm">SPECIMEN</div>
    </div>`
  }
  return `<div class="doc" style="width:85.6mm;height:54mm;border-radius:3.2mm;background:#eef2f0">
    ${guilloche(85.6, 54, 140)}
    <div style="position:absolute;left:4mm;top:4mm;transform:scale(.8);transform-origin:0 0">
      ${field('Personal code / Asmens kodas', doc.personalNumber ?? '—')}
      ${field('Issued by / Išdavė', 'SPECIMEN AUTHORITY')}
    </div>
    <div class="specimen" style="left:36mm;top:10mm;font-size:7mm">SPECIMEN</div>
    ${mrzHtml(printedMrz(doc), (85.6 - 30 * 2.54) / 2, 54 - 16)}
  </div>`
}
