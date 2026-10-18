import type { Order } from '@ppe/api-client'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { cn } from '@ppe/ui/lib/utils'

import { t } from '@/i18n'
import { formatEuro, formatMonths, formatSize } from '@/lib/utils'

/**
 * Stacked (a narrow table), the lines are a list with a rule between them, no
 * boxes: item and line total, then size, quantity, unit price and service
 * period in one wrapped row; the total value below the last rule.
 */
const fact = 'stacked:order-3 stacked:w-auto stacked:justify-start stacked:gap-1 stacked:text-[0.8125rem]'

/** A stored order's snapshot lines, as a ruled list where the table is narrow. Never reads live catalogue data. */
export function OrderLinesTable({ order }: { order: Order }) {
  return (
    <Table stack="list">
      <TableHeader>
        <TableRow>
          <TableHead>{t.order.item}</TableHead>
          <TableHead>{t.order.size}</TableHead>
          <TableHead className="text-right">{t.order.quantity}</TableHead>
          <TableHead className="text-right">{t.order.accountingPrice}</TableHead>
          <TableHead>{t.order.servicePeriod}</TableHead>
          <TableHead className="text-right">{t.common.total}</TableHead>
        </TableRow>
      </TableHeader>
      {/* No box around the list: a rule above the first line and below each. */}
      <TableBody className="stacked:overflow-visible stacked:rounded-none stacked:border-x-0 stacked:border-b-0 stacked:bg-transparent stacked:[&_tr:last-child]:border-b">
        {order.lines.map((l) => (
          <TableRow key={l.id} className={cn(stackedBreak, 'stacked:gap-x-4 stacked:gap-y-1 stacked:bg-transparent stacked:px-0 stacked:hover:bg-transparent')}>
            <TableCell className="whitespace-normal stacked:order-1 stacked:w-auto stacked:flex-1">
              <div className="font-medium">{l.item_name}</div>
              {l.item_details ? <div className="text-xs text-muted-foreground">{l.item_details}</div> : null}
            </TableCell>
            <TableCell label={t.order.cardSize} className={fact}>{formatSize(l.size)}</TableCell>
            <TableCell label={t.order.cardQty} className={cn('text-right tabular-nums', fact)}>{l.quantity}</TableCell>
            <TableCell label={t.order.cardUnit} className={cn('text-right tabular-nums', fact)}>{formatEuro(l.accounting_price_cents)}</TableCell>
            <TableCell label={t.order.cardService} className={fact}>{formatMonths(l.service_period_months)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums stacked:order-1 stacked:w-auto stacked:self-start">
              {formatEuro(l.accounting_price_cents * l.quantity)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter className="stacked:mt-0">
        <TableRow className="stacked:flex-nowrap stacked:justify-between stacked:border-0 stacked:px-0">
          <TableCell colSpan={5} className="text-right font-medium stacked:w-auto">
            {t.order.totalValue}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums stacked:w-auto">{formatEuro(order.total_cents)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
