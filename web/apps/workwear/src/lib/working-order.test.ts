import type { ResolvedEmployee, ResolvedLine } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import {
  acceptResolvedSize,
  addLines,
  clearDraft,
  differsFromSaved,
  draftLineCount,
  applySavedDefault,
  emptyOrder,
  lineFromCatalogue,
  loadDraft,
  reassign,
  removeLine,
  saveDraft,
  setManualSize,
  setQuantity,
  toMarkAsOrderedInput,
  totalCents,
  validate,
  type WorkingOrder,
} from './working-order'
import { clothingBands } from './utils'

function line(id: string, over: Partial<ResolvedLine> = {}): ResolvedLine {
  return {
    catalogue_item_id: id,
    item_name: id,
    item_details: '',
    size_group: 'NONE',
    size: null,
    size_suggested: false,
    size_missing: false,
    quantity: 1,
    accounting_price_cents: 1000,
    currency: 'EUR',
    service_period_months: 12,
    price_missing: false,
    unavailable: false,
    ...over,
  }
}

const ona: ResolvedEmployee = {
  id: 'e1', first_name: 'Ona', last_name: 'K', full_name: 'Ona K',
  code: null, height_cm: null, clothing_size: null, shoe_size: null,
}
const jonas: ResolvedEmployee = { ...ona, id: 'e2', first_name: 'Jonas', full_name: 'Jonas P', shoe_size: '44' }

describe('addLines', () => {
  it('keeps one line per item and sums quantities', () => {
    let o = addLines({ employee: ona, lines: [] }, [line('gloves', { quantity: 2 })])
    o = addLines(o, [line('gloves', { quantity: 3 }), line('helmet')])
    expect(o.lines.map((l) => [l.catalogueItemId, l.quantity])).toEqual([['gloves', 5], ['helmet', 1]])
  })

  it('keeps an existing manual size when the item is added again', () => {
    let o = addLines({ employee: ona, lines: [] }, [line('shoes', { size_group: 'SHOES', size_missing: true })])
    o = setManualSize(o, 'shoes', '41')
    o = addLines(o, [line('shoes', { size_group: 'SHOES', size_missing: true })])
    expect(o.lines[0]).toMatchObject({ size: '41', sizeSource: 'manual', quantity: 2 })
  })

  it('records the size source', () => {
    const o = addLines(emptyOrder, [
      line('a', { size_group: 'CLOTHING', size: '50', size_suggested: true }),
      line('b', { size_group: 'SHOES', size: '42' }),
    ])
    expect(o.lines.map((l) => l.sizeSource)).toEqual(['suggested', 'saved'])
  })
})

describe('reassign', () => {
  const shoes = (size: string | null) => line('shoes', { size_group: 'SHOES', size, size_missing: size === null })

  it('reports a manual size that differs from the new resolution', () => {
    const o = setManualSize(addLines({ employee: ona, lines: [] }, [shoes(null)]), 'shoes', '41')
    const { order, conflicts } = reassign(o, jonas, [shoes('44')])
    expect(order.employee).toBe(jonas)
    expect(order.lines[0]).toMatchObject({ size: '41', sizeSource: 'manual' })
    expect(conflicts).toEqual([
      { catalogueItemId: 'shoes', itemName: 'shoes', manualSize: '41', resolvedSize: '44', resolvedSource: 'saved' },
    ])
    expect(acceptResolvedSize(order, conflicts[0]!).lines[0]).toMatchObject({ size: '44', sizeSource: 'saved' })
  })

  it('does not report a manual size equal to the new resolution', () => {
    const o = setManualSize(addLines({ employee: ona, lines: [] }, [shoes(null)]), 'shoes', '44')
    expect(reassign(o, jonas, [shoes('44')]).conflicts).toEqual([])
  })

  it('takes resolved sizes for lines that were not set by hand', () => {
    const o = addLines({ employee: ona, lines: [] }, [line('jacket', { size_group: 'CLOTHING', size: '50' })])
    const { order, conflicts } = reassign(o, jonas, [line('jacket', { size_group: 'CLOTHING', size: '58' })])
    expect(conflicts).toEqual([])
    expect(order.lines[0]!.size).toBe('58')
  })
})

describe('differsFromSaved', () => {
  const bands = clothingBands(
    [44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66].map((n, i) => ({
      code: String(n),
      band: ['S', 'M', 'L', 'XL', '2XL', '3XL'][Math.floor(i / 2)]!,
      min_cm: null,
      max_cm: null,
    })),
  )
  const saved = { ...ona, clothing_size: 48, shoe_size: '42' }

  it('asks when the employee has no saved size for the group', () => {
    expect(differsFromSaved({ ...ona, shoe_size: null }, 'SHOES', '42', bands)).toBe(true)
    expect(differsFromSaved({ ...ona, clothing_size: null }, 'CLOTHING', '50', bands)).toBe(true)
  })

  it('asks when the size differs from the saved one', () => {
    expect(differsFromSaved(saved, 'SHOES', '43', bands)).toBe(true)
    expect(differsFromSaved(saved, 'CLOTHING', '54', bands)).toBe(true)
  })

  it('does not ask for the saved size, or another size of its clothing band', () => {
    expect(differsFromSaved(saved, 'SHOES', '42', bands)).toBe(false)
    expect(differsFromSaved(saved, 'CLOTHING', '48', bands)).toBe(false)
    expect(differsFromSaved(saved, 'CLOTHING', '50', bands)).toBe(false)
  })

  it('does not ask for a cleared size or a no-size item', () => {
    expect(differsFromSaved({ ...ona, shoe_size: null }, 'SHOES', null, bands)).toBe(false)
    expect(differsFromSaved(ona, 'NONE', '42', bands)).toBe(false)
  })
})

describe('applySavedDefault', () => {
  it('fills every missing size of the group', () => {
    let o = addLines({ employee: ona, lines: [] }, [
      line('shoes', { size_group: 'SHOES', size_missing: true }),
      line('boots', { size_group: 'SHOES', size_missing: true }),
      line('jacket', { size_group: 'CLOTHING', size_missing: true }),
    ])
    o = setManualSize(o, 'shoes', '42')
    o = applySavedDefault(o, { ...ona, shoe_size: '42' }, 'SHOES', '42')
    expect(o.lines.map((l) => [l.size, l.sizeSource])).toEqual([
      ['42', 'saved'],
      ['42', 'saved'],
      [null, 'none'],
    ])
    expect(o.employee?.shoe_size).toBe('42')
  })

  it('keeps the clothing default as a number and the line size as its code', () => {
    let o = addLines({ employee: ona, lines: [] }, [
      line('jacket', { size_group: 'CLOTHING', size_missing: true }),
      line('boots', { size_group: 'SHOES', size_missing: true }),
    ])
    o = setManualSize(o, 'jacket', '44')
    o = applySavedDefault(o, { ...ona, clothing_size: 44 }, 'CLOTHING', '44')
    expect(o.lines.map((l) => [l.size, l.sizeSource])).toEqual([
      ['44', 'saved'],
      [null, 'none'],
    ])
    expect(o.employee?.clothing_size).toBe(44)
  })
})

describe('validate', () => {
  it('requires an employee and a line', () => {
    const v = validate(emptyOrder)
    expect(v.valid).toBe(false)
    expect(v.orderProblems).toHaveLength(2)
  })

  it('reports per-line problems and keeps other lines', () => {
    let o: WorkingOrder = addLines({ employee: ona, lines: [] }, [
      line('ok'),
      line('shoes', { size_group: 'SHOES', size_missing: true }),
      line('draft', { accounting_price_cents: null, price_missing: true }),
      line('gone', { unavailable: true }),
    ])
    o = setQuantity(o, 'ok', 1.5)
    const v = validate(o)
    expect(v.valid).toBe(false)
    expect([...v.lineProblems.keys()]).toEqual(['ok', 'shoes', 'draft', 'gone'])
    expect(v.lineProblems.get('shoes')).toEqual(['Select a size.'])
    expect(o.lines).toHaveLength(4)
  })

  it('accepts a complete order', () => {
    const o = addLines({ employee: ona, lines: [] }, [line('a', { quantity: 2 }), line('b', { size_group: 'CLOTHING', size: '54' })])
    expect(validate(o).valid).toBe(true)
    expect(totalCents(o)).toBe(3000)
    expect(validate(removeLine(o, 'a')).valid).toBe(true)
  })
})

describe('draft persistence', () => {
  const memory = () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage
    return { store, storage }
  }

  it('round-trips per user and clears when empty', () => {
    const { store, storage } = memory()
    const { storage: none } = memory()
    const o = addLines({ employee: ona, lines: [] }, [line('a')])
    saveDraft(o, 'u1', storage)
    expect(loadDraft('u1', storage, none)).toEqual(o)
    // Another user on the same device starts empty.
    expect(loadDraft('u2', storage, none)).toEqual(emptyOrder)
    saveDraft(emptyOrder, 'u1', storage)
    expect(store.size).toBe(0)
    storage.setItem('workwear.createOrder.v3.u1', '{broken')
    expect(loadDraft('u1', storage, none)).toEqual(emptyOrder)
  })

  it('clears one user\'s draft', () => {
    const { storage } = memory()
    saveDraft(addLines(emptyOrder, [line('a')]), 'u1', storage)
    saveDraft(addLines(emptyOrder, [line('b')]), 'u2', storage)
    clearDraft('u1', storage)
    expect(loadDraft('u1', storage, memory().storage)).toEqual(emptyOrder)
    expect(loadDraft('u2', storage, memory().storage).lines).toHaveLength(1)
  })

  it('counts the lines of a user\'s draft without changing storage', () => {
    const { store, storage } = memory()
    expect(draftLineCount('u1', storage)).toBe(0)
    saveDraft(addLines({ employee: ona, lines: [] }, [line('a'), line('b')]), 'u1', storage)
    storage.setItem('workwear.createOrder.v2.u1', '{}')
    expect(draftLineCount('u1', storage)).toBe(2)
    expect(draftLineCount('u2', storage)).toBe(0)
    expect(store.size).toBe(2)
    storage.setItem('workwear.createOrder.v3.u1', '{broken')
    expect(draftLineCount('u1', storage)).toBe(0)
  })

  it('reads the accounting price of a draft saved before items had two prices', () => {
    const { storage } = memory()
    const o = addLines({ employee: ona, lines: [] }, [line('a')])
    const old = { ...o, lines: o.lines.map(({ accountingPriceCents, ...l }) => ({ ...l, unitPriceCents: accountingPriceCents })) }
    storage.setItem('workwear.createOrder.v3.u1', JSON.stringify(old))
    expect(loadDraft('u1', storage, memory().storage)).toEqual(o)
  })

  it('drops drafts saved before clothing sizes became numbers', () => {
    const { store, storage } = memory()
    const { store: tab, storage: legacy } = memory()
    const o = addLines({ employee: { ...ona, shoe_size: '42' }, lines: [] }, [line('jacket', { size_group: 'CLOTHING', size: 'M' })])
    storage.setItem('workwear.createOrder.v2.u1', JSON.stringify(o))
    legacy.setItem('workwear.createOrder.v1', JSON.stringify(o))
    expect(loadDraft('u1', storage, legacy)).toEqual(emptyOrder)
    expect(store.size).toBe(0)
    expect(tab.size).toBe(0)
  })
})

describe('lineFromCatalogue', () => {
  it('builds an unresolved line from catalogue data', () => {
    const l = lineFromCatalogue({
      id: 'i', name: 'Safety shoes', details: 'S3', size_group: 'SHOES', purchase_price_cents: null, accounting_price_cents: null, currency: 'EUR',
      service_period_months: 12, active: true, display_rank: 1, icon: 'shoes', created_at: '', updated_at: '',
    })
    expect(l).toMatchObject({ size: null, size_missing: true, price_missing: true, unavailable: false, quantity: 1 })
    const o = addLines(emptyOrder, [l])
    expect(o.lines[0]!.sizeSource).toBe('none')
  })
})

describe('toMarkAsOrderedInput', () => {
  it('sends only items, quantities and sizes', () => {
    let o = addLines({ employee: ona, lines: [] }, [line('shoes', { size_group: 'SHOES', size_missing: true }), line('gloves', { quantity: 3 })])
    o = setManualSize(o, 'shoes', '41')
    expect(toMarkAsOrderedInput(o)).toEqual({
      employee_id: 'e1',
      lines: [
        { catalogue_item_id: 'shoes', quantity: 1, size: '41' },
        { catalogue_item_id: 'gloves', quantity: 3, size: null },
      ],
    })
  })
  it('refuses an order without an employee', () => {
    expect(() => toMarkAsOrderedInput(emptyOrder)).toThrow()
  })
})
