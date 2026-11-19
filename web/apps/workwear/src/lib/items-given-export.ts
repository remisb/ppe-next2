import { type ExportColumn, exportMoment } from '@ppe/ui/lib/table-export'

import { t } from '@/i18n'
import type { Due, EmployeeItem } from '@/lib/employee-items'

/**
 * The columns an employee's Items given exports, in the table's order: the
 * receipts' snapshots, as the table shows them. Replacement is the day it is
 * due, or Replaced / Reordered as the table says; usage and service period are
 * months, as numbers.
 */
export function itemsGivenExportColumns(due: ReadonlyMap<string, Due> | undefined, timeZone?: string): ExportColumn<EmployeeItem>[] {
  return [
    { key: 'item', label: t.employees.item, value: (i) => i.itemName, shown: true },
    { key: 'details', label: t.employees.itemsExport.details, value: (i) => i.itemDetails || null },
    { key: 'size', label: t.employees.size, value: (i) => i.size, shown: true },
    { key: 'quantity', label: t.employees.quantity, value: (i) => i.quantity, shown: true },
    { key: 'given', label: t.employees.itemsExport.givenOn, value: (i) => exportMoment(i.at, timeZone), shown: true },
    { key: 'usage', label: t.employees.itemsExport.usageMonths, value: (i) => i.usageMonths, shown: true },
    { key: 'service_period', label: t.employees.itemsExport.servicePeriodMonths, value: (i) => i.servicePeriodMonths, shown: true },
    {
      key: 'replacement',
      label: t.employees.itemsExport.replacementDue,
      value: (i) => {
        const d = due?.get(i.key)
        if (!d) return t.employees.replaced
        if (d.reordered) return t.employees.reordered
        return exportMoment(d.dueAt.toISOString(), timeZone, false)
      },
      shown: true,
    },
    { key: 'receipt', label: t.employees.receipt, value: (i) => i.recordNumber, shown: true },
  ]
}
