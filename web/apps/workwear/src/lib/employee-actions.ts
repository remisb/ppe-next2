/**
 * The record actions of an employee and of a catalogue item, as their action
 * bars and ⋯ show them (record-actions.md §6).
 */
import type { RecordAction } from '@ppe/ui/lib/record-actions'

import { t } from '@/i18n'

/** New order with its words; Edit details a tool; Merge with… and Delete employee… in ⋯, each by permission. */
export function employeeActions(
  can: { editDetails: boolean; merge: boolean; remove: boolean },
  run: { newOrder: () => void; editDetails: () => void; merge: () => void; remove: () => void },
): RecordAction[] {
  return [
    { id: 'newOrder', label: t.employees.newOrder, icon: 'add', place: 'main', run: run.newOrder },
    ...(can.editDetails ? [{ id: 'editDetails', label: t.employees.editDetails, icon: 'edit', place: 'tool', run: run.editDetails } as const] : []),
    ...(can.merge ? [{ id: 'merge', label: t.employees.merge.action, place: 'menu', asks: true, run: run.merge } as const] : []),
    ...(can.remove ? [{ id: 'delete', label: t.employees.deleteEmployee, place: 'menu', destructive: true, asks: true, run: run.remove } as const] : []),
  ]
}

/** Edit with its words; Deactivate item… (or Activate item) in ⋯. For whoever manages the catalogue. */
export function itemActions(item: { active: boolean }, run: { edit: () => void; toggle: () => void }): RecordAction[] {
  return [
    { id: 'edit', label: t.common.edit, icon: 'edit', place: 'main', run: run.edit },
    item.active
      ? { id: 'deactivate', label: t.catalogue.deactivateItem, place: 'menu', destructive: true, asks: true, run: run.toggle }
      : { id: 'activate', label: t.catalogue.activateItem, place: 'menu', run: run.toggle },
  ]
}
