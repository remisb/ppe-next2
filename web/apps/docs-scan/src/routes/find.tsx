import type { DocumentCandidate, DocumentMatch, Employee } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { todayHere } from '@ppe/id-docs/reader'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { ActionError, ErrorState, Loading } from '@ppe/ui/components/states'
import { formatDay } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Equal, EqualNot, GitMerge, Minus, Search, UserPlus, Waves } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Group, ScreenBar } from '@/components/screen-bar'
import { t } from '@/i18n'
import { findBlockers, fullNameOf, markOf, mergeable, parseDraft, type Mark } from '@/lib/flow'
import { useRouter } from '@/lib/router'
import { type Session, useSessions } from '@/lib/sessions'
import { useScan } from '@/lib/use-scan'

export function FindScreen({ id }: { id: string }) {
  const { scan, error, loading } = useScan(id)
  if (loading) return <Loading label={t.scans.opening} />
  if (!scan) return <ErrorState title={t.problems.scanGone} error={error} />
  return <Find scan={scan} />
}

/**
 * Find Employee (DS-6, DS-7): Match's candidates, each compared with the document field by
 * field; two who may be one person offered to Merge Employees first (employees.merge only);
 * Choose Another Employee… and Add as New Employee always there. Nothing is chosen for the user.
 */
function Find({ scan }: { scan: Session }) {
  const { client } = useApi()
  const session = useSession()
  const { navigate } = useRouter()
  const sessions = useSessions()
  const m = parseDraft(scan.draft, todayHere())
  const blocked = findBlockers(scan.draft, m).length > 0
  const match = useLoad<DocumentMatch | null>(
    () => (m && !blocked ? client.personnel.match({ mrz: m.lines, surname: scan.draft.surname, given_names: scan.draft.givenNames }) : Promise.resolve(null)),
    [client, scan.id],
  )
  const [distinct, setDistinct] = useState<string[]>([])
  const [error, setError] = useState<unknown>(null)
  const candidates = match.data?.candidates ?? []

  useEffect(() => {
    if (match.data) sessions.update(scan.id, (s) => ({ ...s, candidates: match.data!.candidates }))
  }, [match.data])

  const bad = !m || blocked
  useEffect(() => {
    if (bad) navigate({ name: 'scan', id: scan.id }, { replace: true })
  }, [bad])
  if (!m || bad) return null
  const pairs = (match.data?.pairs ?? []).filter((p) => !distinct.includes(`${p.a}|${p.b}`))
  const byId = (id: string) => candidates.find((c) => c.employee.id === id)
  const mayMerge = session.can('employees.merge')

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenBar back={{ to: { name: 'scan', id: scan.id }, label: t.find.back }} title={t.find.title} />
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        <img src={scan.pages[0]?.url} alt="" className="h-14 w-20 rounded object-cover" />
        <div className="min-w-0">
          <div className="truncate font-semibold">{fullNameOf(scan.draft)}</div>
          <div className="text-sm text-muted-foreground">
            {t.kinds[scan.kind]} · {m.birthDate ? formatDay(m.birthDate) : ''} · {m.nationality}
          </div>
        </div>
      </div>

      {match.loading && !match.data ? <Loading label={t.find.searching} /> : null}
      <ActionError error={match.error ?? error} onRetry={match.error ? match.reload : undefined} />

      {match.data?.check.document_on_file ? (
        <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {t.problems.documentOnFile}
        </p>
      ) : null}
      {match.data ? (
        candidates.length > 0 ? (
          <header>
            <h2 className="text-xl font-bold text-balance">{t.find.mayBe}</h2>
            <p className="text-sm text-muted-foreground">{candidates.length === 1 ? t.find.one : t.find.several(candidates.length)}</p>
          </header>
        ) : (
          <header>
            <h2 className="text-xl font-bold">{t.find.noOne}</h2>
            <p className="text-sm text-muted-foreground">{t.find.noOneHint}</p>
          </header>
        )
      ) : null}

      {pairs.map((p) => {
        const a = byId(p.a)
        const b = byId(p.b)
        if (!a || !b) return null
        const join = mergeable(a, b)
        return (
          <div key={`${p.a}|${p.b}`} role="group" aria-label={t.find.pair(a.employee.full_name, b.employee.full_name)} className="flex gap-3 rounded-xl bg-primary/8 p-3">
            <GitMerge aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">{t.find.pair(a.employee.full_name, b.employee.full_name)}</span>
              {!join ? <span>{t.find.bothHaveDocuments}</span> : mayMerge ? <span>{t.find.pairHint}</span> : <span>{t.find.askManager}</span>}
              {join && mayMerge ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      sessions.update(scan.id, (s) => ({ ...s, pair: { a: p.a, b: p.b } }))
                      navigate({ name: 'merge', id: scan.id })
                    }}
                  >
                    {t.find.merge}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setError(null)
                      client.employees.markDistinct(p.a, p.b).then(
                        () => setDistinct((d) => [...d, `${p.a}|${p.b}`]),
                        (e: unknown) => setError(e),
                      )
                    }}
                  >
                    {t.find.notSame}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        )
      })}

      <ul className="flex flex-col gap-3">
        {candidates.map((c) => (
          <li key={c.employee.id}>
            <Candidate c={c} scan={scan} onUse={() => navigate({ name: 'update', id: scan.id, employee: c.employee.id })} />
          </li>
        ))}
      </ul>

      <ChooseAnother onChoose={(e) => navigate({ name: 'update', id: scan.id, employee: e.id })} />

      <Button size="lg" variant={candidates.length > 0 ? 'secondary' : 'default'} onClick={() => navigate({ name: 'new', id: scan.id })}>
        <UserPlus aria-hidden className="size-4" />
        {t.find.addNew}
      </Button>
    </div>
  )
}

const MARK_ICONS: Record<Mark, typeof Equal> = { same: Equal, accents: Waves, differs: EqualNot, none: Minus }

function MarkIcon({ mark }: { mark: Mark }) {
  const Icon = MARK_ICONS[mark]
  return (
    <span title={t.find.marks[mark]} className={cn('inline-flex', mark === 'differs' ? 'text-amber-600' : mark === 'none' ? 'text-muted-foreground' : 'text-emerald-600')}>
      <Icon aria-hidden className="size-4" />
      <span className="sr-only">{t.find.marks[mark]}</span>
    </span>
  )
}

/** A candidate, compared with the document: = the same, ≈ but for accents, ≠ differs, – not on file. */
function Candidate({ c, scan, onUse }: { c: DocumentCandidate; scan: Session; onUse: () => void }) {
  const m = parseDraft(scan.draft, todayHere())!
  const rows: { label: string; onFile: string | null; mark: Mark }[] = [
    { label: t.find.rows.name, onFile: c.employee.full_name, mark: markOf(c.employee.full_name, fullNameOf(scan.draft)) },
    { label: t.find.rows.birth, onFile: c.birth_date ? formatDay(c.birth_date) : null, mark: markOf(c.birth_date, m.birthDate) },
    { label: t.find.rows.nationality, onFile: c.nationality, mark: markOf(c.nationality, m.nationality) },
    { label: t.find.rows.sex, onFile: c.sex ? (t.details.sexes[c.sex] ?? c.sex) : null, mark: markOf(c.sex, m.sex) },
  ]
  const strong = c.kind === 'personal_code' || c.kind === 'document_number' || c.kind === 'same_name'
  return (
    <article aria-label={c.employee.full_name} className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center gap-3 px-4 pt-3 pb-2">
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-muted font-semibold">
          {c.employee.full_name
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.employee.full_name}</div>
          <div className="text-xs text-muted-foreground">
            {c.employee.code ? t.find.code(c.employee.code) : t.find.noCode}
            {c.has_documents ? ` · ${t.find.hasDocuments}` : ''}
          </div>
        </div>
        <Badge variant={strong ? 'default' : 'secondary'}>{t.find.kinds[c.kind]}</Badge>
      </header>
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 pb-3 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="truncate">{r.onFile ?? t.find.notOnFile}</dd>
            <dd>
              <MarkIcon mark={r.mark} />
            </dd>
          </div>
        ))}
        <dt className="text-muted-foreground">{t.find.rows.holds}</dt>
        <dd className="col-span-2">{t.find.holds(c.orders, c.assets)}</dd>
      </dl>
      <div className="border-t border-border">
        <button type="button" onClick={onUse} className="min-h-12 w-full font-semibold text-primary outline-none focus-visible:bg-muted">
          {t.find.useThis}
        </button>
      </div>
    </article>
  )
}

/** Choose Another Employee…: the employees' search by name or code. */
function ChooseAnother({ onChoose }: { onChoose: (e: Employee) => void }) {
  const { client } = useApi()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Employee[] | null>(null)
  useEffect(() => {
    const query = q.trim()
    if (query === '') return setFound(null)
    let live = true
    const timer = setTimeout(() => {
      client.employees.search(query).then(
        (list) => live && setFound(list),
        () => live && setFound([]),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [client, q])
  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Search aria-hidden className="size-4" />
        {t.find.chooseAnother}
      </Button>
    )
  }
  return (
    <Group>
      <div className="px-4 py-3">
        <Field label={t.find.searchLabel}>{(p) => <Input {...controlProps(p)} type="search" autoComplete="off" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      </div>
      {found && found.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">{t.find.noMatch}</p> : null}
      {(found ?? []).map((e) => (
        <button key={e.id} type="button" onClick={() => onChoose(e)} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left outline-none focus-visible:bg-muted">
          <span className="truncate">{e.full_name}</span>
          <span className="text-xs text-muted-foreground">{e.code ? t.find.code(e.code) : t.find.noCode}</span>
        </button>
      ))}
    </Group>
  )
}
