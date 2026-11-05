import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { errorText } from '@ppe/ui/lib/use-load'
import { useEffect, useId, useState } from 'react'

import { t } from '@/i18n'

/** How the person agreed to the AI colouring (PR-6). */
export type Consent = 'verbal' | 'written'

/** The colour photo chosen with Use, saved as the employee's photo with the consent. */
export type Colour = { blob: Blob; consent: Consent }

/** An object URL for a blob, revoked when it changes or the screen goes. */
function useBlobURL(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/**
 * Make Colour Photo (AI) on the Portrait step (FR-12, PR-6, PR-7; ADR 0007 D4,
 * D7): offered only to personnel.portraits.colorize, and only while Settings →
 * AI has it on with a key. The person's consent first (they may refuse: then
 * the grey portrait stays the only one); the cut-out portrait goes to the API,
 * which sends it to OpenAI without a name and keeps the face's every line (the
 * luminance lock). Before and after side by side, labelled AI-coloured: Use,
 * Try Again or Discard. A box moved or resized after it discards the colour
 * (stamp changes).
 */
export function ColourPhoto({
  grey,
  stamp,
  employeeId,
  value,
  onChange,
}: {
  /** The portrait as cut out now. */
  grey: () => Promise<Blob | undefined>
  /** Changes when the portrait's box does. */
  stamp: string
  employeeId: string | undefined
  value: Colour | null
  onChange: (c: Colour | null) => void
}) {
  const session = useSession()
  const { client } = useApi()
  const may = session.can('personnel.portraits.colorize')
  const [available, setAvailable] = useState(false)
  const [consent, setConsent] = useState<Consent | null>(null)
  const [before, setBefore] = useState<Blob | null>(null)
  const [after, setAfter] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const beforeURL = useBlobURL(before)
  const afterURL = useBlobURL(after ?? value?.blob)
  const name = useId()

  useEffect(() => {
    if (!may) return
    let live = true
    client.personnel
      .colorizeAvailable()
      .then((r) => live && setAvailable(r.available))
      .catch(() => live && setAvailable(false))
    return () => {
      live = false
    }
  }, [may, client])

  // A colour made from another box is not this portrait's.
  useEffect(() => {
    setBefore(null)
    setAfter(null)
    setError(undefined)
  }, [stamp])

  if (!may || !available) return null

  const make = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const g = await grey()
      if (!g) return
      setBefore(g)
      setAfter(await client.personnel.colorize(g, employeeId))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={`${name}-title`} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div>
        <h2 id={`${name}-title`} className="font-medium">
          {t.colour.title}
        </h2>
        <p className="text-sm text-muted-foreground">{t.colour.hint}</p>
      </div>

      {value ? (
        <div className="flex flex-wrap items-center gap-3">
          {afterURL ? <img src={afterURL} alt={t.colour.afterAlt} className="h-32 w-auto rounded-md border border-border" /> : null}
          <div className="flex flex-col gap-2">
            <Badge variant="secondary">{t.colour.label}</Badge>
            <p className="text-sm">{t.colour.chosen(t.colour.given[value.consent])}</p>
            <div>
              <Button variant="outline" size="sm" onClick={() => onChange(null)}>
                {t.colour.dontUse}
              </Button>
            </div>
          </div>
        </div>
      ) : after && beforeURL && afterURL ? (
        <>
          <div className="grid max-w-md grid-cols-2 gap-3">
            <figure className="flex flex-col gap-1">
              <img src={beforeURL} alt={t.colour.beforeAlt} className="w-full rounded-md border border-border" />
              <figcaption className="text-xs text-muted-foreground">{t.colour.before}</figcaption>
            </figure>
            <figure className="flex flex-col gap-1">
              <img src={afterURL} alt={t.colour.afterAlt} className="w-full rounded-md border border-border" />
              <figcaption className="text-xs text-muted-foreground">
                <Badge variant="secondary">{t.colour.label}</Badge>
              </figcaption>
            </figure>
          </div>
          <p className="text-sm text-muted-foreground">{t.colour.guess}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => consent && onChange({ blob: after, consent })}>{t.colour.use}</Button>
            <Button variant="outline" disabled={busy} onClick={() => void make()}>
              {busy ? t.colour.making : t.colour.again}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setAfter(null)
                setBefore(null)
              }}
            >
              {t.colour.discard}
            </Button>
          </div>
        </>
      ) : (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t.colour.consent}</legend>
            {(['verbal', 'written'] as const).map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-3">
                <input type="radio" name={`${name}-consent`} className="size-5 accent-primary" checked={consent === c} onChange={() => setConsent(c)} />
                {t.colour.consents[c]}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">{t.colour.consentHint}</p>
          </fieldset>
          <div>
            <Button variant="outline" disabled={!consent || busy} onClick={() => void make()}>
              {busy ? t.colour.making : t.colour.make}
            </Button>
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}
