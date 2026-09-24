import { ApiError } from '@ppe/api-client'
import { CheckCircle2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { PageHeader } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, controlProps } from '@/components/ui/field'
import { useApi, useSession } from '@/lib/api'
import { type PasswordChange, type PasswordErrors, validatePasswordChange } from '@/lib/password'
import { errorText } from '@/lib/use-load'

const empty: PasswordChange = { current: '', next: '', confirm: '' }

/** Account: change the signed-in user's own password. */
export function Account() {
  const { client } = useApi()
  const session = useSession()
  const [form, setForm] = useState<PasswordChange>(empty)
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

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
        setErrors({ current: 'The current password is incorrect.' })
      } else {
        setServerError(errorText(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Account" description={`Signed in as ${session.name}.`} />
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <Alert className="mb-4">
              <CheckCircle2 aria-hidden />
              <AlertTitle>Password changed</AlertTitle>
              <AlertDescription>Use the new password the next time you sign in.</AlertDescription>
            </Alert>
          ) : null}
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <Field label="Current password" required error={errors.current}>
              {(p) => <Input {...controlProps(p)} type="password" autoComplete="current-password" value={form.current} onChange={set('current')} />}
            </Field>
            <Field label="New password" required error={errors.next} hint="At least 8 characters.">
              {(p) => <Input {...controlProps(p)} type="password" autoComplete="new-password" value={form.next} onChange={set('next')} />}
            </Field>
            <Field label="Confirm new password" required error={errors.confirm}>
              {(p) => <Input {...controlProps(p)} type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />}
            </Field>
            {serverError ? (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? 'Changing…' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  )
}
