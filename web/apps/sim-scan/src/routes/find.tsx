import type { Asset, SimCodes } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { staffHref } from '@ppe/routing'
import { simScanText } from '@ppe/sim-scan'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { ActionError, PageHeader } from '@ppe/ui/components/states'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Show PIN and PUK: a SIM found by its number, then its codes, after the
 * password is confirmed when the sign-in is not recent (the API asks; the
 * shell's Confirm your password answers). Each Show is recorded; the codes
 * stay on screen until hidden or the SIM is left.
 */
export function FindPage() {
  const { client } = useApi()
  const t = simScanText()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Asset[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const digits = q.replace(/\s+/g, '')
    if (digits.length < 4) return setFound(null)
    let live = true
    const timer = setTimeout(() => {
      client.assets.byNumber(digits).then(
        (list) => live && setFound(list.filter((a) => a.kind === 'SIM')),
        (e: unknown) => live && setError(e),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [client, q])

  return (
    <>
      <PageHeader title={t.findTitle} description={t.findDescription} />
      <div className="mb-6 max-w-md">
        <Field label={t.search} hint={t.searchHint}>
          {(p) => <Input {...controlProps(p)} type="search" inputMode="numeric" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
      </div>
      <ActionError error={error} />
      {found && found.length === 0 ? <p className="text-sm text-muted-foreground">{t.noMatch}</p> : null}
      {found && found.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {found.map((a) => (
            <SimRow key={a.id} sim={a} />
          ))}
        </ul>
      ) : null}
    </>
  )
}

function SimRow({ sim }: { sim: Asset }) {
  const { client } = useApi()
  const session = useSession()
  const t = simScanText()
  const [codes, setCodes] = useState<SimCodes | null>(null)
  const [none, setNone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [draft, setDraft] = useState<SimCodes | null>(null)
  const [saved, setSaved] = useState(false)

  const show = async () => {
    setBusy(true)
    setError(null)
    try {
      setCodes(await client.assets.showSimCodes(sim.id))
    } catch (e) {
      if (e instanceof ApiError && e.isNotFound) setNone(true)
      else setError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await client.assets.setSimCodes(sim.id, draft)
      setDraft(null)
      setNone(false)
      setSaved(true)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a href={staffHref(`/assets/sim-cards/${sim.id}`)} className="font-mono font-medium underline-offset-4 hover:underline">
          {sim.sim_no}
        </a>
        <span className="text-sm text-muted-foreground">
          {[sim.phone_no, sim.inventory_no, sim.provider].filter(Boolean).join(' · ')}
        </span>
        <div className="ml-auto">
          {codes ? (
            <Button variant="outline" size="sm" onClick={() => setCodes(null)}>
              <EyeOff aria-hidden className="size-4" />
              {t.hide}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void show()} disabled={busy}>
              <Eye aria-hidden className="size-4" />
              {t.show}
            </Button>
          )}
        </div>
      </div>
      {codes ? (
        <div className="flex flex-col gap-2">
          <dl className="grid w-fit grid-cols-[auto_auto_auto] items-center gap-x-4 gap-y-2">
            {(['pin', 'puk'] as const).map((k) => (
              <Code key={k} label={k === 'pin' ? t.pin : t.puk} value={codes[k]} />
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">{t.shownRecorded}</p>
        </div>
      ) : null}
      {none && !draft ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{t.noCodes}</p>
          {session.can('assets.manage') ? (
            <Button variant="outline" size="sm" onClick={() => setDraft({ pin: '', puk: '' })}>
              {t.addCodes}
            </Button>
          ) : null}
        </div>
      ) : null}
      {draft ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label={t.pin}>
            {(p) => <Input {...controlProps(p)} inputMode="numeric" autoComplete="off" className="w-32 font-mono" value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value })} />}
          </Field>
          <Field label={t.puk}>
            {(p) => <Input {...controlProps(p)} inputMode="numeric" autoComplete="off" className="w-40 font-mono" value={draft.puk} onChange={(e) => setDraft({ ...draft, puk: e.target.value })} />}
          </Field>
          <Button type="submit" disabled={busy}>
            {t.saveCodes}
          </Button>
        </form>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm">
          {t.codesSaved}
        </p>
      ) : null}
      <ActionError error={error} />
    </li>
  )
}

function Code({ label, value }: { label: string; value: string }) {
  const t = simScanText()
  const [copied, setCopied] = useState(false)
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg tracking-wider">{value}</dd>
      <dd>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? t.copied : t.copy(label)}
          title={copied ? t.copied : t.copy(label)}
          onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true), () => setCopied(false))}
        >
          <Copy aria-hidden className="size-4" />
        </Button>
      </dd>
    </>
  )
}
