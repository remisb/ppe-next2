import type { OrderRecord } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Alert, AlertDescription, AlertTitle } from '@ppe/ui/components/alert'
import { Button } from '@ppe/ui/components/button'
import { GavortEmblem } from '@ppe/ui/components/gavort-logo'
import { Loading } from '@ppe/ui/components/states'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { useState } from 'react'

import { ConfirmSummary, Confirmed, ConsentBar, FullRecord, LanguageSwitch } from '@/components/confirmation'
import { type ConfirmLang, confirmText, employeeLang, loadLang, saveLang } from '@/lib/confirm-text'

/**
 * The employee's secure confirmation page (manual §3.6). Reached by link, with
 * no sign-in and no app navigation; the token is the only credential. It says
 * first, in plain words, what is asked, then lists the items and the
 * confirmation statement; the whole locked bilingual record is one tap away,
 * and the consent (checkbox and Confirm) is pinned to the bottom of the screen.
 * EN / RU switches the interface language only. It changes the same order to
 * GIVEN; confirming twice shows the same confirmed state.
 */
export function ConfirmPage({ token }: { token: string }) {
  const { client } = useApi()
  const view = useLoad(() => client.confirmations.view(token), [token])
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState<OrderRecord | null>(null)
  const [error, setError] = useState<unknown>()
  // The employee's preferred language once the order is in, where the page speaks it;
  // else the one chosen last on this device or the browser's. EN / RU on the page wins.
  const [device] = useState<ConfirmLang>(loadLang)
  const [chosen, setChosen] = useState<ConfirmLang>()
  const lang = chosen ?? employeeLang(view.data?.employee_language) ?? device
  const t = confirmText[lang]

  const choose = (l: ConfirmLang) => {
    setChosen(l)
    saveLang(l)
  }

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
  // While asking, the consent bar is the bottom edge and carries the safe-area padding itself.
  const asking = !expired && !view.error && record?.status === 'ORDERED'

  return (
    <main
      className={cn(
        'mx-auto flex min-h-dvh max-w-4xl flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-8 print:p-0',
        asking ? 'pb-0' : 'pb-[max(2rem,env(safe-area-inset-bottom))]',
      )}
    >
      <header className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <span className="flex items-center text-brand-mark">
          <GavortEmblem className="size-9" />
          <span className="sr-only">Workwear &amp; Equipment</span>
        </span>
        <LanguageSwitch lang={lang} onChange={choose} />
      </header>
      {expired ? (
        <Alert variant="destructive" lang={lang}>
          <AlertTitle>{t.expiredTitle}</AlertTitle>
          <AlertDescription>{t.expiredBody}</AlertDescription>
        </Alert>
      ) : view.error ? (
        <Alert variant="destructive" lang={lang}>
          <AlertTitle>{t.loadErrorTitle}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {errorText(view.error)}
            <Button size="sm" variant="outline" onClick={view.reload}>
              {t.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !record ? (
        // The employee's page keeps its own EN / RU, not the device's staff language.
        <Loading label={t.loading} />
      ) : record.status === 'GIVEN' ? (
        <>
          <Confirmed record={record} lang={lang} next={t.closePage} />
          <FullRecord record={record} lang={lang} label={t.viewGiven} center />
        </>
      ) : (
        <>
          <ConfirmSummary record={record} lang={lang} />
          <FullRecord record={record} lang={lang} />
          <ConsentBar className="mt-auto" lang={lang} busy={busy} error={error && !expired ? errorText(error) : undefined} onConfirm={() => void confirm()} />
        </>
      )}
    </main>
  )
}
