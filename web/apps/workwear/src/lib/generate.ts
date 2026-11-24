/**
 * Generate Document…'s rules (ADR 0008 phase 3, docs/specs/document-template-service.md):
 * which employment a document is for, the asked fields' answers, and that
 * Generate makes exactly what was last previewed.
 */
import type { AskedField, Employment, GenerateInput } from '@ppe/api-client'

import { t } from '@/i18n'

/** The employment Generate starts with: the open one, else the latest started; none for a candidate. */
export function defaultEmployment(employments: readonly Employment[] | undefined): string | null {
  const list = employments ?? []
  const open = list.find((e) => e.ended_on === null)
  if (open) return open.id
  const latest = [...list].sort((a, b) => (b.started_on ?? '').localeCompare(a.started_on ?? ''))[0]
  return latest?.id ?? null
}

/** What the asked fields lack, by key: a required one empty, a choice not one of its options. The API checks again. */
export function inputProblems(asked: readonly AskedField[], answers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of asked) {
    const v = (answers[a.key] ?? '').trim()
    if (!v) {
      if (a.required) out[a.key] = t.vault.inputRequired
      continue
    }
    if (a.kind === 'choice' && !(a.options ?? []).includes(v)) out[a.key] = t.vault.inputRequired
    if ((a.kind === 'number' || a.kind === 'money') && Number.isNaN(Number(v.replace(/\s/g, '').replace(',', '.').replace(/€|eur/gi, '')))) {
      out[a.key] = t.vault.inputNumber
    }
  }
  return out
}

/** The request for these choices: only the asked fields' answers, trimmed. */
export function generateInput(
  templateId: string,
  employeeId: string,
  employmentId: string | null,
  asked: readonly AskedField[],
  answers: Readonly<Record<string, string>>,
): GenerateInput {
  const inputs: Record<string, string> = {}
  for (const a of asked) {
    const v = (answers[a.key] ?? '').trim()
    if (v) inputs[a.key] = v
  }
  return { template_id: templateId, employee_id: employeeId, employment_id: employmentId, inputs }
}

/** Whether a preview showed exactly these choices, so Generate may make them. */
export function samePreview(previewed: GenerateInput | null, now: GenerateInput): boolean {
  return previewed !== null && JSON.stringify(previewed) === JSON.stringify(now)
}

/** A PDF the API sent as base64, as a Blob. */
export function pdfBlob(base64: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'application/pdf' })
}
