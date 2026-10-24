import { ApiError } from '@ppe/api-client'
import { type Density, MIN_PASSWORD_LENGTH, type PasswordChange, type PasswordErrors, themes, useApi, useDensity, useSession, useTheme, validatePasswordChange } from '@ppe/app-shell'
import { deviceText } from '@ppe/audit'
import { Alert, AlertDescription, AlertTitle } from '@ppe/ui/components/alert'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ppe/ui/components/card'
import { Field, PasswordInput, controlProps } from '@ppe/ui/components/field'
import { Loaded, PageHeader } from '@ppe/ui/components/states'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { CheckCircle2, LogOut } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import { RelativeDate } from '@ppe/ui/components/relative-date'
import { Segmented } from '@ppe/ui/components/segmented'
import { languages, t } from '@/i18n'
import { sortDevices } from '@/lib/devices'

const empty: PasswordChange = { current: '', next: '', confirm: '' }

const densities: Density[] = ['comfortable', 'compact']

/**
 * Account: the signed-in user's interface language (saved on their account),
 * their own password, the devices they are signed in on, and, with a mouse, the table density. On a phone Sign out is here, since the bottom bar holds only
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
  // The account's email, for the change-password form's hidden username field.
  const [email, setEmail] = useState('')
  useEffect(() => {
    client.me().then(
      (u) => setEmail(u.email),
      () => {},
    )
  }, [client])

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
      <PageHeader title={t.account.title} subtitle={t.account.signedInAs(session.name)} />
      <Card className="mb-6 md:max-w-md">
        <CardHeader>
          <CardTitle>{t.account.language}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Each language is named in itself, so it can be found whatever is showing now. */}
          <Segmented
            layout="fit"
            label={t.account.language}
            options={languages.map((l) => ({ ...l, lang: l.value }))}
            value={session.language}
            onChange={(lang) => {
              setLanguageError(undefined)
              setUserLanguage(lang).catch((err: unknown) => setLanguageError(errorText(err)))
            }}
          />
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
          <Segmented layout="fit" label={t.account.theme} options={themes.map((th) => ({ value: th, label: t.account[th] }))} value={theme} onChange={setTheme} />
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
            {/* Tells a password manager whose password changes, so it updates that saved sign-in. */}
            <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
            <Field label={t.account.currentPassword} required error={errors.current}>
              {(p) => <PasswordInput {...controlProps(p)} name="current-password" autoComplete="current-password" value={form.current} onChange={set('current')} />}
            </Field>
            <Field label={t.account.newPassword} required error={errors.next} hint={t.account.atLeast(MIN_PASSWORD_LENGTH)}>
              {(p) => <PasswordInput {...controlProps(p)} name="new-password" autoComplete="new-password" value={form.next} onChange={set('next')} />}
            </Field>
            <Field label={t.account.confirmNewPassword} required error={errors.confirm}>
              {(p) => <PasswordInput {...controlProps(p)} name="confirm-password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />}
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
      <Devices />
      {/* Compact rows need a mouse or trackpad: a touch screen keeps its 44px rows, so it has nothing to choose. */}
      <Card className="mt-6 md:max-w-md pointer-coarse:hidden">
        <CardHeader>
          <CardTitle>{t.account.tableRows}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Segmented layout="fit" label={t.account.tableRows} options={densities.map((d) => ({ value: d, label: t.account[d] }))} value={density} onChange={setDensity} />
          <p className="text-sm text-muted-foreground">{t.account.densityHint}</p>
        </CardContent>
      </Card>
      <Button variant="outline" className="mt-6 w-full md:hidden" onClick={onSignOut}>
        <LogOut aria-hidden /> {t.account.signOut}
      </Button>
    </>
  )
}

/**
 * Signed-in devices: every browser the user is signed in on, this one first,
 * each but this one with Sign out, and Sign out all other devices. This one
 * signs out with the usual Sign out. A password change signs the others out too.
 */
function Devices() {
  const { client } = useApi()
  const devices = useLoad(() => client.sessions.list(), [client])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const end = async (id?: string) => {
    setBusy(true)
    setError(undefined)
    try {
      if (id) await client.sessions.end(id)
      else await client.sessions.endOthers()
      devices.reload()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const list = sortDevices(devices.data ?? [])
  const others = list.filter((d) => !d.current).length
  return (
    <Card className="mt-6 md:max-w-md">
      <CardHeader>
        <CardTitle>{t.account.devices}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t.account.devicesHint}</p>
        <Loaded load={devices}>
          {() => (
            <ul aria-label={t.account.devices} className="divide-y divide-border">
              {list.map((d) => {
                const label = deviceText(d.user_agent)
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {label}
                        {d.current ? <Badge variant="outline">{t.account.thisDevice}</Badge> : null}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t.account.lastUsed} <RelativeDate iso={d.last_used_at} timeZone={undefined} time sentence />
                        {d.ip ? ` · ${d.ip}` : null}
                      </p>
                      <p className="text-sm text-muted-foreground">{d.keep_signed_in ? t.account.keptSignedIn : t.account.untilBrowserCloses}</p>
                    </div>
                    {d.current ? null : (
                      <Button size="sm" variant="outline" className="shrink-0 pointer-coarse:h-11" aria-label={t.account.signOutDevice(label)} disabled={busy} onClick={() => void end(d.id)}>
                        {t.account.signOut}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Loaded>
        {devices.data && others === 0 ? <p className="text-sm text-muted-foreground">{t.account.noOtherDevices}</p> : null}
        {others > 0 ? (
          <Button variant="outline" className="w-full sm:w-fit" disabled={busy} onClick={() => void end()}>
            {t.account.signOutOthers}
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
