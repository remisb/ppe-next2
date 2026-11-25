/** A document's record actions, as its action bar and ⋯ show them (record-actions.md §6). */
import type { RecordAction } from '@ppe/ui/lib/record-actions'

import { t } from '@/i18n'

/**
 * Download with its words; for whoever may change it, Edit… and Add Version…
 * as tools, and Remove document… in ⋯; Legal Hold… in ⋯ where canHold says. A document the app keeps (locked) is
 * downloaded only.
 */
export function documentActions(
  can: { manage: boolean; locked: boolean; downloading: boolean; hold: boolean },
  run: { download: () => void; edit: () => void; addVersion: () => void; remove: () => void; hold: () => void },
): RecordAction[] {
  const changes = can.manage && !can.locked
  return [
    { id: 'download', label: t.vault.download, icon: 'document', place: 'main', pending: can.downloading, run: run.download },
    ...(changes ? [{ id: 'edit', label: t.vault.edit, icon: 'edit', place: 'tool', asks: true, run: run.edit } as const] : []),
    ...(changes ? [{ id: 'addVersion', label: t.vault.addVersion, icon: 'add', place: 'tool', asks: true, run: run.addVersion } as const] : []),
    ...(can.hold ? [{ id: 'hold', label: t.vault.legalHold, place: 'menu', asks: true, run: run.hold } as const] : []),
    ...(changes ? [{ id: 'remove', label: t.vault.remove, place: 'menu', destructive: true, asks: true, run: run.remove } as const] : []),
  ]
}
