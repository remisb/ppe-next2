/**
 * The employee page's Identity section's rules (ADR 0007, D11, FR-15, FR-19;
 * docs/specs/personnel-service.md): which documents it lists to whom, how a
 * document's validity reads, and how long a shown document stays shown.
 * Nothing here holds a sealed value: those come only from Show Document.
 */
import type { DocumentCopySide, DocumentValidity, IdentityDocument } from '@ppe/api-client'

/** A shown document hides again after a minute, or once the tab is in the background (FR-14). */
export const SHOWN_MS = 60_000

/** Whether a document's expiry date has passed, today (ISO) being the organisation's. */
export function expired(expiresOn: string, today: string): boolean {
  return expiresOn < today
}

/** The validity lines everyone may see: each current document's kind, state and expiry, the soonest first. */
export function validityLines(v: readonly DocumentValidity[], today: string): (DocumentValidity & { expired: boolean })[] {
  return [...v].sort((a, b) => a.expires_on.localeCompare(b.expires_on)).map((d) => ({ ...d, expired: expired(d.expires_on, today) }))
}

/**
 * The documents the section lists (D11): to whoever manages them, every one;
 * to whoever only reads them, those a scan added to the employee record.
 * Current ones first, as the API sends them.
 */
export function visibleDocuments(docs: readonly IdentityDocument[], canManage: boolean): IdentityDocument[] {
  return docs.filter((d) => canManage || d.on_employee_record)
}

/** The copies in the order a document is turned over: page, front, back, then the portrait. */
export function copiesInOrder(copies: readonly DocumentCopySide[]): DocumentCopySide[] {
  const order: DocumentCopySide[] = ['page', 'front', 'back', 'portrait']
  return order.filter((s) => copies.includes(s))
}
