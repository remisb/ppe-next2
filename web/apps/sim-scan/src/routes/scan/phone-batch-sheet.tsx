import type { Settings } from '@ppe/api-client'
import { euroInput, formatEuro, parseEuro } from '@ppe/i18n'
import { type BatchSettings, simScanText } from '@ppe/sim-scan'
import { Button } from '@ppe/ui/components/button'
import { DateInput } from '@ppe/ui/components/date-input'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { Input } from '@ppe/ui/components/field'
import { formatDay, isoDay } from '@ppe/ui/lib/dates'
import { cn } from '@ppe/ui/lib/utils'
import { Pencil } from 'lucide-react'
import { Fragment, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

/** A value's field in a row: plain, at the row's end, until it is tapped. */
const ROW_FIELD = 'h-11 border-transparent bg-muted/60 text-right shadow-none focus-visible:border-input'

/**
 * For every SIM on a phone, in a sheet: the provider as a row of choices (its
 * plan filled in with it, as in the form from 768px), always open to change;
 * then the plan, the Non-return Value, the Received Date and the comment as rows
 * of a label and its value, read only until the pencil at the header's end
 * (Edit) turns the values into fields; and Save across the
 * bottom, with no × and no rules, as the wireframe draws it. Closing it (Escape,
 * a tap outside it) keeps the batch as it was.
 * Portalled to the page's body: over the camera's dark <dialog> it takes the
 * app's own theme, and the topmost modal dialog is the one that takes input.
 */
export function PhoneBatchSheet({
  settings,
  batch,
  onSave,
  onClose,
}: {
  settings: Settings | null
  batch: BatchSettings
  onSave: (batch: BatchSettings) => void
  onClose: () => void
}) {
  const t = simScanText()
  const id = useId()
  const [draft, setDraft] = useState(batch)
  const [valueText, setValueText] = useState(() => euroInput(batch.valueCents))
  const providers = settings?.sim_providers.map((p) => p.name) ?? []
  const valueBad = valueText.trim() !== '' && Number.isNaN(parseEuro(valueText))
  const noProvider = draft.provider.trim() === ''
  // The provider is chosen at any time; the other values only after the pencil (Edit), as text until then.
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (editing) document.getElementById(`${id}-plan`)?.focus()
  }, [editing, id])

  const pick = (provider: string) => {
    const plan = settings?.sim_providers.find((p) => p.name === provider)?.default_plan ?? ''
    setDraft((b) => ({ ...b, provider, plan }))
  }
  const save = () => {
    if (noProvider || valueBad) return
    onSave({ ...draft, valueCents: parseEuro(valueText) })
  }

  return createPortal(
    <FormSheet
      open
      onClose={onClose}
      title={t.batch}
      closeButton={false}
      rules={false}
      action={
        <Button
          type="button"
          variant={editing ? 'default' : 'outline'}
          size="icon"
          className="size-11 shrink-0 rounded-full"
          aria-pressed={editing}
          aria-label={t.editBatchValues}
          title={t.editBatchValues}
          onClick={() => setEditing((e) => !e)}
        >
          <Pencil aria-hidden className="size-4" />
        </Button>
      }
      footer={
        <Button className="h-12 w-full text-base" disabled={noProvider || valueBad} onClick={save}>
          {t.saveBatch}
        </Button>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-muted-foreground">{t.provider}</legend>
          {providers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {providers.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={draft.provider === name}
                  onClick={() => pick(name)}
                  className={cn(
                    'h-11 rounded-full border px-4 text-[15px] font-medium',
                    draft.provider === name ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : (
            <Input aria-label={t.provider} value={draft.provider} onChange={(e) => setDraft((b) => ({ ...b, provider: e.target.value }))} />
          )}
          {noProvider ? <p className="text-sm text-destructive">{t.providerRequired}</p> : null}
        </fieldset>

        {editing ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-[15px]">
            <dt>
              <label htmlFor={`${id}-plan`} className="text-muted-foreground">
                {t.plan}
              </label>
            </dt>
            <dd>
              <Input id={`${id}-plan`} className={ROW_FIELD} value={draft.plan} onChange={(e) => setDraft((b) => ({ ...b, plan: e.target.value }))} />
            </dd>
            <dt>
              <label htmlFor={`${id}-value`} className="text-muted-foreground">
                {t.nonReturnValue}
              </label>
            </dt>
            <dd>
              <Input
                id={`${id}-value`}
                inputMode="decimal"
                className={ROW_FIELD}
                invalid={valueBad}
                aria-describedby={valueBad ? `${id}-value-error` : undefined}
                value={valueText}
                onChange={(e) => setValueText(e.target.value)}
              />
            </dd>
            {valueBad ? (
              <p id={`${id}-value-error`} className="col-span-2 text-right text-sm text-destructive">
                {t.valueInvalid}
              </p>
            ) : null}
            <dt>
              <label htmlFor={`${id}-received`} className="text-muted-foreground">
                {t.receivedDate}
              </label>
            </dt>
            <dd>
              <DateInput
                id={`${id}-received`}
                value={draft.receivedDate}
                max={settings ? isoDay(new Date(), settings.timezone) : undefined}
                onChange={(v) => setDraft((b) => ({ ...b, receivedDate: v }))}
              />
            </dd>
            <dt>
              <label htmlFor={`${id}-comment`} className="text-muted-foreground">
                {t.comment}
              </label>
            </dt>
            <dd>
              <Input id={`${id}-comment`} className={ROW_FIELD} value={draft.comment} onChange={(e) => setDraft((b) => ({ ...b, comment: e.target.value }))} />
            </dd>
          </dl>
        ) : (
          // View mode: each value as text at the row's end, the pencil above turning them into fields.
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-[15px]">
            {[
              [t.plan, draft.plan],
              [t.nonReturnValue, valueText.trim() === '' ? '' : valueBad ? valueText : formatEuro(parseEuro(valueText))],
              [t.receivedDate, draft.receivedDate === '' ? '' : formatDay(draft.receivedDate)],
              [t.comment, draft.comment],
            ].map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className={cn('flex h-11 min-w-0 items-center justify-end text-right', value === '' && 'text-muted-foreground')}>
                  <span className="truncate">{value === '' ? '–' : value}</span>
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </form>
    </FormSheet>,
    document.body,
  )
}
