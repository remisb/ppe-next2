import { useApi } from '@ppe/app-shell'
import { nameMatch } from '@ppe/mrz'
import { todayHere } from '@ppe/id-docs/reader'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { ActionSheet, createActionSheet } from '@ppe/ui/components/drawer'
import { Field, Input, Textarea, controlProps } from '@ppe/ui/components/field'
import { Gallery } from '@ppe/ui/components/gallery'
import { ActionError, ErrorState, Loading } from '@ppe/ui/components/states'
import { toast } from '@ppe/ui/components/toast'
import { formatDay } from '@ppe/ui/lib/dates'
import { saveFile } from '@ppe/ui/lib/save-file'
import { Camera, CircleAlert, CircleCheck, Crop, Download, Keyboard, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Chip, Group, Row, ScreenBar } from '@/components/screen-bar'
import { t } from '@/i18n'
import { draftFrom, findBlockers, parseDraft, type ScanDraft } from '@/lib/flow'
import { keepScan } from '@/lib/pages'
import { useRouter } from '@/lib/router'
import { type Session, useSessions } from '@/lib/sessions'
import { useScan } from '@/lib/use-scan'

/** The scan's screen once its pages are taken, or reopened from Scans. */
export function DetailsScreen({ id }: { id: string }) {
  const { scan, error, loading } = useScan(id)
  if (loading) return <Loading label={t.scans.opening} />
  if (!scan) return <ErrorState title={t.problems.scanGone} error={error} />
  return <Details scan={scan} />
}

type Choice = 'download'
type Removal = 'remove'

/**
 * Details (DS-5): the flattened pages as Photos shows a photo, and below them what was read,
 * each field marked with where it came from. The MRZ's names have no accents, so they are
 * checked against the document and the tick says so. Find Employee waits for an MRZ that passes.
 */
function Details({ scan }: { scan: Session }) {
  const { client } = useApi()
  const { navigate } = useRouter()
  const sessions = useSessions()
  const [page, setPage] = useState(1)
  const [typing, setTyping] = useState(false)
  const [lines, setLines] = useState(scan.draft.lines)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const share = useMemo(() => createActionSheet<Choice>(), [])
  const removal = useMemo(() => createActionSheet<Removal>(), [])
  const d = scan.draft
  const today = todayHere()
  const m = parseDraft(d, today)
  const blockers = findBlockers(d, m)
  const saved = scan.state === 'saved'
  const kindWord = t.kinds[scan.kind]
  const current = scan.pages[Math.min(page, scan.pages.length) - 1]

  const set = (patch: Partial<ScanDraft>) => sessions.update(scan.id, (s) => ({ ...s, draft: { ...s.draft, ...patch } }))

  const names = (() => {
    if (!m || d.surname.trim() === '') return null
    const match = nameMatch(d.surname, d.givenNames, m.nameField)
    return match === 'differs' ? <Chip tone="warn">{t.details.sources.differs}</Chip> : <Chip tone="ok">{t.details.sources.agrees}</Chip>
  })()
  const mrzChip = m?.valid ? <Chip tone="ok">{t.details.sources.mrz}</Chip> : null

  /** The lines typed are read as the camera's are: kept again, read, in this scan's place. */
  const readLines = async () => {
    const draft = { ...draftFrom(parseDraft({ ...d, lines }, today)), ...(d.surname ? { surname: d.surname, givenNames: d.givenNames } : {}), lines }
    const next = parseDraft(draft, today)
    setError(null)
    setBusy(true)
    try {
      const s = await keepScan(client, scan.kind, scan.pages, draft, next, scan.id)
      sessions.put(s)
      sessions.drop(scan.id)
      setTyping(false)
      navigate({ name: 'scan', id: s.id })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    const { returnValue } = await share.open()
    if (returnValue !== 'download') return
    try {
      const { blob, fileName } = await client.personnel.scans.download(scan.id)
      saveFile(blob, fileName)
      toast.success(t.details.downloaded(fileName))
    } catch (e) {
      setError(e)
    }
  }

  const remove = async () => {
    const { returnValue } = await removal.open()
    if (returnValue !== 'remove') return
    try {
      await client.personnel.scans.remove(scan.id)
      sessions.drop(scan.id)
      toast(t.details.removed)
      navigate({ name: 'home' })
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-6">
      <ScreenBar
        back={{ to: { name: 'home' }, label: t.details.back }}
        title={current ? `${kindWord} · ${t.details.sides[current.side]}` : kindWord}
        end={
          !saved && current?.source ? (
            <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'adjust', id: scan.id, page })}>
              {t.details.adjust}
            </Button>
          ) : null
        }
      />

      <Gallery
        label={t.details.pages}
        page={page}
        onPageChange={setPage}
        className="h-[min(44dvh,360px)]"
        items={scan.pages.map((p) => ({
          id: p.key,
          label: t.details.sides[p.side],
          page: <img src={p.url} alt={t.details.pageAlt(t.details.sides[p.side])} className="max-h-full max-w-full rounded-md object-contain shadow-lg" />,
          thumb: <img src={p.url} alt="" className="max-h-full max-w-full object-contain" />,
        }))}
      />

      {saved ? (
        <Banner tone="ok" title={t.details.saved}>
          {t.details.savedHint}
        </Banner>
      ) : !m ? (
        <Banner tone="err" title={t.details.notRead} actions={<Actions onRetake={() => retake()} onType={() => setTyping(true)} />}>
          {t.details.notReadDetail}
        </Banner>
      ) : !m.valid ? (
        <Banner tone="err" title={t.details.problems} actions={<Actions onRetake={() => retake()} onType={() => setTyping(true)} />}>
          {t.details.problemsDetail}
        </Banner>
      ) : (
        <Banner tone="ok" title={t.details.readOk}>
          {t.details.readOkDetail}
        </Banner>
      )}

      <ActionError error={error} />

      {m ? (
        <>
          <Group title={t.details.person} footer={saved ? undefined : t.details.namesHint}>
            <NameField label={t.details.surname} value={d.surname} chip={names} disabled={saved} onChange={(v) => set({ surname: v, namesChecked: false })} />
            <NameField label={t.details.givenNames} value={d.givenNames} chip={names} disabled={saved} onChange={(v) => set({ givenNames: v, namesChecked: false })} />
            <Row label={t.details.birth} end={mrzChip}>
              {m.birthDate ? formatDay(m.birthDate) : '—'}
            </Row>
            <Row label={t.details.sex} end={mrzChip}>
              {m.sex ? (t.details.sexes[m.sex] ?? m.sex) : '—'}
            </Row>
            <Row label={t.details.nationality} end={mrzChip}>
              {m.nationality}
            </Row>
            {m.personalCode ? (
              <Row label={t.details.personalCode} end={mrzChip}>
                {m.personalCode.code}
              </Row>
            ) : null}
          </Group>
          {saved ? null : (
            <label className="flex min-h-11 items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <input type="checkbox" className="mt-1 size-5 accent-primary" checked={d.namesChecked} onChange={(e) => set({ namesChecked: e.target.checked })} />
              <span>{t.details.namesChecked}</span>
            </label>
          )}
          <Group title={t.details.document}>
            <Row label={t.details.kind} end={mrzChip}>
              {t.kinds[scan.kind]} · {m.issuingState}
            </Row>
            <Row label={t.details.number} end={mrzChip}>
              {m.documentNumber}
            </Row>
            <Row label={t.details.validUntil} end={mrzChip}>
              {m.expiryDate ? formatDay(m.expiryDate) : '—'}
            </Row>
            {saved ? null : (
              <div className="flex flex-col gap-3 px-4 py-3">
                <Field label={t.details.issuedOn} hint={t.details.optional}>
                  {(p) => <Input {...controlProps(p)} type="date" value={d.issuedOn} onChange={(e) => set({ issuedOn: e.target.value })} />}
                </Field>
                <Field label={t.details.issuedBy} hint={t.details.optional}>
                  {(p) => <Input {...controlProps(p)} value={d.authority} onChange={(e) => set({ authority: e.target.value })} />}
                </Field>
                <Field label={t.details.placeOfBirth} hint={t.details.optional}>
                  {(p) => <Input {...controlProps(p)} value={d.placeOfBirth} onChange={(e) => set({ placeOfBirth: e.target.value })} />}
                </Field>
              </div>
            )}
          </Group>
        </>
      ) : null}

      {typing || (!m && !saved) ? (
        <Group title={t.details.mrz} footer={t.details.mrzHint}>
          <div className="flex flex-col gap-3 px-4 py-3">
            <Field label={t.details.mrz} hideLabel>
              {(p) => (
                <Textarea
                  {...controlProps(p)}
                  rows={3}
                  spellCheck={false}
                  autoCapitalize="characters"
                  className="font-mono text-sm tracking-wide uppercase"
                  value={lines}
                  onChange={(e) => setLines(e.target.value)}
                />
              )}
            </Field>
            <div>
              <Button variant="outline" disabled={busy || lines.trim() === ''} onClick={() => void readLines()}>
                {t.details.applyMrz}
              </Button>
            </div>
          </div>
        </Group>
      ) : m ? (
        <Group title={t.details.mrz}>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed">{m.lines.join('\n')}</pre>
        </Group>
      ) : null}

      {saved ? (
        <SavedLink scan={scan} />
      ) : (
        <div className="flex flex-col gap-2">
          <Button size="lg" disabled={blockers.length > 0} onClick={() => navigate({ name: 'find', id: scan.id })}>
            <Search aria-hidden className="size-4" />
            {t.details.findEmployee}
          </Button>
          {blockers.length > 0 ? (
            <ul className="text-center text-sm text-muted-foreground">
              {blockers.map((b) => (
                <li key={b}>{t.details.blockers[b]}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <nav aria-label={t.details.pages} className="flex justify-around border-t border-border pt-2">
        <Button variant="ghost" size="icon" aria-label={t.details.download} title={t.details.download} onClick={() => void download()}>
          <Download aria-hidden className="size-5" />
        </Button>
        {!saved && current?.source ? (
          <Button variant="ghost" size="icon" aria-label={t.details.adjust} title={t.details.adjust} onClick={() => navigate({ name: 'adjust', id: scan.id, page })}>
            <Crop aria-hidden className="size-5" />
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" aria-label={t.details.remove} title={t.details.remove} onClick={() => void remove()}>
          <Trash2 aria-hidden className="size-5" />
        </Button>
      </nav>

      <ActionSheet sheet={share} title={t.details.download} description={t.details.downloadHint} actions={[{ value: 'download', label: t.details.download }]} />
      <ActionSheet sheet={removal} title={t.details.removeTitle} description={t.details.removeHint} actions={[{ value: 'remove', label: t.details.remove, destructive: true }]} />
    </div>
  )

  function retake() {
    sessions.setRetake({ replaces: scan.id, kind: scan.kind })
    navigate({ name: 'camera' })
  }
}

function SavedLink({ scan }: { scan: Session }) {
  const employee = scan.employeeId ?? scan.saved?.employeeId
  if (!employee) return null
  return (
    <a href={staffHref(`/employees/${employee}/page`)} className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
      {t.details.openEmployee}
    </a>
  )
}

function Actions({ onRetake, onType }: { onRetake: () => void; onType: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" onClick={onRetake}>
        <Camera aria-hidden className="size-4" />
        {t.details.retake}
      </Button>
      <Button size="sm" variant="outline" onClick={onType}>
        <Keyboard aria-hidden className="size-4" />
        {t.details.typeMrz}
      </Button>
    </div>
  )
}

function Banner({ tone, title, children, actions }: { tone: 'ok' | 'err'; title: string; children: string; actions?: React.ReactNode }) {
  const Icon = tone === 'ok' ? CircleCheck : CircleAlert
  return (
    <div role={tone === 'err' ? 'alert' : 'status'} className={tone === 'ok' ? 'flex gap-3 rounded-xl bg-emerald-500/12 p-3' : 'flex gap-3 rounded-xl bg-destructive/10 p-3'}>
      <Icon aria-hidden className={tone === 'ok' ? 'mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300' : 'mt-0.5 size-5 shrink-0 text-destructive'} />
      <div className="flex flex-col text-sm">
        <span className="font-semibold">{title}</span>
        <span>{children}</span>
        {actions}
      </div>
    </div>
  )
}

function NameField({ label, value, chip, disabled, onChange }: { label: string; value: string; chip: React.ReactNode; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <div className="flex items-end gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <Field label={label}>{(p) => <Input {...controlProps(p)} value={value} disabled={disabled} autoComplete="off" onChange={(e) => onChange(e.target.value)} />}</Field>
      </div>
      <div className="pb-2.5">{chip}</div>
    </div>
  )
}
