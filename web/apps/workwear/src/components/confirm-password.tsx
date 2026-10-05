import { ApiError } from '@ppe/api-client'
import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, PasswordInput, controlProps } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { t } from '@/i18n'
import { type PasswordPrompt } from '@/lib/api'
import { errorText } from '@/lib/use-load'

/**
 * Asks for the password again when an action needs a recent sign-in
 * (managing users, a sign-in older than API_RECENT_SIGN_IN). Continue
 * confirms it and the action goes ahead; Cancel leaves it undone.
 */
export function ConfirmPassword({ prompt }: { prompt: PasswordPrompt | null }) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const cancel = () => {
    setError(undefined)
    prompt?.cancel()
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const password = String(new FormData(form).get('password') ?? '')
    if (!prompt || !password) {
      setError(t.shell.passwordIncorrect)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await prompt.confirm(password)
      form.reset()
    } catch (err) {
      setError(err instanceof ApiError && err.isValidation ? t.shell.passwordIncorrect : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet open={prompt !== null} onClose={cancel} title={t.shell.confirmPasswordTitle} description={t.shell.confirmPasswordHint}>
      <form method="post" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t.shell.password} required error={error}>
          {(p) => <PasswordInput {...controlProps(p)} name="password" autoComplete="current-password" autoFocus />}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={cancel}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t.shell.confirmingPassword : t.shell.confirmPasswordButton}
          </Button>
        </div>
      </form>
    </FormSheet>
  )
}
