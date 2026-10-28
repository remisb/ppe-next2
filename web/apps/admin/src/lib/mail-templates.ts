import type { MailField, MailText } from '@ppe/api-client'

/**
 * Mail Templates' editing rules, as pure functions: a field put where the
 * cursor is, the text as the server saves it, and the fields a template
 * uses. The server (internal/domain/mailtemplate) has the last word.
 */

/** A template's parts, as the editor names its inputs. */
export type MailPart = keyof MailText

/** How a template writes a field. */
export const placeholder = (key: string) => `{{${key}}}`

/**
 * text with the field key put in place of the selection start…end (the
 * cursor when they are equal), and where the cursor goes: just after it.
 */
export function insertField(text: string, key: string, start: number, end = start): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(start, end, text.length))
  const to = Math.min(text.length, Math.max(start, end))
  const field = placeholder(key)
  return { text: text.slice(0, from) + field + text.slice(to), cursor: from + field.length }
}

/** The text as the server saves it: the recipient, Cc and subject trimmed, the body without \r or trailing space. */
export function tidyText(t: MailText): MailText {
  const body = t.body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
  return { to: t.to.trim(), cc: t.cc.trim(), subject: t.subject.trim(), body }
}

/** Whether a and b save as the same text. */
export function sameText(a: MailText, b: MailText): boolean {
  const x = tidyText(a)
  const y = tidyText(b)
  return x.to === y.to && x.cc === y.cc && x.subject === y.subject && x.body === y.body
}

const written = /\{\{\s*([^{}]*?)\s*\}\}/g

/** The fields the text writes, each once, in the order they first appear. */
export function usedFields(t: MailText): string[] {
  const out: string[] = []
  for (const part of [t.to, t.cc, t.subject, t.body]) {
    for (const m of part.matchAll(written)) {
      if (!out.includes(m[1]!)) out.push(m[1]!)
    }
  }
  return out
}

/** The fields the text writes that the template does not have, such as a mistyped {{sim.nubmer}}. */
export function unknownFields(t: MailText, fields: readonly MailField[]): string[] {
  return usedFields(t).filter((k) => !fields.some((f) => f.key === k))
}

export type TextProblem = 'required' | 'oneLine'

/** What keeps each part from being saved, the server's own checks that need no fields; Cc may be empty. */
export function textProblems(t: MailText): Partial<Record<MailPart, TextProblem>> {
  const x = tidyText(t)
  const out: Partial<Record<MailPart, TextProblem>> = {}
  for (const part of ['to', 'cc', 'subject', 'body'] as const) {
    if (x[part] === '' && part !== 'cc') out[part] = 'required'
    else if (part !== 'body' && /[\r\n]/.test(x[part])) out[part] = 'oneLine'
  }
  return out
}
