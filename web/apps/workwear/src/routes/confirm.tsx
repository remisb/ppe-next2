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
import { formatSize } from '@/lib/utils'

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
          {record.status === 'ORDERED' ? <Summary record={record} /> : null}
          <ReceiptDocument record={record} />
          {record.status === 'ORDERED' ? (
            <section
              aria-label="Confirm receipt / Подтверждение"
              className={
                // Pinned to the bottom of the screen, above the home bar, while the record scrolls behind it.
                'sticky bottom-0 z-10 -mx-4 mt-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_16px_-12px_rgb(0_0_0/0.25)] backdrop-blur ' +
                'sm:mx-auto sm:max-w-4xl sm:rounded-t-lg sm:border-x sm:px-6 print:hidden'
              }
            >
              {/* The whole label is the tap target, not just the small box. */}
              <label className="flex cursor-pointer items-start gap-3 rounded-md p-1 text-sm has-checked:text-foreground">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
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
              <Button size="lg" className="w-full sm:w-fit" disabled={!checked || busy} onClick={() => void confirm()}>
                {busy ? '…' : 'Confirm Receipt / Подтвердить'}
              </Button>
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}

/**
 * What the employee is asked, before the full record: whose items, how many,
 * and each one with its size and quantity. The record below is the document
 * they agree to; this only makes the task clear at a glance.
 */
function Summary({ record }: { record: OrderRecord }) {
  const r = record.receipt
  const n = r.lines.length
  return (
    <section aria-labelledby="confirm-summary" className="mx-auto mb-4 max-w-4xl">
      <h2 id="confirm-summary" className="text-xl font-semibold text-balance sm:text-2xl">
        {r.employee_first_name}, please confirm you received {n === 1 ? 'this item' : `these ${n} items`}
      </h2>
      <p lang="ru" className="mt-1 text-muted-foreground">
        Пожалуйста, подтвердите получение {n === 1 ? 'этого предмета' : 'этих предметов'}.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {r.record_number} · prepared by / подготовил {r.prepared_by_name}
      </p>
      <ul aria-label="Items / Предметы" className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
        {r.lines.map((l) => (
          <li key={l.line_no} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
            <span className="min-w-0">
              <span className="font-medium">{l.item_name}</span>
              {l.size ? <span className="text-muted-foreground"> · {formatSize(l.size)}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">× {l.quantity}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        The full record is below. / Полный документ ниже.
      </p>
    </section>
  )
}
