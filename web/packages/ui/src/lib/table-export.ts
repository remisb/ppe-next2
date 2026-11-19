/**
 * A list's rows as a file to download: CSV or an Excel workbook (.xlsx).
 * Pure functions over columns and rows, so every list exports the same way
 * (the Export sheet, components/export-sheet.tsx); no dependency: the
 * workbook is a minimal Office Open XML package in an uncompressed zip.
 */

/** A cell's value: a number stays a number in Excel; null is an empty cell. */
export type ExportValue = string | number | null | undefined

/** One column a list offers to export. */
export interface ExportColumn<T> {
  /** Stable within the list: the sheet's choice is kept by it. */
  key: string
  /** The header row's words, in the reader's language. */
  label: string
  value: (row: T) => ExportValue
  /** Ticked when the sheet opens: the columns the screen itself shows. */
  shown?: boolean | undefined
}

export type ExportFormat = 'xlsx' | 'csv'

export const exportFormats: readonly ExportFormat[] = ['xlsx', 'csv']

const mimeTypes: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8',
}

/** The file for `rows` in `format`, its cells in the columns' order. */
export function exportFile<T>(format: ExportFormat, columns: readonly ExportColumn<T>[], rows: readonly T[], sheetName = 'Sheet1'): Blob {
  const table = exportTable(columns, rows)
  if (format === 'csv') return new Blob([toCSV(table)], { type: mimeTypes.csv })
  return new Blob([toXLSX(table, sheetName) as BlobPart], { type: mimeTypes.xlsx })
}

/** "Employees 2026-11-19.xlsx": the list's name and the day, with what a file name may not hold taken out. */
export function exportFileName(name: string, format: ExportFormat, day: Date = new Date()): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'export'
  const ymd = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  return `${safe} ${ymd}.${format}`
}

/** The header row, then one row of values per row. */
export function exportTable<T>(columns: readonly ExportColumn<T>[], rows: readonly T[]): ExportValue[][] {
  return [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.value(r)))]
}

/**
 * RFC 4180 CSV: commas, CRLF, a field quoted when it holds a comma, quote or
 * line break. It starts with a byte order mark, so Excel reads it as UTF-8
 * (ą, ė, Cyrillic) rather than the system's code page.
 */
export function toCSV(table: readonly (readonly ExportValue[])[]): string {
  const field = (v: ExportValue) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  return '﻿' + table.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n'
}

/**
 * A workbook of one sheet: the first row bold and frozen, numbers as numbers,
 * text as inline strings (no shared-strings part to keep in step).
 */
export function toXLSX(table: readonly (readonly ExportValue[])[], sheetName = 'Sheet1'): Uint8Array {
  // Excel refuses a sheet name over 31 characters or with any of these.
  const name = sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet1'
  const widths = table[0]?.map((_, c) => Math.min(60, Math.max(8, ...table.map((r) => String(r[c] ?? '').length + 2)))) ?? []
  const rows = table
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === undefined || v === '') return ''
          const ref = `${columnName(c)}${r + 1}`
          const style = r === 0 ? ' s="1"' : ''
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
  const frozen =
    table.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : ''
  const sheet = `${XML_HEAD}<worksheet xmlns="${NS_MAIN}">${frozen}${cols}<sheetData>${rows}</sheetData></worksheet>`
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheet],
  ])
}

/** A, B, … Z, AA, AB: a spreadsheet's name for the column at `index` (0-based). */
export function columnName(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const pad = (n: number) => String(n).padStart(2, '0')

function xml(s: string): string {
  // Characters XML 1.0 cannot hold at all (control codes other than tab and line breaks) are dropped.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c)
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES =
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>'
const ROOT_RELS = `${XML_HEAD}<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
const WORKBOOK_RELS =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG}">` +
  `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
  '</Relationships>'
// Style 0 plain, style 1 bold (the header row).
const STYLES =
  `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '</styleSheet>'

/* A zip of stored (uncompressed) entries: all a workbook needs, and every reader opens it. */

let crcTable: Uint32Array | undefined

/** CRC-32 (IEEE), as zip records it for each entry. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** The entries, in order, as one zip file (UTF-8 names, no compression, a fixed 1980 date so the same rows give the same bytes). */
export function zip(entries: readonly (readonly [string, string | Uint8Array])[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name)
    const data = typeof content === 'string' ? encoder.encode(content) : content
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true) // version needed
    l.setUint16(6, 0x0800, true) // UTF-8 names
    l.setUint16(8, 0, true) // stored
    l.setUint16(10, 0, true) // time
    l.setUint16(12, 0x21, true) // 1980-01-01
    l.setUint32(14, crc, true)
    l.setUint32(18, data.length, true)
    l.setUint32(22, data.length, true)
    l.setUint16(26, nameBytes.length, true)
    l.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    const central = new Uint8Array(46 + nameBytes.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true) // made by
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, 0, true)
    c.setUint16(14, 0x21, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, nameBytes.length, true)
    c.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, entries.length, true)
  e.setUint16(10, entries.length, true)
  e.setUint32(12, centralSize, true)
  e.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** The entries of a zip `zip` wrote (stored only), by name: for tests and the e2e step that reads a download back. */
export function unzipStored(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const out = new Map<string, string>()
  let at = 0
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const extra = view.getUint16(at + 28, true)
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength))
    const start = at + 30 + nameLength + extra
    out.set(name, decoder.decode(bytes.subarray(start, start + size)))
    at = start + size
  }
  return out
}
