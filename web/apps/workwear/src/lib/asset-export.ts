import type { Asset, AssetKind, AssetPage, AssetQuery } from '@ppe/api-client'
import { type ExportColumn, exportEuros, exportMoment } from '@ppe/ui/lib/table-export'

import { t } from '@/i18n'
import { categoryLabel, documentsText, locationText, statusLabel } from '@/lib/assets'

/** Who holds it, or held it last while its whereabouts are unknown: the open assignment's employee. */
const holder = (a: Asset) => a.open_assignment?.employee_name ?? null
const given = (a: Asset) => a.open_assignment?.given_date ?? null
/** The day it was marked Not Returned, in the organisation's timezone. */
const notReturned = (timeZone: string | undefined) => (a: Asset) => exportMoment(a.open_assignment?.not_returned_at, timeZone, false)

/**
 * SIM Cards' Export columns, in the file's order; the register's own start
 * ticked. Only what the register shows a reader of SIM cards: never the PIN
 * or PUK, which are shown one card at a time and recorded.
 */
export function simExportColumns(timeZone?: string): ExportColumn<Asset>[] {
  return [
    { key: 'inventory', label: t.assets.colInventoryNo, value: (a) => a.inventory_no },
    { key: 'phone', label: t.assets.phoneNo, value: (a) => a.phone_no, shown: true },
    { key: 'sim', label: t.assets.simNo, value: (a) => a.sim_no, shown: true },
    { key: 'employee', label: t.assets.employee, value: holder, shown: true },
    { key: 'location', label: t.assets.location, value: (a) => locationText(a) },
    { key: 'provider', label: t.assets.provider, value: (a) => a.provider, shown: true },
    { key: 'plan', label: t.assets.plan, value: (a) => a.plan, shown: true },
    { key: 'status', label: t.assets.colStatus, value: (a) => (a.connection_status ? statusLabel(a.connection_status) : null), shown: true },
    { key: 'given', label: t.assets.colGiven, value: given, shown: true },
    { key: 'documents', label: t.assets.colDocuments, value: (a) => documentsText(a.open_assignment), shown: true },
    { key: 'not_returned', label: t.assets.exportColumns.notReturnedOn, value: notReturned(timeZone) },
    { key: 'received', label: t.assets.receivedDate, value: (a) => a.received_date },
    { key: 'value', label: t.assets.nonReturnValue, value: (a) => exportEuros(a.non_return_value_cents) },
    { key: 'comment', label: t.assets.comment, value: (a) => a.comment || null, shown: true },
  ]
}

/** Equipment's Export columns, in the file's order; the register's own start ticked. */
export function equipmentExportColumns(timeZone?: string): ExportColumn<Asset>[] {
  return [
    { key: 'inventory', label: t.assets.colInventoryNo, value: (a) => a.inventory_no, shown: true },
    { key: 'name', label: t.assets.name, value: (a) => a.name, shown: true },
    { key: 'category', label: t.assets.category, value: (a) => (a.category ? categoryLabel(a.category) : null), shown: true },
    { key: 'serial', label: t.assets.colSerialNo, value: (a) => a.serial_no, shown: true },
    { key: 'employee', label: t.assets.employee, value: holder, shown: true },
    { key: 'location', label: t.assets.location, value: (a) => locationText(a), shown: true },
    { key: 'given', label: t.assets.colGiven, value: given, shown: true },
    { key: 'documents', label: t.assets.colDocuments, value: (a) => documentsText(a.open_assignment), shown: true },
    { key: 'not_returned', label: t.assets.exportColumns.notReturnedOn, value: notReturned(timeZone) },
    { key: 'value', label: t.assets.nonReturnValue, value: (a) => exportEuros(a.non_return_value_cents) },
    { key: 'comment', label: t.assets.comment, value: (a) => a.comment || null, shown: true },
  ]
}

export function assetExportColumns(kind: AssetKind, timeZone?: string): ExportColumn<Asset>[] {
  return kind === 'SIM' ? simExportColumns(timeZone) : equipmentExportColumns(timeZone)
}

/** Page size when fetching every page for Export: the API's largest (100), so a big register takes few requests. */
export const EXPORT_PAGE_SIZE = 100

/**
 * Every asset the register's query matches, in its sort: its first page, then
 * the rest at once. `query` is the screen's (its page and page size are replaced).
 */
export async function loadAllAssets(list: (q: AssetQuery) => Promise<AssetPage>, query: AssetQuery, pageSize = EXPORT_PAGE_SIZE): Promise<Asset[]> {
  const first = await list({ ...query, page: 1, page_size: pageSize })
  const pages = Math.ceil(first.total / pageSize)
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, n) => list({ ...query, page: n + 2, page_size: pageSize })))
  return [first, ...rest].flatMap((p) => p.assets)
}

