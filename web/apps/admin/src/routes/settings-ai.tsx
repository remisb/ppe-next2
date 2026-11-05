import type { AIPrices, AISettings } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ppe/ui/components/card'
import { Field, Input, PasswordInput, Select, controlProps } from '@ppe/ui/components/field'
import { Loaded } from '@ppe/ui/components/states'
import { formatDate } from '@ppe/ui/lib/dates'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { type FormEvent, useEffect, useId, useState } from 'react'

import { t } from '@/i18n'
import { formatUSD, microFromUSD, priceOf, usdInput } from '@/lib/ai'

const PRICE_KINDS: (keyof AIPrices)[] = ['input_text', 'input_image', 'output_text', 'output_image']

/**
 * Settings → AI (ADR 0007, docs/specs/ai-usage-service.md): AI colour photos
 * on or off, the OpenAI model and its quality, its prices (the ledger costs
 * each call by them), the monthly budget, and the OpenAI API key: entered
 * once, checked with OpenAI, sealed, never shown again but by its last four
 * characters. Setting or removing it asks for the password again.
 */
export function AISettingsCard({ timeZone }: { timeZone: string | undefined }) {
  const { client } = useApi()
  const settings = useLoad(() => client.ai.settings())
  const titleId = useId()
  return (
    <Card role="region" aria-labelledby={titleId} className="md:max-w-xl">
      <CardHeader>
        <CardTitle id={titleId}>{t.settings.ai.title}</CardTitle>
        <CardDescription>{t.settings.ai.intro}</CardDescription>
      </CardHeader>
      <CardContent>
        <Loaded load={settings}>
          {(s) => (
            <div className="flex flex-col gap-6">
              <AIForm settings={s} onSaved={settings.reload} />
              <KeyForm settings={s} timeZone={timeZone} onSaved={settings.reload} />
            </div>
          )}
        </Loaded>
      </CardContent>
    </Card>
  )
}

function AIForm({ settings, onSaved }: { settings: AISettings; onSaved: () => void }) {
  const { client } = useApi()
  const [enabled, setEnabled] = useState(settings.enabled)
  const [model, setModel] = useState(settings.model)
  const [quality, setQuality] = useState(settings.quality)
  const [budget, setBudget] = useState(usdInput(settings.budget_micro_usd))
  const [prices, setPrices] = useState<Record<string, AIPrices>>(settings.prices)
  // Prices as typed (a half-typed "2." stays), for the model shown.
  const [typed, setTyped] = useState<Partial<Record<keyof AIPrices, string>>>({})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setEnabled(settings.enabled)
    setModel(settings.model)
    setQuality(settings.quality)
    setBudget(usdInput(settings.budget_micro_usd))
    setPrices(settings.prices)
    setTyped({})
  }, [settings])
  useEffect(() => setTyped({}), [model])
  const price = prices[model] ?? { input_text: 0, input_image: 0, output_text: 0, output_image: 0 }
  const budgetMicro = microFromUSD(budget)
  const badPrice = PRICE_KINDS.some((k) => typed[k] !== undefined && priceOf(typed[k]) === undefined)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (budgetMicro === undefined || badPrice) return
    setBusy(true)
    setError(undefined)
    try {
      await client.ai.updateSettings({ enabled, model: model.trim(), quality, prices: { ...prices, [model.trim()]: price }, budget_micro_usd: budgetMicro })
      setSaved(true)
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <p role="status" className="text-sm">
        {saved ? `${t.settings.saved} ` : null}
        {t.settings.ai.spent(formatUSD(settings.spent_this_month_micro_usd), settings.budget_micro_usd === null ? null : formatUSD(settings.budget_micro_usd))}
      </p>
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" className="mt-1 size-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>
          <span className="font-medium">{t.settings.ai.enabled}</span>
          <span className="block text-sm text-muted-foreground">{t.settings.ai.enabledHint}</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.settings.ai.model} hint={t.settings.ai.modelHint}>
          {(p) => <Input {...controlProps(p)} autoComplete="off" value={model} onChange={(e) => setModel(e.target.value)} />}
        </Field>
        <Field label={t.settings.ai.quality} hint={t.settings.ai.qualityHint}>
          {(p) => (
            <Select {...controlProps(p)} value={quality} onChange={(e) => setQuality(e.target.value as AISettings['quality'])}>
              <option value="low">{t.settings.ai.qualities.low}</option>
              <option value="medium">{t.settings.ai.qualities.medium}</option>
              <option value="high">{t.settings.ai.qualities.high}</option>
            </Select>
          )}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t.settings.ai.prices(model)}</legend>
        <p className="text-sm text-muted-foreground">{t.settings.ai.pricesHint}</p>
        {badPrice ? <p className="text-sm text-destructive">{t.settings.ai.priceInvalid}</p> : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PRICE_KINDS.map((kind) => (
            <Field key={kind} label={t.settings.ai.priceKinds[kind]}>
              {(p) => (
                <Input
                  {...controlProps(p)}
                  inputMode="decimal"
                  value={typed[kind] ?? String(price[kind])}
                  onChange={(e) => {
                    setTyped({ ...typed, [kind]: e.target.value })
                    const n = priceOf(e.target.value)
                    if (n !== undefined) setPrices({ ...prices, [model]: { ...price, [kind]: n } })
                  }}
                />
              )}
            </Field>
          ))}
        </div>
      </fieldset>
      <Field label={t.settings.ai.budget} hint={t.settings.ai.budgetHint} error={budgetMicro === undefined ? t.settings.ai.budgetInvalid : error}>
        {(p) => <Input {...controlProps(p)} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />}
      </Field>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? t.settings.saving : t.settings.save}
        </Button>
      </div>
    </form>
  )
}

function KeyForm({ settings, timeZone, onSaved }: { settings: AISettings; timeZone: string | undefined; onSaved: () => void }) {
  const { client } = useApi()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string>()
  const [note, setNote] = useState<string>()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError(undefined)
    setNote(undefined)
    try {
      await fn()
      setNote(done)
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!settings.can_save_key) return <p className="text-sm text-muted-foreground">{t.settings.ai.noSecretsKey}</p>
  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void run(async () => {
          await client.ai.setKey(key)
          setKey('')
        }, t.settings.ai.keySaved)
      }}
    >
      <p role="status" className="text-sm">
        {settings.key ? t.settings.ai.keyIs(settings.key.last4, formatDate(settings.key.set_at, timeZone)) : t.settings.ai.noKey}
      </p>
      <Field label={settings.key ? t.settings.ai.replaceKey : t.settings.ai.key} hint={t.settings.ai.keyHint} error={error}>
        {(p) => <PasswordInput {...controlProps(p)} autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />}
      </Field>
      {note ? <p className="text-sm text-success">{note}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || key.trim() === ''}>
          {t.settings.ai.saveKey}
        </Button>
        {settings.key ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await client.ai.testKey()
                  if (!r.ok) throw new Error(t.settings.ai.keyRefused(r.error_code ?? ''))
                }, t.settings.ai.keyWorks)
              }
            >
              {t.settings.ai.testKey}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t.settings.ai.confirmRemove)) void run(() => client.ai.removeKey(), t.settings.ai.keyRemoved)
              }}
            >
              {t.settings.ai.removeKey}
            </Button>
          </>
        ) : null}
      </div>
    </form>
  )
}
