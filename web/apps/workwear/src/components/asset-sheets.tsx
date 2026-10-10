import type { Asset, AssetKind, AssignmentFormResult, Whereabouts } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Field, Input, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { errorText } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowRight, Check, Copy, Printer } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useLoad } from '@ppe/ui/lib/use-load'

import { AssignmentFormDocument } from '@/components/assignment-form'
import { StatusBadge } from '@/components/asset-controls'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { t } from '@/i18n'
import {
  type GiveDraft,
  blockingEmail,
  cardBlock,
  categoryLabel,
  emptyGiveDraft,
  forgetPrinted,
  formatDay,
  formInput,
  formKey,
  giveBlock,
  recallPrinted,
  rememberPrinted,
} from '@/lib/assets'
import { pathOf } from '@/lib/router'
import { formatEuro, parseEuro } from '@/lib/utils'
import { basePath } from '@ppe/routing'

/**
 * Which action sheet is open, for which card; or Give SIM for an
 * employee, started from their page, where the card is chosen on the sheet.
 */
export type AssetSheet =
  | { kind: 'give' | 'return' | 'notReturned' | 'email'; asset: Asset; note?: string }
  | { kind: 'giveTo'; employee: PickedEmployee; assetKind: AssetKind }
  | null

/**
 * The sheets of a card's actions, shared by the register and the card's page.
 * Each is one short form with no confirmation step (§2); onDone reports what
 * happened, for the screen to announce and reload.
 */
export function AssetSheets({
  sheet,
  today,
  onChange,
  onDone,
}: {
  sheet: AssetSheet
  /** The organisation's day: the default and latest date. */
  today: string
  onChange: (next: AssetSheet) => void
  onDone: (message: string) => void
}) {
  const close = () => onChange(null)
  return (
    <>
      <GiveSheet
        open={sheet?.kind === 'give' || sheet?.kind === 'giveTo'}
        asset={sheet?.kind === 'give' ? sheet.asset : null}
        employee={sheet?.kind === 'giveTo' ? sheet.employee : null}
        assetKind={sheet?.kind === 'giveTo' ? sheet.assetKind : sheet?.kind === 'give' ? sheet.asset.kind : 'SIM'}
        today={today}
        onClose={close}
        onGiven={(m) => (close(), onDone(m))}
      />
      <ReturnSheet asset={sheet?.kind === 'return' ? sheet.asset : null} today={today} onClose={close} onReturned={(m) => (close(), onDone(m))} />
      <NotReturnedSheet
        asset={sheet?.kind === 'notReturned' ? sheet.asset : null}
        onClose={close}
        onMarked={(a, m) => {
          onDone(m)
          // The next step is offered at once: ask the provider to block the card, unless it already is.
          // Equipment has no provider to ask.
          onChange(a.kind !== 'SIM' || a.connection_status === 'BLOCKED' ? null : { kind: 'email', asset: a, note: `${m} ${t.assets.nextStepBlock}` })
        }}
      />
      <BlockingEmailSheet asset={sheet?.kind === 'email' ? sheet.asset : null} note={sheet?.kind === 'email' ? sheet.note : undefined} onClose={close} />
    </>
  )
}

const footerButtons = (onClose: () => void, children: ReactNode) => (
  <>
    <Button variant="outline" onClick={onClose}>
      {t.common.cancel}
    </Button>
    {children}
  </>
)

/**
 * Give SIM (§6–§8). The employee, the given date and any plan or value
 * the card lacks; Print Form prints the form the API would store, in a tab of
 * its own; the employee signs it; Paper Form Signed; Give SIM. A change
 * to the form after printing clears the tick and asks for a reprint, and the
 * API refuses a form that no longer matches what was printed.
 */
function GiveSheet({
  open,
  asset: fixed,
  employee,
  assetKind,
  today,
  onClose,
  onGiven,
}: {
  open: boolean
  /** The card, when Give starts from it; null to choose one among the cards in the office. */
  asset: Asset | null
  /** The employee, when Give starts from their page. */
  employee: PickedEmployee | null
  /** SIM cards or equipment: which to choose from, and the words. */
  assetKind: AssetKind
  today: string
  onClose: () => void
  onGiven: (message: string) => void
}) {
  const { client } = useApi()
  const { userId } = useSession()
  const [draft, setDraft] = useState<GiveDraft>(() => emptyGiveDraft(today))
  // The form printed: its data's key, and its hash once known (null while it is fetched).
  const [printed, setPrinted] = useState<{ key: string; hash: string | null } | null>(null)
  // The hash of the form as the data is now, fetched ahead of Print Form.
  const [hashed, setHashed] = useState<{ key: string; hash: string } | null>(null)
  const [signed, setSigned] = useState(false)
  const [preview, setPreview] = useState<AssignmentFormResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<Asset | null>(null)
  // A finished first step folds to one line; Change opens it again.
  const [editingDetails, setEditingDetails] = useState(false)
  const asset = fixed ?? picked
  // Which opening of the sheet and which form a preview answers: one that
  // arrives after the sheet closed or the form changed is dropped.
  const session = useRef(0)
  const currentKey = useRef('')

  useEffect(() => {
    session.current++
    if (!open) return
    setPicked(null)
    const base = {
      ...emptyGiveDraft(today),
      assetId: fixed?.id ?? '',
      ...(employee ? { employeeId: employee.id, employeeName: employee.full_name } : {}),
    }
    setDraft(base)
    setPrinted(null)
    setHashed(null)
    setSigned(false)
    setPreview(null)
    setShowPreview(false)
    setFailure(undefined)
    setEditingDetails(false)
    if (fixed) restorePrinted(fixed.id, base)
  }, [open, fixed?.id, employee?.id])

  /**
   * Back on a card whose form was printed here before the page reloaded (as
   * Safari may while the print tab is in front): its details and the printed
   * mark, so the paper in hand can be ticked as signed.
   */
  function restorePrinted(assetId: string, base: GiveDraft) {
    const form = recallPrinted(userId, assetId)
    if (!form || (base.employeeId !== '' && base.employeeId !== form.draft.employeeId) || form.draft.givenDate > today) return
    setDraft(form.draft)
    setPrinted({ key: form.key, hash: form.hash })
  }

  const key = formKey(draft)
  useEffect(() => {
    currentKey.current = key
  }, [key])
  const changedAfterPrint = printed !== null && printed.key !== key
  // A form printed, once its hash is known, is kept on this device for a reload.
  useEffect(() => {
    if (!printed?.hash || printed.key !== key || !draft.assetId) return
    if (recallPrinted(userId, draft.assetId)?.key === key) return
    rememberPrinted(userId, { key, hash: printed.hash, draft, at: Date.now() })
  }, [printed?.hash, printed?.key])
  // Anything that changes the form after printing takes the signature away (§8).
  useEffect(() => {
    if (changedAfterPrint) setSigned(false)
  }, [changedAfterPrint])
  // A preview shown is of the form as it is now; a change hides it until asked again.
  useEffect(() => setPreview(null), [key])

  const block = giveBlock(asset, draft, today, printed, signed, assetKind)
  // Furniture and other items are given without a signed form (spec, open decision 6).
  const paper = asset === null || asset.needs_form
  // The form can be printed once its data is complete: the reasons left are about the paper.
  const ready = block === null || block === t.assets.printFirstReason || block === t.assets.tickSignedReason
  const input = asset ? formInput(asset, draft) : null

  // The form is fetched ahead, a moment after its data stops changing, so that
  // Print Form marks it printed at the click itself: Safari does not finish a
  // request the page starts as the click opens the print tab.
  const prefetch = open && paper && ready && asset !== null
  useEffect(() => {
    if (!prefetch) return
    const id = window.setTimeout(() => void loadPreview(true), 300)
    return () => window.clearTimeout(id)
  }, [prefetch, key, asset?.id])

  if (!open) return <FormSheet open={false} onClose={onClose} title={t.assets.giveSimCard}>{null}</FormSheet>

  const set = <K extends keyof GiveDraft>(k: K, v: GiveDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const sim = assetKind === 'SIM'
  const cents = parseEuro(draft.value)
  const formPath =
    asset &&
    input &&
    basePath +
    pathOf({
      name: 'assetForm',
      id: asset.id,
      draft: {
        employeeId: draft.employeeId,
        givenDate: draft.givenDate,
        ...(input.plan ? { plan: input.plan } : {}),
        ...(input.non_return_value_cents != null ? { valueCents: input.non_return_value_cents } : {}),
      },
      print: true,
    })

  /** The form as the data is now; quiet (fetched ahead) leaves a failure unsaid. */
  function loadPreview(quiet = false): Promise<AssignmentFormResult | null> {
    if (!asset || !input) return Promise.resolve(null)
    if (!quiet) setFailure(undefined)
    const asked = { session: session.current, key }
    const current = () => session.current === asked.session && currentKey.current === asked.key
    return client.assets.previewForm(asset.id, input).then(
      (r) => {
        if (!current()) return null
        setPreview(r)
        setHashed({ key: asked.key, hash: r.document_hash })
        // Printed before the hash came: it is this form's.
        setPrinted((p) => (p && p.key === asked.key && p.hash === null ? { ...p, hash: r.document_hash } : p))
        return r
      },
      (err: unknown) => {
        if (current() && !quiet) setFailure(errorText(err))
        return null
      },
    )
  }

  const give = async () => {
    if (block !== null || !asset || !input || (asset.needs_form && !printed)) return
    setBusy(true)
    setFailure(undefined)
    try {
      // A hash still missing (its request lost to the print tab) is the same form's, asked again.
      const hash = asset.needs_form && printed ? (printed.hash ?? (await client.assets.previewForm(asset.id, input)).document_hash) : ''
      const a = await client.assets.give(asset.id, {
        ...input,
        comment: draft.comment.trim(),
        paper_form_signed: asset.needs_form,
        form_hash: hash,
      })
      forgetPrinted(userId, asset.id)
      onGiven(sim ? t.assets.givenTo(a.employee_name) : t.assets.assetGivenTo(a.employee_name))
    } catch (err) {
      // What was entered stays (§7); only a form that changed must be printed again.
      if (err instanceof ApiError && err.isConflict && /already given/i.test(err.message)) setFailure(t.assets.alreadyGivenError)
      else if (err instanceof ApiError && err.isConflict && /form changed/i.test(err.message)) {
        setFailure(t.assets.formChangedError)
        forgetPrinted(userId, asset.id)
        setPrinted(null)
        setSigned(false)
      } else setFailure(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  // The steps: who and when, the paper (when the asset needs a form), the hand-over.
  const detailsDone = ready
  const paperDone = printed !== null && !changedAfterPrint && signed
  const detailsState: StepState = detailsDone ? 'done' : 'current'
  // The details fold to one line once the form is printed from them (never while typing).
  const detailsFolded = detailsDone && paper && printed !== null && !changedAfterPrint && !editingDetails
  const paperState: StepState = !detailsDone ? 'locked' : paperDone ? 'done' : 'current'
  const handOverState: StepState = block === null ? 'current' : 'locked'
  const summary = [draft.employeeName, draft.givenDate ? formatDay(draft.givenDate) : null, input?.non_return_value_cents != null ? formatEuro(input.non_return_value_cents) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <FormSheet
      open
      onClose={onClose}
      title={sim ? t.assets.giveSimCard : t.assets.giveAsset}
      description={sim ? t.assets.giveDescription : t.assets.giveAssetDescription}
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {/* What is left, always in sight beside the button that waits for it. */}
          <p id="give-reason" role="status" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground sm:mr-auto">
            {block ? (
              <>
                <ArrowRight aria-hidden className="size-4 shrink-0" /> {block}
              </>
            ) : (
              <>
                <Check aria-hidden className="size-4 shrink-0" /> {sim ? t.assets.readyToGive : t.assets.readyToGiveAsset}
              </>
            )}
          </p>
          {/* As every sheet's footer: on a phone, full width with the action above Cancel. */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {footerButtons(
              onClose,
              <Button onClick={() => void give()} disabled={busy} aria-disabled={block !== null} aria-describedby="give-reason" className={cn(block !== null && 'opacity-50')}>
                {sim ? t.assets.giveSimCard : t.assets.giveAsset}
              </Button>,
            )}
          </div>
        </div>
      }
    >
      <div className="grid gap-3">
        {fixed ? <CardLine asset={fixed} /> : null}

        <Step n={1} state={detailsState} title={t.assets.stepDetails}>
          {detailsFolded ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 text-sm">
                {!fixed && asset ? <span className="font-mono">{asset.inventory_no} · </span> : null}
                {summary}
              </p>
              <Button variant="link" className="h-auto p-0 pointer-coarse:min-h-11" onClick={() => setEditingDetails(true)}>
                {t.assets.changeDetails}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              {fixed ? null : (
                <CardPicker
                  kind={assetKind}
                  selected={picked}
                  onSelect={(a) => {
                    setPicked(a)
                    set('assetId', a.id)
                    restorePrinted(a.id, { ...draft, assetId: a.id })
                  }}
                />
              )}
              <div className="grid gap-1.5">
                <span aria-hidden className="text-sm font-medium">
                  {t.assets.employee} <span className="text-destructive">*</span>
                </span>
                <EmployeePicker
                  label={t.assets.employee}
                  selected={draft.employeeId ? { id: draft.employeeId, full_name: draft.employeeName, code: null } : null}
                  onSelect={(e) => setDraft((d) => ({ ...d, employeeId: e.id, employeeName: e.full_name }))}
                  onClear={() => setDraft((d) => ({ ...d, employeeId: '', employeeName: '' }))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.assets.givenDate} required hint={t.assets.givenDateHint} error={draft.givenDate > today ? t.assets.dateInFuture : undefined}>
                  {(p) => <Input {...controlProps(p)} type="date" max={today} value={draft.givenDate} onChange={(e) => set('givenDate', e.target.value)} />}
                </Field>
                {asset?.kind === 'SIM' && asset.plan === null ? (
                  <Field label={t.assets.plan} hint={t.assets.planGiveHint}>
                    {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.plan} onChange={(e) => set('plan', e.target.value)} />}
                  </Field>
                ) : null}
                {asset?.needs_form && asset.non_return_value_cents === null ? (
                  <Field
                    label={t.assets.nonReturnValue}
                    required
                    hint={t.assets.missingHint}
                    error={draft.value.trim() && (cents === null || Number.isNaN(cents)) ? t.assets.valueInvalid : undefined}
                  >
                    {(p) => <Input {...controlProps(p)} inputMode="decimal" placeholder="0.00" value={draft.value} onChange={(e) => set('value', e.target.value)} />}
                  </Field>
                ) : null}
              </div>
              <Field label={t.assets.comment} hint={t.assets.optional}>
                {(p) => <Textarea {...controlProps(p)} rows={2} value={draft.comment} onChange={(e) => set('comment', e.target.value)} />}
              </Field>
              {editingDetails && detailsDone && printed !== null ? (
                <Button variant="outline" className="justify-self-start" onClick={() => setEditingDetails(false)}>
                  {t.assets.doneDetails}
                </Button>
              ) : null}
            </div>
          )}
        </Step>

        {paper ? (
          <Step n={2} state={paperState} title={t.assets.stepPaper} hint={sim ? t.assets.signReminder : t.assets.signReminderAsset}>
            <div className="flex flex-wrap gap-2">
              {/* A link, so the browser opens the print tab from the click itself; the sheet keeps the printed form's hash. */}
              <a
                href={formPath || undefined}
                target="_blank"
                rel="noopener"
                aria-disabled={!ready}
                className={cn(buttonVariants({ variant: printed && !changedAfterPrint ? 'outline' : 'default' }), !ready && 'pointer-events-none opacity-50')}
                onClick={(e) => {
                  if (!ready) {
                    e.preventDefault()
                    return
                  }
                  // Marked at once, with the hash fetched ahead when there is one: nothing waits on this page.
                  const hash = hashed?.key === key ? hashed.hash : null
                  setPrinted({ key, hash })
                  setEditingDetails(false)
                  if (hash === null) void loadPreview()
                }}
              >
                <Printer aria-hidden /> {printed && !changedAfterPrint ? t.assets.printAgain : t.assets.printForm}
              </a>
              <Button
                variant="ghost"
                disabled={!ready}
                onClick={() => {
                  if (showPreview) setShowPreview(false)
                  else {
                    setShowPreview(true)
                    void loadPreview()
                  }
                }}
              >
                {showPreview ? t.assets.hidePreview : t.assets.previewForm}
              </Button>
            </div>
            {showPreview && preview ? (
              <div className="max-h-96 overflow-auto rounded-lg border border-border">
                <p className="px-4 pt-3 text-xs text-muted-foreground">{t.assets.formLayoutNote}</p>
                <AssignmentFormDocument form={preview.form} documentHash={preview.document_hash} />
              </div>
            ) : null}
            {changedAfterPrint ? (
              <p role="alert" className="text-sm text-destructive">
                {t.assets.changedAfterPrint}
              </p>
            ) : printed ? (
              <p className="text-sm text-muted-foreground">{t.assets.printedNote}</p>
            ) : null}
            <label className={cn('flex min-h-11 items-center gap-3 text-sm font-medium', (!printed || changedAfterPrint) && 'text-muted-foreground')}>
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={signed}
                disabled={!printed || changedAfterPrint}
                onChange={(e) => setSigned(e.target.checked)}
              />
              {t.assets.paperFormSigned}
            </label>
          </Step>
        ) : null}

        <Step
          n={paper ? 3 : 2}
          state={handOverState}
          title={sim ? t.assets.stepHandOver : t.assets.stepHandOverAsset}
          hint={paper ? (sim ? t.assets.stepHandOverHint : t.assets.stepHandOverHintAsset) : t.assets.noFormNeeded}
        />

        {failure ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}
      </div>
    </FormSheet>
  )
}

type StepState = 'done' | 'current' | 'locked'

/**
 * One step of Give: its number (a tick once done), its title and what it
 * asks for. The current step stands out; a later one is greyed until the
 * steps before it are done, so the order is plain without reading.
 */
function Step({ n, state, title, hint, children }: { n: number; state: StepState; title: string; hint?: string; children?: ReactNode }) {
  return (
    <section
      aria-label={title}
      aria-current={state === 'current' ? 'step' : undefined}
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-lg border p-3',
        state === 'current' ? 'border-primary/40 bg-background' : 'border-transparent',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-7 items-center justify-center rounded-full text-sm font-medium',
          state === 'done' && 'bg-primary text-primary-foreground',
          state === 'current' && 'border-2 border-primary text-foreground',
          state === 'locked' && 'border border-border text-muted-foreground',
        )}
      >
        {state === 'done' ? <Check className="size-4" /> : n}
      </span>
      <div className={cn('grid min-w-0 gap-3', state === 'locked' && 'text-muted-foreground')}>
        <div className="grid min-h-7 content-center gap-0.5">
          <h3 className="text-sm font-semibold">
            <span className="sr-only">{t.assets.stepOf(n, state)} </span>
            {title}
          </h3>
          {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
        </div>
        {/* A step not reached yet shows only what it will ask. */}
        {state === 'locked' ? null : children}
      </div>
    </section>
  )
}

/**
 * The cards in the office, for Give SIM from an employee's page (§6):
 * only cards with no holder are listed, each with its status; one that is
 * not Active or has no phone number is shown but cannot be chosen.
 */
function CardPicker({ kind, selected, onSelect }: { kind: AssetKind; selected: Asset | null; onSelect: (a: Asset) => void }) {
  const sim = kind === 'SIM'
  const { client } = useApi()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setTerm(q.trim()), 200)
    return () => window.clearTimeout(id)
  }, [q])
  const cards = useLoad(
    () => client.assets.list({ kind, location: 'OFFICE', sort: sim ? 'status' : 'name', page_size: 20, ...(term ? { q: term } : {}) }),
    [term],
  )
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">
        {sim ? t.assets.simCard : t.assets.item} <span className="text-destructive">*</span>
      </legend>
      <Input
        type="search"
        aria-label={sim ? t.assets.searchOfficeCards : t.assets.searchOfficeItems}
        placeholder={sim ? t.assets.searchOfficeCards : t.assets.searchOfficeItems}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div role="radiogroup" aria-label={sim ? t.assets.simCard : t.assets.item} className="grid max-h-60 gap-1.5 overflow-y-auto">
        {cards.data?.assets.length === 0 ? <p className="text-sm text-muted-foreground">{sim ? t.assets.noOfficeCards : t.assets.noOfficeItems}</p> : null}
        {(cards.data?.assets ?? []).map((a) => {
          const why = cardBlock(a)
          const chosen = selected?.id === a.id
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-disabled={why !== null}
              onClick={() => why === null && onSelect(a)}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                chosen && 'border-primary bg-accent',
                why === null ? 'cursor-pointer hover:bg-muted/50' : 'cursor-not-allowed bg-muted/40 text-muted-foreground',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="font-mono font-medium">{a.inventory_no}</span> {sim ? <span className="font-mono">{a.phone_no ?? a.sim_no}</span> : <span>{a.name}</span>}
                <span className="block text-xs text-muted-foreground">
                  {(sim ? [a.provider, a.plan] : [a.category ? categoryLabel(a.category) : null, a.serial_no]).filter(Boolean).join(' · ')}
                </span>
              </span>
              {a.connection_status ? <StatusBadge status={a.connection_status} /> : null}
              {why === t.assets.noPhoneNo ? <span className="text-xs">{why}</span> : null}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/** The card a sheet acts on: its number, phone and status. */
function CardLine({ asset }: { asset: Asset }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm">
      <span className="font-mono font-medium">{asset.inventory_no}</span>
      {asset.kind === 'SIM' ? (
        <span className="font-mono text-muted-foreground">{asset.phone_no ?? asset.sim_no}</span>
      ) : (
        <span className="text-muted-foreground">{[asset.name, asset.category ? categoryLabel(asset.category) : null].filter(Boolean).join(' · ')}</span>
      )}
      {asset.connection_status ? <StatusBadge status={asset.connection_status} /> : null}
    </p>
  )
}

/**
 * Register SIM Return (§11): only once the card is physically back. The
 * assignment ends and the card is in the Office; its status does not change.
 */
function ReturnSheet({ asset, today, onClose, onReturned }: { asset: Asset | null; today: string; onClose: () => void; onReturned: (message: string) => void }) {
  const { client } = useApi()
  const [date, setDate] = useState(today)
  const [comment, setComment] = useState('')
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setDate(today)
    setComment('')
    setFailure(undefined)
  }, [asset?.id])

  const open = asset?.open_assignment
  const tooEarly = open !== undefined && open !== null && date < open.given_date
  const submit = async () => {
    if (!asset || !date || date > today || tooEarly) return
    setBusy(true)
    try {
      await client.assets.registerReturn(asset.id, { returned_date: date, comment: comment.trim() })
      onReturned(t.assets.returned(asset.inventory_no))
    } catch (err) {
      setFailure(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormSheet
      open={asset !== null}
      onClose={onClose}
      title={asset?.kind === 'EQUIPMENT' ? t.assets.registerAssetReturn : t.assets.registerReturn}
      description={asset?.kind === 'EQUIPMENT' ? t.assets.returnAssetDescription : t.assets.returnDescription}
      footer={footerButtons(
        onClose,
        <Button onClick={() => void submit()} disabled={busy || !date || date > today || tooEarly}>
          {t.assets.returnButton}
        </Button>,
      )}
    >
      {asset ? (
        <div className="grid gap-4">
          <CardLine asset={asset} />
          {open ? <p className="text-sm">{t.assets.heldByLine(open.employee_name, formatDay(open.given_date))}</p> : null}
          <Field
            label={t.assets.returnDate}
            required
            error={date > today ? t.assets.dateInFuture : tooEarly ? t.assets.returnBeforeGiven : undefined}
          >
            {(p) => <Input {...controlProps(p)} type="date" min={open?.given_date} max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label={t.assets.comment} hint={t.assets.optional}>
            {(p) => <Textarea {...controlProps(p)} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
          {failure ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}
        </div>
      ) : null}
    </FormSheet>
  )
}

/**
 * Mark as Not Returned (§13): the card stays with its holder and out of
 * office stock; whether it is still with them or nobody knows; a comment.
 */
function NotReturnedSheet({ asset, onClose, onMarked }: { asset: Asset | null; onClose: () => void; onMarked: (a: Asset, message: string) => void }) {
  const { client } = useApi()
  const [where, setWhere] = useState<Whereabouts | ''>('')
  const [comment, setComment] = useState('')
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setWhere('')
    setComment('')
    setFailure(undefined)
  }, [asset?.id])

  const submit = async () => {
    if (!asset || !where) return
    setBusy(true)
    try {
      await client.assets.markNotReturned(asset.id, { whereabouts: where, comment: comment.trim() })
      onMarked(asset, t.assets.marked(asset.inventory_no))
    } catch (err) {
      setFailure(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormSheet
      open={asset !== null}
      onClose={onClose}
      title={t.assets.markNotReturned}
      description={asset?.kind === 'EQUIPMENT' ? t.assets.notReturnedDescriptionItem : t.assets.notReturnedDescription}
      footer={footerButtons(
        onClose,
        <Button onClick={() => void submit()} disabled={busy || !where}>
          {t.assets.markNotReturned}
        </Button>,
      )}
    >
      {asset ? (
        <div className="grid gap-4">
          <CardLine asset={asset} />
          {asset.open_assignment ? <p className="text-sm">{t.assets.heldByLine(asset.open_assignment.employee_name, formatDay(asset.open_assignment.given_date))}</p> : null}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">
              {t.assets.whereaboutsQuestion} <span className="text-destructive">*</span>
            </legend>
            {(['WITH_EMPLOYEE', 'UNKNOWN'] as const).map((w) => (
              <label key={w} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm has-checked:border-primary has-checked:bg-accent">
                <input type="radio" name="whereabouts" className="size-4 accent-primary" checked={where === w} onChange={() => setWhere(w)} />
                {t.assets.whereaboutsLabel[w]}
              </label>
            ))}
          </fieldset>
          <Field label={t.assets.comment} hint={t.assets.notReturnedCommentHint}>
            {(p) => <Textarea {...controlProps(p)} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
          {failure ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}
        </div>
      ) : null}
    </FormSheet>
  )
}

/**
 * Prepare Blocking Email (§14): the request to copy into the user's own
 * e-mail. Nothing is sent and the status does not change; the first copy of
 * each opening is recorded as the user's activity (asset.blocking_email_prepared).
 */
function BlockingEmailSheet({ asset, note, onClose }: { asset: Asset | null; note: string | undefined; onClose: () => void }) {
  const { client } = useApi()
  const [copied, setCopied] = useState<string>()
  const recorded = useRef(false)
  useEffect(() => {
    setCopied(undefined)
    recorded.current = false
  }, [asset?.id])
  const mail = asset ? blockingEmail(asset) : null
  const copy = (what: 'subject' | 'body', text: string) =>
    (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).then(
      () => {
        setCopied(what)
        if (asset && !recorded.current) {
          recorded.current = true
          // Recording is the user's activity, not the copy: a failure leaves the copy as it is.
          client.assets.recordBlockingEmail(asset.id).catch(() => {
            recorded.current = false
          })
        }
      },
      () => setCopied('failed'),
    )
  return (
    <FormSheet
      open={asset !== null}
      onClose={onClose}
      title={t.assets.prepareBlockingEmail}
      description={t.assets.blockingDescription}
      footer={
        <Button variant="outline" onClick={onClose}>
          {t.assets.close}
        </Button>
      }
    >
      {asset && mail ? (
        <div className="grid gap-4">
          {note ? (
            <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
              {note}
            </p>
          ) : null}
          <CardLine asset={asset} />
          {asset.provider ? (
            <p className="text-sm">
              {t.assets.provider}: <span className="font-medium">{asset.provider}</span>
            </p>
          ) : null}
          <Field label={t.assets.subject}>
            {(p) => (
              <div className="flex gap-2">
                <Input {...controlProps(p)} readOnly value={mail.subject} className="font-mono" />
                <Button variant="outline" onClick={() => void copy('subject', mail.subject)}>
                  <Copy aria-hidden /> {t.assets.copy}
                </Button>
              </div>
            )}
          </Field>
          <Field label={t.assets.message} hint={t.assets.companyReminder}>
            {(p) => (
              <div className="grid gap-2">
                <Textarea {...controlProps(p)} readOnly rows={11} value={mail.body} className="font-mono text-xs" />
                <Button variant="outline" className="justify-self-start" onClick={() => void copy('body', mail.body)}>
                  <Copy aria-hidden /> {t.assets.copy}
                </Button>
              </div>
            )}
          </Field>
          <p role="status" className="text-sm text-muted-foreground">
            {copied === 'failed' ? t.assets.copyFailed : copied ? t.assets.copiedText : ''}
          </p>
        </div>
      ) : null}
    </FormSheet>
  )
}
