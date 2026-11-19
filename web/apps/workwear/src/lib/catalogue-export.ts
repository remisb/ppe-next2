import type { CatalogueItem, SizeGroup } from '@ppe/api-client'
import { type ExportColumn, exportEuros, exportMoment } from '@ppe/ui/lib/table-export'

import { t } from '@/i18n'
import { itemStatus } from '@/lib/records'

/** A size group's name in the language in use (as the screen's sizeGroupLabel). */
function sizeGroupName(group: SizeGroup): string {
  return group === 'CLOTHING' ? t.catalogue.clothing : group === 'SHOES' ? t.catalogue.shoes : t.catalogue.noSize
}

function statusName(i: CatalogueItem): string {
  const s = itemStatus(i)
  return s === 'active' ? t.catalogue.statusActive : s === 'incomplete' ? t.catalogue.statusIncomplete : t.catalogue.statusInactive
}

/**
 * The columns Item Catalogue's Export offers, in the file's order. Everyone who
 * opens the catalogue reads every field of an item (its pane shows the purchase
 * price too), so none is held back; the list's own columns start ticked. Prices
 * are euros, the service period months, as numbers.
 */
export function catalogueExportColumns(timeZone?: string): ExportColumn<CatalogueItem>[] {
  return [
    { key: 'name', label: t.catalogue.colItem, value: (i) => i.name, shown: true },
    { key: 'details', label: t.catalogue.colDetails, value: (i) => i.details || null, shown: true },
    { key: 'size_group', label: t.catalogue.sizeGroup, value: (i) => sizeGroupName(i.size_group), shown: true },
    { key: 'supplier', label: t.catalogue.supplier, value: (i) => i.supplier_name },
    { key: 'purchase_price', label: t.catalogue.purchasePriceEuro, value: (i) => exportEuros(i.purchase_price_cents) },
    { key: 'price', label: t.catalogue.accountingPriceEuro, value: (i) => exportEuros(i.accounting_price_cents), shown: true },
    { key: 'service_period', label: t.catalogue.servicePeriodMonths, value: (i) => i.service_period_months, shown: true },
    { key: 'status', label: t.catalogue.colStatus, value: statusName, shown: true },
    { key: 'display_order', label: t.catalogue.displayOrder, value: (i) => i.display_rank },
    { key: 'added', label: t.catalogue.added, value: (i) => exportMoment(i.created_at, timeZone, false) },
  ]
}
