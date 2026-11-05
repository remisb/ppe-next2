import { ApiError } from '@ppe/api-client'

import { t } from '@/i18n'

/** An MRZ problem in words, with its field's name when it has one. */
export function issueText(i: { code: string; field?: string | undefined }): string {
  const text = (t.problems as Record<string, string>)[i.code] ?? i.code
  return i.field ? `${(t.fieldNames as Record<string, string>)[i.field] ?? i.field}: ${text}` : text
}

/** An MRZ note in words; a correction names its field. */
export function noteText(i: { code: string; field?: string | undefined }): string {
  const text = (t.notes as Record<string, string>)[i.code] ?? i.code
  return i.code === 'corrected' && i.field ? `${(t.fieldNames as Record<string, string>)[i.field] ?? i.field}: ${text}` : text
}

/** Save's refusals in words; other errors keep ActionError's own. */
export function saveErrorText(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  if (error.conflict === 'document_on_file') return t.errors.conflictDocument
  if (error.conflict === 'other_employee') return t.errors.conflictEmployee
  if (error.status === 503) return t.errors.notConfigured
  if (error.problems?.[0]) return issueText(error.problems[0])
  return undefined
}
