import type { Settings } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { parseEuro } from '@ppe/i18n'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ppe/ui/components/card'
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { Loaded, PageHeader } from '@ppe/ui/components/states'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { linkVariants } from '@ppe/ui/components/link'
import { ExternalLink, X } from 'lucide-react'
import { type FormEvent, useEffect, useId, useState } from 'react'

import { t } from '@/i18n'
import {
  type ProviderProblem,
  type SimProviders,
  type ValueProblem,
  MAX_PLAN_LENGTH,
  providerProblem,
  sameProviders,
  sameValue,
  valueProblem,
  valueText,
  withProvider,
  withoutProvider,
} from '@/lib/sim-providers'
import { type SupplierChatErrors, checkSupplierChat } from '@/lib/supplier-chat'

/**
 * Settings (/settings, administrators only): the organisation's settings. The
 * supplier's WhatsApp group, which Copy for WhatsApp opens for an order
 * message, and the SIM providers, which Add SIM offers, with the Non-return
 * Value it fills in.
 */
export function SettingsPage() {
  const { client } = useApi()
  const settings = useLoad(() => client.settings())

  return (
    <>
      <PageHeader title={t.settings.title} description={t.settings.description} />
      <Loaded load={settings}>
        {(data) => (
          <div className="flex flex-col gap-6">
            <SupplierChatCard settings={data} onSaved={settings.reload} />
            <SimProvidersCard settings={data} onSaved={settings.reload} />
          </div>
        )}
      </Loaded>
    </>
  )
}

/**
 * The supplier's WhatsApp group (WhatsApp cannot open a group with the message
 * typed in, so staff paste it there). Saving both fields empty removes the group.
 */
function SupplierChatCard({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { client } = useApi()
  const titleId = useId()
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [errors, setErrors] = useState<SupplierChatErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'saved' | 'cleared'>()
  const chat = settings.supplier_chat

  // The form starts from what is saved, and again after each save.
  useEffect(() => {
    setName(chat?.name ?? '')
    setLink(chat?.link ?? '')
  }, [chat?.name, chat?.link])

  const save = async (next: { name: string; link: string }) => {
    const found = checkSupplierChat(next.name, next.link)
    setErrors(found)
    setServerError(undefined)
    setDone(undefined)
    if (found.name || found.link) return
    setBusy(true)
    try {
      await client.updateSupplierChat({ name: next.name.trim(), link: next.link.trim() })
      setDone(next.link.trim() ? 'saved' : 'cleared')
      onSaved()
    } catch (err) {
      setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save({ name, link })
  }

  return (
    <Card role="region" aria-labelledby={titleId} className="md:max-w-xl">
      <CardHeader>
        <CardTitle id={titleId}>{t.settings.supplierChat}</CardTitle>
        <CardDescription>{t.settings.supplierChatIntro}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p role="status" className="text-sm">
          {done === 'saved' ? `${t.settings.saved} ` : done === 'cleared' ? `${t.settings.cleared} ` : null}
          {done !== 'cleared' ? (chat ? t.settings.current(chat.name) : t.settings.notSet) : null}{' '}
          {chat ? (
            <a href={chat.link} target="_blank" rel="noreferrer" className={linkVariants({ underline: 'always', weight: 'medium', className: 'inline-flex items-center gap-0.5' })}>
              {t.settings.tryIt} <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label={t.settings.groupName} hint={t.settings.groupNameHint} error={errors.name ? t.settings.nameRequired : undefined}>
            {(p) => <Input {...controlProps(p)} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t.settings.inviteLink} hint={t.settings.inviteLinkHint} error={errors.link ? t.settings.invalidLink : serverError}>
            {(p) => (
              <Input
                {...controlProps(p)}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://chat.whatsapp.com/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? t.settings.saving : t.settings.save}
            </Button>
            {chat ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void save({ name: '', link: '' })}>
                {t.settings.clear}
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * The SIM providers Add SIM offers, the default one it chooses first, the
 * default Non-return Value it fills in, and the default plan Give SIM fills in
 * for a card without one. Added, removed, the default chosen, the value and
 * the plan typed as a draft, saved together; cards already registered keep
 * their provider, value and plan.
 */
function SimProvidersCard({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { client } = useApi()
  const titleId = useId()
  const saved: SimProviders = { providers: settings.sim_providers, default: settings.default_sim_provider ?? '' }
  const [draft, setDraft] = useState<SimProviders>(saved)
  const savedValue = valueText(settings.default_sim_non_return_value_cents)
  // The value as typed; it is checked on Save.
  const [value, setValue] = useState(savedValue)
  const [badValue, setBadValue] = useState<ValueProblem>()
  const savedPlan = settings.default_sim_plan ?? ''
  const [plan, setPlan] = useState(savedPlan)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<ProviderProblem>()
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const dirty = !sameProviders(draft, saved) || !sameValue(value, savedValue) || plan.trim() !== savedPlan

  // The draft starts from what is saved, and again after each save.
  const savedKey = JSON.stringify(saved)
  useEffect(() => setDraft(saved), [savedKey])
  useEffect(() => setValue(savedValue), [savedValue])
  useEffect(() => setPlan(savedPlan), [savedPlan])

  const change = (next: SimProviders) => {
    setDraft(next)
    setDone(false)
    setServerError(undefined)
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    const found = providerProblem(draft.providers, name)
    setProblem(found)
    if (found) return
    change(withProvider(draft, name))
    setName('')
  }

  const save = async () => {
    const problem = valueProblem(value)
    setBadValue(problem)
    if (problem) return
    setBusy(true)
    setServerError(undefined)
    try {
      await client.updateSimProviders({ ...draft, default_non_return_value_cents: parseEuro(value), default_plan: plan.trim() })
      setDone(true)
      onSaved()
    } catch (err) {
      setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const summary =
    draft.providers.length === 0 ? t.settings.noProviders : draft.default ? t.settings.defaultProviderIs(draft.default) : t.settings.noDefaultProvider

  return (
    <Card role="region" aria-labelledby={titleId} className="md:max-w-xl">
      <CardHeader>
        <CardTitle id={titleId}>{t.settings.simProviders}</CardTitle>
        <CardDescription>{t.settings.simProvidersIntro}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p role="status" className="text-sm">
          {done && !dirty ? `${t.settings.saved} ` : null}
          {summary}
          {dirty ? ` ${t.settings.unsaved}` : null}
        </p>
        {draft.providers.length > 0 ? (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t.settings.defaultProvider}</legend>
            <ul className="divide-y rounded-lg border">
              {draft.providers.map((p) => (
                <li key={p} className="flex items-center gap-2 pr-1 pl-3">
                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name={`${titleId}-default`}
                      className="size-5 shrink-0 accent-primary"
                      checked={draft.default === p}
                      onChange={() => change({ ...draft, default: p })}
                    />
                    <span className="min-w-0 truncate">{p}</span>
                    {draft.default === p ? (
                      <Badge variant="secondary" aria-hidden>
                        {t.settings.defaultBadge}
                      </Badge>
                    ) : null}
                  </label>
                  <Button type="button" size="icon" variant="ghost" aria-label={t.settings.removeProvider(p)} onClick={() => change(withoutProvider(draft, p))}>
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
              <li className="pl-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-muted-foreground">
                  <input
                    type="radio"
                    name={`${titleId}-default`}
                    className="size-5 shrink-0 accent-primary"
                    checked={draft.default === ''}
                    onChange={() => change({ ...draft, default: '' })}
                  />
                  {t.settings.noDefault}
                </label>
              </li>
            </ul>
          </fieldset>
        ) : null}
        <form onSubmit={add} className="flex items-start gap-2" noValidate>
          <div className="min-w-0 flex-1">
            <Field label={t.settings.addProviderLabel} error={problem ? t.settings.providerProblems[problem] : undefined}>
              {(p) => (
                <Input
                  {...controlProps(p)}
                  autoComplete="off"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setProblem(undefined)
                  }}
                />
              )}
            </Field>
          </div>
          {/* Level with the input: the Field's label sits above it. */}
          <Button type="submit" variant="outline" className="mt-6.5">
            {t.settings.addProvider}
          </Button>
        </form>
        <Field label={t.settings.defaultValue} hint={t.settings.defaultValueHint} error={badValue ? t.settings.valueProblems[badValue] : undefined}>
          {(p) => (
            <Input
              {...controlProps(p)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="sm:max-w-40"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setBadValue(undefined)
                setDone(false)
                setServerError(undefined)
              }}
            />
          )}
        </Field>
        <Field label={t.settings.defaultPlan} hint={t.settings.defaultPlanHint}>
          {(p) => (
            <Input
              {...controlProps(p)}
              autoComplete="off"
              maxLength={MAX_PLAN_LENGTH}
              className="sm:max-w-xs"
              value={plan}
              onChange={(e) => {
                setPlan(e.target.value)
                setDone(false)
                setServerError(undefined)
              }}
            />
          )}
        </Field>
        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? t.settings.saving : t.settings.saveProviders}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                change(saved)
                setValue(savedValue)
                setBadValue(undefined)
                setPlan(savedPlan)
              }}
            >
              {t.settings.discard}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
