import type { Asset, SimProvider } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { DateInput } from '@ppe/ui/components/date-input'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { errorText } from '@ppe/ui/lib/use-load'
import { linkVariants } from '@ppe/ui/components/link'
import { Segmented } from '@ppe/ui/components/segmented'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'

import { t } from '@/i18n'
import { type SimDraft, type SimErrors, checkSimDraft, emptySimDraft, newSimInput, providerOptions, providerPlan, simDraftOf, withSimProvider } from '@/lib/assets'

/** A number another card already has: which field, and the card, so the form can open it (§4). */
interface Taken {
  field: 'simNo' | 'inventoryNo'
  existingId: string | undefined
}

/**
 * Add SIM and Edit (§4): one card at a time, in one sheet. A new card
 * starts in the Office, Not Activated (or Active, chosen here), received
 * today, with the default provider chosen, the default Non-return Value and
 * the provider's plan filled in and the next free inventory number suggested. The provider is picked from those listed on Settings
 * (Administration); with none listed it is typed. The phone number, plan and
 * value may wait until the card is given.
 */
export function SimCardForm({
  card,
  today,
  providers,
  inUse = [],
  defaultProvider,
  defaultValueCents,
  onClose,
  onSaved,
  onOpenExisting,
}: {
  /** 'new' for Add SIM, a card to Edit it, null when closed. */
  card: Asset | 'new' | null
  /** The organisation's day: the default and latest received date. */
  today: string
  /** The providers listed on Settings (sim_providers), offered to choose from, each with the plan its new cards start with. */
  providers: readonly SimProvider[]
  /** The providers already in use, offered as the provider is typed when none are listed. */
  inUse?: string[]
  /** The provider a new card starts with (Settings' default_sim_provider); Add SIM only. */
  defaultProvider?: string | null | undefined
  /** The Non-return Value a new card starts with (Settings' default_sim_non_return_value_cents); Add SIM only. */
  defaultValueCents?: number | null | undefined
  onClose: () => void
  onSaved: (saved: Asset, added: boolean) => void
  /** Show the card that already has the number. */
  onOpenExisting: (id: string) => void
}) {
  const { client } = useApi()
  const existing = card !== 'new' && card !== null ? card : undefined
  const [draft, setDraft] = useState<SimDraft>(() => emptySimDraft(today))
  const [errors, setErrors] = useState<SimErrors>({})
  const [taken, setTaken] = useState<Taken>()
  const [failure, setFailure] = useState<string>()
  const [saving, setSaving] = useState(false)
  // The suggested inventory number fills the field unless someone typed their own, even before it came.
  const numberTyped = useRef(false)
  const providerList = useId()
  const options = providerOptions(
    providers.map((p) => p.name),
    existing?.provider,
  )

  const suggest = () =>
    client.assets.nextNumber('SIM').then(
      (n) => {
        if (!numberTyped.current) setDraft((d) => ({ ...d, inventoryNo: n }))
      },
      () => {}, // The field stays empty and required: the user types one.
    )

  useEffect(() => {
    if (card === null) return
    setDraft(
      existing
        ? simDraftOf(existing)
        : emptySimDraft(today, defaultProvider ?? '', defaultValueCents ?? null, providerPlan(providers, defaultProvider)),
    )
    setErrors({})
    setTaken(undefined)
    setFailure(undefined)
    numberTyped.current = existing !== undefined
    if (card === 'new') void suggest()
  }, [card])

  const set = <K extends keyof SimDraft>(k: K, v: SimDraft[K]) => {
    // On Add SIM the plan follows the provider chosen (Settings' plan for it); Edit keeps the card's.
    setDraft((d) => (k === 'provider' && !existing ? withSimProvider(d, v as string, providers) : { ...d, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
    if (taken?.field === k) setTaken(undefined)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const { errors: found, input } = checkSimDraft(draft, today)
    setErrors(found)
    setFailure(undefined)
    if (!input) return
    setSaving(true)
    try {
      const saved = existing ? await client.assets.update(existing.id, input) : await client.assets.create(newSimInput(input, draft.status))
      onSaved(saved, !existing)
    } catch (err) {
      if (err instanceof ApiError && err.isConflict && /SIM number/i.test(err.message)) setTaken({ field: 'simNo', existingId: err.existingId })
      else if (err instanceof ApiError && err.isConflict && /inventory number/i.test(err.message)) setTaken({ field: 'inventoryNo', existingId: err.existingId })
      else setFailure(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  const takenNote = (field: Taken['field']) =>
    taken?.field === field ? (
      <div role="alert" className="-mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-destructive">
        {field === 'simNo' ? t.assets.simNoTaken : t.assets.inventoryNoTaken}
        {taken.existingId ? (
          <button
            type="button"
            className={linkVariants({ underline: 'always', weight: 'medium', className: 'cursor-pointer pointer-coarse:min-h-11' })}
            onClick={() => onOpenExisting(taken.existingId!)}
          >
            {field === 'simNo' ? t.assets.openExisting : t.assets.openExistingItem}
          </button>
        ) : null}
        {field === 'inventoryNo' && !existing ? (
          <button
            type="button"
            className={linkVariants({ underline: 'always', weight: 'medium', className: 'cursor-pointer pointer-coarse:min-h-11' })}
            onClick={() => {
              setTaken(undefined)
              numberTyped.current = false
              void suggest()
            }}
          >
            {t.assets.suggestAnother}
          </button>
        ) : null}
      </div>
    ) : null

  return (
    <FormSheet
      open={card !== null}
      onClose={onClose}
      title={existing ? t.assets.editSimCard : t.assets.addSimCard}
      description={t.assets.formDescription}
footer={<FormSheetActions form="sim-card-form" onCancel={onClose} busy={saving} />}
    >
      <form id="sim-card-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Field label={t.assets.simNo} required hint={t.assets.simNoHint} error={errors.simNo}>
            {(p) => (
              <Input
                {...controlProps(p)}
                invalid={p.invalid || taken?.field === 'simNo'}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                value={draft.simNo}
                onChange={(e) => set('simNo', e.target.value)}
              />
            )}
          </Field>
          {takenNote('simNo')}
        </div>
        <Field label={t.assets.phoneNo} hint={t.assets.laterHint} error={errors.phoneNo}>
          {(p) => <Input {...controlProps(p)} type="tel" autoComplete="off" value={draft.phoneNo} onChange={(e) => set('phoneNo', e.target.value)} />}
        </Field>
        {options.length > 0 ? (
          <Field label={t.assets.provider} required error={errors.provider}>
            {(p) => (
              <Select {...controlProps(p)} value={draft.provider} onChange={(e) => set('provider', e.target.value)}>
                <option value="" disabled>
                  {t.assets.chooseProvider}
                </option>
                {options.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label={t.assets.provider} required hint={t.assets.providersNotListed} error={errors.provider}>
            {(p) => (
              <>
                <Input {...controlProps(p)} list={providerList} autoComplete="off" value={draft.provider} onChange={(e) => set('provider', e.target.value)} />
                <datalist id={providerList}>
                  {inUse.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        )}
        <Field label={t.assets.plan} hint={t.assets.optional}>
          {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.plan} onChange={(e) => set('plan', e.target.value)} />}
        </Field>
        <Field label={t.assets.nonReturnValue} hint={t.assets.nonReturnValueHint} error={errors.value}>
          {(p) => <Input {...controlProps(p)} inputMode="decimal" placeholder="0.00" value={draft.value} onChange={(e) => set('value', e.target.value)} />}
        </Field>
        <Field label={t.assets.receivedDate} required hint={t.assets.receivedDateHint} error={errors.receivedDate}>
          {(p) => (
            <DateInput
              {...controlProps(p)}
              max={today}
              value={draft.receivedDate}
              onChange={(v, problem) => {
                set('receivedDate', v)
                if (problem) setErrors((e) => ({ ...e, receivedDate: problem }))
              }}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label={t.assets.inventoryNo} required hint={t.assets.inventoryNoHint} error={errors.inventoryNo}>
            {(p) => (
              <Input
                {...controlProps(p)}
                invalid={p.invalid || taken?.field === 'inventoryNo'}
                autoComplete="off"
                className="font-mono"
                value={draft.inventoryNo}
                onChange={(e) => {
                  numberTyped.current = true
                  set('inventoryNo', e.target.value)
                }}
              />
            )}
          </Field>
          {takenNote('inventoryNo')}
        </div>
        {existing ? null : (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">{t.assets.status}</legend>
            <Segmented
              layout="fit"
              className="auto-cols-fr"
              options={(['NOT_ACTIVATED', 'ACTIVE'] as const).map((s) => ({ value: s, label: t.assets.statuses[s] }))}
              value={draft.status}
              onChange={(s) => set('status', s)}
            />
            <p className="text-xs text-muted-foreground">{t.assets.statusHint}</p>
          </fieldset>
        )}
        <div className="sm:col-span-2">
          <Field label={t.assets.comment} hint={t.assets.commentHint}>
            {(p) => <Textarea {...controlProps(p)} rows={2} value={draft.comment} onChange={(e) => set('comment', e.target.value)} />}
          </Field>
        </div>
        {failure ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {failure}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}
