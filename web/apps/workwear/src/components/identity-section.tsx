import {
  ApiError,
  type DocumentCopySide,
  type IdentityDocument,
  type PersonnelRetention,
  type ShownDocument,
} from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { launcherHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { ActionError } from '@ppe/ui/components/states'
import { useAction } from '@ppe/ui/lib/use-action'
import { useLoad } from '@ppe/ui/lib/use-load'
import { Eye, EyeOff, ScanLine, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { t } from '@/i18n'
import { todayIn } from '@/lib/assets'
import { SHOWN_MS, copiesInOrder, validityLines, visibleDocuments } from '@/lib/identity'
import { useOpenKey } from '@/lib/open-sections'

/**
 * Identity on an employee's page (ADR 0007; FR-15, FR-19, FR-20, D11):
 * everyone sees the "valid until" line of their current documents; whoever
 * holds personnel.documents.read sees the documents a scan added to the
 * employee record, and Show Document (a recent sign-in, recorded, hidden
 * again after a minute); whoever manages them sees every document, Add to
 * Employee Record, Remove, Mark Employment Ended and Legal Hold. Nothing
 * sealed is ever loaded until Show Document is pressed.
 */
export function IdentitySection({ employeeId, timeZone }: { employeeId: string; timeZone: string | undefined }) {
  const session = useSession()
  const canRead = session.can('personnel.documents.read')
  return canRead ? <PersonnelFile employeeId={employeeId} timeZone={timeZone} /> : <ValidityLine employeeId={employeeId} timeZone={timeZone} />
}

/** The line anyone may read: each current document's kind, state and expiry; nothing when there is none. */
function ValidityLine({ employeeId, timeZone }: { employeeId: string; timeZone: string | undefined }) {
  const { client } = useApi()
  const validity = useLoad(() => client.personnel.validity(employeeId), [employeeId])
  const lines = validityLines(validity.data ?? [], todayIn(timeZone))
  if (lines.length === 0) return null
  return (
    <section aria-labelledby="identity-validity" className="mb-6 text-sm">
      <h2 id="identity-validity" className="sr-only">
        {t.identity.section}
      </h2>
      <ul className="flex flex-col gap-1">
        {lines.map((l, i) => (
          <li key={i} className={l.expired ? 'flex items-center gap-1.5 text-warning' : 'text-muted-foreground'}>
            {l.expired ? <TriangleAlert aria-hidden className="size-4" /> : null}
            {l.expired
              ? t.identity.expiredOn(t.identity.kinds[l.kind], l.issuing_state, l.expires_on)
              : t.identity.validUntil(t.identity.kinds[l.kind], l.issuing_state, l.expires_on)}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The personnel file, for personnel.documents.read; its managing for personnel.documents.manage. */
function PersonnelFile({ employeeId, timeZone }: { employeeId: string; timeZone: string | undefined }) {
  const { client } = useApi()
  const canManage = useSession().can('personnel.documents.manage')
  const docs = useLoad(() => client.personnel.documents(employeeId), [employeeId])
  // No personnel file is no error: the employee has no document yet.
  const retention = useLoad(
    () => client.personnel.retention(employeeId).catch((e: unknown) => (e instanceof ApiError && e.isNotFound ? null : Promise.reject(e))),
    [employeeId],
  )
  const shown = visibleDocuments(docs.data ?? [], canManage)
  const today = todayIn(timeZone)
  const reload = () => {
    docs.reload()
    retention.reload()
  }

  return (
    <DisclosureSection
      id="identity"
      title={t.identity.section}
      count={docs.data ? shown.length : undefined}
      description={t.identity.sectionHint}
      rememberAs={useOpenKey('employee.identity')}
      action={
        canManage ? (
          <a href={launcherHref('/docs-import/')} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <ScanLine aria-hidden className="size-4" />
            {t.identity.importDocument}
          </a>
        ) : undefined
      }
    >
      <ActionError error={docs.error ?? retention.error} />
      {docs.data && shown.length === 0 ? <p className="text-sm text-muted-foreground">{t.identity.none}</p> : null}
      <ul className="flex flex-col divide-y divide-border">
        {shown.map((d) => (
          <DocumentRow key={d.id} doc={d} today={today} canManage={canManage} onChanged={reload} />
        ))}
      </ul>
      {canManage && retention.data ? <Retention employeeId={employeeId} retention={retention.data} today={today} onChanged={reload} /> : null}
    </DisclosureSection>
  )
}

function DocumentRow({ doc, today, canManage, onChanged }: { doc: IdentityDocument; today: string; canManage: boolean; onChanged: () => void }) {
  const { client } = useApi()
  const action = useAction()
  const [opened, setOpened] = useState<ShownDocument | null>(null)
  const [image, setImage] = useState<{ side: DocumentCopySide; url: string } | null>(null)
  const kind = t.identity.kinds[doc.kind]
  const isExpired = doc.expires_on < today

  // What Show Document opened hides again after a minute, or once the tab is in the background (FR-14).
  const hide = () => {
    setOpened(null)
    setImage((cur) => {
      if (cur) URL.revokeObjectURL(cur.url)
      return null
    })
  }
  const showing = opened !== null || image !== null
  useEffect(() => {
    if (!showing) return
    const timer = setTimeout(hide, SHOWN_MS)
    const onVisibility = () => document.visibilityState === 'hidden' && hide()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [showing])
  useEffect(() => () => hide(), [])

  const show = () => action.run(async () => setOpened(await client.personnel.show(doc.id)))
  const showCopy = (side: DocumentCopySide) =>
    action.run(async () => {
      const { blob } = await client.personnel.showCopy(doc.id, side)
      setImage((cur) => {
        if (cur) URL.revokeObjectURL(cur.url)
        return { side, url: URL.createObjectURL(blob) }
      })
    })

  return (
    <li className="flex flex-col gap-3 py-3" aria-label={`${kind} ${doc.issuing_state}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium">
          {kind} · {doc.issuing_state}
        </p>
        <p className={isExpired ? 'text-sm text-warning' : 'text-sm text-muted-foreground'}>
          {isExpired ? t.identity.expired(doc.expires_on) : t.identity.until(doc.expires_on)}
          {doc.superseded_at ? ` · ${t.identity.replaced}` : ''}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {doc.on_employee_record ? t.identity.onRecord : t.identity.filedOnly}
        {doc.issued_on ? ` · ${t.identity.issuedOn(doc.issued_on)}` : ''}
      </p>

      <div className="flex flex-wrap gap-2">
        {opened ? (
          <Button variant="secondary" size="sm" onClick={hide}>
            <EyeOff aria-hidden className="size-4" />
            {t.identity.hide}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void show()} disabled={action.pending}>
            <Eye aria-hidden className="size-4" />
            {t.identity.show}
          </Button>
        )}
        {copiesInOrder(doc.copies).map((side) => (
          <Button key={side} variant="ghost" size="sm" onClick={() => void showCopy(side)} disabled={action.pending}>
            {t.identity.showCopy[side]}
          </Button>
        ))}
        {canManage ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void action.run(async () => {
                  await client.personnel.setEmployeeRecord(doc.id, !doc.on_employee_record)
                  onChanged()
                })
              }
            >
              {doc.on_employee_record ? t.identity.takeOffRecord : t.identity.addToRecord}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() =>
                void action.run(
                  async () => {
                    hide()
                    await client.personnel.remove(doc.id)
                    onChanged()
                  },
                  { confirm: t.identity.confirmRemove(kind, doc.issuing_state) },
                )
              }
            >
              {t.identity.remove}
            </Button>
          </>
        ) : null}
      </div>
      <ActionError error={action.error} />

      {opened ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <FactGrid ruled={false}>
            <Fact label={t.identity.fields.number}>
              <span className="font-mono">{opened.fields.number}</span>
            </Fact>
            {opened.fields.personal_code ? (
              <Fact label={t.identity.fields.personalCode}>
                <span className="font-mono">{opened.fields.personal_code}</span>
              </Fact>
            ) : null}
            <Fact label={t.identity.fields.names}>{`${opened.fields.given_names} ${opened.fields.surname}`.trim()}</Fact>
            {opened.fields.birth_date ? <Fact label={t.identity.fields.birthDate}>{opened.fields.birth_date}</Fact> : null}
            <Fact label={t.identity.fields.nationality}>{opened.fields.nationality}</Fact>
            {opened.fields.place_of_birth ? <Fact label={t.identity.fields.placeOfBirth}>{opened.fields.place_of_birth}</Fact> : null}
            {opened.fields.authority ? <Fact label={t.identity.fields.authority}>{opened.fields.authority}</Fact> : null}
            <Fact label={t.identity.fields.mrz} wide>
              <span className="font-mono text-xs break-all whitespace-pre-line">{opened.fields.mrz.join('\n')}</span>
            </Fact>
          </FactGrid>
          <p className="text-xs text-muted-foreground">{t.identity.shownNote}</p>
        </div>
      ) : null}
      {image ? (
        <figure className="flex flex-col gap-1">
          <img src={image.url} alt={t.identity.showCopy[image.side]} className="max-h-96 w-full rounded border border-border object-contain" />
          <figcaption className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {t.identity.shownNote}
            <Button variant="ghost" size="sm" onClick={hide}>
              {t.identity.hide}
            </Button>
          </figcaption>
        </figure>
      ) : null}
    </li>
  )
}

/** Mark Employment Ended and Legal Hold (FR-20, D3): what the cleanup after 3 years runs from, and what stops it. */
function Retention({
  employeeId,
  retention,
  today,
  onChanged,
}: {
  employeeId: string
  retention: PersonnelRetention
  today: string
  onChanged: () => void
}) {
  const { client } = useApi()
  const action = useAction()
  const [endedOn, setEndedOn] = useState(today)
  const [holdUntil, setHoldUntil] = useState('')
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState<'ended' | 'hold' | null>(null)
  // After a change: the form closes and the file is read again.
  const done = (_changed?: PersonnelRetention) => {
    setEditing(null)
    onChanged()
  }

  return (
    <section aria-labelledby="identity-retention" className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <h3 id="identity-retention" className="text-sm font-semibold">
        {t.identity.retention}
      </h3>
      <p className="text-sm text-muted-foreground">{t.identity.retentionHint}</p>
      <FactGrid ruled={false}>
        <Fact label={t.identity.employmentEnded}>{retention.employment_ended_on ?? t.identity.employed}</Fact>
        <Fact label={t.identity.legalHold}>
          {retention.hold_until ? t.identity.heldUntil(retention.hold_until, retention.hold_reason ?? '') : t.identity.noHold}
        </Fact>
      </FactGrid>
      <div className="flex flex-wrap gap-2">
        {retention.employment_ended_on ? (
          <Button variant="outline" size="sm" onClick={() => void action.run(async () => done(await client.personnel.setEmploymentEnded(employeeId, null)))}>
            {t.identity.clearEnded}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing('ended')}>
            {t.identity.markEnded}
          </Button>
        )}
        {retention.hold_until ? (
          <Button variant="outline" size="sm" onClick={() => void action.run(async () => done(await client.personnel.setHold(employeeId, null)))}>
            {t.identity.clearHold}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing('hold')}>
            {t.identity.setHold}
          </Button>
        )}
      </div>

      {editing === 'ended' ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void action.run(async () => done(await client.personnel.setEmploymentEnded(employeeId, endedOn)))
          }}
        >
          <Field label={t.identity.endedOn}>
            {(p) => <Input {...controlProps(p)} type="date" max={today} required value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />}
          </Field>
          <Button type="submit">{t.identity.markEnded}</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
            {t.common.cancel}
          </Button>
        </form>
      ) : null}
      {editing === 'hold' ? (
        <form
          className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            void action.run(async () => done(await client.personnel.setHold(employeeId, holdUntil, reason)))
          }}
        >
          <Field label={t.identity.holdUntil}>
            {(p) => <Input {...controlProps(p)} type="date" min={today} required value={holdUntil} onChange={(e) => setHoldUntil(e.target.value)} />}
          </Field>
          <Field label={t.identity.holdReason} hint={t.identity.holdReasonHint}>
            {(p) => <Input {...controlProps(p)} required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Button type="submit">{t.identity.setHold}</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
            {t.common.cancel}
          </Button>
        </form>
      ) : null}
      <ActionError error={action.error} />
    </section>
  )
}
