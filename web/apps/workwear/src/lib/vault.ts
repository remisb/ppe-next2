/**
 * The Document Vault's rules on screen (ADR 0008, docs/specs/vault-service.md):
 * names of types and links, what a document's links open, whether it is about
 * to expire, and the checks Upload Document…, Edit… and Add Version… make
 * before sending, which the API makes again.
 */
import type { VaultDetails, VaultDocument, VaultLink, VaultLinkRef, VaultSubjectKind, VaultType } from '@ppe/api-client'

import { t } from '@/i18n'
import type { Route } from '@/lib/router'

/** The files Upload Document… offers to choose; the API reads each file's own bytes again. */
export const VAULT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

/** The upload limit unless a type sets a lower one (vault.MaxUploadBytes). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** How many days before its Valid until a document reads as expiring soon. */
export const EXPIRES_SOON_DAYS = 30

/** A type's name in the language in use; one the app does not know shows its key. */
export function typeLabel(key: string): string {
  return t.vault.types[key] ?? key
}

/** The links' names in one line: "Ana Žukauskaitė, EQ-0001 Laptop". */
export function linkLabels(links: readonly Pick<VaultLink, 'label'>[]): string {
  return links.map((l) => l.label).join(', ')
}

/** Where a link opens: an employee's page, an asset's; null for kinds with no screen of their own here. */
export function linkRoute(link: Pick<VaultLink, 'kind' | 'id'>, from?: string): Route | null {
  switch (link.kind) {
    case 'employee':
      return { name: 'employeePage', id: link.id, ...(from ? { from } : {}) }
    case 'asset':
      return { name: 'asset', id: link.id }
  }
  return null
}

/** Whether a document's Valid until has passed or comes within EXPIRES_SOON_DAYS of today (YYYY-MM-DD both). */
export function expiry(validUntil: string | null | undefined, today: string): 'expired' | 'soon' | null {
  if (!validUntil) return null
  if (validUntil < today) return 'expired'
  const soon = new Date(`${today}T00:00:00Z`)
  soon.setUTCDate(soon.getUTCDate() + EXPIRES_SOON_DAYS)
  return validUntil <= soon.toISOString().slice(0, 10) ? 'soon' : null
}

/** Why a chosen file is not sent, or null. The API reads the file's own bytes again. */
export function fileProblem(file: Pick<File, 'name' | 'size' | 'type'>, maxBytes = MAX_UPLOAD_BYTES): string | null {
  if (file.size === 0) return t.vault.fileEmpty
  if (file.size > maxBytes) return t.vault.fileTooLarge
  const known = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name)
  return known ? null : t.vault.fileType
}

/** An upload the API refused, in the user's language; null for any other answer. */
export function uploadRefusal(status: number): string | null {
  switch (status) {
    case 404:
      return t.vault.linkMissing
    case 413:
      return t.vault.fileTooLarge
    case 415:
      return t.vault.fileType
    case 503:
      return t.vault.noStorage
  }
  return null
}

/** A document's editable fields, to start Edit… from. */
export function detailsOf(d: VaultDocument): VaultDetails {
  return {
    title: d.title,
    document_date: d.document_date,
    valid_from: d.valid_from,
    valid_until: d.valid_until,
    links: d.links.filter((l) => !l.locked).map(({ kind, id }) => ({ kind, id })),
  }
}

/** A link chosen in a sheet: the ref, its name and whether the sheet may drop it. */
export interface ChosenLink extends VaultLinkRef {
  label: string
  /** Set by where the sheet was opened (the employee's page) or by the app: not the user's to remove. */
  fixed?: boolean
}

/** Adds a link once; the same subject again changes nothing. */
export function withLink(links: readonly ChosenLink[], link: ChosenLink): ChosenLink[] {
  return links.some((l) => l.kind === link.kind && l.id === link.id) ? [...links] : [...links, link]
}

/** What a sheet's draft lacks, by field; empty when it may be sent. */
export function draftProblems(
  draft: { title: string; valid_from: string | null; valid_until: string | null; links: readonly VaultLinkRef[] },
  type: Pick<VaultType, 'must'> | undefined,
): Partial<Record<'title' | 'valid_until' | 'links', string>> {
  const out: Partial<Record<'title' | 'valid_until' | 'links', string>> = {}
  if (!draft.title.trim()) out.title = t.vault.titleRequired
  if (draft.valid_from && draft.valid_until && draft.valid_until < draft.valid_from) out.valid_until = t.vault.untilBeforeFrom
  const missing = (type?.must ?? []).filter((kind) => !draft.links.some((l) => l.kind === kind))
  if (missing.length > 0) out.links = t.vault.required(missing.map((k) => t.vault.kinds[k]).join(', '))
  return out
}

/**
 * The types Upload Document… offers where it was opened: those the reader may
 * add, whose required links it can make there. The sheet links employees
 * itself; any other required kind must be given by the place (an asset's page).
 */
export function uploadTypes(types: readonly VaultType[], can: (p: string) => boolean, given: readonly VaultSubjectKind[]): VaultType[] {
  return types.filter((ty) => ty.origins.includes('uploaded') && can(ty.manage) && ty.must.every((k) => k === 'employee' || given.includes(k)))
}
