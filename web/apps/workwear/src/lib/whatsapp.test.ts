import type { Order } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { formatWhatsApp, localDate, messageFromOrder, messageFromWorkingOrder, recordMessage, whatsappUrl } from './whatsapp'
import type { WorkingOrder } from './working-order'

describe('formatWhatsApp', () => {
  it('lists employee, lines with sizes when applicable, preparer and date', () => {
    const text = formatWhatsApp({
      recordNumber: 'WE-000042',
      employeeName: 'Jonas Petraitis',
      employeeCode: 'W-17',
      preparedBy: 'Admin',
      date: '2026-09-24',
      lines: [
        { itemName: 'Safety shoes', itemDetails: 'S3 model', size: '43', quantity: 1 },
        { itemName: 'Protective gloves', itemDetails: '', size: null, quantity: 10 },
      ],
    })
    expect(text).toBe(
      [
        'Workwear order WE-000042',
        'Employee: Jonas Petraitis (W-17)',
        '',
        '1. Safety shoes – S3 model – size 43 – qty 1',
        '2. Protective gloves – qty 10',
        '',
        'Prepared by: Admin',
        'Date: 2026-09-24',
      ].join('\n'),
    )
  })

  it('omits the record number and code when absent', () => {
    const text = formatWhatsApp({ employeeName: 'Ona K', employeeCode: null, preparedBy: 'A', date: '2026-01-02', lines: [] })
    expect(text.split('\n').slice(0, 2)).toEqual(['Workwear order', 'Employee: Ona K'])
  })

  it('never includes prices or a status', () => {
    const o: Order = {
      id: 'o', record_number: 'WE-000001', employee_id: 'e', employee_first_name: 'Ona', employee_last_name: 'K',
      employee_code: null, status: 'ORDERED', ordered_at: '2026-09-24T09:00:00Z', prepared_by_user_id: 'u',
      prepared_by_name: 'Admin', given_at: null, given_by_user_id: null, given_by_name: null, confirmation_method: null,
      updated_at: '', total_cents: 4999,
      lines: [{ id: 'l', line_no: 1, catalogue_item_id: 'i', item_name: 'Safety shoes', item_details: '', size_group: 'SHOES',
        size: '40', quantity: 1, unit_price_cents: 4999, currency: 'EUR', service_period_months: 12 }],
    }
    const text = formatWhatsApp(messageFromOrder(o))
    expect(text).toContain('Workwear order WE-000001')
    expect(text).toContain('size 40')
    expect(text).not.toMatch(/€|49\.99|ORDERED|GIVEN|sent|delivered/i)
  })
})

describe('messages', () => {
  it('builds from a working order', () => {
    const o: WorkingOrder = {
      employee: { id: 'e', first_name: 'Ona', last_name: 'K', full_name: 'Ona K', code: 'X', height_cm: null, clothing_size: null, shoe_size: null },
      lines: [{ catalogueItemId: 'i', itemName: 'Helmet', itemDetails: '', sizeGroup: 'NONE', size: null, sizeSource: 'none',
        quantity: 2, unitPriceCents: 100, servicePeriodMonths: 12, priceMissing: false, unavailable: false }],
    }
    const m = messageFromWorkingOrder(o, 'Admin', new Date(2026, 8, 4))
    expect(m).toMatchObject({ employeeName: 'Ona K', employeeCode: 'X', date: '2026-09-04' })
    expect(m.recordNumber).toBeUndefined()
    expect(m.lines).toEqual([{ itemName: 'Helmet', itemDetails: '', size: null, quantity: 2 }])
  })

  it('encodes the text into a wa.me link', () => {
    expect(whatsappUrl('a b\nc&d')).toBe('https://wa.me/?text=a%20b%0Ac%26d')
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('recordMessage', () => {
  it('shares a GIVEN record from its locked receipt', () => {
    const text = formatWhatsApp(recordMessage({
      receipt: {
        record_number: 'WE-000007', employee_first_name: 'Ona', employee_last_name: 'K', employee_code: null,
        ordered_at: '2026-09-01T09:00:00Z', prepared_by_name: 'Admin', total_cents: 500, currency: 'EUR', text_version: 'v',
        confirmation_title_en: '', confirmation_text_en: '', confirmation_title_ru: '', confirmation_text_ru: '',
        lines: [{ line_no: 1, item_name: 'Gloves', item_details: '', size: null, quantity: 2, unit_price_cents: 250, total_cents: 500, currency: 'EUR', service_period_months: 1 }],
      },
      document_hash: 'h', status: 'GIVEN', given_at: '2026-09-20T09:00:00Z', given_by_name: 'Admin', confirmation_method: 'PAPER', confirmation: null,
    }))
    expect(text).toContain('Workwear order WE-000007')
    expect(text).toContain('1. Gloves – qty 2')
    expect(text).toContain('Date: 2026-09-20')
  })
})
