import { ApiError } from '@ppe/api-client'
import { CheckCircle2, LogOut } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { PageHeader } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, controlProps } from '@/components/ui/field'
import { type Lang, languages, t } from '@/i18n'
import { useApi, useSession } from '@/lib/api'
import { type Density, useDensity } from '@/lib/density'
import { themes, useTheme } from '@/lib/theme'
import { MIN_PASSWORD_LENGTH, type PasswordChange, type PasswordErrors, validatePasswordChange } from '@/lib/password'
import { errorText } from '@/lib/use-load'

const empty: PasswordChange = { current: '', next: '', confirm: '' }

const densities: Density[] = ['comfortable', 'compact']

/** A row of mutually exclusive choices, the pressed one raised: Language, Table rows. */
const choice =
  'flex h-9 cursor-pointer items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11'

/**
 * Account: the signed-in user's interface language (saved on their account),
 * their own password, and, with a mouse, the table density. On a phone Sign out is here, since the bottom bar holds only
 * the sections; from md it is in the sidebar.
 */
export function Account({ onSignOut }: { onSignOut: () => void }) {
  const { client, setUserLanguage } = useApi()
  const session = useSession()
  const [languageError, setLanguageError] = useState<string>()
  const [form, setForm] = useState<PasswordChange>(empty)
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [density, setDensity] = useDensity(session.userId)
  const [theme, setTheme] = useTheme()

  const set = (k: keyof PasswordChange) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setErrors((er) => ({ ...er, [k]: undefined }))
    setDone(false)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validatePasswordChange(form)
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    setBusy(true)
    try {
      await client.changeOwnPassword(form.current, form.next)
      setForm(empty)
      setDone(true)
    } catch (err) {
      // The API answers a wrong current password with a 400 naming the field.
      if (err instanceof ApiError && err.isValidation && err.message.includes('current_password')) {
        setErrors({ current: t.account.currentIncorrect })
      } else {
        setServerError(errorText(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={t.account.title} description={t.account.signedInAs(session.name)} />
      <Card className="mb-6 md:max-w-md">
        <CardHeader>
          <CardTitle>{t.account.language}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Each language is named in itself, so it can be found whatever is showing now. */}
          <div role="group" aria-label={t.account.language} className="inline-grid w-fit grid-flow-col gap-1 rounded-lg bg-muted p-1">
            {languages.map((l) => (
              <button
                key={l.value}
                type="button"
                lang={l.value}
                aria-pressed={session.language === l.value}
                onClick={() => {
                  setLanguageError(undefined)
                  setUserLanguage(l.value as Lang).catch((err: unknown) => setLanguageError(errorText(err)))
                }}
                className={choice}
              >
                {l.label}
              </button>
            ))}
          </div>
          {languageError ? (
            <p role="alert" className="text-sm text-destructive">
              {t.account.languageFailed}: {languageError}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t.account.languageHint}</p>
        </CardContent>
      </Card>
      <Card className="mb-6 md:max-w-md">
        <CardHeader>
          <CardTitle>{t.account.theme}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div role="group" aria-label={t.account.theme} className="inline-grid w-fit grid-flow-col gap-1 rounded-lg bg-muted p-1">
            {themes.map((th) => (
              <button key={th} type="button" aria-pressed={theme === th} onClick={() => setTheme(th)} className={choice}>
                {t.account[th]}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t.account.themeHint}</p>
        </CardContent>
      </Card>
      <Card className="md:max-w-md">
        <CardHeader>
          <CardTitle>{t.account.changePassword}</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <Alert className="mb-4">
              <CheckCircle2 aria-hidden />
              <AlertTitle>{t.account.passwordChanged}</AlertTitle>
              <AlertDescription>{t.account.useNewPassword}</AlertDescription>
            </Alert>
          ) : null}
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <Field label={t.account.currentPassword} required error={errors.current}>
              {(p) => <Input {...controlProps(p)} type="password" autoComplete="current-password" value={form.current} onChange={set('current')} />}
            </Field>
            <Field label={t.account.newPassword} required error={errors.next} hint={t.account.atLeast(MIN_PASSWORD_LENGTH)}>
              {(p) => <Input {...controlProps(p)} type="password" autoComplete="new-password" value={form.next} onChange={set('next')} />}
            </Field>
            <Field label={t.account.confirmNewPassword} required error={errors.confirm}>
              {(p) => <Input {...controlProps(p)} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />}
            </Field>
            {serverError ? (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            ) : null}
            <Button type="submit" className="w-full sm:w-fit" disabled={busy}>
              {busy ? t.account.changing : t.account.changePassword}
            </Button>
          </form>
        </CardContent>
      </Card>
      {/* Compact rows need a mouse or trackpad: a touch screen keeps its 44px rows, so it has nothing to choose. */}
      <Card className="mt-6 md:max-w-md pointer-coarse:hidden">
        <CardHeader>
          <CardTitle>{t.account.tableRows}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div role="group" aria-label={t.account.tableRows} className="inline-grid w-fit grid-flow-col gap-1 rounded-lg bg-muted p-1">
            {densities.map((d) => (
              <button key={d} type="button" aria-pressed={density === d} onClick={() => setDensity(d)} className={choice}>
                {t.account[d]}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t.account.densityHint}</p>
        </CardContent>
      </Card>
      <Button variant="outline" className="mt-6 w-full md:hidden" onClick={onSignOut}>
        <LogOut aria-hidden /> {t.account.signOut}
      </Button>
    </>
  )
}
