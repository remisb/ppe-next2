import type { Employee, EmployeeInput, EmployeeMatch, EmployeeMergePreview, Sizes } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { ActionError } from '@ppe/ui/components/states'
import { useAction } from '@ppe/ui/lib/use-action'
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useState } from 'react'

import { EmployeeCard } from '@/components/duplicate-employees'
import { EmployeePicker } from '@/components/employee-picker'
import { languages, t } from '@/i18n'
import { mergedInput, mergeDefaults, type MergeField, type MergeChoices, olderOf } from '@/lib/merge-employees'
import { clothingBands, clothingSizeLabel, formatSize } from '@/lib/utils'

/**
 * Merge Employees: one person's two records made one (review first, then ask
 * first). `start` is the employee it was opened from; `other`, when known
 * (the Employees screen's Review), the second record, else picked here.
 * Each row chooses whose value is kept; the record kept is the older one
 * unless chosen otherwise, or the one with identity documents, which cannot
 * be removed.
 */
export function MergeEmployeesSheet({
  start,
  other: initialOther,
  sizes,
  onClose,
  onMerged,
}: {
  start: Employee | null
  other?: Employee | null | undefined
  sizes: Sizes | undefined
  onClose: () => void
  onMerged: (kept: Employee, removed: Employee) => void
}) {
  const { client } = useApi()
  const action = useAction()
  // Its own id: the Employees list and an employee open beside it each hold this sheet.
  const formId = useId()
  const [other, setOther] = useState<Employee | null>(null)
  const [keepId, setKeepId] = useState<string>()
  const [preview, setPreview] = useState<EmployeeMergePreview>()
  const [choices, setChoices] = useState<MergeChoices>()
  const [suggested, setSuggested] = useState<EmployeeMatch[]>([])
  const bands = useMemo(() => clothingBands(sizes?.clothing ?? []), [sizes])

  // Opened: the second record as given, the older of the two kept.
  useEffect(() => {
    setOther(initialOther ?? null)
    setKeepId(start && initialOther ? olderOf(start, initialOther).id : undefined)
    setPreview(undefined)
    setChoices(undefined)
    action.clear()
  }, [start, initialOther])

  // Picking the second record: names like this one's first.
  useEffect(() => {
    if (!start || other) return
    let current = true
    client.employees.similar(start.first_name, start.last_name, start.id).then(
      (ms) => current && setSuggested(ms),
      () => current && setSuggested([]),
    )
    return () => {
      current = false
    }
  }, [start, other, client])

  const pick = (e: Employee) => {
    if (!start) return
    setOther(e)
    setKeepId(olderOf(start, e).id)
  }

  // The review of the pair, from the record kept: what the other one has.
  const removeId = start && other && keepId ? (keepId === start.id ? other.id : start.id) : undefined
  useEffect(() => {
    if (!keepId || !removeId) return
    let current = true
    setPreview(undefined)
    client.employees.mergePreview(keepId, removeId).then(
      (p) => {
        if (!current) return
        // A record with identity documents cannot be the one removed: keep it instead.
        if (p.contents.remove_has_documents && !p.contents.keep_has_documents) {
          setKeepId(removeId)
          return
        }
        setPreview(p)
        setChoices(mergeDefaults(p.keep, p.remove))
      },
      (err: unknown) => current && action.fail(err),
    )
    return () => {
      current = false
    }
  }, [keepId, removeId, client])

  const bothHaveDocuments = preview ? preview.contents.keep_has_documents && preview.contents.remove_has_documents : false
  const keepLocked = preview ? preview.contents.keep_has_documents : false

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!preview || !choices || bothHaveDocuments) return
    const input: EmployeeInput = mergedInput(preview.keep, preview.remove, choices)
    void action.run(
      async () => {
        const kept = await client.employees.merge(preview.keep.id, preview.remove.id, input)
        onMerged(kept, preview.remove)
      },
      { confirm: t.employees.merge.confirm(preview.remove.full_name, `${input.first_name} ${input.last_name}`) },
    )
  }

  // The columns stay in one order, the record it was opened from first, whichever is kept.
  const pair = start && other ? [start, other] : []
  const byId = (id: string) => (preview?.keep.id === id ? preview.keep : preview?.remove.id === id ? preview.remove : undefined)
  const shown = pair.map((e) => byId(e.id) ?? e)

  const value = (e: Employee, f: MergeField): string => {
    switch (f) {
      case 'name':
        return e.full_name
      case 'code':
        return e.code ?? t.employees.merge.none
      case 'height_cm':
        return e.height_cm !== null ? t.employees.heightCm(e.height_cm) : t.employees.merge.none
      case 'clothing_size':
        return e.clothing_size !== null ? clothingSizeLabel(bands, e.clothing_size) : t.employees.merge.none
      case 'shoe_size':
        return e.shoe_size !== null ? formatSize(e.shoe_size) : t.employees.merge.none
      case 'preferred_language':
        return languages.find((l) => l.value === e.preferred_language)?.label ?? t.employees.merge.none
    }
  }
  const rows: { field: MergeField; label: string }[] = [
    { field: 'name', label: t.employees.merge.name },
    { field: 'code', label: t.employees.employeeCode },
    { field: 'height_cm', label: t.employees.height },
    { field: 'clothing_size', label: t.employees.clothing },
    { field: 'shoe_size', label: t.employees.shoes },
    { field: 'preferred_language', label: t.employees.merge.language },
  ]

  const contents = preview?.contents
  const moves = contents
    ? [
        contents.orders.length > 0 ? t.employees.merge.orders(contents.orders.length) : null,
        contents.assignments.length > 0 ? t.employees.merge.assets(contents.assignments.length, contents.open_assignments) : null,
        contents.photos.length > 0 ? t.employees.merge.photos(contents.photos.length) : null,
      ].filter((x): x is string => x !== null)
    : []

  return (
    <FormSheet
      open={start !== null}
      onClose={onClose}
      title={t.employees.merge.title}
      description={t.employees.merge.description}
      footer={
        <FormSheetActions
          form={formId}
          onCancel={onClose}
          busy={action.pending}
          disabled={!preview || !choices || bothHaveDocuments}
          submitLabel={t.employees.merge.submit}
        />
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4">
        {start && !other ? (
          <>
            {/* As Create Order's Assigned to: the label above the picker; room below it for its list, which the sheet would clip. */}
            <div className="min-h-[min(22rem,60dvh)]">
              <p className="mb-1.5 text-sm font-medium">{t.employees.merge.pickOther}</p>
              <EmployeePicker label={t.employees.merge.pickOther} selected={null} exceptId={start.id} onSelect={pick} />
            </div>
            {suggested.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="text-sm font-medium">{t.employees.merge.suggested}</h3>
                <ul className="grid gap-2">
                  {suggested.map((m) => (
                    <EmployeeCard
                      key={m.employee.id}
                      employee={m.employee}
                      kind={m.kind}
                      sizes={sizes}
                      action={{ label: t.employees.merge.pickOther, onClick: () => pick(m.employee) }}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        {other && start ? (
          <div className="grid">
            <ChoiceRow label={t.employees.merge.keepRecord} strong>
              {shown.map((e) => (
                <Option
                  key={e.id}
                  name="keep"
                  checked={keepId === e.id}
                  disabled={keepLocked && keepId !== e.id}
                  onChange={() => setKeepId(e.id)}
                >
                  {e.full_name}
                </Option>
              ))}
            </ChoiceRow>
            {preview && choices
              ? rows.map(({ field, label }) => {
                  const [a, b] = shown as [Employee, Employee]
                  if (value(a, field) === value(b, field)) {
                    return (
                      <ChoiceRow key={field} label={label}>
                        <span className="col-span-2 flex min-h-11 items-center gap-2">
                          {value(a, field)}
                          <span className="text-xs text-muted-foreground">· {t.employees.merge.same}</span>
                        </span>
                      </ChoiceRow>
                    )
                  }
                  return (
                    <ChoiceRow key={field} label={label}>
                      {shown.map((e) => (
                        <Option
                          key={e.id}
                          name={field}
                          checked={choices[field] === e.id}
                          onChange={() => setChoices((c) => (c ? { ...c, [field]: e.id } : c))}
                        >
                          {value(e, field)}
                        </Option>
                      ))}
                    </ChoiceRow>
                  )
                })
              : null}
            {preview && (preview.keep.notes || preview.remove.notes) ? (
              <ChoiceRow label={t.employees.merge.notes}>
                <span className="col-span-2 flex min-h-11 items-center text-muted-foreground">{t.employees.merge.notesJoined}</span>
              </ChoiceRow>
            ) : null}
          </div>
        ) : null}

        {preview ? (
          <section className="grid gap-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <h3 className="font-medium">{t.employees.merge.movesTo(preview.keep.full_name)}</h3>
            <p className="text-muted-foreground">{moves.length > 0 ? [...moves, t.employees.merge.history].join(' · ') : t.employees.merge.nothingMoves}</p>
            <p className="text-xs text-muted-foreground">{t.employees.merge.snapshotsKept}</p>
            {keepLocked && !bothHaveDocuments ? <p className="text-xs">{t.employees.merge.documentsKept(preview.keep.full_name)}</p> : null}
          </section>
        ) : null}
        {bothHaveDocuments ? (
          <p role="alert" className="text-sm text-destructive">
            {t.employees.merge.bothHaveDocuments}
          </p>
        ) : null}
        <ActionError error={action.error} />
      </form>
    </FormSheet>
  )
}

/** One row of the review: its label, then a choice per record (on a phone, the label above them). */
function ChoiceRow({ label, strong = false, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-2 gap-x-3 border-t py-1 first:border-t-0 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
    >
      <span className={strong ? 'col-span-2 pt-1 text-sm font-medium sm:col-span-1 sm:pt-0' : 'col-span-2 pt-1 text-xs text-muted-foreground sm:col-span-1 sm:pt-0 sm:text-sm'}>
        {label}
      </span>
      {children}
    </div>
  )
}

function Option({
  name,
  checked,
  disabled = false,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="size-4 shrink-0 accent-primary" />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  )
}
