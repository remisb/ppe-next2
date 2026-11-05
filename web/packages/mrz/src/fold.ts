/**
 * Printed names and their MRZ form (docs-import plan §5.3): fold() maps a
 * name as printed (`Žukauskaitė`, `Müller-Lüdenscheidt`, `Пётр`) to what
 * the MRZ holds (`ZUKAUSKAITE`, `MUELLER<LUEDENSCHEIDT`, `PETR`), following
 * ICAO Doc 9303 Part 3 §6 (transliteration of Latin letters with
 * diacritics, and of Cyrillic). Where the table gives two forms (`Ä` as `AE`
 * or `A`), both are returned; a state uses one of them throughout a name.
 *
 * nameMatch() then says whether a typed (or, later, VIZ-read) name is the
 * MRZ's, allowing for the MRZ cutting long names short.
 */

/** Latin letters ICAO writes as more than their base letter, or as something other than it. */
const LATIN: Record<string, string> = {
  Æ: 'AE',
  Ð: 'D',
  Đ: 'D',
  Ħ: 'H',
  Ĳ: 'IJ',
  Ł: 'L',
  Ŀ: 'L',
  Œ: 'OE',
  Ø: 'OE',
  Þ: 'TH',
  ẞ: 'SS',
  ß: 'SS',
}

/** The letters with two forms: the expanded one (Germanic and Nordic practice) first, then the plain letter. */
const TWO_FORMS: Record<string, [string, string]> = { Ä: ['AE', 'A'], Ö: ['OE', 'O'], Ü: ['UE', 'U'], Å: ['AA', 'A'] }

/** ICAO 9303 Part 3, Table B: Cyrillic. Ь is left out, as the table does. */
const CYRILLIC: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Ґ: 'G', Д: 'D', Ѓ: 'G', Ђ: 'D', Е: 'E', Ё: 'E', Є: 'IE', Ж: 'ZH', З: 'Z',
  Ѕ: 'DZ', И: 'I', І: 'I', Ї: 'I', Й: 'I', Ј: 'J', К: 'K', Л: 'L', Љ: 'LJ', М: 'M', Н: 'N', Њ: 'NJ', О: 'O',
  П: 'P', Р: 'R', С: 'S', Т: 'T', Ћ: 'C', Ќ: 'K', У: 'U', Ў: 'U', Ф: 'F', Х: 'KH', Ц: 'TS', Ч: 'CH', Џ: 'DZ',
  Ш: 'SH', Щ: 'SHCH', Ъ: 'IE', Ы: 'Y', Ь: '', Э: 'E', Ю: 'IU', Я: 'IA',
}

/**
 * Where the table's notes differ by state: Belarus and Ukraine write Г as
 * H, and Ukraine И as Y. A second Cyrillic reading, tried as a whole.
 */
const CYRILLIC_UA_BY: Record<string, string> = { ...CYRILLIC, Г: 'H', И: 'Y' }

function foldWith(name: string, twoForms: 0 | 1, cyrillic: Record<string, string>): string {
  let out = ''
  for (const ch of name.toLocaleUpperCase('en')) {
    if (TWO_FORMS[ch]) out += TWO_FORMS[ch][twoForms]
    else if (LATIN[ch] !== undefined) out += LATIN[ch]
    else if (cyrillic[ch] !== undefined) out += cyrillic[ch]
    else if (/[\s\-‐‑–]/.test(ch)) out += '<'
    else if (/[A-Z]/.test(ch)) out += ch
    else {
      // Ą Č Ę Ė Į Š Ų Ū Ž and the rest: the letter without its marks.
      const base = ch.normalize('NFD').replace(/\p{M}/gu, '')
      if (/^[A-Z]+$/.test(base)) out += base
      // Apostrophes, dots and anything else are left out (O'Brien → OBRIEN).
    }
  }
  return out.replace(/<+/g, '<').replace(/^<|<$/g, '')
}

/** Every MRZ form of a printed name: one, or two where the name has a letter with two forms or is Cyrillic. */
export function fold(name: string): string[] {
  const forms = [foldWith(name, 0, CYRILLIC), foldWith(name, 1, CYRILLIC), foldWith(name, 0, CYRILLIC_UA_BY)]
  return [...new Set(forms)]
}

export type NameMatch = 'same' | 'truncated' | 'differs'

/**
 * Whether the printed surname and given names are the MRZ's name field
 * (fillers kept, as Mrz.nameField): `same` when a form of them fills the
 * field exactly, `truncated` when the field is full and a form of them begins
 * with it (the MRZ cut the name short), else `differs` (the review's note
 * "The name differs from the document's code").
 */
export function nameMatch(surname: string, givenNames: string, nameField: string): NameMatch {
  const len = nameField.length
  const field = nameField
  let truncated = false
  for (const s of fold(surname)) {
    for (const g of fold(givenNames)) {
      const full = g ? `${s}<<${g}` : s
      if (full.length <= len && full.padEnd(len, '<') === field) return 'same'
      if (full.length > len && full.startsWith(field)) truncated = true
      // ICAO's truncation may also cut a given name to its initial; a full field the name's start
      // matches up to its last part is taken as cut short too.
      if (full.length > len && !field.endsWith('<') && truncatedAtParts(full, field)) truncated = true
    }
  }
  return truncated ? 'truncated' : 'differs'
}

/** The field is the full name with its later parts cut (each to at least its first letter). */
function truncatedAtParts(full: string, field: string): boolean {
  const parts = full.split('<')
  const got = field.split('<')
  if (got.length > parts.length) return false
  return got.every((g, i) => (g === '' ? parts[i] === '' : parts[i]!.startsWith(g)))
}
