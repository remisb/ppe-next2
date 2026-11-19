import { describe, expect, it } from 'vitest'

import { type ExportColumn, columnName, crc32, exportFile, exportFileName, exportTable, toCSV, toXLSX, unzipStored, zip } from './table-export.ts'

interface Person {
  name: string
  height: number | null
  note: string
}

const columns: ExportColumn<Person>[] = [
  { key: 'name', label: 'Name', value: (p) => p.name },
  { key: 'height', label: 'Height (cm)', value: (p) => p.height },
  { key: 'note', label: 'Notes', value: (p) => p.note },
]
const people: Person[] = [
  { name: 'Petrauskienė Rūta', height: 168, note: 'Left-handed, "tall" gloves' },
  { name: 'Смирнов Игорь', height: null, note: 'two\nlines' },
]

describe('exportTable', () => {
  it('puts the header first and the values in the columns’ order', () => {
    expect(exportTable(columns, people)).toEqual([
      ['Name', 'Height (cm)', 'Notes'],
      ['Petrauskienė Rūta', 168, 'Left-handed, "tall" gloves'],
      ['Смирнов Игорь', null, 'two\nlines'],
    ])
  })
})

describe('toCSV', () => {
  it('starts with a BOM, quotes only what needs it, and ends rows with CRLF', () => {
    expect(toCSV(exportTable(columns, people))).toBe(
      '﻿Name,Height (cm),Notes\r\nPetrauskienė Rūta,168,"Left-handed, ""tall"" gloves"\r\nСмирнов Игорь,,"two\nlines"\r\n',
    )
  })
})

describe('toXLSX', () => {
  const parts = unzipStored(toXLSX(exportTable(columns, people), 'Employees'))

  it('is a package Excel opens: content types, relations, workbook, styles and one sheet', () => {
    expect([...parts.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ])
    expect(parts.get('xl/workbook.xml')).toContain('<sheet name="Employees" sheetId="1" r:id="rId1"/>')
  })

  it('writes numbers as numbers, text as inline strings, escapes XML and leaves empty cells out', () => {
    const sheet = parts.get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>')
    expect(sheet).toContain('<c r="B2"><v>168</v></c>')
    expect(sheet).toContain('Left-handed, &quot;tall&quot; gloves')
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">Смирнов Игорь</t></is></c>')
    expect(sheet).not.toContain('r="B3"')
    // The header row stays in view.
    expect(sheet).toContain('state="frozen"')
  })

  it('keeps a sheet name Excel accepts', () => {
    const named = unzipStored(toXLSX([['a']], 'Items: given / returned [all of them, ever]'))
    expect(named.get('xl/workbook.xml')).toContain('<sheet name="Items  given   returned  all of" ')
  })
})

describe('zip', () => {
  it('records each entry’s CRC-32 and size, and reads back', () => {
    const bytes = zip([['a.txt', 'hello']])
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('hello')))
    expect(unzipStored(bytes).get('a.txt')).toBe('hello')
  })

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('names', () => {
  it('names spreadsheet columns', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  it('names the file after the list and the day', () => {
    expect(exportFileName('Employees', 'xlsx', new Date(2026, 10, 9))).toBe('Employees 2026-11-09.xlsx')
    expect(exportFileName('A/B: C', 'csv', new Date(2026, 0, 1))).toBe('A B  C 2026-01-01.csv')
  })

  it('gives each format its type', () => {
    expect(exportFile('csv', columns, people).type).toBe('text/csv;charset=utf-8')
    expect(exportFile('xlsx', columns, people).type).toContain('spreadsheetml')
  })
})
