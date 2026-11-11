import type { Employee, EmployeeInput } from '@ppe/api-client'

/** The rows of Merge Employees' review, each choosing whose value the record kept takes. */
export type MergeField = 'name' | 'code' | 'height_cm' | 'clothing_size' | 'shoe_size' | 'preferred_language'

/** Per row, the id of the record whose value is kept. */
export type MergeChoices = Record<MergeField, string>

const FIELDS: MergeField[] = ['name', 'code', 'height_cm', 'clothing_size', 'shoe_size', 'preferred_language']

/** The older record (added first): the one kept unless chosen otherwise. */
export function olderOf(a: Employee, b: Employee): Employee {
  return b.created_at < a.created_at ? b : a
}

function isBlank(e: Employee, f: MergeField): boolean {
  switch (f) {
    case 'name':
      return false
    case 'code':
      return e.code === null
    case 'height_cm':
      return e.height_cm === null
    case 'clothing_size':
      return e.clothing_size === null
    case 'shoe_size':
      return e.shoe_size === null
    case 'preferred_language':
      return e.preferred_language === null
  }
}

/** Each row's first choice: the record kept's value, or the other's where the kept one has none. */
export function mergeDefaults(keep: Employee, remove: Employee): MergeChoices {
  const out = {} as MergeChoices
  for (const f of FIELDS) out[f] = isBlank(keep, f) && !isBlank(remove, f) ? remove.id : keep.id
  return out
}

/** Both records' notes, the kept one's first; one copy when they are the same. */
export function joinedNotes(keep: Employee, remove: Employee): string {
  const a = keep.notes.trim()
  const b = remove.notes.trim()
  if (!b || a === b) return a
  if (!a) return b
  return `${a}\n${b}`
}

/** The record kept, as the choices make it: the body of the merge, as Edit takes it. */
export function mergedInput(keep: Employee, remove: Employee, choices: MergeChoices): EmployeeInput {
  const from = (f: MergeField) => (choices[f] === remove.id ? remove : keep)
  return {
    first_name: from('name').first_name,
    last_name: from('name').last_name,
    code: from('code').code,
    height_cm: from('height_cm').height_cm,
    clothing_size: from('clothing_size').clothing_size,
    shoe_size: from('shoe_size').shoe_size,
    notes: joinedNotes(keep, remove),
    preferred_language: from('preferred_language').preferred_language,
  }
}
