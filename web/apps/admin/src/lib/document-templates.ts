import type { AskedField, AskedKind, DocumentTemplate, TemplateBlock, TemplateBlockType, TemplateBody, TemplateRun, TemplateVersion } from '@ppe/api-client'

/**
 * Document Templates' editing rules, as pure functions (ADR 0008 phase 3,
 * docs/specs/document-template-service.md): inline text as a light markup
 * and back, the blocks as the editor holds them and as the API takes them,
 * asked fields, the checks the API makes that are cheap to make here, and a
 * template's state. The API (internal/vault/template) has the last word.
 *
 * Inline text is edited as plain text: **bold**, *italic*, ***both***, and
 * {{field.key}} for a field. A backslash keeps the next *, \ or { as written.
 */

// ---------------------------------------------------------------------------
// Inline text

/** A field's key as the markup writes it: employee.name, input.salary. */
const fieldAt = /^\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\s*\}\}/

/** runs without empty pieces, neighbouring words of the same look joined, false marks left out. */
export function tidyRuns(runs: readonly TemplateRun[]): TemplateRun[] {
  const out: TemplateRun[] = []
  for (const r of runs) {
    const bold = Boolean(r.bold)
    const italic = Boolean(r.italic)
    if (r.field) {
      out.push(styled({ field: r.field }, bold, italic))
      continue
    }
    if (!r.text) continue
    const last = out.at(-1)
    if (last && last.field === undefined && Boolean(last.bold) === bold && Boolean(last.italic) === italic) {
      last.text = (last.text ?? '') + r.text
    } else {
      out.push(styled({ text: r.text }, bold, italic))
    }
  }
  return out
}

function styled(run: TemplateRun, bold: boolean, italic: boolean): TemplateRun {
  if (bold) run.bold = true
  if (italic) run.italic = true
  return run
}

/** The asterisks that switch from one look to another: * italic, ** bold, *** both. */
function marker(fromBold: boolean, fromItalic: boolean, toBold: boolean, toItalic: boolean): string {
  return '*'.repeat((fromItalic !== toItalic ? 1 : 0) + (fromBold !== toBold ? 2 : 0))
}

/** text as markup, next being the character the markup goes on with (none at the end). */
function escapeText(text: string, next: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const following = i + 1 < text.length ? text[i + 1]! : next
    if (c === '*') out += '\\*'
    else if (c === '\\' && (following === '*' || following === '\\' || following === '{')) out += '\\\\'
    else if (c === '{' && following === '{') out += '\\{'
    else out += c
  }
  return out
}

/** runs as the editor shows them: **bold**, *italic*, {{field}}. markupToRuns reads it back to the same runs. */
export function runsToMarkup(runs: readonly TemplateRun[]): string {
  const tidy = tidyRuns(runs)
  let bold = false
  let italic = false
  // Each run's markup, then the text escaped once the character after it is known.
  const parts: { text?: string; raw?: string }[] = []
  for (const r of tidy) {
    const b = Boolean(r.bold)
    const i = Boolean(r.italic)
    const m = marker(bold, italic, b, i)
    if (m) parts.push({ raw: m })
    bold = b
    italic = i
    parts.push(r.field ? { raw: `{{${r.field}}}` } : { text: r.text ?? '' })
  }
  const end = marker(bold, italic, false, false)
  if (end) parts.push({ raw: end })
  let out = ''
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k]!
    out = (p.raw ?? escapeText(p.text ?? '', out[0] ?? '')) + out
  }
  return out
}

type Token = { text: string } | { field: string } | { bold: boolean; italic: boolean; literal: string }

/**
 * The runs markup writes. An asterisk that opens a look never closed is kept
 * as written; four or more in a row are words.
 */
export function markupToRuns(markup: string): TemplateRun[] {
  const tokens: Token[] = []
  let words = ''
  const flush = () => {
    if (words) tokens.push({ text: words })
    words = ''
  }
  let i = 0
  while (i < markup.length) {
    const c = markup[i]!
    if (c === '\\') {
      const n = markup[i + 1]
      if (n === '*' || n === '\\' || n === '{') {
        words += n
        i += 2
      } else {
        words += c
        i++
      }
      continue
    }
    if (c === '{') {
      const m = fieldAt.exec(markup.slice(i))
      if (m) {
        flush()
        tokens.push({ field: m[1]! })
        i += m[0].length
      } else {
        words += c
        i++
      }
      continue
    }
    if (c === '*') {
      let n = 0
      while (markup[i + n] === '*') n++
      if (n > 3) {
        words += '*'.repeat(n)
      } else {
        flush()
        tokens.push({ italic: n !== 2, bold: n >= 2, literal: '' })
      }
      i += n
      continue
    }
    words += c
    i++
  }
  flush()

  // A look left open at the end: the asterisks that opened it are words.
  let bold = false
  let italic = false
  let boldOpener = -1
  let italicOpener = -1
  tokens.forEach((tk, k) => {
    if (!('literal' in tk)) return
    if (tk.bold) {
      bold = !bold
      if (bold) boldOpener = k
    }
    if (tk.italic) {
      italic = !italic
      if (italic) italicOpener = k
    }
  })
  if (bold) {
    const tk = tokens[boldOpener] as Extract<Token, { literal: string }>
    tk.bold = false
    tk.literal += '**'
  }
  if (italic) {
    const tk = tokens[italicOpener] as Extract<Token, { literal: string }>
    tk.italic = false
    tk.literal += '*'
  }

  const runs: TemplateRun[] = []
  bold = false
  italic = false
  for (const tk of tokens) {
    if ('literal' in tk) {
      if (tk.literal) runs.push(styled({ text: tk.literal }, bold, italic))
      if (tk.bold) bold = !bold
      if (tk.italic) italic = !italic
    } else if ('field' in tk) {
      runs.push(styled({ field: tk.field }, bold, italic))
    } else {
      runs.push(styled({ text: tk.text }, bold, italic))
    }
  }
  return tidyRuns(runs)
}

/**
 * text with {{key}} put in place of the selection start…end (the cursor when
 * they are equal), and where the cursor goes: just after it.
 */
export function insertField(text: string, key: string, start: number, end = start): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(start, end, text.length))
  const to = Math.min(text.length, Math.max(start, end))
  const field = `{{${key}}}`
  return { text: text.slice(0, from) + field + text.slice(to), cursor: from + field.length }
}

// ---------------------------------------------------------------------------
// Blocks as the editor holds them: inline text as markup, a list's items one a line.

export type ParagraphAlign = '' | 'center' | 'justify'

export interface EditPair {
  label: string
  value: string
}

export interface EditSignature {
  label: string
  under: string
}

export type EditBlock =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'paragraph'; align: ParagraphAlign; text: string }
  | { id: string; type: 'list'; ordered: boolean; items: string }
  | { id: string; type: 'table'; header: boolean; widths: number[]; rows: string[][] }
  | { id: string; type: 'fields'; pairs: EditPair[] }
  | { id: string; type: 'signatures'; signatures: EditSignature[] }
  | { id: string; type: 'page_break' }
  | { id: string; type: 'spacer'; height: number }

/** The kinds Add Block offers, in its order. */
export const blockKinds: readonly TemplateBlockType[] = ['heading', 'paragraph', 'list', 'table', 'fields', 'signatures', 'spacer', 'page_break']

export const limits = {
  maxColumns: 8,
  maxSignatures: 3,
  maxSpacer: 200,
  minWidth: 1,
  maxWidth: 12,
  maxAsked: 30,
  maxLabel: 120,
  maxName: 120,
  maxOptions: 30,
} as const

let lastId = 0
/** A key for React, never sent. */
const newId = () => `b${++lastId}`

/** A new block of kind, with a start that reads as one. */
export function newBlock(type: TemplateBlockType): EditBlock {
  const id = newId()
  switch (type) {
    case 'heading':
      return { id, type, level: 2, text: '' }
    case 'paragraph':
      return { id, type, align: '', text: '' }
    case 'list':
      return { id, type, ordered: true, items: '' }
    case 'table':
      return { id, type, header: true, widths: [1, 1], rows: [['', ''], ['', '']] }
    case 'fields':
      return { id, type, pairs: [{ label: '', value: '' }] }
    case 'signatures':
      return { id, type, signatures: [{ label: '', under: '' }, { label: '', under: '' }] }
    case 'page_break':
      return { id, type }
    case 'spacer':
      return { id, type, height: 12 }
  }
}

const level = (n: number | undefined): 1 | 2 | 3 => (n === 1 || n === 3 ? n : 2)

/** A body's block as the editor holds it. */
export function editBlock(b: TemplateBlock): EditBlock {
  const id = newId()
  const md = (rs: TemplateRun[] | undefined) => runsToMarkup(rs ?? [])
  switch (b.type) {
    case 'heading':
      return { id, type: 'heading', level: level(b.level), text: md(b.text) }
    case 'paragraph':
      return { id, type: 'paragraph', align: b.align === 'center' || b.align === 'justify' ? b.align : '', text: md(b.text) }
    case 'list':
      return { id, type: 'list', ordered: Boolean(b.ordered), items: (b.items ?? []).map(md).join('\n') }
    case 'table': {
      const rows = (b.rows ?? []).map((r) => r.map(md))
      const cols = Math.max(1, rows[0]?.length ?? 1)
      const widths = b.widths?.length === cols ? [...b.widths] : Array.from({ length: cols }, () => 1)
      return { id, type: 'table', header: Boolean(b.header), widths, rows: rows.length ? rows : [Array.from({ length: cols }, () => '')] }
    }
    case 'fields':
      return { id, type: 'fields', pairs: (b.pairs ?? []).map((p) => ({ label: md(p.label), value: md(p.value) })) }
    case 'signatures':
      return { id, type: 'signatures', signatures: (b.signatures ?? []).map((s) => ({ label: md(s.label), under: md(s.under) })) }
    case 'page_break':
      return { id, type: 'page_break' }
    case 'spacer':
      return { id, type: 'spacer', height: b.height ?? 12 }
  }
}

/** A list's lines that hold something: its items. */
export function listItems(items: string): string[] {
  return items.split('\n').filter((l) => l.trim() !== '')
}

/** The block as the API takes it: only its kind's parts. */
export function toBlock(b: EditBlock): TemplateBlock {
  const runs = markupToRuns
  switch (b.type) {
    case 'heading':
      return { type: 'heading', level: b.level, text: runs(b.text) }
    case 'paragraph':
      return b.align ? { type: 'paragraph', align: b.align, text: runs(b.text) } : { type: 'paragraph', text: runs(b.text) }
    case 'list':
      return { type: 'list', ...(b.ordered ? { ordered: true } : {}), items: listItems(b.items).map(runs) }
    case 'table':
      return {
        type: 'table',
        rows: b.rows.map((r) => r.map(runs)),
        ...(b.header ? { header: true } : {}),
        // Equal columns need no widths.
        ...(b.widths.some((w) => w !== b.widths[0]) ? { widths: [...b.widths] } : {}),
      }
    case 'fields':
      return { type: 'fields', pairs: b.pairs.map((p) => ({ label: runs(p.label), value: runs(p.value) })) }
    case 'signatures':
      return {
        type: 'signatures',
        signatures: b.signatures.map((s) => {
          const under = runs(s.under)
          return under.length ? { label: runs(s.label), under } : { label: runs(s.label) }
        }),
      }
    case 'page_break':
      return { type: 'page_break' }
    case 'spacer':
      return { type: 'spacer', height: b.height }
  }
}

export function editBody(body: TemplateBody | undefined): EditBlock[] {
  return (body?.blocks ?? []).map(editBlock)
}

export function toBody(blocks: readonly EditBlock[]): TemplateBody {
  return { format: 'ppe.blocks.v1', blocks: blocks.map(toBlock) }
}

/** blocks with the one at index moved by step (−1 up, +1 down); unchanged at an end. */
export function moveBlock<T>(blocks: readonly T[], index: number, step: -1 | 1): T[] {
  const to = index + step
  if (index < 0 || index >= blocks.length || to < 0 || to >= blocks.length) return [...blocks]
  const out = [...blocks]
  const [b] = out.splice(index, 1)
  out.splice(to, 0, b!)
  return out
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

export function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((x, i) => (i === index ? item : x))
}

type Table = Extract<EditBlock, { type: 'table' }>

export function addRow(t: Table): Table {
  return { ...t, rows: [...t.rows, t.widths.map(() => '')] }
}

export function removeRow(t: Table, row: number): Table {
  return t.rows.length <= 1 ? t : { ...t, rows: removeAt(t.rows, row) }
}

export function addColumn(t: Table): Table {
  if (t.widths.length >= limits.maxColumns) return t
  return { ...t, widths: [...t.widths, 1], rows: t.rows.map((r) => [...r, '']) }
}

export function removeColumn(t: Table, col: number): Table {
  if (t.widths.length <= 1) return t
  return { ...t, widths: removeAt(t.widths, col), rows: t.rows.map((r) => removeAt(r, col)) }
}

export function setCell(t: Table, row: number, col: number, value: string): Table {
  return { ...t, rows: t.rows.map((r, i) => (i === row ? replaceAt(r, col, value) : r)) }
}

// ---------------------------------------------------------------------------
// Asked fields

export interface EditAsked {
  id: string
  key: string
  label: string
  kind: AskedKind
  required: boolean
  /** A choice's options, one a line. */
  options: string
}

export const askedKinds: readonly AskedKind[] = ['text', 'long_text', 'date', 'number', 'money', 'choice']

export const askedKeyPattern = /^[a-z][a-z0-9_]{0,39}$/

/** How a template writes an asked field: input.<key>. */
export const askedField = (key: string) => `input.${key}`

export function editAsked(a: AskedField): EditAsked {
  return { id: newId(), key: a.key, label: a.label, kind: a.kind, required: a.required, options: (a.options ?? []).join('\n') }
}

/** A new asked field: a key of its own (field_1, field_2…), a text, not required. */
export function newAsked(existing: readonly { key: string }[]): EditAsked {
  let n = existing.length + 1
  while (existing.some((a) => a.key === `field_${n}`)) n++
  return { id: newId(), key: `field_${n}`, label: '', kind: 'text', required: false, options: '' }
}

export function optionsOf(options: string): string[] {
  return options
    .split('\n')
    .map((o) => o.trim())
    .filter((o) => o !== '')
}

/** The asked field as the API takes it: trimmed, options only for a choice. */
export function toAsked(a: EditAsked): AskedField {
  const out: AskedField = { key: a.key.trim(), label: a.label.trim(), kind: a.kind, required: a.required }
  if (a.kind === 'choice') out.options = optionsOf(a.options)
  return out
}

export type AskedProblem = 'key' | 'keyTaken' | 'label' | 'labelLong' | 'options' | 'optionLong'

/** What keeps each asked field from being saved, by its id: the API's CheckAsked. */
export function askedProblems(asked: readonly EditAsked[]): Record<string, AskedProblem> {
  const out: Record<string, AskedProblem> = {}
  const seen: string[] = []
  for (const a of asked) {
    const x = toAsked(a)
    if (!askedKeyPattern.test(x.key)) out[a.id] = 'key'
    else if (seen.includes(x.key)) out[a.id] = 'keyTaken'
    else if (x.label === '') out[a.id] = 'label'
    else if ([...x.label].length > limits.maxLabel) out[a.id] = 'labelLong'
    else if (a.kind === 'choice' && ((x.options?.length ?? 0) < 2 || (x.options?.length ?? 0) > limits.maxOptions)) out[a.id] = 'options'
    else if ((x.options ?? []).some((o) => [...o].length > limits.maxLabel)) out[a.id] = 'optionLong'
    seen.push(x.key)
  }
  return out
}

// ---------------------------------------------------------------------------
// Checks the API makes, made here where they are cheap

/** Every run list of a block, in reading order. */
export function blockRuns(b: TemplateBlock): TemplateRun[][] {
  const out: TemplateRun[][] = []
  if (b.text) out.push(b.text)
  for (const it of b.items ?? []) out.push(it)
  for (const row of b.rows ?? []) for (const c of row) out.push(c)
  for (const p of b.pairs ?? []) out.push(p.label, p.value)
  for (const s of b.signatures ?? []) out.push(s.label, s.under ?? [])
  return out
}

/** The fields a body writes, each once, in reading order. */
export function usedFields(body: TemplateBody): string[] {
  const out: string[] = []
  for (const b of body.blocks) for (const rs of blockRuns(b)) for (const r of rs) if (r.field && !out.includes(r.field)) out.push(r.field)
  return out
}

export type BlockProblem =
  | { kind: 'unknownField'; key: string }
  | { kind: 'notAField' }
  | { kind: 'listEmpty' }
  | { kind: 'fieldsEmpty' }
  | { kind: 'signatures' }
  | { kind: 'spacer' }
  | { kind: 'width' }

/**
 * What keeps a block from being saved: a field that is neither the app's
 * (known) nor an asked one, text that looks like a field and is not one, a
 * kind's own limits.
 */
export function blockProblems(b: EditBlock, known: (key: string) => boolean): BlockProblem[] {
  const out: BlockProblem[] = []
  const block = toBlock(b)
  for (const rs of blockRuns(block)) {
    for (const r of rs) {
      if (r.field && !known(r.field) && !out.some((p) => p.kind === 'unknownField' && p.key === r.field)) out.push({ kind: 'unknownField', key: r.field })
      if (r.text?.includes('{{') && !out.some((p) => p.kind === 'notAField')) out.push({ kind: 'notAField' })
    }
  }
  if (b.type === 'list' && (block.items ?? []).length === 0) out.push({ kind: 'listEmpty' })
  if (b.type === 'fields' && b.pairs.length === 0) out.push({ kind: 'fieldsEmpty' })
  if (b.type === 'signatures' && (b.signatures.length === 0 || b.signatures.length > limits.maxSignatures)) out.push({ kind: 'signatures' })
  if (b.type === 'spacer' && !(Number.isInteger(b.height) && b.height >= 1 && b.height <= limits.maxSpacer)) out.push({ kind: 'spacer' })
  if (b.type === 'table' && b.widths.some((w) => !Number.isInteger(w) || w < limits.minWidth || w > limits.maxWidth)) out.push({ kind: 'width' })
  return out
}

/** Whether key is an app field or one of the asked ones (input.<key>). */
export function knownField(appFields: readonly { key: string }[], asked: readonly { key: string }[]): (key: string) => boolean {
  return (key) => appFields.some((f) => f.key === key) || (key.startsWith('input.') && asked.some((a) => askedField(a.key.trim()) === key))
}

/** The field every published template must print. */
export const DOCUMENT_NUMBER = 'document.number'

/** Whether the body prints the document's number, which Publish requires. */
export function printsNumber(body: TemplateBody): boolean {
  return usedFields(body).includes(DOCUMENT_NUMBER)
}

/** Every problem of the draft, by block id and asked field id, and whether it has none. */
export function draftProblems(
  blocks: readonly EditBlock[],
  asked: readonly EditAsked[],
  appFields: readonly { key: string }[],
): { blocks: Record<string, BlockProblem[]>; asked: Record<string, AskedProblem>; empty: boolean; count: number } {
  const known = knownField(appFields, asked)
  const byBlock: Record<string, BlockProblem[]> = {}
  let count = 0
  for (const b of blocks) {
    const p = blockProblems(b, known)
    if (p.length) {
      byBlock[b.id] = p
      count += p.length
    }
  }
  const a = askedProblems(asked)
  count += Object.keys(a).length
  return { blocks: byBlock, asked: a, empty: blocks.length === 0, count: count + (blocks.length === 0 ? 1 : 0) }
}

// ---------------------------------------------------------------------------
// The template's state and versions

/** The version the editor starts from: the draft, else the published one, else the newest. */
export function editedVersion(t: DocumentTemplate): TemplateVersion | undefined {
  return t.versions.find((v) => v.state === 'draft') ?? t.versions.find((v) => v.number === t.current_version) ?? t.versions[0]
}

/** The draft's number: the one saved, or the next after the newest version. */
export function draftNumber(t: DocumentTemplate): number {
  return t.versions.find((v) => v.state === 'draft')?.number ?? (t.versions[0]?.number ?? 0) + 1
}

export type TemplateState =
  | { kind: 'draft'; draft: number }
  | { kind: 'published'; version: number }
  | { kind: 'publishedWithDraft'; version: number; draft: number }
  | { kind: 'retired'; version: number | null }

/** Draft only, Published vN, Published vN with draft vN+1, or Retired. */
export function templateState(t: DocumentTemplate): TemplateState {
  if (t.retired) return { kind: 'retired', version: t.current_version }
  const draft = t.versions.find((v) => v.state === 'draft')
  if (t.current_version === null) return { kind: 'draft', draft: draft?.number ?? 1 }
  return draft ? { kind: 'publishedWithDraft', version: t.current_version, draft: draft.number } : { kind: 'published', version: t.current_version }
}

/** The draft as the API saves it, as one string: equal strings, the same draft. */
export function draftKey(body: TemplateBody, asked: readonly AskedField[]): string {
  return JSON.stringify({ body, asked })
}

/** A saved version as the editor would save it again, for telling whether anything changed. */
export function savedKey(v: TemplateVersion | undefined): string {
  return draftKey(toBody(editBody(v?.body)), (v?.asked ?? []).map(editAsked).map(toAsked))
}

// ---------------------------------------------------------------------------
// Names, types, the preview

export const templateLanguages = ['lt', 'en', 'ru'] as const

export function validName(name: string): 'required' | 'tooLong' | null {
  const n = name.trim()
  if (n === '') return 'required'
  if ([...n].length > limits.maxName) return 'tooLong'
  return null
}

/** Templates grouped by type, in the types' order, each by name; retired ones last. */
export function byType(templates: readonly DocumentTemplate[], typeOrder: readonly string[]): { type: string; templates: DocumentTemplate[] }[] {
  const types = [...new Set([...typeOrder.filter((k) => templates.some((t) => t.type === k)), ...templates.map((t) => t.type)])]
  return types.map((type) => ({
    type,
    templates: templates
      .filter((t) => t.type === type)
      .sort((a, b) => Number(a.retired) - Number(b.retired) || a.name.localeCompare(b.name)),
  }))
}

/** A PDF the API sent as base64. */
export function pdfBlob(base64: string): Blob {
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return new Blob([bytes], { type: 'application/pdf' })
}

/** The preview's file name: the template's name, safe as a file's. */
export function previewFilename(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'template'
  return `${base} (preview).pdf`
}
