import { ApiError, type Client, type DocumentCopies, type DocumentTake, type IdentityDocument } from '@ppe/api-client'
import { documentCopy } from '@ppe/id-docs/copies'
import { todayHere } from '@ppe/id-docs/reader'

import { t } from '@/i18n'

import { COPY_PART, parseDraft, saveInputOf, type Target } from './flow'
import type { Session } from './sessions'

/**
 * Saves the scan's document (POST /api/v1/personnel/documents): its pages as Document Copies,
 * drawn again without the camera's metadata, and the kept scan named, which the API then
 * links to the document in the same transaction.
 */
export async function saveDocument(client: Client, scan: Session, target: Target, addToRecord: boolean, take: readonly DocumentTake[]): Promise<IdentityDocument> {
  const m = parseDraft(scan.draft, todayHere())
  if (!m) throw new Error('no MRZ')
  const copies: DocumentCopies = {}
  for (const p of scan.pages) copies[COPY_PART[p.side]] ??= await documentCopy(p.blob)
  return client.personnel.save(saveInputOf(target, scan.draft, m, addToRecord, take, scan.id), copies)
}

/** A refusal the API explains, in words; null for anything else (ActionError says it). */
export function refusalOf(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null
  if (e.status === 409 && e.conflict === 'document_on_file') return t.problems.documentOnFile
  if (e.status === 409 && e.conflict === 'other_employee') return t.problems.otherEmployee
  if (e.status === 404) return t.problems.scanGone
  return null
}
