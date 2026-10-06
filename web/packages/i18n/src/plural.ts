import { intlLocale } from './current.ts'

/**
 * The forms of a counted phrase; `#` stands for the number. English needs
 * one and other; Lithuanian one, few and other (2–9 take few, 10–20 other);
 * Russian one, few, many and other (5–20 take many, other is for fractions).
 * Lithuanian fractions take many (2,5 dienos), falling back to other.
 */
export interface PluralForms {
  one: string
  few?: string
  many?: string
  other: string
}

/** The form for n in the current language, with # replaced by n: "3 days", "3 dienos", "3 дня". */
export function plural(n: number, forms: PluralForms): string {
  const category = new Intl.PluralRules(intlLocale()).select(n) as keyof PluralForms | 'zero' | 'two'
  const form = (category in forms ? forms[category as keyof PluralForms] : undefined) ?? forms.other
  // The number as the language writes it: 2.5 in English, 2,5 in Lithuanian and Russian; never grouped.
  return form.replaceAll('#', new Intl.NumberFormat(intlLocale(), { useGrouping: false, maximumFractionDigits: 2 }).format(n))
}
