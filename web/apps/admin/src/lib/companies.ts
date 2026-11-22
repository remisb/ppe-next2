import type { Company, CompanyInput } from '@ppe/api-client'

import { t } from '@/i18n'

/**
 * Companies screen rules. The API enforces all of them
 * (internal/domain/company); these mirror it so the form can say what is
 * wrong before a round trip.
 */

/** The form's fields, as typed. */
export type CompanyDraft = CompanyInput

export type CompanyErrors = Partial<Record<keyof CompanyDraft, string>>

/** Every field's longest value, in characters, as the API's. */
export const COMPANY_LIMITS: Record<keyof CompanyDraft, number> = {
  code: 32,
  name: 200,
  company_code: 50,
  vat_code: 50,
  address: 300,
  city: 100,
  postal_code: 20,
  country: 2,
  notes: 2000,
}

/** The form for a company, or an empty one for Add Company. */
export function draftOf(c?: Company): CompanyDraft {
  return {
    code: c?.code ?? '',
    name: c?.name ?? '',
    company_code: c?.company_code ?? '',
    vat_code: c?.vat_code ?? '',
    address: c?.address ?? '',
    city: c?.city ?? '',
    postal_code: c?.postal_code ?? '',
    country: c?.country ?? '',
    notes: c?.notes ?? '',
  }
}

/** What the form sends: every field trimmed, the country in upper case. */
export function toInput(d: CompanyDraft): CompanyInput {
  const out = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim()])) as CompanyInput
  out.country = out.country.toUpperCase()
  return out
}

/** The form's problems by field; none when it may be saved. Only the name is required. */
export function validateCompany(d: CompanyDraft): CompanyErrors {
  const v = toInput(d)
  const errors: CompanyErrors = {}
  if (!v.name) errors.name = t.companies.enterName
  if (v.country && !/^[A-Z]{2}$/.test(v.country)) errors.country = t.companies.invalidCountry
  for (const key of Object.keys(COMPANY_LIMITS) as (keyof CompanyDraft)[]) {
    if (!errors[key] && [...v[key]].length > COMPANY_LIMITS[key]) errors[key] = t.companies.tooLong(COMPANY_LIMITS[key])
  }
  return errors
}

/** Where a company is: its city and country, as far as they are known. */
export function placeOf(c: Pick<Company, 'city' | 'country'>): string {
  return [c.city, c.country].filter(Boolean).join(', ')
}

/** Whether a company matches the search: by code, name, company or VAT code, or city. */
export function matches(c: Company, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [c.code, c.name, c.company_code, c.vat_code, c.city].some((f) => f.toLowerCase().includes(q))
}

/** Why a company cannot be deleted, or undefined when it can: the default, or one employing anyone. */
export function deleteRefusal(c: Pick<Company, 'is_default' | 'employee_count'>): string | undefined {
  if (c.is_default) return t.companies.cannotDeleteDefault
  if (c.employee_count > 0) return t.companies.cannotDeleteEmploying(c.employee_count)
  return undefined
}
