import type { Client, ListedOrder, OrderStatus, SizeGroup } from '@ppe/api-client'

/** One order line as it appears on an employee's page, with the order it belongs to. */
export interface EmployeeItem {
  key: string
  orderId: string
  catalogueItemId: string
  recordNumber: string
  status: OrderStatus
  /** given_at for GIVEN, ordered_at for ORDERED. */
  at: string
  itemName: string
  itemDetails: string
  sizeGroup: SizeGroup
  /** As stored on the line: a clothing size may be a letter from before EU numbers. */
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
        catalogueItemId: l.catalogue_item_id,
        recordNumber: o.record_number,
        status: o.status,
        at,
        itemName: l.item_name,
        itemDetails: l.item_details,
        sizeGroup: l.size_group,
        size: l.size,
        quantity: l.quantity,
        servicePeriodMonths: l.service_period_months,
        usageMonths: o.usage_months,
      })
    }
  }
  return { given, ordered }
}

/** Every stored order of one employee; History pages hold at most 100. */
export async function loadEmployeeOrders(client: Client, employeeId: string): Promise<ListedOrder[]> {
  const orders: ListedOrder[] = []
  for (let page = 1; ; page++) {
    const res = await client.orders.list({ employee_id: employeeId, page, page_size: 100 })
    orders.push(...res.orders)
    if (res.orders.length === 0 || orders.length >= res.total) return orders
  }
}

/** A replacement counts as due soon this many days ahead, as on the dashboards. */
export const DUE_SOON_DAYS = 30

/** When an item given on a line is due for replacement, and whether it already is. */
export interface Due {
  /** The GIVEN line this is about: the latest one for its catalogue item. */
  item: EmployeeItem
  dueAt: Date
  /** Due now or earlier. */
  overdue: boolean
  /** Due within DUE_SOON_DAYS, overdue included. */
  dueSoon: boolean
  /** How much of the service period has passed, 0 to 1 (1 once due). */
  used: number
  /** The item is on an ORDERED order for the employee already: a replacement is on its way. */
  reordered: boolean
}

/**
 * iso plus months, as Postgres adds an interval: a day the target month lacks
 * becomes its last day (31 January + 1 month is 28 or 29 February).
 */
export function addMonths(iso: string, months: number): Date {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + months
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()))
}

/**
 * The replacement due for each item given to the employee, by the same rule as
 * the dashboards: the latest GIVEN line per catalogue item, due at its given
 * date plus its service period; an item already on an ORDERED order for them
 * is marked reordered. Soonest due first.
 */
export function replacementsDue(orders: readonly ListedOrder[], now: Date): Due[] {
  const { given, ordered } = employeeItems(orders)
  const onOrder = new Set(ordered.map((i) => i.catalogueItemId))
  const latest = new Map<string, EmployeeItem>()
  for (const i of given) {
    const cur = latest.get(i.catalogueItemId)
    if (!cur || i.at > cur.at) latest.set(i.catalogueItemId, i)
  }
  const soon = now.getTime() + DUE_SOON_DAYS * 86_400_000
  return [...latest.values()]
    .map((item) => {
      const dueAt = addMonths(item.at, item.servicePeriodMonths)
      const start = new Date(item.at).getTime()
      const span = dueAt.getTime() - start
      return {
        item,
        dueAt,
        overdue: dueAt.getTime() <= now.getTime(),
        dueSoon: dueAt.getTime() < soon,
        used: span > 0 ? Math.min(1, Math.max(0, (now.getTime() - start) / span)) : 1,
        reordered: onOrder.has(item.catalogueItemId),
      }
    })
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
}
