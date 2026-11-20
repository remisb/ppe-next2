/**
 * An asset's actions as its action bar and ⋯ show them (record-actions.md §6):
 * the one action its state calls for with its words (Give SIM, Give Asset,
 * Return), Show PIN and PUK and Print Form as tools, the rest in ⋯ with Mark
 * as Not Returned last.
 */
import type { Asset } from '@ppe/api-client'
import type { RecordAction } from '@ppe/ui/lib/record-actions'

import { t } from '@/i18n'
import { canMarkNotReturned, primaryAction } from '@/lib/assets'

export interface AssetRunners {
  give: () => void
  return: () => void
  edit: () => void
  printForm: () => void
  notReturned: () => void
  activationEmail: () => void
  blockingEmail: () => void
}

export function assetActions(
  a: Pick<Asset, 'kind' | 'open_assignment' | 'connection_status'>,
  {
    manage,
    codes,
    printing = false,
  }: {
    /** Manage SIMs, or Manage Equipment & Furniture, for the asset's kind. */
    manage: boolean
    /** Show PIN and PUK, for whoever sees SIM cards (useSimCodes). */
    codes?: RecordAction | null | undefined
    /** Print Form is building the form. */
    printing?: boolean | undefined
  },
  run: AssetRunners,
): RecordAction[] {
  const sim = a.kind === 'SIM'
  const held = a.open_assignment
  const status = a.connection_status
  const actions: RecordAction[] = []
  if (manage) {
    const primary = primaryAction(a)
    // Give has no icon in the vocabulary: it keeps its words at every width.
    if (primary === 'give') actions.push({ id: 'give', label: sim ? t.assets.giveSimCard : t.assets.giveAsset, place: 'main', run: run.give })
    if (primary === 'return') {
      actions.push({ id: 'return', label: t.assets.takeBack, icon: 'return', place: 'main', help: t.assets.takeBackHelp[sim ? 'SIM' : 'EQUIPMENT'], run: run.return })
    }
  }
  if (codes) actions.push(codes)
  if (manage) {
    // The holder's form again; for a SIM held since the import, one built now.
    if (held && (held.paper_form_signed || sim)) actions.push({ id: 'printForm', label: t.assets.printForm, icon: 'print', place: 'tool', pending: printing, run: run.printForm })
    actions.push({ id: 'edit', label: t.common.edit, icon: 'edit', place: 'menu', run: run.edit })
    if (status && status !== 'ACTIVE') actions.push({ id: 'activationEmail', label: t.assets.prepareActivationEmail, icon: 'email', place: 'menu', run: run.activationEmail })
    if (status && status !== 'BLOCKED') actions.push({ id: 'blockingEmail', label: t.assets.prepareBlockingEmail, icon: 'email', place: 'menu', run: run.blockingEmail })
    if (canMarkNotReturned(a)) actions.push({ id: 'notReturned', label: t.assets.markNotReturned, place: 'menu', asks: true, run: run.notReturned })
  }
  return actions
}
