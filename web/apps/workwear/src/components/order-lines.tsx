import type { Order } from '@ppe/api-client'

import { Table, TableBody, stackedBreak, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/i18n'
import { cn, formatEuro, formatMonths, formatSize } from '@/lib/utils'

/**
 * Stacked (a narrow table), a line is a compact card: item and line total, then size,
 * quantity, unit price and service period in one wrapped row.
 */
const fact = 'stacked:order-3 stacked:w-auto stacked:justify-start stacked:gap-1 stacked:text-[0.8125rem]'

/** A stored order's snapshot lines, as cards where the table is narrow. Never reads live catalogue data. */
export function OrderLinesTable({ order }: { order: Order }) {
  return (
    <Table stack="grid">
      <TableHeader>
        <TableRow>
          <TableHead>{t.order.item}</TableHead>
          <TableHead>{t.order.size}</TableHead>
          <TableHead className="text-right">{t.order.quantity}</TableHead>
          <TableHead className="text-right">{t.order.unitPrice}</TableHead>
          <TableHead>{t.order.servicePeriod}</TableHead>
          <TableHead className="text-right">{t.common.total}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {order.lines.map((l) => (
          <TableRow key={l.id} className={stackedBreak}>
            <TableCell className="whitespace-normal stacked:order-1 stacked:w-auto stacked:flex-1">
              <div className="font-medium">{l.item_name}</div>
              {l.item_details ? <div className="text-xs text-muted-foreground">{l.item_details}</div> : null}
            </TableCell>
            <TableCell label={t.order.cardSize} className={fact}>{formatSize(l.size)}</TableCell>
            <TableCell label={t.order.cardQty} className={cn('text-right tabular-nums', fact)}>{l.quantity}</TableCell>
            <TableCell label={t.order.cardUnit} className={cn('text-right tabular-nums', fact)}>{formatEuro(l.unit_price_cents)}</TableCell>
            <TableCell label={t.order.cardService} className={fact}>{formatMonths(l.service_period_months)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums stacked:order-1 stacked:w-auto stacked:self-start">
              {formatEuro(l.unit_price_cents * l.quantity)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow className="stacked:flex-nowrap stacked:justify-between stacked:bg-muted/50">
          <TableCell colSpan={5} className="text-right font-medium stacked:w-auto">
            {t.order.totalValue}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums stacked:w-auto">{formatEuro(order.total_cents)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
