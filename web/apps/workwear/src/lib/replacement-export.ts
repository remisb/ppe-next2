import type { DashboardReplacement } from '@ppe/api-client'
import { type ExportColumn, exportMoment } from '@ppe/ui/lib/table-export'

import { t } from '@/i18n'

/**
 * The columns Replacements due's Export offers: one row per item due, in the
 * screen's order (soonest first). The employee's code takes See employee
 * profiles, as everywhere else.
 */
export function replacementExportColumns(can: { profile: boolean }, timeZone?: string): ExportColumn<DashboardReplacement>[] {
  const columns: (ExportColumn<DashboardReplacement> & { needs?: 'profile' })[] = [
    { key: 'employee', label: t.dashboard.employee, value: (x) => x.employee_name, shown: true },
    { key: 'code', label: t.dashboard.exportColumns.code, value: (x) => x.employee_code, shown: true, needs: 'profile' },
    { key: 'item', label: t.dashboard.item, value: (x) => x.item_name, shown: true },
    { key: 'size', label: t.dashboard.exportColumns.size, value: (x) => x.size, shown: true },
    { key: 'quantity', label: t.dashboard.quantity, value: (x) => x.quantity, shown: true },
    { key: 'status', label: t.dashboard.exportColumns.status, value: (x) => (x.overdue ? t.dashboard.overdue : t.dashboard.dueSoon), shown: true },
    { key: 'due', label: t.dashboard.exportColumns.dueOn, value: (x) => exportMoment(x.due_at, timeZone, false), shown: true },
    { key: 'given', label: t.dashboard.exportColumns.givenOn, value: (x) => exportMoment(x.given_at, timeZone, false), shown: true },
    { key: 'receipt', label: t.dashboard.exportColumns.receipt, value: (x) => x.record_number, shown: true },
  ]
  return columns.filter((c) => !c.needs || can[c.needs]).map(({ needs: _, ...c }) => c)
}
