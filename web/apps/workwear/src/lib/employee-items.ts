import type { ListedOrder, OrderStatus } from '@ppe/api-client'

/** One order line as it appears on an employee's page, with the order it belongs to. */
export interface EmployeeItem {
  key: string
  orderId: string
  recordNumber: string
  status: OrderStatus
  /** given_at for GIVEN, ordered_at for ORDERED. */
  at: string
  itemName: string
  itemDetails: string
  size: string | null
  quantity: number
  servicePeriodMonths: number
  usageMonths: number | null
}

/**
 * The employee's items from their stored orders (snapshots, never live
 * catalogue rows), split into those given to them and those still ordered.
 * Order stays as the API returns it, newest activity first; lines keep
 * their line order.
 */
export function employeeItems(orders: readonly ListedOrder[]): { given: EmployeeItem[]; ordered: EmployeeItem[] } {
  const given: EmployeeItem[] = []
  const ordered: EmployeeItem[] = []
  for (const o of orders) {
    const at = o.status === 'GIVEN' && o.given_at ? o.given_at : o.ordered_at
    for (const l of [...o.lines].sort((a, b) => a.line_no - b.line_no)) {
      ;(o.status === 'GIVEN' ? given : ordered).push({
        key: l.id,
        orderId: o.id,
        recordNumber: o.record_number,
        status: o.status,
        at,
        itemName: l.item_name,
        itemDetails: l.item_details,
        size: l.size,
        quantity: l.quantity,
        servicePeriodMonths: l.service_period_months,
        usageMonths: o.usage_months,
      })
    }
  }
  return { given, ordered }
}
