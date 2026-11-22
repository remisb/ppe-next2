import type { Supplier, SupplierInput } from '@ppe/api-client'

import { t } from '@/i18n'
import { isEmail } from '@/lib/email'

/**
 * Suppliers screen rules. The API enforces all of them
 * (internal/domain/supplier); these mirror it so the form can say what is
 * wrong before a round trip.
 */

/** The form's fields, as typed. */
export type SupplierDraft = SupplierInput

export type SupplierErrors = Partial<Record<keyof SupplierDraft, string>>

/** Every field's longest value, in characters, as the API's. */
export const SUPPLIER_LIMITS: Record<keyof SupplierDraft, number> = {
  code: 32,
  name: 200,
  company_code: 50,
  vat_code: 50,
  address: 300,
  city: 100,
  postal_code: 20,
  country: 2,
  contact_person: 200,
  email: 254,
  phone: 50,
  website: 300,
  bank_account: 50,
  notes: 2000,
}


/** The form for a supplier, or an empty one for Add Supplier. */
export function draftOf(s?: Supplier): SupplierDraft {
  return {
    code: s?.code ?? '',
    name: s?.name ?? '',
    company_code: s?.company_code ?? '',
    vat_code: s?.vat_code ?? '',
    address: s?.address ?? '',
    city: s?.city ?? '',
    postal_code: s?.postal_code ?? '',
    country: s?.country ?? '',
    contact_person: s?.contact_person ?? '',
    email: s?.email ?? '',
    phone: s?.phone ?? '',
    website: s?.website ?? '',
    bank_account: s?.bank_account ?? '',
    notes: s?.notes ?? '',
  }
}

/** What the form sends: every field trimmed, the country in upper case. */
export function toInput(d: SupplierDraft): SupplierInput {
  const out = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim()])) as SupplierInput
  out.country = out.country.toUpperCase()
  return out
}

/** The form's problems by field; none when it may be saved. */
export function validateSupplier(d: SupplierDraft): SupplierErrors {
  const v = toInput(d)
  const errors: SupplierErrors = {}
  if (!v.code) errors.code = t.suppliers.enterCode
  if (!v.name) errors.name = t.suppliers.enterName
  if (v.country && !/^[A-Z]{2}$/.test(v.country)) errors.country = t.suppliers.invalidCountry
  if (v.email && !isEmail(v.email)) errors.email = t.suppliers.invalidEmail
  for (const key of Object.keys(SUPPLIER_LIMITS) as (keyof SupplierDraft)[]) {
    if (!errors[key] && [...v[key]].length > SUPPLIER_LIMITS[key]) errors[key] = t.suppliers.tooLong(SUPPLIER_LIMITS[key])
  }
  return errors
}

/** Where a supplier is: its city and country, as far as they are known. */
export function placeOf(s: Pick<Supplier, 'city' | 'country'>): string {
  return [s.city, s.country].filter(Boolean).join(', ')
}

/** Whether a supplier matches the search: by code, name, company or VAT code, city, contact or email. */
export function matches(s: Supplier, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [s.code, s.name, s.company_code, s.vat_code, s.city, s.contact_person, s.email].some((f) => f.toLowerCase().includes(q))
}
