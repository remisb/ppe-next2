import type { ListedOrder } from '@ppe/api-client'
import { type ExportColumn, exportEuros, exportMoment } from '@ppe/ui/lib/table-export'

import { t } from '@/i18n'

/**
 * The columns Orders' Export offers, in the file's order; the list's own start
 * ticked. Moments in the organisation's timezone, the total in euros.
 */
export function orderExportColumns(timeZone: string | undefined): ExportColumn<ListedOrder>[] {
  const cols = t.history.exportColumns
  return [
    { key: 'record', label: t.history.colRecord, value: (o) => o.record_number, shown: true },
    { key: 'employee', label: t.history.colEmployee, value: (o) => `${o.employee_first_name} ${o.employee_last_name}`.trim(), shown: true },
    { key: 'employee_code', label: t.employees.employeeCode, value: (o) => o.employee_code },
    { key: 'status', label: t.history.colStatus, value: (o) => (o.status === 'GIVEN' ? t.common.given : t.common.ordered), shown: true },
    { key: 'ordered_at', label: cols.orderedAt, value: (o) => exportMoment(o.ordered_at, timeZone), shown: true },
    { key: 'given_at', label: cols.givenAt, value: (o) => exportMoment(o.given_at, timeZone), shown: true },
    { key: 'prepared_by', label: cols.preparedBy, value: (o) => o.prepared_by_name },
    { key: 'given_by', label: cols.givenBy, value: (o) => o.given_by_name },
    { key: 'confirmation', label: cols.confirmation, value: (o) => (o.confirmation_method ? t.history.confirmedHow[o.confirmation_method] : null) },
    { key: 'items', label: cols.items, value: (o) => o.lines.reduce((n, l) => n + l.quantity, 0) },
    { key: 'total', label: t.history.colTotal, value: (o) => exportEuros(o.total_cents), shown: true },
    { key: 'usage_months', label: cols.usageMonths, value: (o) => o.usage_months },
  ]
}
