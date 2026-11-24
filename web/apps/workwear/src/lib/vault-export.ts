import type { VaultHit } from '@ppe/api-client'
import type { ExportColumn } from '@ppe/ui/lib/table-export'

import { t } from '@/i18n'
import { linkLabels, typeLabel } from '@/lib/vault'

/** The columns Document Vault's Export offers: what its list shows, and the rest of a document's facts. */
export function vaultExportColumns(): ExportColumn<VaultHit>[] {
  return [
    { key: 'title', label: t.vault.colTitle, value: (d) => d.title, shown: true },
    { key: 'type', label: t.vault.colType, value: (d) => typeLabel(d.type), shown: true },
    { key: 'number', label: t.vault.number, value: (d) => d.number },
    { key: 'linked', label: t.vault.colLinked, value: (d) => linkLabels(d.links) || null, shown: true },
    { key: 'document_date', label: t.vault.documentDate, value: (d) => d.document_date },
    { key: 'valid_until', label: t.vault.colValidUntil, value: (d) => d.valid_until, shown: true },
    { key: 'origin', label: t.vault.origin, value: (d) => t.vault.origins[d.origin] },
    { key: 'versions', label: t.vault.versions, value: (d) => d.versions },
    { key: 'updated', label: t.vault.colUpdated, value: (d) => d.updated_at.slice(0, 10), shown: true },
  ]
}
