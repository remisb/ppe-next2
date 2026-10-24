import type { AssetAssignment, AssetKind, ConnectionStatus } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Button } from '@ppe/ui/components/button'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { ActionError, Loaded } from '@ppe/ui/components/states'
import { Tooltip, TooltipContent, TooltipTrigger } from '@ppe/ui/components/tooltip'
import { RuleList } from '@ppe/ui/components/rule-list'
import { formatDate } from '@ppe/ui/lib/dates'
import { useRememberedOpen } from '@ppe/ui/lib/remembered-open'
import { saveFile } from '@ppe/ui/lib/save-file'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { formatEuro } from '@ppe/i18n'
import { cn } from '@ppe/ui/lib/utils'
import { linkVariants } from '@ppe/ui/components/link'
import { BackButton } from '@ppe/ui/components/back-button'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { RecordHeader, RecordTitle } from '@ppe/ui/components/record-header'
import { useAction } from '@ppe/ui/lib/use-action'
import { FileDown, Printer, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { AssetMoreActions, CopyButton, NotReturnedBadge, ReturnButton, StatusBadge, StatusMenu, setStatus } from '@/components/asset-controls'
import { AssignmentFormDocument } from '@/components/assignment-form'
import { type AssetSheet, AssetSheets } from '@/components/asset-sheets'
import { EquipmentForm } from '@/components/equipment-form'
import { usePrintInPlace } from '@/components/print-in-place'
import { SignedCopies } from '@/components/signed-copies'
import { SimCardForm } from '@/components/sim-card-form'
import { t } from '@/i18n'
import { categoryLabel, formatDay, locationText, primaryAction, simCopyText, todayIn } from '@/lib/assets'
import { type Route, linkTo } from '@/lib/router'
import { useOpenKey } from '@/lib/open-sections'

const link = linkVariants({ weight: 'medium' })

/**
 * Where the asset is shown: on its own page (/assets/<id>), whose way out is
 * Back to its register; or beside its register, SIM Cards or Equipment (from
 * lg), where it closes, and instead of it on a narrow screen, where it goes
 * Back to the list (as an order beside Orders).
 */
export type AssetPlace = { page: true; onBack: (kind: AssetKind) => void } | { page: false; kind: AssetKind; onClose: () => void }

/**
 * One asset: its numbers to copy, the three facts the brief keeps apart (§2:
 * Connection, Where, Held by), the one action its state calls for, every
 * assignment with its form, and its Changes. A phone works here. Its parts
 * lay out by the room they have (a container), so the same detail fits the
 * page and the pane beside the register.
 */
export function AssetDetail({
  id,
  place,
  navigate,
  onOpen,
  onChanged,
  refresh = 0,
}: {
  id: string
  place: AssetPlace
  navigate: (to: Route) => void
  /** Open another asset: the one that already has a number typed on Edit. */
  onOpen: (id: string) => void
  /** Something here changed the asset: the register beside it loads again. */
  onChanged?: (() => void) | undefined
  /** Changes when the register beside it changed the asset, which loads it again. */
  refresh?: number
}) {
  const { client } = useApi()
  const canManage = useSession().can('assets.manage')
  const changesKey = useOpenKey('asset.changes')
  // Assignments are closed at first, as Changes are, then as the user left them. An action
  // here (Give, Register Return, …) opens them, so its result shows, without changing what is remembered.
  const [assignmentsRemembered, rememberAssignments] = useRememberedOpen(useOpenKey('asset.assignments'), false)
  const [assignmentsOpened, setAssignmentsOpened] = useState(false)
  const settings = useLoad(() => client.settings())
  const tz = settings.data?.timezone
  const today = todayIn(tz)
  const asset = useLoad(() => client.assets.get(id), [id, refresh])
  const [sheet, setSheet] = useState<AssetSheet>(null)
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const action = useAction()

  const a = asset.data
  const sim = a?.kind !== 'EQUIPMENT'
  // Beside the register, the register loads both again (refresh); on its own, the page loads the asset.
  const changed = () => (onChanged ? onChanged() : asset.reload())
  const changeStatus = (next: ConnectionStatus) =>
    a &&
    action.run(async () => {
      setMessage(await setStatus(client, a, next))
      changed()
    })
  const copied = (value: string) => (ok: boolean) => setMessage(ok ? t.assets.copied(value) : t.assets.copyFailed)
  // The page's title is its h1; beside the register, the register's title is, as an order's beside Orders.
  const Title = place.page ? 'h1' : 'h2'
  // A SIM's phone number and SIM No.: as large as a title, by the room the detail has (a SIM No. is 20 digits).
  const simNumber = cn('font-mono text-lg font-semibold whitespace-nowrap tracking-tight tabular-nums @sm:text-xl', place.page && '@2xl:text-2xl')

  return (
    <article aria-label={a ? a.inventory_no : sim ? t.assets.simCard : t.assets.item} className="@container">
      {place.page ? (
        // Back to its register: SIM Cards or Equipment, once the asset says which.
        <BackButton className="mb-2" onClick={() => place.onBack(sim ? 'SIM' : 'EQUIPMENT')}>{!a ? t.assets.title : sim ? t.assets.simCards : t.assets.equipment}</BackButton>
      ) : (
        <>
          {/* Narrow: the card is the whole screen, so the way out is Back to the list, on its own row. */}
          <BackButton className="mb-2 lg:hidden" onClick={place.onClose}>{place.kind === 'SIM' ? t.assets.simCards : t.assets.equipment}</BackButton>
          {/* Beside the list: Close sits in the pane's corner, beside the heading. */}
          <Button variant="ghost" size="icon" className="absolute top-2 right-2 max-lg:hidden" aria-label={place.kind === 'SIM' ? t.assets.closeCard : t.assets.closeItem} onClick={place.onClose}>
            <X aria-hidden />
          </Button>
        </>
      )}
      <Loaded load={asset}>
        {(a) => (
          <>
            {/*
              What a manager reads out or sends the provider: the phone number over the SIM No., both large, named by a
              tooltip rather than a label; the first of them is the heading, the inventory number follows, smaller.
              The action stays in the top right corner (RecordHeader).
            */}
            <RecordHeader
              beside={!place.page}
              className={cn(place.page && 'mb-5 md:mb-6')}
              title={
                !sim ? (
                  <RecordTitle as={place.page ? 'h1' : 'h2'} className={cn(place.page && 'md:text-2xl')}>
                    {a.inventory_no}
                  </RecordTitle>
                ) : a.phone_no ? (
                  <SimNumber as={Title} label={t.assets.phoneNo} className={simNumber}>
                    {a.phone_no}
                  </SimNumber>
                ) : (
                  <p className="text-muted-foreground">{t.assets.noPhoneNo}</p>
                )
              }
              actions={
                canManage ? (
                  <>
                    {primaryAction(a) === 'give' ? (
                      <Button onClick={() => setSheet({ kind: 'give', asset: a })}>{sim ? t.assets.giveSimCard : t.assets.giveAsset}</Button>
                    ) : null}
                    {primaryAction(a) === 'return' ? (
                      <ReturnButton kind={a.kind} onClick={() => setSheet({ kind: 'return', asset: a })} />
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
            >
              {sim && a.sim_no ? (
                // One button copying both numbers, beside the second of them; it takes no more height than the number,
                // so the two numbers stay close.
                <div className="flex items-center gap-1">
                  <SimNumber as={a.phone_no ? 'p' : Title} label={t.assets.simNo} className={simNumber}>
                    {a.sim_no}
                  </SimNumber>
                  <span className="-my-2">
                    <CopyButton text={simCopyText(a)} label={t.assets.copyNumbers(a.inventory_no)} onCopied={copied(simCopyText(a))} />
                  </span>
                </div>
              ) : null}
              {sim ? (
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">{t.assets.inventoryNo}</span> <span className="font-mono">{a.inventory_no}</span>
                </p>
              ) : null}
              <p className="mt-1 max-w-prose text-sm text-muted-foreground empty:hidden">
                {(sim ? [a.provider, a.plan] : [a.name, a.category ? categoryLabel(a.category) : null]).filter(Boolean).join(' · ')}
              </p>
            </RecordHeader>
            <p role="status" className="mb-2 text-sm text-muted-foreground empty:hidden">
              {message}
            </p>
            <ActionError error={action.error} />

            {/*
              The three facts the brief keeps apart: changing one never changes another (§2). Connection
              is one line of its own at every width; Where and Held by are short, so they share the row below it.
              They and the details are not boxes, only lines between them, so the room goes to the content.
            */}
            <div className="grid grid-cols-2">
              {sim ? (
                <StateFact title={t.assets.connection} inline className="col-span-2">
                  <span className="flex flex-wrap items-center gap-2">
                    {a.connection_status ? <StatusBadge status={a.connection_status} /> : null}
                    {canManage && a.connection_status ? (
                      <StatusMenu number={a.inventory_no} status={a.connection_status} disabled={action.pending} onChange={(next) => void changeStatus(next)} />
                    ) : null}
                  </span>
                </StateFact>
              ) : null}
              <StateFact title={t.assets.where}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{locationText(a)}</span>
                  {a.open_assignment?.not_returned_at ? <NotReturnedBadge kind={a.kind} /> : null}
                </span>
              </StateFact>
              <StateFact title={t.assets.heldBy} className="pl-4">
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
              </StateFact>
            </div>

            <FactGrid aria-label={t.assets.details} className="mb-4">
              {sim ? (
                <>
                  <Fact label={t.assets.provider}>{a.provider ?? '–'}</Fact>
                  <Fact label={t.assets.plan}>{a.plan ?? '–'}</Fact>
                </>
              ) : (
                <>
                  <Fact label={t.assets.category}>{a.category ? categoryLabel(a.category) : '–'}</Fact>
                  <Fact label={t.assets.serialNo}>{a.serial_no ? <span className="font-mono">{a.serial_no}</span> : '–'}</Fact>
                </>
              )}
              <Fact label={t.assets.nonReturnValueShort}>{a.non_return_value_cents === null ? '–' : formatEuro(a.non_return_value_cents)}</Fact>
              {sim ? <Fact label={t.assets.receivedDate}>{a.received_date ? formatDay(a.received_date) : '–'}</Fact> : null}
              {a.comment ? (
                <Fact label={t.assets.comment} wide>
                  <span className="whitespace-pre-line">{a.comment}</span>
                </Fact>
              ) : null}
            </FactGrid>

            <DisclosureSection
              id={`assignments-${a.id}`}
              title={t.assets.assignmentsTitle}
              count={a.assignments.length}
              description={t.assets.assignmentsIntro}
              open={assignmentsRemembered || assignmentsOpened}
              onOpenChange={(next) => {
                setAssignmentsOpened(false)
                rememberAssignments(next)
              }}
            >
              {a.assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.assets.noAssignments}</p>
              ) : (
                // Flat, as the rest of the pane: a rule between givings, no boxes.
                <RuleList ordered>
                  {a.assignments.map((s) => (
                    <AssignmentItem
                      key={s.id}
                      assetId={a.id}
                      kind={a.kind}
                      inventoryNo={a.inventory_no}
                      assignment={s}
                      canManage={canManage}
                      timeZone={tz}
                      navigate={navigate}
                      onUploaded={(m) => {
                        setMessage(m)
                        changed()
                      }}
                    />
                  ))}
                </RuleList>
              )}
            </DisclosureSection>

            <RecordChanges load={() => client.audit.history('assets', id)} deps={[id, a.updated_at, a.assignments.length, a.open_assignment?.not_returned_at]} timeZone={tz} rememberAs={changesKey} className="mb-0" />

            <AssetSheets
              sheet={sheet}
              today={today}
              defaultPlan={settings.data?.default_sim_plan}
              onChange={setSheet}
              onDone={(m) => {
                setMessage(m)
                setAssignmentsOpened(true)
                changed()
              }}
            />
            {sim ? (
              <SimCardForm
                card={editing ? a : null}
                today={today}
                providers={settings.data?.sim_providers ?? []}
                onClose={() => setEditing(false)}
                onSaved={(saved) => {
                  setEditing(false)
                  setMessage(t.assets.saved(saved.inventory_no))
                  changed()
                }}
                onOpenExisting={(other) => {
                  setEditing(false)
                  onOpen(other)
                }}
              />
            ) : (
              <EquipmentForm
                item={editing ? a : null}
                onClose={() => setEditing(false)}
                onSaved={(saved) => {
                  setEditing(false)
                  setMessage(t.assets.saved(saved.inventory_no))
                  changed()
                }}
                onOpenExisting={(other) => {
                  setEditing(false)
                  onOpen(other)
                }}
              />
            )}
          </>
        )}
      </Loaded>
    </article>
  )
}

/**
 * One of the three facts: its title over its value, or, inline, both on one
 * line, the value at its end where the line is short (beside the register, on a
 * phone) and after the title where it is long. Where a long word leaves no room
 * (Russian on a phone), the value moves under the title in one piece.
 */
function StateFact({ title, inline = false, className, children }: { title: string; inline?: boolean; className?: string; children: ReactNode }) {
  return (
    // A line above each; the details' upper rule closes the last row.
    <div
      className={cn(
        'min-w-0 border-t border-border py-2.5',
        inline && 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2 @lg:justify-start @lg:gap-x-6',
        className,
      )}
    >
      <div className={cn('mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase', inline && 'mb-0')}>{title}</div>
      <div className={cn('text-sm', inline && 'max-w-full shrink-0')}>{children}</div>
    </div>
  )
}

/** One giving: who, from when to when, its form and what happened to it. */
function AssignmentItem({
  assetId,
  kind,
  inventoryNo,
  assignment: s,
  canManage,
  timeZone,
  navigate,
  onUploaded,
}: {
  assetId: string
  kind: AssetKind
  inventoryNo: string
  assignment: AssetAssignment
  canManage: boolean
  timeZone: string | undefined
  navigate: (to: Route) => void
  onUploaded: (message: string) => void
}) {
  return (
    <li className="text-sm">
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
          <NotReturnedBadge kind={kind} open={!s.returned_date} />
          <span>
            {t.assets.markedNotReturned(formatDate(s.not_returned_at, timeZone))}
            {s.whereabouts ? ` · ${t.assets.whereaboutsLabel[s.whereabouts]}` : ''}
          </span>
          {s.not_returned_comment ? <span className="basis-full whitespace-pre-line text-muted-foreground">{s.not_returned_comment}</span> : null}
        </p>
      ) : null}
      {s.return_comment ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{s.return_comment}</p> : null}
      {s.paper_form_signed ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t.assets.formSigned}</span>
          <StoredFormActions assetId={assetId} assignmentId={s.id} />
        </p>
      ) : null}
      {s.paper_form_signed ? (
        <SignedCopies assetId={assetId} inventoryNo={inventoryNo} assignment={s} canManage={canManage} timeZone={timeZone} onUploaded={onUploaded} />
      ) : null}
    </li>
  )
}

/**
 * Print form again and Download PDF for an assignment's stored form: printed
 * from this page with no tab of its own, or saved as a PDF. Each is recorded
 * as the user's activity (asset.form_printed).
 */
function StoredFormActions({ assetId, assignmentId }: { assetId: string; assignmentId: string }) {
  const { client } = useApi()
  const { print, printing } = usePrintInPlace()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setFailure(undefined)
    try {
      await action()
    } catch (err) {
      setFailure(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const reprint = () =>
    run(async () => {
      const f = await client.assets.form(assetId, assignmentId)
      await client.assets.recordFormReprinted(assetId, assignmentId).catch(() => {})
      print(<AssignmentFormDocument form={f.form} documentHash={f.document_hash} />)
    })
  const download = () =>
    run(async () => {
      const { blob, filename } = await client.assets.storedFormPDF(assetId, assignmentId)
      saveFile(blob, filename)
    })
  const action = `${link} inline-flex min-h-11 cursor-pointer items-center gap-1 disabled:opacity-50 md:min-h-0`
  return (
    <>
      <button type="button" className={action} disabled={busy} onClick={() => void reprint()}>
        <Printer aria-hidden className="size-3.5" /> {t.assets.printFormAgain}
      </button>
      <button type="button" className={action} disabled={busy} onClick={() => void download()}>
        <FileDown aria-hidden className="size-3.5" /> {t.assets.downloadPdf}
      </button>
      {failure ? (
        <span role="alert" className="basis-full text-destructive">
          {failure}
        </span>
      ) : null}
      {printing}
    </>
  )
}

/**
 * A SIM's phone number or SIM No., large and without a label beside it: the
 * label is a tooltip on hover, and screen readers hear it before the number.
 */
function SimNumber({ as: As, label, className, children }: { as: 'h1' | 'h2' | 'p'; label: string; className: string; children: ReactNode }) {
  // Keyed by its element: the SIM No. turns from heading to line when a phone number is added, and Base UI keeps
  // listening for hover on the element it first had.
  return (
    <Tooltip key={As}>
      <TooltipTrigger render={<As className={cn('w-fit', className)} />}>
        <span className="sr-only">{label} </span>
        {children}
      </TooltipTrigger>
      <TooltipContent aria-hidden side="top" align="start">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
