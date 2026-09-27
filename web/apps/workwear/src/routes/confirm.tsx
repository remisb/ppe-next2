import type { OrderRecord } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'

import { ConfirmSummary, ConsentBar } from '@/components/confirmation'
import { ReceiptDocument } from '@/components/receipt'
import { Loading } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'
import { errorText, useLoad } from '@/lib/use-load'

/**
 * The employee's secure confirmation page (manual §3.6). Reached by link, with
 * no sign-in and no app navigation; the token is the only credential. It first
 * says in plain words what is asked and lists the items, then shows the whole
 * locked bilingual receipt, with the consent (checkbox and Confirm) pinned to
 * the bottom of the screen so it is in reach wherever the reader is. It changes
 * the same order to GIVEN; confirming twice shows the same record.
 */
export function ConfirmPage({ token }: { token: string }) {
  const { client } = useApi()
  const view = useLoad(() => client.confirmations.view(token), [token])
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState<OrderRecord | null>(null)
  const [error, setError] = useState<unknown>()

  const confirm = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setConfirmed(await client.confirmations.confirm(token))
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const record = confirmed ?? view.data
  const expired = [view.error, error].some((e) => e instanceof ApiError && e.status === 410)

  return (
    <main className="mx-auto max-w-4xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8 print:p-0">
      {expired ? (
        <Alert variant="destructive">
          <AlertTitle>This link has expired or was replaced / Срок действия ссылки истёк</AlertTitle>
          <AlertDescription>
            Please ask for a new confirmation link. / Пожалуйста, запросите новую ссылку для подтверждения.
          </AlertDescription>
        </Alert>
      ) : view.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load the record / Не удалось загрузить документ</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {errorText(view.error)}
            <Button size="sm" variant="outline" onClick={view.reload}>
              Retry / Повторить
            </Button>
          </AlertDescription>
        </Alert>
      ) : !record ? (
        <Loading />
      ) : (
        <>
          {record.status === 'GIVEN' ? (
            <Alert className="mb-4 print:hidden">
              <CheckCircle2 aria-hidden />
              <AlertTitle>Receipt confirmed / Получение подтверждено</AlertTitle>
              <AlertDescription>Thank you. You can close this page. / Спасибо. Эту страницу можно закрыть.</AlertDescription>
            </Alert>
          ) : null}
          {record.status === 'ORDERED' ? <ConfirmSummary record={record} /> : null}
          <ReceiptDocument record={record} />
          {record.status === 'ORDERED' ? (
            <ConsentBar busy={busy} error={error && !expired ? errorText(error) : undefined} onConfirm={() => void confirm()} />
          ) : null}
        </>
      )}
    </main>
  )
}
