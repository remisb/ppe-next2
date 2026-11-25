import type { DocumentTemplate, DocxTemplateBody, TemplateBlock, TemplateRun, TemplateVersion } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import {
  type EditBlock,
  addColumn,
  addRow,
  askedProblems,
  blockKinds,
  blockProblems,
  byType,
  draftKey,
  draftNumber,
  draftProblems,
  docxBody,
  docxProblems,
  fileSize,
  editAsked,
  editBlock,
  editBody,
  editedVersion,
  insertField,
  knownField,
  markupToRuns,
  moveBlock,
  newAsked,
  newBlock,
  pdfBlob,
  previewFilename,
  printsNumber,
  removeColumn,
  removeRow,
  runsToMarkup,
  savedKey,
  setCell,
  templateState,
  tidyRuns,
  toAsked,
  toBlock,
  toBody,
  validName,
} from './document-templates'

/** A block without its React key, to compare. */
const bare = ({ id: _, ...b }: EditBlock) => b

describe('runsToMarkup and markupToRuns', () => {
  const cases: [TemplateRun[], string][] = [
    [[{ text: 'Plain words.' }], 'Plain words.'],
    [[{ text: 'Hello ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'italic', italic: true }], 'Hello **bold** and *italic*'],
    [[{ text: 'both', bold: true, italic: true }], '***both***'],
    [[{ text: 'Employee: ' }, { field: 'employee.name' }, { text: '.' }], 'Employee: {{employee.name}}.'],
    [[{ field: 'employee.name', bold: true }], '**{{employee.name}}**'],
    [[{ field: 'company.name' }, { field: 'document.number' }], '{{company.name}}{{document.number}}'],
    // From one look straight to another: one marker switches both.
    [[{ text: 'a', bold: true }, { text: 'b', italic: true }], '**a***b*'],
    [[{ text: 'a', bold: true }, { text: 'b', bold: true, italic: true }, { text: 'c' }], '**a*b***c'],
    [[{ text: 'a', italic: true }, { field: 'today', bold: true, italic: true }, { text: 'c', bold: true }], '*a**{{today}}*c**'],
    // Asterisks, backslashes and braces in words are kept as written.
    [[{ text: '5 * 3 = 15' }], '5 \\* 3 = 15'],
    [[{ text: '*', bold: true }], '**\\***'],
    [[{ text: 'C:\\dir' }], 'C:\\dir'],
    [[{ text: 'end\\' }], 'end\\'],
    [[{ text: 'a\\' }, { field: 'today' }], 'a\\\\{{today}}'],
    [[{ text: '\\*' }], '\\\\\\*'],
    [[{ text: 'not {{a field}}' }], 'not \\{{a field}}'],
    [[{ text: '{{' }, { field: 'today' }], '\\{\\{{{today}}'],
    [[{ text: 'a{' }, { field: 'today' }], 'a\\{{{today}}'],
    [[{ text: 'one {brace}' }], 'one {brace}'],
    [[{ text: 'two\nlines' }], 'two\nlines'],
    [[], ''],
  ]

  it('writes each case as its markup', () => {
    for (const [runs, markup] of cases) expect(runsToMarkup(runs), JSON.stringify(runs)).toBe(markup)
  })

  it('reads each markup back to the same runs', () => {
    for (const [runs, markup] of cases) expect(markupToRuns(markup), markup).toEqual(runs)
  })

  it('round-trips runs, dropping empty pieces and joining words of the same look', () => {
    const runs: TemplateRun[] = [{ text: '' }, { text: 'a', bold: false }, { text: 'b' }, { field: '' }, { text: 'c', bold: true }, { text: 'd', bold: true }]
    expect(tidyRuns(runs)).toEqual([{ text: 'ab' }, { text: 'cd', bold: true }])
    expect(markupToRuns(runsToMarkup(runs))).toEqual(tidyRuns(runs))
  })

  it('round-trips random runs exactly', () => {
    const pieces = ['a', ' ', '*', '**', '\\', '{', '}', '{{', '}}', 'x y', '\n', 'ą', '***']
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let k = 0; k < 500; k++) {
      const runs: TemplateRun[] = []
      for (let j = rand(6); j >= 0; j--) {
        const look = { ...(rand(2) ? { bold: true } : {}), ...(rand(2) ? { italic: true } : {}) }
        if (rand(4) === 0) runs.push({ field: ['employee.name', 'input.salary', 'today'][rand(3)]!, ...look })
        else runs.push({ text: Array.from({ length: 1 + rand(4) }, () => pieces[rand(pieces.length)]).join(''), ...look })
      }
      const markup = runsToMarkup(runs)
      expect(markupToRuns(markup), markup).toEqual(tidyRuns(runs))
      expect(runsToMarkup(markupToRuns(markup))).toBe(markup)
    }
  })

  it('keeps asterisks never closed as words', () => {
    expect(markupToRuns('**bold')).toEqual([{ text: '**bold' }])
    expect(markupToRuns('a *b')).toEqual([{ text: 'a *b' }])
    expect(markupToRuns('***a**')).toEqual([{ text: '*' }, { text: 'a', bold: true }])
    expect(markupToRuns('a **** b')).toEqual([{ text: 'a **** b' }])
  })

  it('reads a field written with spaces, and leaves what is not a field as words', () => {
    expect(markupToRuns('{{ employee.name }}')).toEqual([{ field: 'employee.name' }])
    expect(markupToRuns('{{Employee Name}}')).toEqual([{ text: '{{Employee Name}}' }])
    expect(markupToRuns('{{employee.name')).toEqual([{ text: '{{employee.name' }])
  })
})

describe('insertField', () => {
  it('puts the field at the cursor or over the selection', () => {
    expect(insertField('Dear , hello', 'employee.name', 5)).toEqual({ text: 'Dear {{employee.name}}, hello', cursor: 22 })
    expect(insertField('Dear X', 'today', 5, 6)).toEqual({ text: 'Dear {{today}}', cursor: 14 })
    expect(insertField('', 'today', 9)).toEqual({ text: '{{today}}', cursor: 9 })
  })
})

describe('blocks', () => {
  const body: TemplateBlock[] = [
    { type: 'heading', level: 1, text: [{ text: 'Contract ' }, { field: 'document.number' }] },
    { type: 'paragraph', align: 'justify', text: [{ text: 'Signed by ' }, { field: 'employee.name', bold: true }] },
    { type: 'paragraph', text: [{ text: 'Left.' }] },
    { type: 'list', ordered: true, items: [[{ text: 'one' }], [{ text: 'two', italic: true }]] },
    { type: 'list', items: [[{ text: 'bullet' }]] },
    { type: 'table', header: true, widths: [2, 1], rows: [[[{ text: 'A' }], [{ text: 'B' }]], [[{ field: 'today' }], []]] },
    { type: 'table', rows: [[[{ text: 'x' }]]] },
    { type: 'fields', pairs: [{ label: [{ text: 'Name' }], value: [{ field: 'employee.name' }] }] },
    { type: 'signatures', signatures: [{ label: [{ text: 'Employer' }], under: [{ field: 'company.name' }] }, { label: [{ text: 'Employee' }] }] },
    { type: 'page_break' },
    { type: 'spacer', height: 24 },
  ]

  it('round-trips every kind through the editor', () => {
    expect(toBody(editBody({ format: 'ppe.blocks.v1', blocks: body }))).toEqual({ format: 'ppe.blocks.v1', blocks: body })
  })

  it('keeps a list item a line, and drops blank lines', () => {
    const b = editBlock(body[3]!)
    expect(b).toMatchObject({ items: 'one\n*two*' })
    expect(toBlock({ ...(b as Extract<EditBlock, { type: 'list' }>), items: 'one\n\n  \n*two*\n' })).toEqual(body[3])
  })

  it('reads a left alignment as the default, and fills missing widths', () => {
    expect(bare(editBlock({ type: 'paragraph', align: 'left', text: [] }))).toEqual({ type: 'paragraph', align: '', text: '' })
    expect(bare(editBlock({ type: 'table', rows: [[[], [], []]] }))).toMatchObject({ widths: [1, 1, 1] })
  })

  it('starts every kind as a block the API takes', () => {
    for (const kind of blockKinds) {
      const b = newBlock(kind)
      expect(b.type).toBe(kind)
      expect(toBlock(b).type).toBe(kind)
    }
    expect(new Set(blockKinds.map((k) => newBlock(k).id)).size).toBe(blockKinds.length)
  })

  it('moves a block up and down, never past an end', () => {
    expect(moveBlock(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveBlock(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveBlock(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveBlock(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })

  it('adds and removes a table\'s rows and columns, keeping one of each and at most 8 columns', () => {
    let t = newBlock('table') as Extract<EditBlock, { type: 'table' }>
    t = setCell(t, 0, 1, 'B')
    t = addColumn(t)
    expect(t.rows).toEqual([['', 'B', ''], ['', '', '']])
    expect(t.widths).toEqual([1, 1, 1])
    t = removeColumn(t, 0)
    expect(t.rows).toEqual([['B', ''], ['', '']])
    t = addRow(t)
    expect(t.rows).toHaveLength(3)
    t = removeRow(removeRow(removeRow(t, 0), 0), 0)
    expect(t.rows).toEqual([['', '']])
    t = removeColumn(removeColumn(t, 0), 0)
    expect(t.widths).toEqual([1])
    for (let i = 0; i < 10; i++) t = addColumn(t)
    expect(t.widths).toHaveLength(8)
  })
})

describe('checks', () => {
  const appFields = [{ key: 'employee.name' }, { key: 'document.number' }, { key: 'today' }]

  it('knows the app\'s fields and the asked ones', () => {
    const known = knownField(appFields, [{ key: 'salary' }])
    expect(known('employee.name')).toBe(true)
    expect(known('input.salary')).toBe(true)
    expect(known('input.bonus')).toBe(false)
    expect(known('employee.nmae')).toBe(false)
  })

  it('names unknown fields, text that looks like a field, and kinds\' limits', () => {
    const known = knownField(appFields, [])
    const p = (b: EditBlock) => blockProblems(b, known)
    expect(p({ id: 'x', type: 'paragraph', align: '', text: 'Dear {{employee.nmae}} {{input.x}} {{employee.nmae}}' })).toEqual([
      { kind: 'unknownField', key: 'employee.nmae' },
      { kind: 'unknownField', key: 'input.x' },
    ])
    expect(p({ id: 'x', type: 'paragraph', align: '', text: 'Dear {{Employee}}' })).toEqual([{ kind: 'notAField' }])
    expect(p({ id: 'x', type: 'list', ordered: false, items: ' \n' })).toEqual([{ kind: 'listEmpty' }])
    expect(p({ id: 'x', type: 'fields', pairs: [] })).toEqual([{ kind: 'fieldsEmpty' }])
    expect(p({ id: 'x', type: 'signatures', signatures: [] })).toEqual([{ kind: 'signatures' }])
    expect(p({ id: 'x', type: 'spacer', height: 0 })).toEqual([{ kind: 'spacer' }])
    expect(p({ id: 'x', type: 'spacer', height: 200 })).toEqual([])
    expect(p({ id: 'x', type: 'table', header: false, widths: [13], rows: [['']] })).toEqual([{ kind: 'width' }])
  })

  it('checks asked fields as the API does', () => {
    const a = (over: Partial<ReturnType<typeof newAsked>>) => ({ ...newAsked([]), label: 'Salary', ...over })
    expect(askedProblems([a({ id: '1', key: 'salary' })])).toEqual({})
    expect(askedProblems([a({ id: '1', key: 'Salary' })])).toEqual({ 1: 'key' })
    expect(askedProblems([a({ id: '1', key: 'x'.repeat(41) })])).toEqual({ 1: 'key' })
    expect(askedProblems([a({ id: '1', key: 'salary' }), a({ id: '2', key: 'salary' })])).toEqual({ 2: 'keyTaken' })
    expect(askedProblems([a({ id: '1', label: ' ' })])).toEqual({ 1: 'label' })
    expect(askedProblems([a({ id: '1', kind: 'choice', options: 'Full time\n' })])).toEqual({ 1: 'options' })
    expect(askedProblems([a({ id: '1', kind: 'choice', options: 'Full time\n\nPart time' })])).toEqual({})
  })

  it('sends options only for a choice', () => {
    const asked = { key: 'hours', label: 'Hours', kind: 'choice' as const, required: true, options: ['Full time', 'Part time'] }
    expect(toAsked(editAsked(asked))).toEqual(asked)
    expect(toAsked({ ...editAsked(asked), kind: 'text' })).toEqual({ key: 'hours', label: 'Hours', kind: 'text', required: true })
  })

  it('gives new asked fields keys of their own', () => {
    const first = newAsked([])
    expect(first.key).toBe('field_1')
    expect(newAsked([{ key: 'field_2' }]).key).toBe('field_3')
  })

  it('collects every problem, and an empty body', () => {
    const asked = [{ ...newAsked([]), id: 'a1', key: 'salary', label: '' }]
    const blocks: EditBlock[] = [{ id: 'b1', type: 'paragraph', align: '', text: '{{input.salary}} {{nope}}' }]
    expect(draftProblems(blocks, asked, appFields)).toEqual({ blocks: { b1: [{ kind: 'unknownField', key: 'nope' }] }, asked: { a1: 'label' }, empty: false, count: 2 })
    expect(draftProblems([], [], appFields)).toMatchObject({ empty: true, count: 1 })
  })

  it('tells whether the body prints the document\'s number', () => {
    expect(printsNumber(toBody([{ id: 'x', type: 'heading', level: 1, text: 'No. **{{document.number}}**' }]))).toBe(true)
    expect(printsNumber(toBody([{ id: 'x', type: 'heading', level: 1, text: 'No. document.number' }]))).toBe(false)
  })

  it('checks a name', () => {
    expect(validName(' ')).toBe('required')
    expect(validName('a'.repeat(121))).toBe('tooLong')
    expect(validName('Employment contract, LT')).toBeNull()
  })
})

describe('state and versions', () => {
  const version = (number: number, state: 'draft' | 'published'): TemplateVersion => ({
    number,
    state,
    kind: 'blocks',
    body: { format: 'ppe.blocks.v1', blocks: [{ type: 'paragraph', text: [{ text: `v${number}` }] }] },
    asked: [],
    body_sha256: '',
    updated_at: '',
    published_at: state === 'published' ? '2026-11-24T10:00:00Z' : null,
  })
  const template = (over: Partial<DocumentTemplate>): DocumentTemplate => ({
    id: 't1',
    type: 'employment.contract',
    name: 'Contract',
    language: 'lt',
    current_version: null,
    retired: false,
    versions: [version(1, 'draft')],
    created_at: '',
    updated_at: '',
    ...over,
  })

  it('says Draft only, Published, Published with a draft, or Retired', () => {
    expect(templateState(template({}))).toEqual({ kind: 'draft', draft: 1 })
    const published = template({ current_version: 2, versions: [version(2, 'published'), version(1, 'published')] })
    expect(templateState(published)).toEqual({ kind: 'published', version: 2 })
    expect(templateState({ ...published, versions: [version(3, 'draft'), ...published.versions] })).toEqual({ kind: 'publishedWithDraft', version: 2, draft: 3 })
    expect(templateState({ ...published, retired: true })).toEqual({ kind: 'retired', version: 2 })
  })

  it('edits the draft, else the published version; a new draft takes the next number', () => {
    const published = template({ current_version: 2, versions: [version(2, 'published'), version(1, 'published')] })
    expect(editedVersion(published)?.number).toBe(2)
    expect(draftNumber(published)).toBe(3)
    const drafted = { ...published, versions: [version(3, 'draft'), ...published.versions] }
    expect(editedVersion(drafted)?.number).toBe(3)
    expect(draftNumber(drafted)).toBe(3)
    expect(draftNumber(template({ versions: [] }))).toBe(1)
  })

  it('tells an unchanged draft from a changed one', () => {
    const v = version(1, 'draft')
    const blocks = editBody(v.body)
    expect(draftKey(toBody(blocks), [])).toBe(savedKey(v))
    const changed = blocks.map((b) => (b.type === 'paragraph' ? { ...b, text: b.text + '!' } : b))
    expect(draftKey(toBody(changed), [])).not.toBe(savedKey(v))
  })

  it('groups templates by type in the types\' order, retired ones last', () => {
    const list = [
      template({ id: '1', type: 'employment.nda', name: 'NDA' }),
      template({ id: '2', name: 'B', retired: true }),
      template({ id: '3', name: 'A' }),
      template({ id: '4', name: 'C' }),
    ]
    expect(byType(list, ['employment.contract', 'employment.annex', 'employment.nda']).map((g) => [g.type, g.templates.map((t) => t.id)])).toEqual([
      ['employment.contract', ['3', '4', '2']],
      ['employment.nda', ['1']],
    ])
  })
})

describe('the preview', () => {
  it('reads the base64 PDF', async () => {
    const blob = pdfBlob(btoa('%PDF-1.7\n'))
    expect(blob.type).toBe('application/pdf')
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe('%PDF-1.7\n')
  })

  it('names the file after the template', () => {
    expect(previewFilename('Contract: LT/full time')).toBe('Contract- LT-full time (preview).pdf')
  })
})

describe('DOCX templates', () => {
  const body: DocxTemplateBody = { format: 'ppe.docx.v1', blocks: [], docx_sha256: 'a'.repeat(64), fields: ['document.number', 'employee.name', 'input.salary'] }
  const app = [{ key: 'document.number' }, { key: 'document.hash' }, { key: 'employee.name' }]
  it('names the fields the DOCX uses that are not known, and what Publish needs', () => {
    expect(docxProblems({ ...body, fields: [...body.fields] }, [], app)).toEqual({ unknown: ['input.salary'], missing: ['document.hash'] })
    const salary = { ...editAsked({ key: 'salary', label: 'Alga', kind: 'money', required: true }) }
    expect(docxProblems({ ...body, fields: [...body.fields, 'document.hash'] }, [salary], app)).toEqual({ unknown: [], missing: [] })
  })
  it('keeps a DOCX draft as it is saved, and tells it from blocks', () => {
    const v: TemplateVersion = { number: 2, state: 'draft', kind: 'docx', body: { ...body, fields: [...body.fields] }, asked: [], body_sha256: 'b', updated_at: '', published_at: null }
    expect(docxBody(v)?.docx_sha256).toBe('a'.repeat(64))
    expect(savedKey(v)).toBe(draftKey(v.body, []))
    expect(editBody(v.body)).toEqual([])
  })
  it('writes a size', () => {
    expect(fileSize(18_000)).toBe('18 KB')
    expect(fileSize(1_300_000)).toBe('1.2 MB')
  })
})
