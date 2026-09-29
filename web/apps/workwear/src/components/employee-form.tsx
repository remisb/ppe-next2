import type { Employee, EmployeeInput, Sizes } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { type FormEvent, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea, controlProps } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { t } from '@/i18n'
import { useApi } from '@/lib/api'
import { blankToNull, clothingBandValue, clothingBands } from '@/lib/utils'
import { errorText } from '@/lib/use-load'

interface Props {
  open: boolean
  /** Editing an existing employee; omit to add a new one. */
  employee?: Employee | undefined
  sizes: Sizes | undefined
  onClose: () => void
  onSaved: (e: Employee) => void
  /** "Save" on the Employees screen, "Save and Select Employee" from Create Order. */
  submitLabel?: string
}

interface Draft {
  first_name: string
  last_name: string
  code: string
  height_cm: string
  /** The select's value: the EU number as text, '' when not set. */
  clothing_size: string
  shoe_size: string
  notes: string
}

function draftOf(e: Employee | undefined): Draft {
  return {
    first_name: e?.first_name ?? '',
    last_name: e?.last_name ?? '',
    code: e?.code ?? '',
    height_cm: e?.height_cm?.toString() ?? '',
    clothing_size: e?.clothing_size?.toString() ?? '',
    shoe_size: e?.shoe_size ?? '',
    notes: e?.notes ?? '',
  }
}

/**
 * Add New Employee / edit employee. Only first and last name are required;
 * height, clothing and shoe size are optional defaults. There is no glove size.
 */
export function EmployeeForm({ open, employee, sizes, onClose, onSaved, submitLabel }: Props) {
  const { client } = useApi()
  const [d, setD] = useState<Draft>(() => draftOf(employee))
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const bands = clothingBands(sizes?.clothing ?? [])

  useEffect(() => {
    if (open) {
      setD(draftOf(employee))
      setError(undefined)
    }
  }, [open, employee])

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((cur) => ({ ...cur, [k]: e.target.value }))

  const height = d.height_cm.trim() === '' ? null : Number(d.height_cm)
  const heightError =
    height !== null && (!Number.isInteger(height) || height < 100 || height > 250) ? t.employees.heightRange : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (heightError) return
    const input: EmployeeInput = {
      first_name: d.first_name,
      last_name: d.last_name,
      code: blankToNull(d.code),
      height_cm: height,
      clothing_size: d.clothing_size === '' ? null : Number(d.clothing_size),
      shoe_size: blankToNull(d.shoe_size),
      notes: d.notes,
    }
    setBusy(true)
    setError(undefined)
    try {
      onSaved(employee ? await client.employees.update(employee.id, input) : await client.employees.create(input))
    } catch (err) {
      setError(err instanceof ApiError && err.isConflict ? t.employees.codeTaken : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={employee ? t.employees.editEmployee : t.employees.addNew}
      description={t.employees.formDescription}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="employee-form" disabled={busy || !d.first_name.trim() || !d.last_name.trim()}>
            {busy ? t.common.saving : (submitLabel ?? t.common.save)}
          </Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t.employees.firstName} required>
          {(p) => <Input {...controlProps(p)} value={d.first_name} onChange={set('first_name')} autoFocus />}
        </Field>
        <Field label={t.employees.lastName} required>
          {(p) => <Input {...controlProps(p)} value={d.last_name} onChange={set('last_name')} />}
        </Field>
        <Field label={t.employees.employeeCode}>{(p) => <Input {...controlProps(p)} value={d.code} onChange={set('code')} />}</Field>
        <Field label={t.employees.heightLabel} error={heightError}>
          {(p) => <Input {...controlProps(p)} inputMode="numeric" value={d.height_cm} onChange={set('height_cm')} />}
        </Field>
        <Field label={t.employees.clothingSize}>
          {(p) => (
            <Select {...controlProps(p)} value={clothingBandValue(bands, d.clothing_size)} onChange={set('clothing_size')}>
              <option value="">{t.employees.notSet}</option>
              {bands.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t.employees.shoeSize}>
          {(p) => (
            <Select {...controlProps(p)} value={d.shoe_size} onChange={set('shoe_size')}>
              <option value="">{t.employees.notSet}</option>
              {sizes?.shoes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label={t.employees.notes}>{(p) => <Textarea {...controlProps(p)} rows={2} value={d.notes} onChange={set('notes')} />}</Field>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
      </form>
    </FormSheet>
  )
}
