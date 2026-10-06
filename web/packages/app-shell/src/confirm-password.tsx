import { ApiError } from '@ppe/api-client'
import { Button } from '@ppe/ui/components/button'
import { Field, PasswordInput, controlProps } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { errorText } from '@ppe/ui/lib/use-load'
import { type FormEvent, useState } from 'react'

import { type PasswordPrompt } from './api.tsx'
import { shellText } from './text.ts'

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
      setError(shellText().passwordIncorrect)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await prompt.confirm(password)
      form.reset()
    } catch (err) {
      setError(err instanceof ApiError && err.isValidation ? shellText().passwordIncorrect : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet open={prompt !== null} onClose={cancel} title={shellText().confirmPasswordTitle} description={shellText().confirmPasswordHint}>
      <form method="post" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={shellText().password} required error={error}>
          {(p) => <PasswordInput {...controlProps(p)} name="password" autoComplete="current-password" autoFocus />}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={cancel}>
            {shellText().cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? shellText().confirmingPassword : shellText().confirmPasswordButton}
          </Button>
        </div>
      </form>
    </FormSheet>
  )
}
