import { ApiError } from '@ppe/api-client'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, PasswordInput, controlProps } from '@ppe/ui/components/field'
import { GavortLogo } from '@ppe/ui/components/gavort-logo'
import { errorText } from '@ppe/ui/lib/use-load'
import { type FormEvent, useState } from 'react'

import { useApi } from './api.tsx'
import { keepSignedInChoice } from './session.ts'
import { shellText } from './text.ts'

/**
 * Sign in, in Gavort's quiet colours: the company's logo, the app's name and a
 * faint contour pattern on the page's own background, and the form beside them
 * (from lg, past a rule; above it on a phone and a tablet, as a short band, where
 * the logo drops its tagline). The logo is navy, and gold in dark mode. The page
 * is in the device's language (deviceLanguage).
 */
export function SignIn({ appName, tagline }: { appName: string; tagline: string }) {
  const { signIn } = useApi()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  // The values are read from the form, not from React state: a browser or
  // password manager that fills the fields does not always send the events
  // React listens for (Chrome holds an autofilled value back until the first
  // tap on the page), so a button disabled until the fields "changed" could
  // not be pressed after autofill.
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    const keepSignedIn = data.get('keep-signed-in') !== null
    if (!email || !password) {
      setError(shellText().enterEmailAndPassword)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await signIn(email, password, keepSignedIn)
    } catch (err) {
      // 429: too many attempts from this address, or failed ones for this account.
      if (err instanceof ApiError && err.status === 429) setError(shellText().tooManyAttempts)
      else setError(errorText(err) === 'unauthenticated' ? shellText().wrongPassword : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-background lg:grid-cols-[5fr_6fr] lg:grid-rows-none">
      <div className="relative overflow-hidden px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6 text-brand-mark lg:flex lg:flex-col lg:border-r lg:border-border lg:p-10">
        <Contours />
        {/* The book's clear space around the logo is an eighth of its width: 30px at w-60. */}
        <div className="relative flex flex-col items-center gap-4 lg:flex-1 lg:justify-center">
          <GavortLogo className="h-16 w-auto lg:hidden" />
          <GavortLogo withTagline className="hidden h-auto w-60 lg:block" />
          <p className="text-xs opacity-70 lg:hidden">{appName}</p>
        </div>
        <div className="relative hidden lg:block">
          <p className="max-w-[16ch] text-2xl font-semibold tracking-tight">{appName}</p>
          <p className="mt-2 max-w-[34ch] text-sm opacity-70">{tagline}</p>
        </div>
      </div>
      <div className="flex justify-center px-5 py-8 lg:items-center lg:p-10">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{shellText().signIn}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{shellText().signInHint}</p>
          {/*
           * Password managers find the account by the fields' stable names and
           * autocomplete tokens (email / username, password / current-password),
           * and offer to save it when this form is submitted with a password
           * field in it. Keep both if the form changes.
           */}
          <form method="post" onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
            <Field label={shellText().email} required>
              {(p) => <Input {...controlProps(p)} name="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" autoFocus />}
            </Field>
            <Field label={shellText().password} required error={error}>
              {(p) => <PasswordInput {...controlProps(p)} name="password" autoComplete="current-password" />}
            </Field>
            {/* Ticked unless it was unticked at the last sign-in on this device (a shared one). */}
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input type="checkbox" name="keep-signed-in" defaultChecked={keepSignedInChoice()} className="mt-0.5 size-5 shrink-0 accent-primary" />
              <span>
                <span className="font-medium">{shellText().keepSignedIn}</span>
                <span className="block text-muted-foreground">{shellText().keepSignedInHint}</span>
              </span>
            </label>
            <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90" disabled={busy}>
              {busy ? shellText().signingIn : shellText().signIn}
            </Button>
          </form>
        </div>
      </div>
    </main>
  )
}

/** A faint contour pattern behind the panel, faded out around the logo to keep its clear space: decoration only. */
function Contours() {
  const lines = [180, 210, 240, 270, 300, 330, 360]
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 size-full stroke-current opacity-[0.09] [mask-image:radial-gradient(closest-side,transparent_55%,black)] lg:[mask-image:radial-gradient(closest-side_at_50%_45%,transparent_60%,black)]"
      fill="none"
    >
      {lines.map((y) => (
        <path key={y} d={`M-20 ${y} C80 ${y - 50} 140 ${y + 30} 240 ${y - 20} S420 ${y - 60} 440 ${y - 40}`} />
      ))}
    </svg>
  )
}
