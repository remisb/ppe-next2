import type { CatalogueItem, ItemSet, ItemSetLine } from '@ppe/api-client'
import { type ExportColumn, exportEuros } from '@ppe/ui/lib/table-export'

import { t } from '@/i18n'

/** One line of one set: Item Sets' file has a row per item in each set, the sets in the screen's order. */
export interface ItemSetExportRow {
  set: ItemSet
  line: ItemSetLine
  /** The catalogue item today; undefined for an item deleted since. */
  item: CatalogueItem | undefined
}

export function itemSetExportRows(sets: readonly ItemSet[], itemsById: ReadonlyMap<string, CatalogueItem>): ItemSetExportRow[] {
  return sets.flatMap((set) => set.lines.map((line) => ({ set, line, item: itemsById.get(line.catalogue_item_id) })))
}

/**
 * The columns Item Sets' Export offers. A set stores no prices: the price and
 * line total are today's catalogue price, as each card's total is.
 */
export function itemSetExportColumns(): ExportColumn<ItemSetExportRow>[] {
  return [
    { key: 'set', label: t.catalogue.exportColumns.itemSet, value: (r) => r.set.name, shown: true },
    { key: 'set_status', label: t.catalogue.exportColumns.setStatus, value: (r) => (r.set.active ? t.catalogue.active : t.catalogue.inactive), shown: true },
    { key: 'set_description', label: t.catalogue.setDescription, value: (r) => r.set.description || null },
    { key: 'item', label: t.catalogue.colItem, value: (r) => r.item?.name ?? t.catalogue.deletedItem, shown: true },
    { key: 'details', label: t.catalogue.colDetails, value: (r) => r.item?.details || null },
    { key: 'quantity', label: t.catalogue.exportColumns.defaultQuantity, value: (r) => r.line.default_quantity, shown: true },
    { key: 'price', label: t.catalogue.accountingPriceEuro, value: (r) => exportEuros(r.item?.accounting_price_cents), shown: true },
    {
      key: 'line_total',
      label: t.catalogue.exportColumns.lineTotal,
      value: (r) => {
        const price = r.item?.accounting_price_cents
        return price === null || price === undefined ? null : exportEuros(price * r.line.default_quantity)
      },
      shown: true,
    },
    { key: 'service_period', label: t.catalogue.servicePeriodMonths, value: (r) => r.item?.service_period_months ?? null },
  ]
}
