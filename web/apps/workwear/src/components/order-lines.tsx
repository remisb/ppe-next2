import type { Order } from '@ppe/api-client'

import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatEuro, formatMonths, formatSize } from '@/lib/utils'

/** A stored order's snapshot lines. Never reads live catalogue data. */
export function OrderLinesTable({ order }: { order: Order }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Size</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead>Service period</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {order.lines.map((l) => (
          <TableRow key={l.id}>
            <TableCell>
              <div className="font-medium">{l.item_name}</div>
              {l.item_details ? <div className="text-xs text-muted-foreground">{l.item_details}</div> : null}
            </TableCell>
            <TableCell>{formatSize(l.size)}</TableCell>
            <TableCell className="text-right">{l.quantity}</TableCell>
            <TableCell className="text-right">{formatEuro(l.unit_price_cents)}</TableCell>
            <TableCell>{formatMonths(l.service_period_months)}</TableCell>
            <TableCell className="text-right">{formatEuro(l.unit_price_cents * l.quantity)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={5} className="text-right font-medium">
            Total value
          </TableCell>
          <TableCell className="text-right font-semibold">{formatEuro(order.total_cents)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
