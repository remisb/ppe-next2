import { HardHat } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, PasswordInput, controlProps } from '@/components/ui/field'
import { t } from '@/i18n'
import { useApi } from '@/lib/api'
import { errorText } from '@/lib/use-load'

/**
 * Sign in, in Gavort's quiet colours: a pale panel with the company's mark,
 * the app's name and a faint contour pattern, and the form on white beside it
 * (from lg; above it on a phone and a tablet, as a short band). In dark mode the
 * panel turns navy. The page is in the device's language (deviceLanguage).
 */
export function SignIn() {
  const { signIn } = useApi()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(errorText(err) === 'unauthenticated' ? t.shell.wrongPassword : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-background lg:grid-cols-[5fr_6fr] lg:grid-rows-none">
      <div className="relative overflow-hidden bg-brand-panel px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6 text-brand-panel-foreground lg:flex lg:flex-col lg:justify-between lg:p-10">
        <Contours />
        <Brand />
        <div className="relative mt-16 hidden lg:block">
          <p className="max-w-[16ch] text-2xl font-semibold tracking-tight">{t.common.appName}</p>
          <p className="mt-2 max-w-[34ch] text-sm opacity-70">{t.shell.signInTagline}</p>
        </div>
      </div>
      <div className="flex justify-center px-5 py-8 lg:items-center lg:p-10">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">{t.shell.signIn}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.shell.signInHint}</p>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <Field label={t.shell.email} required>
              {(p) => <Input {...controlProps(p)} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label={t.shell.password} required error={error}>
              {(p) => (
                <PasswordInput
                  {...controlProps(p)}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" className="bg-brand text-brand-foreground hover:bg-brand/90" disabled={busy || !email || !password}>
              {busy ? t.shell.signingIn : t.shell.signIn}
            </Button>
          </form>
        </div>
      </div>
    </main>
  )
}

/** Gavort's mark: the app's hard hat on navy, the company's name (the same in every language) and the app's. */
function Brand() {
  return (
    <div className="relative flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground">
        <HardHat aria-hidden className="size-5" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[0.95rem] font-extrabold tracking-[0.08em]">GAVORT</span>
        <span className="text-xs opacity-70">{t.common.appName}</span>
      </span>
    </div>
  )
}

/** A faint contour pattern behind the panel: decoration only. */
function Contours() {
  const lines = [180, 210, 240, 270, 300, 330, 360]
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 size-full stroke-current opacity-[0.09]"
      fill="none"
    >
      {lines.map((y) => (
        <path key={y} d={`M-20 ${y} C80 ${y - 50} 140 ${y + 30} 240 ${y - 20} S420 ${y - 60} 440 ${y - 40}`} />
      ))}
    </svg>
  )
}
