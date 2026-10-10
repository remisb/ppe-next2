import type { Asset } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { errorText } from '@ppe/ui/lib/use-load'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'

import { t } from '@/i18n'
import { type SimDraft, type SimErrors, checkSimDraft, defaultProviderChange, emptySimDraft, isDefaultProvider, newSimInput, simDraftOf } from '@/lib/assets'

/** A number another card already has: which field, and the card, so the form can open it (§4). */
interface Taken {
  field: 'simNo' | 'inventoryNo'
  existingId: string | undefined
}

/**
 * Add SIM Card and Edit (§4): one card at a time, in one sheet. A new card
 * starts in the Office, Not Activated (or Active, chosen here), received
 * today, with the default provider and the next free inventory number
 * suggested; "Default for new cards" makes the typed provider the default
 * (or, unticked, clears it) as the card is saved. The phone number, plan and
 * value may wait until the card is given.
 */
export function SimCardForm({
  card,
  today,
  providers,
  defaultProvider,
  onClose,
  onSaved,
  onOpenExisting,
}: {
  /** 'new' for Add SIM Card, a card to Edit it, null when closed. */
  card: Asset | 'new' | null
  /** The organisation's day: the default and latest received date. */
  today: string
  /** The providers already in use, offered as the provider is typed. */
  providers: string[]
  /** The provider a new card starts with (Settings' default_sim_provider); Add SIM Card only. */
  defaultProvider?: string | null | undefined
  onClose: () => void
  onSaved: (saved: Asset, added: boolean) => void
  /** Show the card that already has the number. */
  onOpenExisting: (id: string) => void
}) {
  const { client } = useApi()
  const existing = card !== 'new' && card !== null ? card : undefined
  const [draft, setDraft] = useState<SimDraft>(() => emptySimDraft(today))
  const [makeDefault, setMakeDefault] = useState(false)
  const [errors, setErrors] = useState<SimErrors>({})
  const [taken, setTaken] = useState<Taken>()
  const [failure, setFailure] = useState<string>()
  const [saving, setSaving] = useState(false)
  // The suggested inventory number fills the field unless someone typed their own, even before it came.
  const numberTyped = useRef(false)
  const providerList = useId()

  const suggest = () =>
    client.assets.nextNumber('SIM').then(
      (n) => {
        if (!numberTyped.current) setDraft((d) => ({ ...d, inventoryNo: n }))
      },
      () => {}, // The field stays empty and required: the user types one.
    )

  useEffect(() => {
    if (card === null) return
    setDraft(existing ? simDraftOf(existing) : emptySimDraft(today, defaultProvider ?? ''))
    setMakeDefault(!existing && !!defaultProvider)
    setErrors({})
    setTaken(undefined)
    setFailure(undefined)
    numberTyped.current = existing !== undefined
    if (card === 'new') void suggest()
  }, [card])

  const set = <K extends keyof SimDraft>(k: K, v: SimDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
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
      // The default first: a refusal then leaves no card added to save again.
      const nextDefault = existing ? undefined : defaultProviderChange(draft.provider, makeDefault, defaultProvider)
      if (nextDefault !== undefined) await client.updateDefaultSimProvider(nextDefault)
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
            className="cursor-pointer font-medium underline underline-offset-4 pointer-coarse:min-h-11"
            onClick={() => onOpenExisting(taken.existingId!)}
          >
            {field === 'simNo' ? t.assets.openExisting : t.assets.openExistingItem}
          </button>
        ) : null}
        {field === 'inventoryNo' && !existing ? (
          <button
            type="button"
            className="cursor-pointer font-medium underline underline-offset-4 pointer-coarse:min-h-11"
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
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="sim-card-form" disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </Button>
        </>
      }
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
        <div className="flex flex-col gap-1.5">
          <Field label={t.assets.provider} required error={errors.provider}>
            {(p) => (
              <>
                <Input
                  {...controlProps(p)}
                  list={providerList}
                  autoComplete="off"
                  value={draft.provider}
                  onChange={(e) => {
                    set('provider', e.target.value)
                    setMakeDefault(isDefaultProvider(e.target.value, defaultProvider))
                  }}
                />
                <datalist id={providerList}>
                  {providers.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          {existing ? null : (
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input type="checkbox" className="size-5 accent-primary" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
              <span className="flex flex-col">
                {t.assets.makeDefaultProvider}
                <span className="text-xs font-normal text-muted-foreground">
                  {t.assets.makeDefaultProviderHint}
                </span>
              </span>
            </label>
          )}
        </div>
        <Field label={t.assets.plan} hint={t.assets.optional}>
          {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.plan} onChange={(e) => set('plan', e.target.value)} />}
        </Field>
        <Field label={t.assets.nonReturnValue} hint={t.assets.nonReturnValueHint} error={errors.value}>
          {(p) => <Input {...controlProps(p)} inputMode="decimal" placeholder="0.00" value={draft.value} onChange={(e) => set('value', e.target.value)} />}
        </Field>
        <Field label={t.assets.receivedDate} required hint={t.assets.receivedDateHint} error={errors.receivedDate}>
          {(p) => <Input {...controlProps(p)} type="date" max={today} value={draft.receivedDate} onChange={(e) => set('receivedDate', e.target.value)} />}
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
            <div role="group" className="inline-grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1">
              {(['NOT_ACTIVATED', 'ACTIVE'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={draft.status === s}
                  onClick={() => set('status', s)}
                  className="flex h-9 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11"
                >
                  {t.assets.statuses[s]}
                </button>
              ))}
            </div>
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
