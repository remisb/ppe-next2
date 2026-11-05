import type { DocumentCheck, DocumentTake } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import type { Issue, Mrz } from '@ppe/mrz'
import { Thumb } from '@ppe/scan-kit/thumb'
import { Button } from '@ppe/ui/components/button'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { PageHeader } from '@ppe/ui/components/states'
import { useEffect, useMemo, useState } from 'react'

import { t } from '@/i18n'
import {
  blockers,
  differences,
  linesOf,
  needsChecking,
  parseDraft,
  readPhotoOf,
  type Draft,
  type Holder,
  type Photos,
  type Slot,
} from '@/lib/flow'
import { todayHere } from '@/lib/reader'

import { issueText, noteText } from './issues'
import { HolderLine } from './person-step'

/**
 * Step 3 (FR-7 to FR-10, FR-19): the code lines as read, editable, each
 * change parsed again at once; what they say; the names typed as printed;
 * what the code lines do not hold; Add to Employee Record, with what differs
 * from the employee on file; the API's check (a document on file, another
 * employee's code); then Save, all or none, with the photos as Document Copies.
 */
export function ReviewStep({
  holder,
  draft,
  onDraft,
  photos,
  pictures,
  onBack,
  onNext,
}: {
  holder: Holder
  draft: Draft
  onDraft: (d: Draft) => void
  photos: Photos
  pictures: ReadonlyMap<string, string>
  onBack: () => void
  /** Nothing stops Save: on to the portrait, where Save is. */
  onNext: () => void
}) {
  const { client } = useApi()
  const today = todayHere()
  const m = useMemo(() => parseDraft(draft, today), [draft, today])
  const [check, setCheck] = useState<DocumentCheck | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const set = (patch: Partial<Draft>) => onDraft({ ...draft, ...patch })

  // The API's check, a moment after the lines or names change; an answer to an earlier draft is dropped.
  const lines = useMemo(() => linesOf(draft.lines), [draft.lines])
  const employeeId = holder.kind === 'existing' ? holder.employee.id : undefined
  useEffect(() => {
    setCheck(undefined)
    if (!m?.valid) return
    let live = true
    setChecking(true)
    const timer = setTimeout(() => {
      client.personnel
        .check({ mrz: lines, surname: draft.surname, given_names: draft.givenNames, ...(employeeId ? { employee_id: employeeId } : {}) })
        .then(
          (c) => live && setCheck(c),
          () => live && setCheck(undefined),
        )
        .finally(() => live && setChecking(false))
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [client, lines, m?.valid, draft.surname, draft.givenNames, employeeId])

  const stops = blockers(holder, draft, m, check)
  const diffs = draft.addToRecord ? differences(holder, draft, m) : []
  const read = readPhotoOf(draft.type, photos)


  return (
    <>
      <PageHeader title={t.review.title} description={t.review.description} />
      <HolderLine holder={holder} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="flex min-w-0 flex-col gap-5">
          <Field label={t.review.lines} hint={t.review.linesHint} error={m && m.problems.length > 0 ? issueText(m.problems[0]!) : undefined}>
            {(p) => (
              <Textarea
                {...controlProps(p)}
                rows={3}
                spellCheck={false}
                autoCapitalize="characters"
                autoComplete="off"
                className="font-mono text-sm tracking-wider uppercase md:text-sm"
                value={draft.lines}
                onChange={(e) => set({ lines: e.target.value, checked: false })}
              />
            )}
          </Field>
          {m && m.problems.length > 1 ? <IssueList issues={m.problems.slice(1)} tone="problem" /> : null}
          {m && m.notes.length > 0 ? <IssueList issues={m.notes} tone="note" /> : null}
          {needsChecking(draft, m) ? (
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={draft.checked} onChange={(e) => set({ checked: e.target.checked })} />
              <span>
                <span className="font-medium">{t.review.checked}</span>
                <span className="block text-muted-foreground">{t.review.checkedHint}</span>
              </span>
            </label>
          ) : null}

          {m ? <ReadFields m={m} draft={draft} onKind={(kind) => set({ kind })} /> : null}

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-base font-semibold">{t.review.names}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.review.surname} required>
                {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.surname} onChange={(e) => set({ surname: e.target.value })} />}
              </Field>
              <Field label={t.review.givenNames} required={holder.kind === 'new'}>
                {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.givenNames} onChange={(e) => set({ givenNames: e.target.value })} />}
              </Field>
            </div>
            {check?.name_match === 'differs' ? <p className="text-sm text-warning">{t.review.namesDiffer}</p> : null}
            {check?.name_match === 'truncated' ? <p className="text-sm text-muted-foreground">{t.review.namesTruncated}</p> : null}
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-base font-semibold">{t.review.optional}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t.review.issuedOn}>
                {(p) => <Input {...controlProps(p)} type="date" value={draft.issuedOn} onChange={(e) => set({ issuedOn: e.target.value })} />}
              </Field>
              <Field label={t.review.placeOfBirth}>
                {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.placeOfBirth} onChange={(e) => set({ placeOfBirth: e.target.value })} />}
              </Field>
              <Field label={t.review.authority}>
                {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.authority} onChange={(e) => set({ authority: e.target.value })} />}
              </Field>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <label className="flex min-h-11 items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={draft.addToRecord}
                onChange={(e) => set({ addToRecord: e.target.checked, take: e.target.checked ? draft.take : [] })}
              />
              <span>
                <span className="font-medium">{t.review.addToRecord}</span>
                <span className="block text-sm text-muted-foreground">{t.review.addToRecordHint}</span>
              </span>
            </label>
            {diffs.length > 0 ? (
              <div className="flex flex-col gap-2 pl-6">
                <p className="text-sm font-medium">{t.review.differences}</p>
                <ul className="flex flex-col gap-2">
                  {diffs.map((d) => (
                    <li key={d.field}>
                      <label className="flex min-h-11 items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1 size-4"
                          checked={draft.take.includes(d.field)}
                          onChange={(e) => set({ take: toggle(draft.take, d.field, e.target.checked) })}
                        />
                        <span>
                          <span className="font-medium">{t.review.takeLabel(t.takes[d.field])}</span>
                          <span className="block text-muted-foreground">
                            {t.review.current}: {shown(d.field, d.current)} → {t.review.document}: {shown(d.field, d.document)}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </fieldset>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            {checking ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t.review.checking}
              </p>
            ) : null}
            {stops.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm text-destructive" aria-live="polite">
                {stops.map((s) => (
                  <li key={s}>{t.blockers[s]}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={onNext} disabled={stops.length > 0 || checking}>
                {t.review.next}
              </Button>
              <Button variant="outline" onClick={onBack}>
                {t.review.back}
              </Button>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-2" aria-label={t.review.photos}>
          {(Object.entries(photos) as [Slot, { id: string } | undefined][]).map(([slot, p]) =>
            p ? (
              <figure key={slot} className="flex flex-col gap-1">
                <Thumb src={pictures.get(p.id)} alt={t.capture[slot]} className={p === read ? 'h-56 object-contain' : 'h-32 object-contain'} />
                <figcaption className="text-xs text-muted-foreground">{t.capture[slot]}</figcaption>
              </figure>
            ) : null,
          )}
        </aside>
      </div>
    </>
  )
}

/** What the code lines say: never a value the API keeps outside the seal is shown elsewhere. */
function ReadFields({ m, draft, onKind }: { m: Mrz; draft: Draft; onKind: (kind: Draft['kind']) => void }) {
  const dash = '—'
  return (
    <section aria-labelledby="read-fields" className="flex flex-col gap-2">
      <h2 id="read-fields" className="text-base font-semibold">
        {t.review.fields}
      </h2>
      <FactGrid>
        <Fact label={t.review.kind}>
          {draft.type === 'card' ? (
            <Select aria-label={t.review.kind} value={draft.kind} onChange={(e) => onKind(e.target.value as Draft['kind'])}>
              <option value="id_card">{t.kinds.id_card}</option>
              <option value="residence_permit">{t.kinds.residence_permit}</option>
            </Select>
          ) : (
            t.kinds.passport
          )}
        </Fact>
        <Fact label={t.review.number}>
          <span className="font-mono">{m.documentNumber || dash}</span>
        </Fact>
        <Fact label={t.review.issuingState}>{m.issuingState || dash}</Fact>
        <Fact label={t.review.nationality}>{m.nationality || dash}</Fact>
        <Fact label={t.review.birthDate}>{m.birthDate ?? dash}</Fact>
        <Fact label={t.review.sex}>{m.sex ? t.sexes[m.sex] : dash}</Fact>
        <Fact label={t.review.expiresOn}>{m.expiryDate ?? dash}</Fact>
        {m.personalCode ? (
          <Fact label={t.review.personalCode}>
            <span className="font-mono">{m.personalCode.code}</span>
          </Fact>
        ) : null}
        {m.corrections.length > 0 ? (
          <Fact label={t.review.corrected} wide>
            {m.corrections.map((c) => t.fieldNames[c.field]).join(', ')}
          </Fact>
        ) : null}
      </FactGrid>
    </section>
  )
}

function IssueList({ issues, tone }: { issues: Issue<string>[]; tone: 'problem' | 'note' }) {
  return (
    <ul className={`flex flex-col gap-1 text-sm ${tone === 'problem' ? 'text-destructive' : 'text-muted-foreground'}`}>
      {issues.map((i, n) => (
        <li key={`${i.code}-${i.field ?? ''}-${n}`}>{tone === 'problem' ? issueText(i) : noteText(i)}</li>
      ))}
    </ul>
  )
}



function toggle(take: DocumentTake[], field: DocumentTake, on: boolean): DocumentTake[] {
  return on ? [...new Set([...take, field])] : take.filter((f) => f !== field)
}

function shown(field: DocumentTake, v: string | null): string {
  if (v === null || v === '') return t.review.none
  return field === 'sex' && (v === 'M' || v === 'F' || v === 'X') ? t.sexes[v] : v
}

