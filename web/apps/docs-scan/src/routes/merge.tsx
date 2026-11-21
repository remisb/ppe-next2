import type { Employee, EmployeeInput, EmployeeMergePreview } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { todayHere } from '@ppe/id-docs/reader'
import { Button } from '@ppe/ui/components/button'
import { ActionSheet, createActionSheet } from '@ppe/ui/components/drawer'
import { ActionError, ErrorState, Loading } from '@ppe/ui/components/states'
import { formatDay } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { GitMerge } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Group, ScreenBar } from '@/components/screen-bar'
import { t } from '@/i18n'
import { fullNameOf, mergeable, parseDraft } from '@/lib/flow'
import { useRouter } from '@/lib/router'
import { type Session, useSessions } from '@/lib/sessions'
import { useScan } from '@/lib/use-scan'

export function MergeScreen({ id }: { id: string }) {
  const { scan, error, loading } = useScan(id)
  if (loading) return <Loading label={t.scans.opening} />
  if (!scan) return <ErrorState title={t.problems.scanGone} error={error} />
  return <Merge scan={scan} />
}

type Pick = 'keep' | 'remove'
type Row = 'name' | 'code' | 'language'

/**
 * Merge Employees from Find Employee (DS-9, D6; employees.merge): the record to keep (never
 * removing one with identity documents, which the API refuses), then value by value, as the
 * staff app's Merge Employees sheet; confirmed in an action sheet; then Update for the kept record.
 */
function Merge({ scan }: { scan: Session }) {
  const { client } = useApi()
  const { navigate } = useRouter()
  const sessions = useSessions()
  const a = scan.candidates?.find((c) => c.employee.id === scan.pair?.a)
  const b = scan.candidates?.find((c) => c.employee.id === scan.pair?.b)
  const first = a && b ? mergeable(a, b) : null
  const [keepId, setKeepId] = useState(first?.keep ?? '')
  const removeId = first ? (keepId === first.keep ? first.remove : first.keep) : ''
  const preview = useLoad<EmployeeMergePreview | null>(() => (keepId && removeId ? client.employees.mergePreview(keepId, removeId) : Promise.resolve(null)), [client, keepId, removeId])
  const [picks, setPicks] = useState<Partial<Record<Row, Pick>>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const confirm = useMemo(() => createActionSheet<'merge'>(), [])
  const m = parseDraft(scan.draft, todayHere())

  if (!a || !b || !first) {
    return <ErrorState title={t.find.bothHaveDocuments} error={null} />
  }
  const canSwap = (id: string) => !(id === a.employee.id ? b : a).has_documents
  const p = preview.data
  if (!p) return preview.error ? <ErrorState error={preview.error} onRetry={preview.reload} /> : <Loading label={t.merge.loading} />

  const values: Record<Row, (e: Employee) => string> = {
    name: (e) => `${e.first_name} ${e.last_name}`,
    code: (e) => e.code ?? '',
    language: (e) => (e.preferred_language ? (t.merge.languages[e.preferred_language] ?? e.preferred_language) : ''),
  }
  const pickOf = (row: Row): Pick => picks[row] ?? (values[row](p.keep) !== '' ? 'keep' : 'remove')
  const from = (row: Row) => (pickOf(row) === 'keep' ? p.keep : p.remove)
  const body: EmployeeInput = {
    first_name: from('name').first_name,
    last_name: from('name').last_name,
    code: from('code').code,
    height_cm: p.keep.height_cm ?? p.remove.height_cm,
    clothing_size: p.keep.clothing_size ?? p.remove.clothing_size,
    shoe_size: p.keep.shoe_size ?? p.remove.shoe_size,
    notes: p.keep.notes || p.remove.notes,
    preferred_language: from('language').preferred_language,
  }
  const documentSays: Partial<Record<Row, string>> = { name: fullNameOf(scan.draft) }

  const merge = async () => {
    const { returnValue } = await confirm.open()
    if (returnValue !== 'merge') return
    setError(null)
    setBusy(true)
    try {
      await client.employees.merge(p.keep.id, p.remove.id, body)
      const gone = p.remove.full_name
      sessions.update(scan.id, (s) => ({ ...s, merged: gone, ...(s.candidates ? { candidates: s.candidates.filter((c) => c.employee.id !== p.remove.id) } : {}) }))
      navigate({ name: 'update', id: scan.id, employee: p.keep.id }, { replace: true })
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenBar back={{ to: { name: 'find', id: scan.id }, label: t.merge.cancel }} title={t.merge.title} />
      <p className="text-sm text-muted-foreground">{t.merge.intro}</p>
      <section className="flex flex-col gap-1.5">
        <h2 className="px-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t.merge.keepRecord}</h2>
        <div role="radiogroup" aria-label={t.merge.keepRecord} className="grid grid-cols-2 gap-2">
          {[a, b].map((c) => {
            const on = keepId === c.employee.id
            return (
              <button
                key={c.employee.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!on && !canSwap(c.employee.id)}
                onClick={() => {
                  setPicks({})
                  setKeepId(c.employee.id)
                }}
                className={cn('flex flex-col gap-1 rounded-xl border-2 bg-card p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60', on ? 'border-primary' : 'border-transparent')}
              >
                <span className={cn('text-xs font-bold uppercase', on ? 'text-primary' : 'text-muted-foreground')}>{on ? t.merge.keep : t.merge.remove}</span>
                <span className="font-semibold">{c.employee.full_name}</span>
                <span className="text-xs text-muted-foreground">
                  {c.employee.code ? t.find.code(c.employee.code) : t.find.noCode} · {t.find.holds(c.orders, c.assets)}
                </span>
                {c.has_documents ? <span className="text-xs text-muted-foreground">{t.merge.cannotRemove}</span> : null}
              </button>
            )
          })}
        </div>
      </section>

      <Group>
        {(['name', 'code', 'language'] as const).map((row) => (
          <fieldset key={row} className="flex flex-col gap-2 px-4 py-3">
            <legend className="flex w-full justify-between gap-2 text-xs text-muted-foreground">
              <span>{t.merge.rows[row]}</span>
              {documentSays[row] ? <span>{t.merge.documentSays(documentSays[row]!)}</span> : null}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(['keep', 'remove'] as const).map((side) => {
                const v = values[row](side === 'keep' ? p.keep : p.remove)
                const on = pickOf(row) === side
                return (
                  <label key={side} className={cn('flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm', on ? 'bg-primary/10 font-semibold text-primary ring-1 ring-primary' : 'bg-muted', v === '' && 'opacity-60')}>
                    <input type="radio" name={row} className="accent-primary" checked={on} disabled={v === ''} onChange={() => setPicks((cur) => ({ ...cur, [row]: side }))} />
                    <span className="truncate">{v || t.merge.empty}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </Group>
      {m?.birthDate ? <p className="px-4 text-xs text-muted-foreground">{t.merge.documentSays(formatDay(m.birthDate))}</p> : null}

      <p className="flex gap-2 rounded-xl bg-muted p-3 text-sm">
        <GitMerge aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        {t.merge.moves(p.contents.orders.length, p.contents.assignments.length, p.contents.photos.length, p.keep.full_name)}
      </p>
      <ActionError error={error} />
      <Button size="lg" disabled={busy} onClick={() => void merge()}>
        {t.merge.action}
      </Button>
      <ActionSheet
        sheet={confirm}
        title={t.merge.confirmTitle(p.remove.full_name, p.keep.full_name)}
        description={t.merge.confirmHint(p.remove.full_name)}
        actions={[{ value: 'merge', label: t.merge.action }]}
      />
    </div>
  )
}
