/**
 * Copy for WhatsApp (algorithm E): plain text for the supplier, built from the
 * current working order or a stored ORDERED snapshot. Copying or opening
 * WhatsApp never changes an order's status and never implies delivery.
 */
import type { Order, OrderRecord } from '@ppe/api-client'

import type { WorkingOrder } from './working-order'

export interface WhatsAppLine {
  itemName: string
  itemDetails: string
  size: string | null
  quantity: number
}

export interface WhatsAppMessage {
  recordNumber?: string | undefined
  employeeName: string
  employeeCode: string | null
  preparedBy: string
  /** YYYY-MM-DD. */
  date: string
  lines: WhatsAppLine[]
}

export function formatWhatsApp(m: WhatsAppMessage): string {
  const out = [m.recordNumber ? `Workwear order ${m.recordNumber}` : 'Workwear order']
  out.push(`Employee: ${m.employeeName}${m.employeeCode ? ` (${m.employeeCode})` : ''}`)
  out.push('')
  m.lines.forEach((l, i) => {
    const parts = [l.itemName]
    if (l.itemDetails) parts.push(l.itemDetails)
    if (l.size) parts.push(`size ${l.size}`)
    parts.push(`qty ${l.quantity}`)
    out.push(`${i + 1}. ${parts.join(' – ')}`)
  })
  out.push('')
  out.push(`Prepared by: ${m.preparedBy}`)
  out.push(`Date: ${m.date}`)
  return out.join('\n')
}

/** A local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function messageFromWorkingOrder(o: WorkingOrder, preparedBy: string, now: Date): WhatsAppMessage {
  return {
    employeeName: o.employee?.full_name ?? '',
    employeeCode: o.employee?.code ?? null,
    preparedBy,
    date: localDate(now),
    lines: o.lines.map((l) => ({ itemName: l.itemName, itemDetails: l.itemDetails, size: l.size, quantity: l.quantity })),
  }
}

export function messageFromOrder(o: Order): WhatsAppMessage {
  return {
    recordNumber: o.record_number,
    employeeName: `${o.employee_first_name} ${o.employee_last_name}`,
    employeeCode: o.employee_code,
    preparedBy: o.prepared_by_name,
    date: localDate(new Date(o.ordered_at)),
    lines: o.lines.map((l) => ({ itemName: l.item_name, itemDetails: l.item_details, size: l.size, quantity: l.quantity })),
  }
}

/** A wa.me link that opens WhatsApp with the text prefilled and no recipient chosen. */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** Share via WhatsApp for a GIVEN record, from its locked receipt. */
export function recordMessage(r: OrderRecord): WhatsAppMessage {
  const rc = r.receipt
  return {
    recordNumber: rc.record_number,
    employeeName: `${rc.employee_first_name} ${rc.employee_last_name}`,
    employeeCode: rc.employee_code,
    preparedBy: rc.prepared_by_name,
    date: localDate(new Date(r.given_at ?? rc.ordered_at)),
    lines: rc.lines.map((l) => ({ itemName: l.item_name, itemDetails: l.item_details, size: l.size, quantity: l.quantity })),
  }
}
