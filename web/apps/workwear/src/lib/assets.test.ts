import type { Asset } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { t } from '@/i18n'

import { MAX_SIGNED_COPY_BYTES, assetQuery, blockingEmail, documentsText, filterCount, signedCopyProblem, uploadRefusal, checkEquipmentDraft, emptyEquipmentDraft, looksLikeAssetNumber, canMarkNotReturned, checkSimDraft, emptyGiveDraft, formInput, formKey, formatDay, giveBlock, primaryAction, chooseTile, defaultProviderChange, emptySimDraft, isDefaultProvider, holderText, newSimInput, noAssetFilters, simDraftOf, tilePressed, todayIn } from './assets'

describe('tiles and filters', () => {
  it('a tile sets the place and keeps the status: In Office + Blocked (§3)', () => {
    const blocked = { ...noAssetFilters, status: 'BLOCKED' as const }
    const f = chooseTile(blocked, 'inOffice')
    expect(f).toMatchObject({ place: 'office', status: 'BLOCKED', notReturned: false })
    expect(tilePressed(f, 'inOffice')).toBe(true)
    expect(tilePressed(f, 'total')).toBe(false)
    expect(assetQuery('SIM', f, 'inventory', 'asc', 1)).toEqual({ kind: 'SIM', location: 'OFFICE', status: 'BLOCKED', sort: 'inventory', dir: 'asc', page: 1, page_size: 50 })
  })
  it('With Employees is everyone holding a card, whereabouts known or not', () => {
    expect(assetQuery('SIM', chooseTile(noAssetFilters, 'withEmployees'), 'holder', 'desc', 2)).toMatchObject({ held: true, sort: 'holder', dir: 'desc', page: 2 })
    expect(assetQuery('SIM', chooseTile(noAssetFilters, 'withEmployees'), 'inventory', 'asc', 1)).not.toHaveProperty('location')
  })
  it('Not Returned and Total', () => {
    const nr = chooseTile({ ...noAssetFilters, place: 'office' }, 'notReturned')
    expect(assetQuery('SIM', nr, 'inventory', 'asc', 1)).toMatchObject({ not_returned: true })
    expect(assetQuery('SIM', nr, 'inventory', 'asc', 1)).not.toHaveProperty('location')
    expect(tilePressed(chooseTile(nr, 'total'), 'total')).toBe(true)
  })
  it('leaves out what is not set, and trims the search', () => {
    expect(assetQuery('SIM', { ...noAssetFilters, q: '  612 40 ', provider: 'Telia', place: 'unknown' }, 'inventory', 'asc', 1)).toEqual({
      kind: 'SIM', q: '612 40', provider: 'Telia', location: 'UNKNOWN', sort: 'inventory', dir: 'asc', page: 1, page_size: 50,
    })
  })
})

const card = (over: Partial<Asset>): Asset => ({
  id: 'a', kind: 'SIM', category: null, inventory_no: 'SIM-000001', name: null, serial_no: null, sim_no: '0089370011', phone_no: null,
  provider: 'Telia', plan: null, non_return_value_cents: null, currency: 'EUR', connection_status: 'NOT_ACTIVATED', received_date: '2026-10-01',
  comment: '', created_at: '', updated_at: '', location: 'OFFICE', open_assignment: null, needs_form: true, ...over,
})

describe('held by / location', () => {
  const open = { employee_name: 'Jonas Petraitis' } as Asset['open_assignment']
  it('names the Office, the holder, or Unknown with the last holder kept', () => {
    expect(holderText(card({}))).toEqual({ main: 'Office' })
    expect(holderText(card({ location: 'WITH_EMPLOYEE', open_assignment: open }))).toEqual({ main: 'Jonas Petraitis' })
    expect(holderText(card({ location: 'UNKNOWN', open_assignment: open }))).toEqual({ main: 'Unknown', sub: 'Last held by Jonas Petraitis' })
  })
})

describe('Add SIM Card', () => {
  it('needs the SIM No., provider, inventory number and received date now; the rest can wait (§4)', () => {
    const { errors, input } = checkSimDraft(emptySimDraft('2026-10-09'), '2026-10-09')
    expect(input).toBeUndefined()
    expect(Object.keys(errors).sort()).toEqual(['inventoryNo', 'provider', 'simNo'])
  })
  it('keeps the SIM number as typed, leading zeros included', () => {
    const d = { ...emptySimDraft('2026-10-09'), simNo: ' 0089 3700 ', provider: 'Telia', inventoryNo: 'SIM-000001', value: '25,00' }
    const { errors, input } = checkSimDraft(d, '2026-10-09')
    expect(errors).toEqual({})
    expect(input).toEqual({
      inventory_no: 'SIM-000001', sim_no: '0089 3700', phone_no: null, provider: 'Telia', plan: null,
      non_return_value_cents: 2500, received_date: '2026-10-09', comment: '',
    })
    expect(newSimInput(input!, 'ACTIVE')).toMatchObject({ kind: 'SIM', connection_status: 'ACTIVE' })
  })
  it('refuses what the API would', () => {
    const d = { ...emptySimDraft('2026-10-09'), simNo: '12-34', phoneNo: 'call me', provider: 'T', inventoryNo: 'X', value: 'abc', receivedDate: '2026-10-10' }
    expect(Object.keys(checkSimDraft(d, '2026-10-09').errors).sort()).toEqual(['phoneNo', 'receivedDate', 'simNo', 'value'])
  })
  it('Edit starts from the card', () => {
    const d = simDraftOf(card({ phone_no: '+370 612 40118', non_return_value_cents: 2500, connection_status: 'ACTIVE', comment: 'Spare' }))
    expect(d).toMatchObject({ simNo: '0089370011', phoneNo: '+370 612 40118', value: '25.00', status: 'ACTIVE', receivedDate: '2026-10-01', comment: 'Spare' })
  })
})

describe('default provider', () => {
  it('fills in a new card', () => {
    expect(emptySimDraft('2026-10-09', 'Telia').provider).toBe('Telia')
    expect(emptySimDraft('2026-10-09').provider).toBe('')
  })

  it('is ticked for the default provider only', () => {
    expect(isDefaultProvider(' Telia ', 'Telia')).toBe(true)
    expect(isDefaultProvider('Bitė', 'Telia')).toBe(false)
    expect(isDefaultProvider('', null)).toBe(false)
  })

  it('changes only when the choice differs from the default', () => {
    expect(defaultProviderChange(' Bitė ', true, 'Telia')).toBe('Bitė')
    expect(defaultProviderChange('Telia', true, null)).toBe('Telia')
    expect(defaultProviderChange('Telia', true, 'Telia')).toBeUndefined()
    expect(defaultProviderChange('  ', true, 'Telia')).toBeUndefined()
    expect(defaultProviderChange('Telia', false, 'Telia')).toBe('')
    expect(defaultProviderChange('Bitė', false, 'Telia')).toBeUndefined()
    expect(defaultProviderChange('Bitė', false, null)).toBeUndefined()
  })
})

describe('today', () => {
  it('is the organisation’s calendar day', () => {
    expect(todayIn('Europe/Vilnius', new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-10')
    expect(todayIn('UTC', new Date('2026-10-09T22:30:00Z'))).toBe('2026-10-09')
  })
})

describe('dates', () => {
  it('reads a calendar date without moving it to another day', () => {
    expect(formatDay('2026-03-02')).toMatch(/2 Mar 2026|Mar 2, 2026/)
  })
})

describe('the action a card calls for', () => {
  const held = { not_returned_at: null } as Asset['open_assignment']
  it('Register SIM Return while held; Give SIM Card when Active in the office; else Change Status', () => {
    expect(primaryAction(card({ open_assignment: held, connection_status: 'BLOCKED' }))).toBe('return')
    expect(primaryAction(card({ connection_status: 'ACTIVE' }))).toBe('give')
    expect(primaryAction(card({ connection_status: 'NOT_ACTIVATED' }))).toBe('status')
    expect(primaryAction(card({ connection_status: 'BLOCKED' }))).toBe('status')
  })
  it('Mark as Not Returned once, only while held', () => {
    expect(canMarkNotReturned(card({ open_assignment: held }))).toBe(true)
    expect(canMarkNotReturned(card({ open_assignment: { not_returned_at: '2026-10-09T08:00:00Z' } as Asset['open_assignment'] }))).toBe(false)
    expect(canMarkNotReturned(card({}))).toBe(false)
  })
})

describe('Give SIM Card', () => {
  const today = '2026-10-09'
  const ready = card({ connection_status: 'ACTIVE', phone_no: '+370 612 40118', plan: 'Biz 10 GB', non_return_value_cents: 2500 })
  const chosen = { ...emptyGiveDraft(today), employeeId: 'e1', employeeName: 'Jonas Petraitis' }
  it('says the first reason it cannot be given yet, ending at the signed paper (§6)', () => {
    expect(giveBlock(card({ connection_status: 'NOT_ACTIVATED' }), chosen, today, null, false)).toMatch(/not activated/)
    expect(giveBlock(card({ connection_status: 'BLOCKED' }), chosen, today, null, false)).toMatch(/blocked/)
    expect(giveBlock({ ...ready, open_assignment: { not_returned_at: null } as Asset['open_assignment'] }, chosen, today, null, false)).toMatch(/already holds it/)
    expect(giveBlock({ ...ready, phone_no: null }, chosen, today, null, false)).toMatch(/phone number/)
    expect(giveBlock(ready, emptyGiveDraft(today), today, null, false)).toBe('Choose the employee.')
    expect(giveBlock(ready, { ...chosen, givenDate: '2026-10-10' }, today, null, false)).toMatch(/later than today/)
    // The plan is optional: a card without one goes on to the value and the paper.
    expect(giveBlock({ ...ready, plan: null }, chosen, today, null, false)).toMatch(/Print the form/)
    expect(giveBlock({ ...ready, non_return_value_cents: null }, chosen, today, null, false)).toBe('Fill in the non-return value: the form needs it.')
    expect(giveBlock(ready, chosen, today, null, false)).toMatch(/Print the form/)
    expect(giveBlock(ready, chosen, today, { key: formKey(chosen) }, false)).toMatch(/Tick Paper Form Signed/)
    expect(giveBlock(ready, chosen, today, { key: formKey(chosen) }, true)).toBeNull()
  })
  it('from the employee, a card is chosen first; a change of card after printing asks for the form again', () => {
    expect(giveBlock(null, chosen, today, null, false)).toBe('Choose a SIM card.')
    const withCard = { ...chosen, assetId: 'a1' }
    expect(giveBlock(ready, { ...withCard, assetId: 'a2' }, today, { key: formKey(withCard) }, true)).toMatch(/Print the form/)
  })
  it('a change after printing asks for the form again (§8)', () => {
    const printed = { key: formKey(chosen) }
    expect(giveBlock(ready, { ...chosen, givenDate: '2026-10-08' }, today, printed, true)).toMatch(/Print the form/)
    expect(giveBlock(ready, { ...chosen, comment: 'Spare charger too' }, today, printed, true)).toBeNull()
  })
  it('sends only the plan and value the card lacks', () => {
    const d = { ...chosen, plan: 'Biz 5 GB', value: '15,00' }
    expect(formInput(ready, d)).toEqual({ employee_id: 'e1', given_date: today })
    expect(formInput({ kind: 'SIM', plan: null, non_return_value_cents: null }, d)).toEqual({ employee_id: 'e1', given_date: today, plan: 'Biz 5 GB', non_return_value_cents: 1500 })
    // Equipment has no plan (it is always null), so a typed one is never sent.
    expect(formInput({ kind: 'EQUIPMENT', plan: null, non_return_value_cents: null }, d)).toEqual({ employee_id: 'e1', given_date: today, non_return_value_cents: 1500 })
  })
})

describe('Prepare Blocking Email', () => {
  it('is the brief’s text with the card’s numbers; the company is left to fill in (§14)', () => {
    const mail = blockingEmail({ phone_no: '+370 612 40118', sim_no: '0089370011' })
    expect(mail.subject).toBe('SIM blocking request - +370 612 40118')
    expect(mail.body).toContain('Phone number: +370 612 40118\nSIM number: 0089370011\nCompany: [Company Name]')
    expect(mail.body).toMatch(/^Hello,/)
    expect(mail.body).toMatch(/Thank you\.$/)
  })
})

describe('⌘K', () => {
  it('looks numbers up among the cards, not names', () => {
    for (const q of ['612 40', '+370 612', '0089370011', 'SIM-000001', 'sim 1']) expect(looksLikeAssetNumber(q), q).toBe(true)
    for (const q of ['Ona', 'we4', '12', 'gloves']) expect(looksLikeAssetNumber(q), q).toBe(false)
  })
})

describe('Equipment & Furniture', () => {
  const today = '2026-10-09'
  const chosen = { ...emptyGiveDraft(today), assetId: 'a1', employeeId: 'e1', employeeName: 'Jonas Petraitis' }
  const laptop = card({ kind: 'EQUIPMENT', category: 'COMPUTER', name: 'Laptop', sim_no: null, provider: null, connection_status: null, received_date: null, needs_form: true })
  const desk = { ...laptop, category: 'FURNITURE' as const, name: 'Desk', needs_form: false }
  it('in the office it can always be given: no connection status', () => {
    expect(primaryAction(laptop)).toBe('give')
    expect(primaryAction({ ...laptop, open_assignment: { not_returned_at: null } as Asset['open_assignment'] })).toBe('return')
  })
  it('a computer needs its value and the signed form; a desk needs neither (open decision 6)', () => {
    expect(giveBlock(laptop, chosen, today, null, false)).toBe('Fill in the non-return value: the form needs it.')
    expect(giveBlock({ ...laptop, non_return_value_cents: 90000 }, chosen, today, null, false)).toMatch(/Print the form/)
    expect(giveBlock(desk, chosen, today, null, false)).toBeNull()
    expect(giveBlock(null, chosen, today, null, false, 'EQUIPMENT')).toBe('Choose an item.')
  })
  it('Add Asset needs a name, a category and a number (§15)', () => {
    expect(Object.keys(checkEquipmentDraft(emptyEquipmentDraft()).errors).sort()).toEqual(['category', 'inventoryNo', 'name'])
    const { input } = checkEquipmentDraft({ ...emptyEquipmentDraft(), name: ' Laptop ', category: 'COMPUTER', inventoryNo: 'PC-000001', value: '900' })
    expect(input).toEqual({ category: 'COMPUTER', inventory_no: 'PC-000001', name: 'Laptop', serial_no: null, non_return_value_cents: 90000, comment: '' })
  })
})

describe('signed copies', () => {
  it('checks a chosen file before sending it: not empty, at most 10 MB, a PDF, JPEG or PNG', () => {
    expect(signedCopyProblem({ name: 'scan.pdf', size: 1000, type: 'application/pdf' })).toBeNull()
    expect(signedCopyProblem({ name: 'IMG_0012.JPG', size: 3_000_000, type: '' })).toBeNull()
    expect(signedCopyProblem({ name: 'photo.png', size: MAX_SIGNED_COPY_BYTES, type: 'image/png' })).toBeNull()
    expect(signedCopyProblem({ name: 'scan.pdf', size: 0, type: 'application/pdf' })).toBe(t.assets.fileEmpty)
    expect(signedCopyProblem({ name: 'scan.pdf', size: MAX_SIGNED_COPY_BYTES + 1, type: 'application/pdf' })).toBe(t.assets.fileTooLarge)
    expect(signedCopyProblem({ name: 'IMG_0012.HEIC', size: 2000, type: 'image/heic' })).toBe(t.assets.fileType)
    expect(signedCopyProblem({ name: 'form.docx', size: 2000, type: '' })).toBe(t.assets.fileType)
  })

  it('says whether a holding on a form has its signed copy, and nothing for one without a form', () => {
    expect(documentsText({ paper_form_signed: true, signed_copy_uploaded: false })).toBe(t.assets.signedCopyMissing)
    expect(documentsText({ paper_form_signed: true, signed_copy_uploaded: true })).toBe(t.assets.signedCopyUploaded)
    expect(documentsText({ paper_form_signed: false, signed_copy_uploaded: false })).toBeNull()
    expect(documentsText(null)).toBeNull()
  })

  it('filters the register to the holdings whose signed copy is missing, counted as a filter', () => {
    const f = { ...noAssetFilters, signedCopyMissing: true }
    expect(assetQuery('SIM', f, 'inventory', 'asc', 1)).toMatchObject({ signed_copy: 'missing' })
    expect(assetQuery('SIM', noAssetFilters, 'inventory', 'asc', 1)).not.toHaveProperty('signed_copy')
    expect(filterCount(f)).toBe(1)
  })

  it('says why the API refused an upload in the user\'s words', () => {
    expect(uploadRefusal(415)).toBe(t.assets.fileType)
    expect(uploadRefusal(413)).toBe(t.assets.fileTooLarge)
    expect(uploadRefusal(503)).toBe(t.assets.noStorage)
    expect(uploadRefusal(500)).toBeNull()
  })
})
