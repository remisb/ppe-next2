import type { OrderRecord } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'

import { ReceiptDocument } from '@/components/receipt'
import { Loading } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'
import { errorText, useLoad } from '@/lib/use-load'

/**
 * The employee's secure confirmation page (manual §3.6). Reached by link, with
 * no sign-in and no app navigation; the token is the only credential. It shows
 * the locked bilingual receipt, requires the checkbox, and changes the same
 * order to GIVEN. Confirming twice shows the same record.
 */
export function ConfirmPage({ token }: { token: string }) {
  const { client } = useApi()
  const view = useLoad(() => client.confirmations.view(token), [token])
  const [checked, setChecked] = useState(false)
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
    <main className="mx-auto max-w-4xl p-4 print:p-0">
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
          <ReceiptDocument record={record} />
          {record.status === 'ORDERED' ? (
            <section className="mx-auto mt-4 flex max-w-4xl flex-col gap-3 print:hidden">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                <span>
                  I have received the items listed above and agree with the confirmation text.
                  <br />
                  <span lang="ru">Я получил(а) перечисленные выше предметы и согласен(на) с текстом подтверждения.</span>
                </span>
              </label>
              {error && !expired ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorText(error)}
                </p>
              ) : null}
              <Button size="lg" disabled={!checked || busy} onClick={() => void confirm()}>
                {busy ? '…' : 'Confirm Receipt / Подтвердить'}
              </Button>
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}
