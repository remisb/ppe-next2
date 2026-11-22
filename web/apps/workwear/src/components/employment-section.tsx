import type { Company, Employee, Employment } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DateInput } from '@ppe/ui/components/date-input'
import { Field, Select, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { useAction } from '@ppe/ui/lib/use-action'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { Pencil, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useId, useState } from 'react'

import { t } from '@/i18n'
import { todayIn } from '@/lib/assets'
import { type PeriodDraft, type PeriodErrors, checkEnd, checkPeriod, defaultCompanyId, openEmployment, periodText } from '@/lib/employment'

/** A candidate's or a former employee's badge; an employee has none. */
export function StatusBadge({ status, className }: { status: Employee['status']; className?: string }) {
  if (status === 'employee') return null
  return (
    <Badge variant={status === 'candidate' ? 'outline' : 'secondary'} className={className}>
      {t.employment.status[status]}
    </Badge>
  )
}

type Sheet = { kind: 'employ' } | { kind: 'move' } | { kind: 'end'; job: Employment } | { kind: 'edit'; job: Employment }

/**
 * The person's employment: the company they are employed by now and from
 * when, the earlier periods, and, with Manage employee profiles, Employ…,
 * Move to Another Company…, End Employment… and each period's Edit and
 * Remove (for one entered by mistake). Every change answers with the employee,
 * handed to onChanged.
 */
export function EmploymentSection({ employee, timeZone, onChanged }: { employee: Employee; timeZone?: string | undefined; onChanged: () => void }) {
  const { client } = useApi()
  const manages = useSession().can('employee_profiles.manage')
  const jobs = employee.employments ?? []
  const open = openEmployment(jobs)
  const earlier = jobs.filter((m) => m !== open)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [done, setDone] = useState('')
  const action = useAction()

  const remove = async (m: Employment) => {
    const ok = await action.run(() => client.employees.removeEmployment(employee.id, m.id), {
      confirm: t.employment.confirmRemove(m.company_name, periodText(m)),
    })
    if (ok) {
      setDone(t.employment.removed)
      onChanged()
    }
  }

  const periodTools = (m: Employment) =>
    manages ? (
      <span className="flex shrink-0 gap-1">
        <Button size="icon-sm" variant="ghost" aria-label={t.employment.editPeriod(m.company_name)} title={t.employment.editPeriod(m.company_name)} onClick={() => setSheet({ kind: 'edit', job: m })}>
          <Pencil aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={t.employment.removePeriod(m.company_name)} title={t.employment.removePeriod(m.company_name)} onClick={() => void remove(m)}>
          <Trash2 aria-hidden />
        </Button>
      </span>
    ) : null

  return (
    <section aria-labelledby="employment-heading" className="mb-6 border-b border-border pb-4 text-sm sm:max-w-2xl">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 pt-2">
        <h2 id="employment-heading" className="font-semibold">
          {t.employment.title}
        </h2>
        {manages ? (
          <div className="flex flex-wrap gap-2">
            {open ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setSheet({ kind: 'move' })}>
                  {t.employment.move}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSheet({ kind: 'end', job: open })}>
                  {t.employment.end}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setSheet({ kind: 'employ' })}>
                {t.employment.employ}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="flex items-start justify-between gap-2">
          <dl>
            <dt className="text-muted-foreground">{t.employment.employedBy}</dt>
            <dd className="mt-0.5 font-medium">{open.company_name}</dd>
            <dd className="text-muted-foreground">{periodText(open)}</dd>
          </dl>
          {periodTools(open)}
        </div>
      ) : (
        <p className="text-muted-foreground">{employee.status === 'candidate' ? t.employment.candidateNote : t.employment.formerNote}</p>
      )}
      {earlier.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-muted-foreground">{t.employment.earlier}</h3>
          <ul className="mt-1 divide-y divide-border">
            {earlier.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="block">{m.company_name}</span>
                  <span className="block text-muted-foreground">{periodText(m)}</span>
                </span>
                {periodTools(m)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p role="status" className="mt-2 text-muted-foreground empty:hidden">
        {done}
      </p>
      {action.error ? (
        <p role="alert" className="mt-2 text-destructive">
          {errorText(action.error)}
        </p>
      ) : null}
      <PeriodSheet
        sheet={sheet?.kind === 'end' ? null : sheet}
        employee={employee}
        timeZone={timeZone}
        onClose={() => setSheet(null)}
        onSaved={(message) => {
          setSheet(null)
          setDone(message)
          onChanged()
        }}
      />
      <EndSheet
        job={sheet?.kind === 'end' ? sheet.job : null}
        employee={employee}
        timeZone={timeZone}
        onClose={() => setSheet(null)}
        onSaved={(message) => {
          setSheet(null)
          setDone(message)
          onChanged()
        }}
      />
    </section>
  )
}

/** Employ…, Move to Another Company… and a period's Edit: the company and the days. */
function PeriodSheet({
  sheet,
  employee,
  timeZone,
  onClose,
  onSaved,
}: {
  sheet: Exclude<Sheet, { kind: 'end' }> | null
  employee: Employee
  timeZone: string | undefined
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { client } = useApi()
  const formId = useId()
  const companies = useLoad(() => (sheet ? client.companies.list() : Promise.resolve<Company[]>([])), [sheet !== null])
  const editing = sheet?.kind === 'edit' ? sheet.job : undefined
  const move = sheet?.kind === 'move'
  const [d, setD] = useState<PeriodDraft>({ companyId: '', startedOn: '', endedOn: '' })
  const [errors, setErrors] = useState<PeriodErrors>({})
  const [notDate, setNotDate] = useState<{ startedOn?: string | undefined; endedOn?: string | undefined }>({})
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const jobs = employee.employments ?? []

  useEffect(() => {
    if (!sheet) return
    setD(
      editing
        ? { companyId: editing.company_id, startedOn: editing.started_on ?? '', endedOn: editing.ended_on ?? '' }
        : { companyId: move ? '' : defaultCompanyId(companies.data ?? []), startedOn: todayIn(timeZone), endedOn: '' },
    )
    setErrors({})
    setNotDate({})
    setFailure(undefined)
  }, [sheet, companies.data, timeZone])

  const choices = (companies.data ?? []).filter((c) => !move || c.id !== openEmployment(jobs)?.company_id)
  // A period at a company deleted since keeps it as a choice.
  const keeps = editing && !choices.some((c) => c.id === editing.company_id) ? { id: editing.company_id, name: editing.company_name } : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!sheet) return
    const v = checkPeriod(d, jobs, editing ? { move, editing } : { move })
    setErrors(v)
    setFailure(undefined)
    if (Object.keys(v).length > 0 || notDate.startedOn || notDate.endedOn) return
    const company = choices.find((c) => c.id === d.companyId)?.name ?? keeps?.name ?? ''
    setBusy(true)
    try {
      if (editing) {
        await client.employees.updateEmployment(employee.id, editing.id, { company_id: d.companyId, started_on: d.startedOn || null, ended_on: d.endedOn || null })
        onSaved(t.employment.saved)
      } else {
        await client.employees.employ(employee.id, { company_id: d.companyId, started_on: d.startedOn || null, end_current: move })
        onSaved(move ? t.employment.moved(employee.full_name, company) : t.employment.employed(employee.full_name, company))
      }
    } catch (err) {
      setFailure(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const title = editing ? t.employment.editTitle(editing.company_name) : move ? t.employment.moveTitle(employee.full_name) : t.employment.employTitle(employee.full_name)
  const description = editing ? t.employment.editDescription : move ? t.employment.moveDescription : t.employment.employDescription
  return (
    <FormSheet
      open={sheet !== null}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <FormSheetActions form={formId} onCancel={onClose} busy={busy} submitLabel={editing ? undefined : move ? t.employment.moveButton : t.employment.employButton} />
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label={t.employment.company} required error={errors.companyId} className="sm:col-span-2">
          {(p) => (
            <Select {...controlProps(p)} value={d.companyId} onChange={(e) => setD((cur) => ({ ...cur, companyId: e.target.value }))}>
              <option value="">{t.employment.chooseCompany}</option>
              {keeps ? <option value={keeps.id}>{keeps.name}</option> : null}
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t.employment.startedOn} required={move} error={notDate.startedOn ?? errors.startedOn}>
          {(p) => (
            <DateInput
              {...controlProps(p)}
              value={d.startedOn}
              onChange={(v, problem) => {
                setD((cur) => ({ ...cur, startedOn: v }))
                setNotDate((n) => ({ ...n, startedOn: problem }))
              }}
            />
          )}
        </Field>
        {editing ? (
          <Field label={t.employment.endedOn} hint={t.employment.endedOnHint} error={notDate.endedOn ?? errors.endedOn}>
            {(p) => (
              <DateInput
                {...controlProps(p)}
                value={d.endedOn}
                min={d.startedOn || undefined}
                onChange={(v, problem) => {
                  setD((cur) => ({ ...cur, endedOn: v }))
                  setNotDate((n) => ({ ...n, endedOn: problem }))
                }}
              />
            )}
          </Field>
        ) : null}
        {failure ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {failure}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}

/** End Employment…: the day the person left; they become a former employee. */
function EndSheet({
  job,
  employee,
  timeZone,
  onClose,
  onSaved,
}: {
  job: Employment | null
  employee: Employee
  timeZone: string | undefined
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { client } = useApi()
  const formId = useId()
  const [day, setDay] = useState('')
  const [problem, setProblem] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!job) return
    setDay(todayIn(timeZone))
    setProblem(undefined)
    setFailure(undefined)
  }, [job, timeZone])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!job) return
    const p = problem ?? checkEnd(day, job)
    setProblem(p)
    if (p) return
    setBusy(true)
    setFailure(undefined)
    try {
      await client.employees.endEmployment(employee.id, job.id, day)
      onSaved(t.employment.ended(employee.full_name))
    } catch (err) {
      setFailure(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={job !== null}
      onClose={onClose}
      title={t.employment.endTitle(employee.full_name)}
      description={job ? t.employment.endDescription(job.company_name) : ''}
      footer={<FormSheetActions form={formId} onCancel={onClose} busy={busy} submitLabel={t.employment.endButton} />}
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
        <Field label={t.employment.endedOn} required hint={t.employment.endedOnHint} error={problem}>
          {(p) => (
            <DateInput
              {...controlProps(p)}
              value={day}
              min={job?.started_on ?? undefined}
              onChange={(v, notDate) => {
                setDay(v)
                setProblem(notDate)
              }}
            />
          )}
        </Field>
        {failure ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}
