import { HardHat } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, PasswordInput, controlProps } from '@/components/ui/field'
import { t } from '@/i18n'
import { useApi } from '@/lib/api'
import { errorText } from '@/lib/use-load'

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
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <HardHat aria-hidden className="size-6" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{t.common.appName}</h1>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t.shell.signIn}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
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
            <Button type="submit" disabled={busy || !email || !password}>
              {busy ? t.shell.signingIn : t.shell.signIn}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
