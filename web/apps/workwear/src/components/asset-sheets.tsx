import type { Asset, AssignmentFormResult, Whereabouts } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Field, Input, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { errorText } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Copy, Printer } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useLoad } from '@ppe/ui/lib/use-load'

import { AssignmentFormDocument } from '@/components/assignment-form'
import { StatusBadge } from '@/components/asset-controls'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { t } from '@/i18n'
import { type GiveDraft, blockingEmail, cardBlock, emptyGiveDraft, formatDay, formInput, formKey, giveBlock } from '@/lib/assets'
import { pathOf } from '@/lib/router'
import { parseEuro } from '@/lib/utils'
import { basePath } from '@ppe/routing'

/**
 * Which action sheet is open, for which card; or Give SIM Card for an
 * employee, started from their page, where the card is chosen on the sheet.
 */
export type AssetSheet =
  | { kind: 'give' | 'return' | 'notReturned' | 'email'; asset: Asset; note?: string }
  | { kind: 'giveTo'; employee: PickedEmployee }
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
          onChange(a.connection_status === 'BLOCKED' ? null : { kind: 'email', asset: a, note: `${m} ${t.assets.nextStepBlock}` })
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
 * Give SIM Card (§6–§8). The employee, the given date and any plan or value
 * the card lacks; Print Form prints the form the API would store, in a tab of
 * its own; the employee signs it; Paper Form Signed; Give SIM Card. A change
 * to the form after printing clears the tick and asks for a reprint, and the
 * API refuses a form that no longer matches what was printed.
 */
function GiveSheet({
  open,
  asset: fixed,
  employee,
  today,
  onClose,
  onGiven,
}: {
  open: boolean
  /** The card, when Give starts from it; null to choose one among the cards in the office. */
  asset: Asset | null
  /** The employee, when Give starts from their page. */
  employee: PickedEmployee | null
  today: string
  onClose: () => void
  onGiven: (message: string) => void
}) {
  const { client } = useApi()
  const [draft, setDraft] = useState<GiveDraft>(() => emptyGiveDraft(today))
  const [printed, setPrinted] = useState<{ key: string; hash: string } | null>(null)
  const [signed, setSigned] = useState(false)
  const [preview, setPreview] = useState<AssignmentFormResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<Asset | null>(null)
  const asset = fixed ?? picked

  useEffect(() => {
    if (!open) return
    setPicked(null)
    setDraft({
      ...emptyGiveDraft(today),
      assetId: fixed?.id ?? '',
      ...(employee ? { employeeId: employee.id, employeeName: employee.full_name } : {}),
    })
    setPrinted(null)
    setSigned(false)
    setPreview(null)
    setShowPreview(false)
    setFailure(undefined)
  }, [open, fixed?.id, employee?.id])

  const key = formKey(draft)
  const changedAfterPrint = printed !== null && printed.key !== key
  // Anything that changes the form after printing takes the signature away (§8).
  useEffect(() => {
    if (changedAfterPrint) setSigned(false)
  }, [changedAfterPrint])
  // A preview shown is of the form as it is now; a change hides it until asked again.
  useEffect(() => setPreview(null), [key])

  if (!open) return <FormSheet open={false} onClose={onClose} title={t.assets.giveSimCard}>{null}</FormSheet>

  const set = <K extends keyof GiveDraft>(k: K, v: GiveDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const block = giveBlock(asset, draft, today, printed, signed)
  // The form can be printed once its data is complete: the reasons left are about the paper.
  const ready = block === null || block === t.assets.printFirstReason || block === t.assets.tickSignedReason
  const cents = parseEuro(draft.value)
  const input = asset ? formInput(asset, draft) : null
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

  const loadPreview = async (): Promise<AssignmentFormResult | null> => {
    if (!asset || !input) return null
    setFailure(undefined)
    try {
      const r = await client.assets.previewForm(asset.id, input)
      setPreview(r)
      return r
    } catch (err) {
      setFailure(errorText(err))
      return null
    }
  }

  const give = async () => {
    if (block !== null || !printed || !asset || !input) return
    setBusy(true)
    setFailure(undefined)
    try {
      const a = await client.assets.give(asset.id, { ...input, comment: draft.comment.trim(), paper_form_signed: true, form_hash: printed.hash })
      onGiven(t.assets.givenTo(a.employee_name))
    } catch (err) {
      // What was entered stays (§7); only a form that changed must be printed again.
      if (err instanceof ApiError && err.isConflict && /already given/i.test(err.message)) setFailure(t.assets.alreadyGivenError)
      else if (err instanceof ApiError && err.isConflict && /form changed/i.test(err.message)) {
        setFailure(t.assets.formChangedError)
        setPrinted(null)
        setSigned(false)
      } else setFailure(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.assets.giveSimCard}
      description={t.assets.giveDescription}
      footer={footerButtons(
        onClose,
        <Button onClick={() => void give()} disabled={busy} aria-disabled={block !== null} className={cn(block !== null && 'opacity-50')}>
          {t.assets.giveSimCard}
        </Button>,
      )}
    >
      <div className="grid gap-4">
        {fixed ? (
          <CardLine asset={fixed} />
        ) : (
          <CardPicker
            selected={picked}
            onSelect={(a) => {
              setPicked(a)
              set('assetId', a.id)
            }}
          />
        )}
        <EmployeePicker
          label={t.assets.employee}
          selected={draft.employeeId ? { id: draft.employeeId, full_name: draft.employeeName, code: null } : null}
          onSelect={(e) => setDraft((d) => ({ ...d, employeeId: e.id, employeeName: e.full_name }))}
          onClear={() => setDraft((d) => ({ ...d, employeeId: '', employeeName: '' }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.assets.givenDate} required hint={t.assets.givenDateHint} error={draft.givenDate > today ? t.assets.dateInFuture : undefined}>
            {(p) => <Input {...controlProps(p)} type="date" max={today} value={draft.givenDate} onChange={(e) => set('givenDate', e.target.value)} />}
          </Field>
          {asset?.plan === null ? (
            <Field label={t.assets.plan} required hint={t.assets.missingHint}>
              {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.plan} onChange={(e) => set('plan', e.target.value)} />}
            </Field>
          ) : null}
          {asset?.non_return_value_cents === null ? (
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

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
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
          {/* A link, so the browser opens the print tab from the click itself; the sheet keeps the printed form's hash. */}
          <a
            href={formPath || undefined}
            target="_blank"
            rel="noopener"
            aria-disabled={!ready}
            className={cn(buttonVariants({ variant: 'outline' }), !ready && 'pointer-events-none opacity-50')}
            onClick={(e) => {
              if (!ready) {
                e.preventDefault()
                return
              }
              void loadPreview().then((r) => r && setPrinted({ key, hash: r.document_hash }))
            }}
          >
            <Printer aria-hidden /> {t.assets.printForm}
          </a>
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

        <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium">{t.assets.signReminder}</p>
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
        {block ? (
          <p className="text-sm text-muted-foreground" id="give-reason">
            {block}
          </p>
        ) : null}
        {failure ? (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        ) : null}
      </div>
    </FormSheet>
  )
}

/**
 * The cards in the office, for Give SIM Card from an employee's page (§6):
 * only cards with no holder are listed, each with its status; one that is
 * not Active or has no phone number is shown but cannot be chosen.
 */
function CardPicker({ selected, onSelect }: { selected: Asset | null; onSelect: (a: Asset) => void }) {
  const { client } = useApi()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setTerm(q.trim()), 200)
    return () => window.clearTimeout(id)
  }, [q])
  const cards = useLoad(
    () => client.assets.list({ kind: 'SIM', location: 'OFFICE', sort: 'status', page_size: 20, ...(term ? { q: term } : {}) }),
    [term],
  )
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">
        {t.assets.simCard} <span className="text-destructive">*</span>
      </legend>
      <Input type="search" aria-label={t.assets.searchOfficeCards} placeholder={t.assets.searchOfficeCards} value={q} onChange={(e) => setQ(e.target.value)} />
      <div role="radiogroup" aria-label={t.assets.simCard} className="grid max-h-60 gap-1.5 overflow-y-auto">
        {cards.data?.assets.length === 0 ? <p className="text-sm text-muted-foreground">{t.assets.noOfficeCards}</p> : null}
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
                <span className="font-mono font-medium">{a.inventory_no}</span> <span className="font-mono">{a.phone_no ?? a.sim_no}</span>
                <span className="block text-xs text-muted-foreground">{[a.provider, a.plan].filter(Boolean).join(' · ')}</span>
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
      <span className="font-mono text-muted-foreground">{asset.phone_no ?? asset.sim_no}</span>
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
      title={t.assets.registerReturn}
      description={t.assets.returnDescription}
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
      description={t.assets.notReturnedDescription}
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
 * e-mail. Nothing is sent and the status does not change.
 */
function BlockingEmailSheet({ asset, note, onClose }: { asset: Asset | null; note: string | undefined; onClose: () => void }) {
  const [copied, setCopied] = useState<string>()
  useEffect(() => setCopied(undefined), [asset?.id])
  const mail = asset ? blockingEmail(asset) : null
  const copy = (what: 'subject' | 'body', text: string) =>
    (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).then(
      () => setCopied(what),
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
