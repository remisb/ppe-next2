import type { DocumentTake } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { todayHere } from '@ppe/id-docs/reader'
import { Button } from '@ppe/ui/components/button'
import { ActionError, ErrorState, Loading } from '@ppe/ui/components/states'
import { formatDay } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Check, Lock } from 'lucide-react'
import { useState } from 'react'

import { Group, ScreenBar } from '@/components/screen-bar'
import { t } from '@/i18n'
import { changesOf, fullNameOf, parseDraft, tickedAtFirst, type Change, type OnFile } from '@/lib/flow'
import { useRouter } from '@/lib/router'
import { refusalOf, saveDocument } from '@/lib/save'
import { type Session, useSessions } from '@/lib/sessions'
import { useScan } from '@/lib/use-scan'

export function UpdateScreen({ id, employeeId }: { id: string; employeeId: string }) {
  const { scan, error, loading } = useScan(id)
  if (loading) return <Loading label={t.scans.opening} />
  if (!scan) return <ErrorState title={t.problems.scanGone} error={error} />
  return <Update scan={scan} employeeId={employeeId} />
}

/** The record as the screen compares it, and whether its birth date, nationality and sex are shown to this user. */
interface Record_ {
  onFile: OnFile
  code: string | null
  known: boolean
}

/**
 * Update Employee (DS-8): what the record would take from the document, field by field, ticked
 * as D5 says, under Add to Employee Record (on in this app, D4); the Document Copies; Save.
 * A record chosen by search, for a user who may not see its identity details, offers no
 * birth date, nationality or sex unticked over what is hidden.
 */
function Update({ scan, employeeId }: { scan: Session; employeeId: string }) {
  const { client } = useApi()
  const session = useSession()
  const candidate = scan.candidates?.find((c) => c.employee.id === employeeId)
  const loaded = useLoad<Record_>(async () => {
    if (candidate) {
      const { birth_date, nationality, sex } = candidate
      return { onFile: { full_name: candidate.employee.full_name, birth_date, nationality, sex }, code: candidate.employee.code, known: true }
    }
    const e = await client.employees.get(employeeId)
    return {
      onFile: { full_name: e.full_name, birth_date: e.birth_date, nationality: e.nationality, sex: e.sex },
      code: e.code,
      known: session.can('employee_profiles.read'),
    }
  }, [client, employeeId])
  if (loaded.loading && !loaded.data) return <Loading />
  if (!loaded.data) return <ErrorState error={loaded.error} onRetry={loaded.reload} />
  return <UpdateForm scan={scan} employeeId={employeeId} record={loaded.data} />
}

function UpdateForm({ scan, employeeId, record }: { scan: Session; employeeId: string; record: Record_ }) {
  const { client } = useApi()
  const { navigate } = useRouter()
  const sessions = useSessions()
  const m = parseDraft(scan.draft, todayHere())!
  const all = changesOf(record.onFile, scan.draft, m)
  // Fields this user may not see are never offered over what is hidden.
  const changes: Change[] = record.known ? all.changes : all.changes.filter((c) => c.field === 'names')
  const [addToRecord, setAddToRecord] = useState(true)
  const [take, setTake] = useState<DocumentTake[]>(() => tickedAtFirst(changes))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const kind = t.kinds[scan.kind].toLocaleLowerCase()
  const taking = addToRecord ? take.filter((f) => changes.some((c) => c.field === f)) : []

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      await saveDocument(client, scan, { kind: 'existing', id: employeeId }, addToRecord, taking)
      const name = taking.includes('names') ? fullNameOf(scan.draft) : record.onFile.full_name
      sessions.update(scan.id, (s) => ({
        ...s,
        state: 'saved',
        employeeId,
        saved: { employeeId, name, created: false, changed: taking, merged: s.merged ?? null, sides: s.pages.map((p) => p.side) },
      }))
      navigate({ name: 'saved', id: scan.id }, { replace: true })
    } catch (e) {
      setError(e)
      setSaving(false)
    }
  }

  const show = (c: Change, v: string | null) => (v && (c.field === 'birth_date') ? formatDay(v) : c.field === 'sex' && v ? (t.details.sexes[v] ?? v) : v)
  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenBar back={{ to: { name: 'find', id: scan.id }, label: t.update.back }} title={t.update.title} />
      {scan.merged ? <p className="rounded-xl bg-emerald-500/12 p-3 text-sm">{t.update.merged(scan.merged)}</p> : null}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        <span aria-hidden className="grid size-11 place-items-center rounded-full bg-muted font-semibold">
          {record.onFile.full_name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2)}
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold">{record.onFile.full_name}</div>
          <div className="text-xs text-muted-foreground">{record.code ? t.find.code(record.code) : t.find.noCode}</div>
        </div>
      </div>

      <Group footer={addToRecord ? t.update.addOn(kind) : t.update.addOff}>
        <label className="flex min-h-12 items-center justify-between gap-3 px-4">
          <span>{t.update.addToRecord}</span>
          <input type="checkbox" role="switch" className="size-5 accent-primary" checked={addToRecord} onChange={(e) => setAddToRecord(e.target.checked)} />
        </label>
      </Group>

      {changes.length > 0 ? (
        <Group title={t.update.take(kind)} footer={t.update.ticksHint}>
          <fieldset disabled={!addToRecord} className={cn('divide-y divide-border', !addToRecord && 'opacity-50')}>
            <legend className="sr-only">{t.update.take(kind)}</legend>
            {changes.map((c) => {
              const on = addToRecord && take.includes(c.field)
              return (
                <label key={c.field} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={on}
                    onChange={(e) => setTake((cur) => (e.target.checked ? [...cur, c.field] : cur.filter((f) => f !== c.field)))}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-xs text-muted-foreground">
                      {t.update.fields[c.field]} · {t.update.why[c.why]}
                    </span>
                    <span className="text-sm text-muted-foreground">{c.current ? <s>{show(c, c.current)}</s> : t.update.empty}</span>
                    <span className={cn('truncate', on ? 'font-semibold' : 'text-muted-foreground')}>{show(c, c.document)}</span>
                  </span>
                </label>
              )
            })}
          </fieldset>
        </Group>
      ) : (
        <p className="text-sm text-muted-foreground">{t.update.nothing}</p>
      )}
      {all.same.length > 0 ? (
        <p className="flex items-center gap-2 px-4 text-sm text-muted-foreground">
          <Check aria-hidden className="size-4 text-emerald-600" />
          {t.update.already}: {all.same.map((f) => t.update.fields[f]).join(', ')}
        </p>
      ) : null}

      <Group title={t.update.copies} footer={t.update.copiesHint}>
        <div className="flex gap-3 overflow-x-auto px-4 py-3">
          {scan.pages.map((p) => (
            <figure key={p.key} className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
              <span className="relative block h-16 w-24 overflow-hidden rounded-md bg-muted">
                <img src={p.url} alt="" className="size-full object-cover" />
                <Lock aria-hidden className="absolute right-1 bottom-1 size-4 rounded-full bg-black/60 p-0.5 text-white" />
              </span>
              <figcaption>{t.details.sides[p.side]}</figcaption>
            </figure>
          ))}
        </div>
      </Group>

      {refusalOf(error) ? (
        <p role="alert" className="text-sm text-destructive">
          {refusalOf(error)}
        </p>
      ) : (
        <ActionError error={error} />
      )}
      <Button size="lg" disabled={saving} onClick={() => void save()}>
        {saving ? t.update.saving : taking.length > 0 ? t.update.saveAndUpdate : t.update.save}
      </Button>
    </div>
  )
}
