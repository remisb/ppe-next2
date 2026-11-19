import type { Employee } from '@ppe/api-client'
import type { ExportColumn } from '@ppe/ui/lib/table-export'

import { languages, t } from '@/i18n'

/**
 * The columns Employees' Export offers, in the file's order: only those the
 * reader may see (sizes need See employee sizes; the code, language, notes and
 * identity details See employee profiles, which the API blanks without).
 * The screen's own columns start ticked.
 */
export function employeeExportColumns(can: { sizes: boolean; profile: boolean }): ExportColumn<Employee>[] {
  const columns: (ExportColumn<Employee> & { needs?: 'sizes' | 'profile' })[] = [
    { key: 'name', label: t.employees.name, value: (e) => e.full_name, shown: true },
    { key: 'first_name', label: t.employees.firstName, value: (e) => e.first_name },
    { key: 'last_name', label: t.employees.lastName, value: (e) => e.last_name },
    { key: 'code', label: t.employees.code, value: (e) => e.code, shown: true, needs: 'profile' },
    { key: 'height', label: t.employees.heightLabel, value: (e) => e.height_cm, shown: true, needs: 'sizes' },
    // The EU number as saved (46), so a spreadsheet sorts and counts it; the screen's "S (44–46)" is a label of it.
    { key: 'clothing', label: t.employees.clothingSize, value: (e) => e.clothing_size, shown: true, needs: 'sizes' },
    { key: 'shoes', label: t.employees.shoeSize, value: (e) => shoeSize(e.shoe_size), shown: true, needs: 'sizes' },
    { key: 'language', label: t.employees.preferredLanguage, value: (e) => languages.find((l) => l.value === e.preferred_language)?.label ?? null, needs: 'profile' },
    { key: 'notes', label: t.employees.notes, value: (e) => e.notes || null, needs: 'profile' },
    { key: 'birth_date', label: t.employees.exportColumns.birthDate, value: (e) => e.birth_date, needs: 'profile' },
    { key: 'nationality', label: t.employees.exportColumns.nationality, value: (e) => e.nationality, needs: 'profile' },
    { key: 'sex', label: t.employees.exportColumns.sex, value: (e) => e.sex, needs: 'profile' },
    { key: 'added', label: t.employees.exportColumns.added, value: (e) => e.created_at.slice(0, 10) },
  ]
  return columns.filter((c) => !c.needs || can[c.needs]).map(({ needs: _, ...c }) => c)
}

/** A shoe size is a number where it is one (42, 42.5), else as saved. */
function shoeSize(code: string | null): string | number | null {
  if (code === null || code === '') return null
  const n = Number(code)
  return Number.isFinite(n) ? n : code
}
