import { AUDIT_EVENTS } from '@ppe/api-client'
import { applyLanguage } from '@ppe/i18n'
import { afterEach, describe, expect, it } from 'vitest'

import { auditChanges, auditTitle, deviceText, sourceLabel } from './describe.ts'

afterEach(() => applyLanguage('en'))

describe('auditTitle', () => {
  it('names every event the API records, and shows an unknown one as stored', () => {
    for (const e of AUDIT_EVENTS) expect(auditTitle(e)).not.toBe(e)
    expect(auditTitle('catalogue.price_changed')).toBe('Price changed')
    expect(auditTitle('employee.hired')).toBe('employee.hired')
  })
})

describe('auditChanges', () => {
  it('shows prices as euros and periods in months, leaving out what did not change', () => {
    const changes = auditChanges({
      before: { purchase_price_cents: 3510, accounting_price_cents: 4200, currency: 'EUR', service_period_months: 12 },
      after: { purchase_price_cents: 3800, accounting_price_cents: 4550, currency: 'EUR', service_period_months: 12 },
    })
    expect(changes).toEqual([
      { key: 'accounting_price_cents', label: 'Price', before: '€42.00', after: '€45.50' },
      { key: 'purchase_price_cents', label: 'Purchase price', before: '€35.10', after: '€38.00' },
    ])
  })

  it('reads the accounting price stored before the purchase price existed', () => {
    expect(auditChanges({ before: { unit_price_cents: 1000 }, after: { unit_price_cents: 1200 } })).toEqual([
      { key: 'accounting_price_cents', label: 'Price', before: '€10.00', after: '€12.00' },
    ])
  })

  it('shows what a record was created with', () => {
    expect(auditChanges({ before: null, after: { height_cm: 180, clothing_size: 54, shoe_size: null } })).toEqual([
      { key: 'height_cm', label: 'Height', before: null, after: '180 cm' },
      { key: 'clothing_size', label: 'Clothing size', before: null, after: '54' },
    ])
  })

  it('says notes changed without their text, and hides ids', () => {
    expect(auditChanges({ before: { last_name: 'B' }, after: { last_name: 'Jonaitė', notes_changed: true, employee_id: 'x' } })).toEqual([
      { key: 'last_name', label: 'Last name', before: 'B', after: 'Jonaitė' },
      { key: 'notes_changed', label: 'Notes', before: null, after: 'Changed' },
    ])
  })

  it('names roles and permissions when it can, else counts them', () => {
    const entry = { before: { role_ids: ['a'] }, after: { role_ids: ['a', 'b'] } }
    expect(auditChanges(entry)[0]).toMatchObject({ before: '1 role', after: '2 roles' })
    const names: Record<string, string> = { a: 'Manager', b: 'Storekeeper' }
    expect(auditChanges(entry, { roleName: (id) => names[id] })[0]).toMatchObject({ before: 'Manager', after: 'Manager, Storekeeper' })
  })

  it('writes values in the language in use', () => {
    applyLanguage('lt')
    expect(auditChanges({ before: { service_period_months: 12, size_group: 'NONE' }, after: { service_period_months: 6, size_group: 'SHOES' } })).toEqual([
      { key: 'size_group', label: 'Dydžių grupė', before: 'Be dydžio', after: 'Avalynė' },
      { key: 'service_period_months', label: 'Naudojimo laikotarpis', before: '12 mėnesių', after: '6 mėnesiai' },
    ])
    expect(auditChanges({ before: { preferred_language: null }, after: { preferred_language: 'ru' } })[0]?.after).toBe('rusų')
  })

  it('shows a field it does not know as stored', () => {
    expect(auditChanges({ before: null, after: { colour: 'blue' } })).toEqual([{ key: 'colour', label: 'colour', before: null, after: 'blue' }])
  })
})

describe('sourceLabel and deviceText', () => {
  it('names where a change was made, and the browser it was made in', () => {
    expect(sourceLabel('public_link')).toBe('Confirmation link')
    expect(sourceLabel(null)).toBe('Not recorded')
    expect(deviceText('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe('Chrome on Windows')
  })
})
