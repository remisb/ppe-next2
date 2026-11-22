import { useApi } from '@ppe/app-shell'
import { todayHere } from '@ppe/id-docs/reader'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { ActionError, ErrorState, Loading } from '@ppe/ui/components/states'
import { formatDay } from '@ppe/ui/lib/dates'
import { useState } from 'react'

import { Chip, Group, Row, ScreenBar } from '@/components/screen-bar'
import { t } from '@/i18n'
import { parseDraft } from '@/lib/flow'
import { useRouter } from '@/lib/router'
import { refusalOf, saveDocument } from '@/lib/save'
import { type Session, useSessions } from '@/lib/sessions'
import { useScan } from '@/lib/use-scan'

export function NewEmployeeScreen({ id }: { id: string }) {
  const { scan, error, loading } = useScan(id)
  if (loading) return <Loading label={t.scans.opening} />
  if (!scan) return <ErrorState title={t.problems.scanGone} error={error} />
  return <NewEmployee scan={scan} />
}

/**
 * Add New Employee (DS-10): the form filled from the document, its names as checked on
 * Details; the employee and the document saved all or none (ADR 0007 D6).
 */
function NewEmployee({ scan }: { scan: Session }) {
  const { client } = useApi()
  const { navigate } = useRouter()
  const sessions = useSessions()
  const m = parseDraft(scan.draft, todayHere())!
  const [first, setFirst] = useState(scan.draft.givenNames)
  const [last, setLast] = useState(scan.draft.surname)
  const [code, setCode] = useState('')
  const [addToRecord, setAddToRecord] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const kind = t.kinds[scan.kind].toLocaleLowerCase()
  const mrz = <Chip tone="ok">{t.details.sources.mrz}</Chip>

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      const doc = await saveDocument(client, scan, { kind: 'new', firstName: first, lastName: last, code }, addToRecord, [])
      const name = `${first.trim()} ${last.trim()}`
      sessions.update(scan.id, (s) => ({
        ...s,
        state: 'saved',
        employeeId: doc.employee_id,
        saved: { employeeId: doc.employee_id, name, created: true, changed: [], merged: null, sides: s.pages.map((p) => p.side) },
      }))
      navigate({ name: 'saved', id: scan.id }, { replace: true })
    } catch (e) {
      setError(e)
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenBar back={{ to: { name: 'find', id: scan.id }, label: t.newEmployee.back }} title={t.newEmployee.title} />
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        <img src={scan.pages[0]?.url} alt="" className="h-14 w-20 rounded object-cover" />
        <div className="min-w-0 text-sm">
          <div className="font-semibold">{t.newEmployee.from(kind)}</div>
          <div className="text-muted-foreground">{t.newEmployee.fromHint}</div>
        </div>
      </div>
      <Group>
        <div className="flex flex-col gap-3 px-4 py-3">
          <Field label={t.newEmployee.firstName} required>
            {(p) => <Input {...controlProps(p)} value={first} autoComplete="off" onChange={(e) => setFirst(e.target.value)} />}
          </Field>
          <Field label={t.newEmployee.lastName} required>
            {(p) => <Input {...controlProps(p)} value={last} autoComplete="off" onChange={(e) => setLast(e.target.value)} />}
          </Field>
          <Field label={t.newEmployee.code} hint={t.newEmployee.optional}>
            {(p) => <Input {...controlProps(p)} value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} />}
          </Field>
        </div>
      </Group>
      <Group>
        <Row label={t.details.birth} end={mrz}>
          {m.birthDate ? formatDay(m.birthDate) : '—'}
        </Row>
        <Row label={t.details.sex} end={mrz}>
          {m.sex ? (t.details.sexes[m.sex] ?? m.sex) : '—'}
        </Row>
        <Row label={t.details.nationality} end={mrz}>
          {m.nationality}
        </Row>
      </Group>
      <Group footer={addToRecord ? t.newEmployee.addOn(kind) : t.newEmployee.addOff}>
        <label className="flex min-h-12 items-center justify-between gap-3 px-4">
          <span>{t.update.addToRecord}</span>
          <input type="checkbox" role="switch" className="size-5 accent-primary" checked={addToRecord} onChange={(e) => setAddToRecord(e.target.checked)} />
        </label>
      </Group>
      {refusalOf(error) ? (
        <p role="alert" className="text-sm text-destructive">
          {refusalOf(error)}
        </p>
      ) : (
        <ActionError error={error} />
      )}
      <Button size="lg" disabled={saving || first.trim() === '' || last.trim() === ''} onClick={() => void save()}>
        {saving ? t.update.saving : t.newEmployee.save}
      </Button>
    </div>
  )
}
