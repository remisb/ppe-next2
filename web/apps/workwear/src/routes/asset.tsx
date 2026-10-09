import type { AssetAssignment, ConnectionStatus } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'
import { formatEuro } from '@ppe/i18n'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowLeft, Printer } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { AssetMoreActions, CopyNumber, StatusBadge, StatusMenu } from '@/components/asset-controls'
import { type AssetSheet, AssetSheets } from '@/components/asset-sheets'
import { EquipmentForm } from '@/components/equipment-form'
import { SignedCopies } from '@/components/signed-copies'
import { SimCardForm } from '@/components/sim-card-form'
import { t } from '@/i18n'
import { categoryLabel, formatDay, primaryAction, statusLabel, todayIn } from '@/lib/assets'
import { type Route, linkTo } from '@/lib/router'

const link = 'rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * One asset (/assets/<id>): its numbers to copy, the three facts the brief
 * keeps apart (§2: Connection, Where, Held by), the one action its state calls
 * for, every assignment with its form, and its Changes. A phone works here:
 * the register's rows open this page.
 */
export function AssetPage({ id, navigate, onBack }: { id: string; navigate: (to: Route) => void; onBack: () => void }) {
  const { client } = useApi()
  const canManage = useSession().can('assets.manage')
  const settings = useLoad(() => client.settings())
  const tz = settings.data?.timezone
  const today = todayIn(tz)
  const asset = useLoad(() => client.assets.get(id), [id])
  const [sheet, setSheet] = useState<AssetSheet>(null)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState<unknown>()
  const [saving, setSaving] = useState(false)

  const a = asset.data
  const sim = a?.kind !== 'EQUIPMENT'
  const changeStatus = async (next: ConnectionStatus) => {
    if (!a) return
    setSaving(true)
    setActionError(undefined)
    try {
      await client.assets.setStatus(a.id, next)
      setMessage(t.assets.statusChanged(a.inventory_no, statusLabel(next)))
      asset.reload()
    } catch (err) {
      setActionError(err)
    } finally {
      setSaving(false)
    }
  }
  const copied = (value: string) => (ok: boolean) => setMessage(ok ? t.assets.copied(value) : t.assets.copyFailed)

  return (
    <>
      <Button variant="ghost" className="-ml-3 mb-2" onClick={onBack}>
        <ArrowLeft aria-hidden /> {t.assets.title}
      </Button>
      {asset.error ? (
        <ErrorState error={asset.error} onRetry={asset.reload} />
      ) : !a ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={a.inventory_no}
            description={(sim ? [a.provider, a.plan] : [a.name, a.category ? categoryLabel(a.category) : null]).filter(Boolean).join(' · ')}
            actions={
              canManage ? (
                <>
                  {primaryAction(a) === 'give' ? (
                    <Button onClick={() => setSheet({ kind: 'give', asset: a })}>{sim ? t.assets.giveSimCard : t.assets.giveAsset}</Button>
                  ) : null}
                  {primaryAction(a) === 'return' ? (
                    <Button onClick={() => setSheet({ kind: 'return', asset: a })}>{sim ? t.assets.registerReturn : t.assets.registerAssetReturn}</Button>
                  ) : null}
                  <AssetMoreActions
                    asset={a}
                    onStatus={(next) => void changeStatus(next)}
                    onEdit={() => setEditing(true)}
                    onNotReturned={() => setSheet({ kind: 'notReturned', asset: a })}
                    onBlockingEmail={() => setSheet({ kind: 'email', asset: a })}
                  />
                </>
              ) : undefined
            }
          />
          {sim ? (
          <p className="mb-4 flex flex-wrap gap-x-6 gap-y-1">
            {a.sim_no ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t.assets.simNo}</span>
                <CopyNumber value={a.sim_no} label={t.assets.copySimNo(a.sim_no)} onCopied={copied(a.sim_no)} />
              </span>
            ) : null}
            <span className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t.assets.phoneNo}</span>
              {a.phone_no ? <CopyNumber value={a.phone_no} label={t.assets.copyPhoneNo(a.phone_no)} onCopied={copied(a.phone_no)} /> : <span>{t.assets.noPhoneNo}</span>}
            </span>
          </p>
          ) : null}
          <p role="status" className="mb-2 text-sm text-muted-foreground empty:hidden">
            {message}
          </p>
          {actionError ? <ErrorState title={t.common.actionFailed} error={actionError} /> : null}

          {/* The three facts the brief keeps apart: changing one never changes another (§2). */}
          <div className={cn('mb-4 grid gap-3', sim ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
            {sim ? (
            <Fact title={t.assets.connection}>
              <span className="flex flex-wrap items-center gap-2">
                {a.connection_status ? <StatusBadge status={a.connection_status} /> : null}
                {canManage && a.connection_status ? (
                  <StatusMenu number={a.inventory_no} status={a.connection_status} disabled={saving} onChange={(next) => void changeStatus(next)} />
                ) : null}
              </span>
            </Fact>
            ) : null}
            <Fact title={t.assets.where}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.location === 'OFFICE' ? t.assets.office : a.location === 'UNKNOWN' ? t.assets.unknown : t.assets.withAnEmployee}</span>
                {a.open_assignment?.not_returned_at ? <Badge variant="destructive">{t.assets.notReturned}</Badge> : null}
              </span>
            </Fact>
            <Fact title={t.assets.heldBy}>
              {a.open_assignment ? (
                <>
                  <a {...linkTo({ name: 'employee', id: a.open_assignment.employee_id }, navigate)} className={link}>
                    {a.open_assignment.employee_name}
                  </a>
                  <span className="block text-xs text-muted-foreground">
                    {t.assets.heldSince(formatDay(a.open_assignment.given_date), t.assets.daysHeld(a.open_assignment.days_held))}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">{t.assets.nobody}</span>
              )}
            </Fact>
          </div>
          {a.connection_status === 'NOT_ACTIVATED' ? (
            <p role="note" className="mb-4 rounded-md bg-muted px-3 py-2 text-sm">
              {t.assets.activateNote}
            </p>
          ) : null}

          <dl aria-label={t.assets.details} className="mb-8 grid grid-cols-2 gap-4 rounded-lg border border-border p-4 text-sm sm:max-w-2xl sm:grid-cols-3">
            {sim ? (
              <>
                <Detail label={t.assets.provider}>{a.provider ?? '—'}</Detail>
                <Detail label={t.assets.plan}>{a.plan ?? '—'}</Detail>
              </>
            ) : (
              <>
                <Detail label={t.assets.category}>{a.category ? categoryLabel(a.category) : '—'}</Detail>
                <Detail label={t.assets.serialNo}>{a.serial_no ? <span className="font-mono">{a.serial_no}</span> : '—'}</Detail>
              </>
            )}
            <Detail label={t.assets.nonReturnValueShort}>{a.non_return_value_cents === null ? '—' : formatEuro(a.non_return_value_cents)}</Detail>
            {sim ? <Detail label={t.assets.receivedDate}>{a.received_date ? formatDay(a.received_date) : '—'}</Detail> : null}
            {a.comment ? (
              <div className="col-span-2 sm:col-span-3">
                <Detail label={t.assets.comment}>
                  <span className="whitespace-pre-line">{a.comment}</span>
                </Detail>
              </div>
            ) : null}
          </dl>

          <section aria-labelledby="assignments" className="mb-8">
            <h2 id="assignments" className="mb-1 text-lg font-semibold">
              {t.assets.assignmentsTitle}
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">{t.assets.assignmentsIntro}</p>
            {a.assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.assets.noAssignments}</p>
            ) : (
              <ol className="grid gap-3">
                {a.assignments.map((s) => (
                  <AssignmentItem
                    key={s.id}
                    assetId={a.id}
                    inventoryNo={a.inventory_no}
                    assignment={s}
                    canManage={canManage}
                    timeZone={tz}
                    navigate={navigate}
                    onUploaded={(m) => {
                      setMessage(m)
                      asset.reload()
                    }}
                  />
                ))}
              </ol>
            )}
          </section>

          <RecordChanges load={() => client.audit.history('assets', id)} deps={[id, a.updated_at, a.assignments.length, a.open_assignment?.not_returned_at]} timeZone={tz} />

          <AssetSheets
            sheet={sheet}
            today={today}
            onChange={setSheet}
            onDone={(m) => {
              setMessage(m)
              asset.reload()
            }}
          />
          {sim ? (
            <SimCardForm
              card={editing ? a : null}
              today={today}
              providers={[]}
              onClose={() => setEditing(false)}
              onSaved={(saved) => {
                setEditing(false)
                setMessage(t.assets.saved(saved.inventory_no))
                asset.reload()
              }}
              onOpenExisting={(other) => {
                setEditing(false)
                navigate({ name: 'asset', id: other })
              }}
            />
          ) : (
            <EquipmentForm
              item={editing ? a : null}
              onClose={() => setEditing(false)}
              onSaved={(saved) => {
                setEditing(false)
                setMessage(t.assets.saved(saved.inventory_no))
                asset.reload()
              }}
              onOpenExisting={(other) => {
                setEditing(false)
                navigate({ name: 'asset', id: other })
              }}
            />
          )}
        </>
      )}
    </>
  )
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

/** One giving: who, from when to when, its form and what happened to it. */
function AssignmentItem({
  assetId,
  inventoryNo,
  assignment: s,
  canManage,
  timeZone,
  navigate,
  onUploaded,
}: {
  assetId: string
  inventoryNo: string
  assignment: AssetAssignment
  canManage: boolean
  timeZone: string | undefined
  navigate: (to: Route) => void
  onUploaded: (message: string) => void
}) {
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a {...linkTo({ name: 'employee', id: s.employee_id }, navigate)} className={link}>
          {s.employee_name}
        </a>
        <span className="text-muted-foreground tabular-nums">{t.assets.daysHeld(s.days_held)}</span>
      </div>
      <p className="text-muted-foreground">
        {t.assets.givenOnDate(formatDay(s.given_date))} · {s.returned_date ? t.assets.returnedOnDate(formatDay(s.returned_date)) : t.assets.stillHeld}
      </p>
      {s.comment ? <p className="mt-1 whitespace-pre-line">{s.comment}</p> : null}
      {s.not_returned_at ? (
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="destructive">{t.assets.notReturned}</Badge>
          <span>
            {t.assets.markedNotReturned(formatDay(formatDateTime(s.not_returned_at, timeZone).slice(0, 10)))}
            {s.whereabouts ? ` · ${t.assets.whereaboutsLabel[s.whereabouts]}` : ''}
          </span>
          {s.not_returned_comment ? <span className="basis-full whitespace-pre-line text-muted-foreground">{s.not_returned_comment}</span> : null}
        </p>
      ) : null}
      {s.return_comment ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{s.return_comment}</p> : null}
      {s.paper_form_signed ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t.assets.formSigned}</span>
          <a {...linkTo({ name: 'assetForm', id: assetId, assignment: s.id }, navigate)} className={`${link} inline-flex min-h-11 items-center gap-1 md:min-h-0`}>
            <Printer aria-hidden className="size-3.5" /> {t.assets.printFormAgain}
          </a>
        </p>
      ) : null}
      {s.paper_form_signed ? (
        <SignedCopies assetId={assetId} inventoryNo={inventoryNo} assignment={s} canManage={canManage} timeZone={timeZone} onUploaded={onUploaded} />
      ) : null}
    </li>
  )
}
