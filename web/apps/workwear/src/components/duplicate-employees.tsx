import type { Employee, EmployeeMatch, EmployeeMatchKind, Sizes } from '@ppe/api-client'
import { Button } from '@ppe/ui/components/button'
import { TriangleAlert } from 'lucide-react'

import { EmployeeAvatar } from '@/components/employee-photo'
import { t } from '@/i18n'
import { employeeFacts } from '@/lib/records'
import { clothingBands } from '@/lib/utils'

export const matchKindLabel = (kind: EmployeeMatchKind) => (kind === 'same_name' ? t.employees.duplicates.sameName : t.employees.duplicates.similarName)

/** An employee already here, as Add New Employee's warning and Merge Employees show them: avatar, name, how alike, facts. */
export function EmployeeCard({
  employee,
  kind,
  sizes,
  action,
}: {
  employee: Employee
  kind?: EmployeeMatchKind | undefined
  sizes: Sizes | undefined
  action?: { label: string; onClick: () => void } | undefined
}) {
  const facts = employeeFacts(employee, clothingBands(sizes?.clothing ?? []))
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2 text-card-foreground">
      <EmployeeAvatar employee={employee} />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{employee.full_name}</p>
        <p className="text-xs text-muted-foreground">{[kind ? matchKindLabel(kind) : null, facts].filter(Boolean).join(' · ')}</p>
      </div>
      {action ? (
        <Button type="button" size="sm" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </li>
  )
}

/**
 * Add New Employee's warning: employees whose names are like the one typed, or
 * who already have the code, each with Use This Employee when the screen can
 * use one instead (Employees opens them, Create Order selects them).
 */
export function DuplicateWarning({
  matches,
  codeOwner,
  sizes,
  onUse,
}: {
  matches: EmployeeMatch[]
  codeOwner: Employee | undefined
  sizes: Sizes | undefined
  onUse: ((e: Employee) => void) | undefined
}) {
  const shown = codeOwner ? matches.filter((m) => m.employee.id !== codeOwner.id) : matches
  if (shown.length === 0 && !codeOwner) return null
  const use = (e: Employee) => (onUse ? { label: t.employees.duplicates.useThis, onClick: () => onUse(e) } : undefined)
  return (
    <section role="status" aria-live="polite" className="grid gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm sm:col-span-2">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
        {t.employees.duplicates.mayExist}
      </p>
      <p className="text-muted-foreground">{t.employees.duplicates.mayExistHint}</p>
      {codeOwner ? (
        <>
          <p>{t.employees.duplicates.codeOwner}</p>
          <ul className="grid gap-2">
            <EmployeeCard employee={codeOwner} sizes={sizes} action={use(codeOwner)} />
          </ul>
        </>
      ) : null}
      {shown.length > 0 ? (
        <ul className="grid gap-2">
          {shown.map((m) => (
            <EmployeeCard key={m.employee.id} employee={m.employee} kind={m.kind} sizes={sizes} action={use(m.employee)} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
