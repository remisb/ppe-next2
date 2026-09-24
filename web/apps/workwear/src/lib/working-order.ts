/**
 * Create Order working state (manual §3.1, §4, algorithm A). Pure functions
 * over an immutable WorkingOrder, so every rule here is unit-tested and the
 * screen only wires events to them. Nothing in this state is stored by the
 * server until Mark as Ordered.
 */
import type { CatalogueItem, MarkAsOrderedInput, ResolvedEmployee, ResolvedLine, SizeGroup } from '@ppe/api-client'

/** Where a line's size came from. 'manual' sizes are never silently overwritten. */
export type SizeSource = 'saved' | 'suggested' | 'manual' | 'none'

export interface WorkingLine {
  catalogueItemId: string
  itemName: string
  itemDetails: string
  sizeGroup: SizeGroup | ''
  size: string | null
  sizeSource: SizeSource
  quantity: number
  unitPriceCents: number | null
  servicePeriodMonths: number | null
  priceMissing: boolean
  unavailable: boolean
}

export interface WorkingOrder {
  employee: ResolvedEmployee | null
  lines: WorkingLine[]
}

export const emptyOrder: WorkingOrder = { employee: null, lines: [] }

export function toWorkingLine(r: ResolvedLine): WorkingLine {
  return {
    catalogueItemId: r.catalogue_item_id,
    itemName: r.item_name,
    itemDetails: r.item_details,
    sizeGroup: r.size_group,
    size: r.size,
    sizeSource: r.size === null ? 'none' : r.size_suggested ? 'suggested' : 'saved',
    quantity: r.quantity,
    unitPriceCents: r.unit_price_cents,
    servicePeriodMonths: r.service_period_months,
    priceMissing: r.price_missing,
    unavailable: r.unavailable,
  }
}

/**
 * A line built from catalogue data alone, for Add Item before an employee is
 * selected. Its size is resolved when Assigned to is set (reassign).
 */
export function lineFromCatalogue(item: CatalogueItem, quantity = 1): ResolvedLine {
  return {
    catalogue_item_id: item.id,
    item_name: item.name,
    item_details: item.details,
    size_group: item.size_group,
    size: null,
    size_suggested: false,
    size_missing: item.size_group !== 'NONE',
    quantity,
    unit_price_cents: item.unit_price_cents,
    currency: item.currency,
    service_period_months: item.service_period_months,
    price_missing: item.unit_price_cents === null || item.service_period_months === null,
    unavailable: !item.active,
  }
}

/** Whether the line's item needs a size and has none. */
export function needsSize(line: WorkingLine): boolean {
  return (line.sizeGroup === 'CLOTHING' || line.sizeGroup === 'SHOES') && line.size === null
}

/**
 * Add Item / Apply Item Set: add resolved lines. One line per catalogue item:
 * an item already on the order has its quantity increased and keeps its size.
 */
export function addLines(order: WorkingOrder, resolved: ResolvedLine[]): WorkingOrder {
  const lines = [...order.lines]
  for (const r of resolved) {
    const i = lines.findIndex((l) => l.catalogueItemId === r.catalogue_item_id)
    if (i >= 0) {
      const cur = lines[i]!
      lines[i] = { ...cur, quantity: cur.quantity + r.quantity }
    } else {
      lines.push(toWorkingLine(r))
    }
  }
  return { ...order, lines }
}

export interface SizeConflict {
  catalogueItemId: string
  itemName: string
  manualSize: string
  resolvedSize: string | null
  resolvedSource: SizeSource
}

/**
 * Assigned to changed: take the new employee and the re-resolved lines.
 * A size the user chose by hand is kept for now and reported as a conflict
 * unless the new employee resolves to the same value; the user then accepts
 * the resolved size or removes the line (manual §4.1).
 */
export function reassign(
  order: WorkingOrder,
  employee: ResolvedEmployee,
  resolved: ResolvedLine[],
): { order: WorkingOrder; conflicts: SizeConflict[] } {
  const conflicts: SizeConflict[] = []
  const lines = resolved.map((r) => {
    const next = toWorkingLine(r)
    const prev = order.lines.find((l) => l.catalogueItemId === r.catalogue_item_id)
    if (prev?.sizeSource === 'manual' && prev.size !== null && prev.size !== next.size) {
      conflicts.push({
        catalogueItemId: next.catalogueItemId,
        itemName: next.itemName,
        manualSize: prev.size,
        resolvedSize: next.size,
        resolvedSource: next.sizeSource,
      })
      return { ...next, size: prev.size, sizeSource: 'manual' as const }
    }
    return next
  })
  return { order: { employee, lines }, conflicts }
}

export function acceptResolvedSize(order: WorkingOrder, conflict: SizeConflict): WorkingOrder {
  return mapLine(order, conflict.catalogueItemId, (l) => ({
    ...l,
    size: conflict.resolvedSize,
    sizeSource: conflict.resolvedSource,
  }))
}

export function removeLine(order: WorkingOrder, catalogueItemId: string): WorkingOrder {
  return { ...order, lines: order.lines.filter((l) => l.catalogueItemId !== catalogueItemId) }
}

/** Quantity as typed; validate() reports anything that is not an integer >= 1. */
export function setQuantity(order: WorkingOrder, catalogueItemId: string, quantity: number): WorkingOrder {
  return mapLine(order, catalogueItemId, (l) => ({ ...l, quantity }))
}

export function setManualSize(order: WorkingOrder, catalogueItemId: string, size: string | null): WorkingOrder {
  return mapLine(order, catalogueItemId, (l) => ({
    ...l,
    size,
    sizeSource: size === null ? 'none' : 'manual',
  }))
}

/**
 * Save as Employee Default accepted: the employee's default for the group is
 * now size. The line that prompted it, and every other line of the same group
 * still missing a size, take it as a saved size. Other manual sizes stay.
 */
export function applySavedDefault(
  order: WorkingOrder,
  employee: ResolvedEmployee,
  group: 'CLOTHING' | 'SHOES',
  size: string,
): WorkingOrder {
  return {
    employee,
    lines: order.lines.map((l) =>
      l.sizeGroup === group && (l.size === null || (l.sizeSource === 'manual' && l.size === size))
        ? { ...l, size, sizeSource: 'saved' as const }
        : l,
    ),
  }
}

export interface Validation {
  valid: boolean
  /** Problems with the order as a whole. */
  orderProblems: string[]
  /** Problems per line, keyed by catalogue item id. */
  lineProblems: Map<string, string[]>
}

export function validate(order: WorkingOrder): Validation {
  const orderProblems: string[] = []
  const lineProblems = new Map<string, string[]>()
  if (!order.employee) orderProblems.push('Select an employee in Assigned to.')
  if (order.lines.length === 0) orderProblems.push('Add at least one item.')
  for (const l of order.lines) {
    const p: string[] = []
    if (l.unavailable) p.push('This item is no longer available. Remove it from the order.')
    if (!Number.isInteger(l.quantity) || l.quantity < 1) p.push('Quantity must be a whole number of at least 1.')
    if (needsSize(l)) p.push('Select a size.')
    if (l.priceMissing && !l.unavailable) {
      p.push('No price or service period in the Item Catalogue. An authorised user must complete it.')
    }
    if (p.length > 0) lineProblems.set(l.catalogueItemId, p)
  }
  return { valid: orderProblems.length === 0 && lineProblems.size === 0, orderProblems, lineProblems }
}

/**
 * The Mark as Ordered request: only employee, items, quantities and sizes.
 * The server re-reads everything else inside its transaction. Call only when
 * validate(order).valid.
 */
export function toMarkAsOrderedInput(order: WorkingOrder): MarkAsOrderedInput {
  if (!order.employee) throw new Error('toMarkAsOrderedInput: no employee')
  return {
    employee_id: order.employee.id,
    lines: order.lines.map((l) => ({
      catalogue_item_id: l.catalogueItemId,
      quantity: l.quantity,
      size: l.sizeGroup === 'NONE' ? null : l.size,
    })),
  }
}

/** Sum of lines with a known price. */
export function totalCents(order: WorkingOrder): number {
  return order.lines.reduce((sum, l) => sum + (l.unitPriceCents ?? 0) * (Number.isInteger(l.quantity) ? l.quantity : 0), 0)
}

function mapLine(order: WorkingOrder, id: string, f: (l: WorkingLine) => WorkingLine): WorkingOrder {
  return { ...order, lines: order.lines.map((l) => (l.catalogueItemId === id ? f(l) : l)) }
}

// The working order survives reloads, validation errors and network errors
// (manual §3.1). sessionStorage: it belongs to this tab's unfinished work.
const DRAFT_KEY = 'workwear.createOrder.v1'

export function saveDraft(order: WorkingOrder, storage: Storage | undefined = globalThis.sessionStorage): void {
  try {
    if (order.employee === null && order.lines.length === 0) storage?.removeItem(DRAFT_KEY)
    else storage?.setItem(DRAFT_KEY, JSON.stringify(order))
  } catch {
    // Storage unavailable (private mode, quota): the order stays in memory.
  }
}

export function loadDraft(storage: Storage | undefined = globalThis.sessionStorage): WorkingOrder {
  try {
    const raw = storage?.getItem(DRAFT_KEY)
    if (!raw) return emptyOrder
    const parsed = JSON.parse(raw) as Partial<WorkingOrder>
    if (!Array.isArray(parsed.lines)) return emptyOrder
    return { employee: parsed.employee ?? null, lines: parsed.lines }
  } catch {
    return emptyOrder
  }
}

export function clearDraft(storage: Storage | undefined = globalThis.sessionStorage): void {
  try {
    storage?.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to clear.
  }
}
