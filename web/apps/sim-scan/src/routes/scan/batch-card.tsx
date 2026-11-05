import type { Settings } from '@ppe/api-client'
import { euroInput, formatEuro, parseEuro } from '@ppe/i18n'
import { type BatchSettings, simScanText } from '@ppe/sim-scan'
import { Button } from '@ppe/ui/components/button'
import { DateInput } from '@ppe/ui/components/date-input'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { formatDay, isoDay } from '@ppe/ui/lib/dates'
import { cn } from '@ppe/ui/lib/utils'
import { Pencil } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'

/**
 * What every SIM of the batch shares (For every SIM), filled in from Settings:
 * shown read only, a label and its value a line, with Edit at its top right. Edit flips
 * it over to the form; Save or Cancel (or Escape) flips it back. Without a
 * provider to fill in, it opens on the form.
 */
export function BatchCard({
  settings,
  batch,
  onSave,
  missingProvider,
}: {
  settings: Settings | null
  batch: BatchSettings
  onSave: (batch: BatchSettings) => void
  missingProvider: boolean
}) {
  const t = simScanText()
  const [editing, setEditing] = useState(false)
  // Only a change of side flips; the card as first shown does not.
  const [flipped, setFlipped] = useState(false)
  const [draft, setDraft] = useState(batch)
  const [valueText, setValueText] = useState('')
  const editButton = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const loaded = settings !== null
  const providerChoices = settings?.sim_providers.map((p) => p.name) ?? []
  const valueBad = valueText.trim() !== '' && Number.isNaN(parseEuro(valueText))
  const open = editing

  const start = () => {
    setDraft(batch)
    setValueText(euroInput(batch.valueCents))
    setFlipped(true)
    setEditing(true)
  }
  const close = () => {
    setFlipped(true)
    setEditing(false)
    requestAnimationFrame(() => editButton.current?.focus())
  }
  const save = () => {
    if (draft.provider.trim() === '' || valueBad) return
    onSave({ ...draft, valueCents: parseEuro(valueText) })
    close()
  }

  // With no provider to fill in from Settings, it opens on the form, unflipped.
  useEffect(() => {
    if (!loaded || batch.provider.trim() !== '' || editing) return
    setDraft(batch)
    setValueText(euroInput(batch.valueCents))
    setEditing(true)
  }, [loaded, batch, editing])

  // The form's first field takes the focus as it opens.
  useEffect(() => {
    if (editing) form.current?.querySelector<HTMLElement>('select, input')?.focus()
  }, [editing])

  const flip = flipped ? 'motion-safe:animate-flip-in origin-top' : undefined
  return (
    <section aria-labelledby="batch" className="mb-5 [perspective:900px]">
      {!open ? (
        <div key="view" className={cn('flex items-start gap-2 rounded-lg border border-border px-3 py-2', flip)}>
          <div className="min-w-0 flex-1">
            <h2 id="batch" className="text-sm font-semibold">
              {t.batch}
            </h2>
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              {[
                [t.provider, batch.provider],
                [t.plan, batch.plan],
                [t.nonReturnValue, batch.valueCents === null ? '' : formatEuro(batch.valueCents)],
                [t.receivedDate, batch.receivedDate === '' ? '' : formatDay(batch.receivedDate)],
                [t.comment, batch.comment],
              ]
                .filter(([, v]) => v !== '')
                .map(([label, value]) => (
                  <Fragment key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </Fragment>
                ))}
            </dl>
          </div>
          <Button
            ref={editButton}
            type="button"
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-2 shrink-0"
            aria-label={t.editBatch}
            title={t.editBatch}
            disabled={!loaded}
            onClick={start}
          >
            <Pencil aria-hidden className="size-4" />
          </Button>
        </div>
      ) : (
        <form
          key="edit"
          ref={form}
          className={cn('flex flex-col gap-4 rounded-lg border border-border p-3 sm:p-4', flip)}
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && batch.provider.trim() !== '') close()
          }}
        >
          <h2 id="batch" className="text-base font-semibold">
            {t.batch}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t.provider} required error={(missingProvider || editing) && draft.provider.trim() === '' ? t.providerRequired : undefined}>
              {(p) =>
                providerChoices.length > 0 ? (
                  <Select
                    {...controlProps(p)}
                    value={draft.provider}
                    onChange={(e) => {
                      const provider = e.target.value
                      const plan = settings?.sim_providers.find((x) => x.name === provider)?.default_plan ?? ''
                      setDraft((b) => ({ ...b, provider, plan }))
                    }}
                  >
                    <option value="" disabled>
                      {t.provider}
                    </option>
                    {providerChoices.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input {...controlProps(p)} value={draft.provider} onChange={(e) => setDraft((b) => ({ ...b, provider: e.target.value }))} />
                )
              }
            </Field>
            <Field label={t.plan}>
              {(p) => <Input {...controlProps(p)} value={draft.plan} onChange={(e) => setDraft((b) => ({ ...b, plan: e.target.value }))} />}
            </Field>
            <Field label={t.nonReturnValue} error={valueBad ? t.valueInvalid : undefined}>
              {(p) => <Input {...controlProps(p)} inputMode="decimal" value={valueText} onChange={(e) => setValueText(e.target.value)} />}
            </Field>
            <Field label={t.receivedDate}>
              {(p) => (
                <DateInput
                  {...controlProps(p)}
                  value={draft.receivedDate}
                  max={settings ? isoDay(new Date(), settings.timezone) : undefined}
                  onChange={(v) => setDraft((b) => ({ ...b, receivedDate: v }))}
                />
              )}
            </Field>
          </div>
          <Field label={t.comment}>
            {(p) => <Textarea {...controlProps(p)} rows={2} value={draft.comment} onChange={(e) => setDraft((b) => ({ ...b, comment: e.target.value }))} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={draft.provider.trim() === '' || valueBad}>
              {t.saveBatch}
            </Button>
            {batch.provider.trim() !== '' ? (
              <Button type="button" variant="outline" onClick={close}>
                {t.cancel}
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  )
}
