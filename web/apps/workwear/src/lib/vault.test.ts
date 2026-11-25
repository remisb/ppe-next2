import type { VaultDocument, VaultHit, VaultType } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { vaultExportColumns } from './vault-export'
import { canReadAgain, detailsOf, displayTitle, draftProblems, holdProblems, seesVault, expiry, fileProblem, linkLabels, linkRoute, textLine, typeLabel, uploadRefusal, uploadTypes, withLink } from './vault'

const type = (key: string, must: VaultType['must'], manage = 'vault.manage'): VaultType => ({
  key,
  group: 'other',
  sealed: false,
  read: 'vault.read',
  manage,
  links: ['employee', 'asset'],
  must,
  origins: ['uploaded'],
  file_types: ['application/pdf'],
  max_bytes: 20 << 20,
  dated: true,
  expiring: true,
  retention: { rule: 'keep' },
})

describe('sealed', () => {
  it('names a sealed document by its type in lists, whose title only its page shows', () => {
    expect(displayTitle({ title: '', type: 'employment.contract' })).toBe('Employment contract')
    expect(displayTitle({ title: 'Darbas aukštyje', type: 'employee.certificate' })).toBe('Darbas aukštyje')
  })
  it('opens the vault to either reader', () => {
    expect(seesVault((p) => p === 'vault.employment.read')).toBe(true)
    expect(seesVault((p) => p === 'vault.read')).toBe(true)
    expect(seesVault(() => false)).toBe(false)
  })
  it('needs a day and a reason for a Legal Hold', () => {
    expect(holdProblems('', ' ')).toEqual({ until: 'Choose the day.', reason: 'Say why.' })
    expect(holdProblems('2027-01-01', 'Court case')).toEqual({})
  })
})

describe('names', () => {
  it('names a type, or shows a key it does not know', () => {
    expect(typeLabel('employee.certificate')).toBe('Certificate')
    expect(typeLabel('employment.contract')).toBe('Employment contract')
    expect(typeLabel('order.record')).toBe('order.record')
  })
  it('joins the links’ names', () => {
    expect(linkLabels([{ label: 'Ana Žukauskaitė' }, { label: 'EQ-0001 Laptop' }])).toBe('Ana Žukauskaitė, EQ-0001 Laptop')
  })
  it('opens an employee’s page or an asset, and nothing for a company', () => {
    expect(linkRoute({ kind: 'employee', id: 'e1' }, 'Garantija')).toEqual({ name: 'employeePage', id: 'e1', from: 'Garantija' })
    expect(linkRoute({ kind: 'asset', id: 'a1' })).toEqual({ name: 'asset', id: 'a1' })
    expect(linkRoute({ kind: 'company', id: 'c1' })).toBeNull()
  })
})

describe('expiry', () => {
  it('is expired after the day, soon within 30 days, else nothing', () => {
    expect(expiry('2026-11-23', '2026-11-24')).toBe('expired')
    expect(expiry('2026-11-24', '2026-11-24')).toBe('soon')
    expect(expiry('2026-12-24', '2026-11-24')).toBe('soon')
    expect(expiry('2026-12-25', '2026-11-24')).toBeNull()
    expect(expiry(null, '2026-11-24')).toBeNull()
  })
})

describe('files', () => {
  it('refuses an empty, large or unknown file before sending it', () => {
    expect(fileProblem({ name: 'a.pdf', size: 0, type: 'application/pdf' })).toBe('The file is empty.')
    expect(fileProblem({ name: 'a.pdf', size: 21 << 20, type: 'application/pdf' })).toBe('The file is over 20 MB.')
    expect(fileProblem({ name: 'a.docx', size: 10, type: 'application/msword' })).toBe('Choose a PDF, JPEG or PNG file.')
    expect(fileProblem({ name: 'SCAN.JPG', size: 10, type: '' })).toBeNull()
  })
  it('words what the API refused', () => {
    expect(uploadRefusal(415)).toBe('Choose a PDF, JPEG or PNG file.')
    expect(uploadRefusal(404)).toMatch(/linked record/)
    expect(uploadRefusal(500)).toBeNull()
  })
})

describe('the draft', () => {
  const draft = { title: 'Working at height', valid_from: null, valid_until: null, links: [{ kind: 'employee' as const, id: 'e1' }] }
  it('needs a title, dates in order and the type’s required links', () => {
    expect(draftProblems(draft, type('employee.certificate', ['employee']))).toEqual({})
    expect(draftProblems({ ...draft, title: '  ' }, undefined)).toEqual({ title: 'Enter a title.' })
    expect(draftProblems({ ...draft, valid_from: '2026-02-01', valid_until: '2026-01-31' }, undefined).valid_until).toMatch(/before/)
    expect(draftProblems({ ...draft, links: [] }, type('employee.certificate', ['employee'])).links).toBe('Needs a link to: Employee')
  })
  it('adds a link once', () => {
    const one = withLink([], { kind: 'employee', id: 'e1', label: 'Ana' })
    expect(withLink(one, { kind: 'employee', id: 'e1', label: 'Ana' })).toHaveLength(1)
    expect(withLink(one, { kind: 'employee', id: 'e2', label: 'Jonas' })).toHaveLength(2)
  })
  it('edits the links the user made, leaving locked ones to the API', () => {
    const doc = {
      title: 'x',
      document_date: null,
      valid_from: null,
      valid_until: '2027-01-01',
      links: [
        { kind: 'employee', id: 'e1', label: 'Ana', locked: false },
        { kind: 'asset', id: 'a1', label: 'EQ', locked: true },
      ],
    } as unknown as VaultDocument
    expect(detailsOf(doc)).toEqual({ title: 'x', document_date: null, valid_from: null, valid_until: '2027-01-01', links: [{ kind: 'employee', id: 'e1' }] })
  })
  it('offers the types the reader may add and whose links can be made here', () => {
    const signed = { ...type('asset.signed_form', ['asset', 'employee'], ''), source: 'asset_signed_form' }
    const types = [type('employee.certificate', ['employee']), type('asset.document', ['asset']), type('other', []), type('secret', [], 'x.manage'), signed]
    const can = (p: string) => p === 'vault.manage' || p === ''
    expect(uploadTypes(types, can, []).map((t) => t.key)).toEqual(['employee.certificate', 'other'])
    // A signed form is added by Company Assets alone, never here.
    expect(uploadTypes(types, can, ['asset']).map((t) => t.key)).toEqual(['employee.certificate', 'asset.document', 'other'])
  })
})

describe('export', () => {
  it('writes a document’s row', () => {
    const hit: VaultHit = {
      id: 'd1',
      type: 'employee.certificate',
      title: 'Working at height',
      number: null,
      document_date: '2026-03-01',
      valid_until: '2028-03-01',
      origin: 'uploaded',
      sealed: false,
      versions: 2,
      content_type: 'application/pdf',
      links: [{ kind: 'employee', id: 'e1', label: 'Ana Žukauskaitė', locked: false }],
      created_at: '2026-03-02T10:00:00Z',
      updated_at: '2026-04-01T10:00:00Z',
    }
    const row = Object.fromEntries(vaultExportColumns().map((c) => [c.key, c.value(hit)]))
    expect(row).toMatchObject({ title: 'Working at height', type: 'Certificate', linked: 'Ana Žukauskaitė', valid_until: '2028-03-01', origin: 'Uploaded', versions: 2, updated: '2026-04-01' })
  })
})

describe('textLine and canReadAgain', () => {
  const v = { text_state: 'read', text_method: 'ocr', text_pages: 3, text_error: null, origin: 'original' } as const
  it('says how a version was read, or why not', () => {
    expect(textLine(v)).toBe('Read · by OCR · 3 pages')
    expect(textLine({ ...v, text_method: 'blocks', text_pages: null })).toBe('Read')
    expect(textLine({ ...v, text_state: 'failed', text_error: 'timeout' })).toBe('Couldn’t read · it took too long')
    expect(textLine({ ...v, text_state: 'failed', text_error: 'later_code' })).toBe('Couldn’t read · later_code')
    expect(textLine({ ...v, text_state: 'pending', text_method: null })).toBe('Waiting to be read')
  })
  it('offers Read Again for a read file to whoever may change it', () => {
    expect(canReadAgain(v, true)).toBe(true)
    expect(canReadAgain(v, false)).toBe(false)
    expect(canReadAgain({ origin: 'generated', text_state: 'read' }, true)).toBe(false)
    expect(canReadAgain({ origin: 'original', text_state: 'pending' }, true)).toBe(false)
    expect(canReadAgain({ origin: 'signed', text_state: 'failed' }, true)).toBe(true)
  })
})
