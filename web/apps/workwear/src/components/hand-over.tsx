import type { OrderRecord } from '@ppe/api-client'
import { CheckCircle2 } from 'lucide-react'
import { type PointerEvent, useEffect, useId, useRef, useState } from 'react'

import { ConfirmSummary, ConsentBar } from '@/components/confirmation'
import { ReceiptDocument } from '@/components/receipt'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useApi } from '@/lib/api'
import { errorText, useLoad } from '@/lib/use-load'
import { cn } from '@/lib/utils'

/** How long Hand back must be held: long enough that a stray tap by the employee does nothing. */
const HOLD_MS = 1500

/**
 * Hand-over mode: the storekeeper turns this device to the employee at the
 * counter. It fills the screen (a modal dialog, full screen where allowed)
 * with no app navigation, and shows the employee what the public confirmation
 * page shows: what is asked, the items, the full record and the consent. Their
 * confirmation is recorded IN_PERSON with the signed-in staff member as giver.
 *
 * Getting out before the employee confirms takes Hand back held for 1.5
 * seconds, or Escape on a keyboard. For a device left at a counter, iPad
 * Guided Access also keeps the employee inside this screen.
 */
export function HandOver({ orderId, onGiven, onClose }: { orderId: string; onGiven: () => void; onClose: () => void }) {
  const { client } = useApi()
  const record = useLoad(() => client.orders.record(orderId), [orderId])
  const [confirmed, setConfirmed] = useState<OrderRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // The latest onClose, without reopening the dialog each time the parent renders.
  const close = useRef(onClose)
  close.current = onClose

  // A modal dialog: the page behind is inert, Escape asks to close.
  useEffect(() => {
    const d = dialog.current
    if (!d) return
    d.showModal()
    // Full screen where the browser allows it (not an iPhone); the dialog fills the window either way.
    if (!document.fullscreenElement && typeof d.requestFullscreen === 'function') void d.requestFullscreen().catch(() => undefined)
    const onCancel = (e: Event) => {
      e.preventDefault()
      close.current()
    }
    d.addEventListener('cancel', onCancel)
    return () => {
      d.removeEventListener('cancel', onCancel)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
      d.close()
    }
  }, [])

  const confirm = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setConfirmed(await client.orders.confirmInPerson(orderId))
      onGiven()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const r = record.data
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-background p-0 text-foreground backdrop:bg-background"
    >
      <main className="mx-auto max-w-4xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p id={titleId} className="text-sm font-medium text-muted-foreground">
            Hand-over / Выдача
          </p>
          {confirmed ? null : <HoldToClose onDone={onClose} />}
        </div>
        {record.error ? (
          <ErrorState error={record.error} onRetry={record.reload} />
        ) : !r ? (
          <Loading />
        ) : confirmed || r.status === 'GIVEN' ? (
          <Done record={confirmed ?? r} onClose={onClose} />
        ) : (
          <>
            <ConfirmSummary record={r} />
            <ReceiptDocument record={r} />
            <ConsentBar busy={busy} error={error ? errorText(error) : undefined} onConfirm={() => void confirm()} />
          </>
        )}
      </main>
    </dialog>
  )
}

/** After the employee confirmed: thanks, and the staff member's way back to the app. */
function Done({ record, onClose }: { record: OrderRecord; onClose: () => void }) {
  return (
    <section className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-center">
      <CheckCircle2 aria-hidden className="size-16 text-primary" />
      <h2 className="text-2xl font-semibold">Receipt confirmed / Получение подтверждено</h2>
      <p className="max-w-md text-muted-foreground">
        Thank you, {record.receipt.employee_first_name}. Please hand the device back.
        <br />
        <span lang="ru">Спасибо. Пожалуйста, верните устройство.</span>
      </p>
      <Button size="lg" onClick={onClose}>
        Done
      </Button>
    </section>
  )
}

/**
 * Hand back, which only works when held: a tap by the employee does nothing,
 * and a fill shows the staff member how long is left. Escape does the same on
 * a keyboard.
 */
function HoldToClose({ onDone }: { onDone: () => void }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(() => stop, [])
  const start = (e: PointerEvent) => {
    e.preventDefault()
    setHolding(true)
    timer.current = setTimeout(() => {
      stop()
      onDone()
    }, HOLD_MS)
  }
  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className="relative h-9 touch-none overflow-hidden rounded-md border border-border px-3 text-xs font-medium text-muted-foreground select-none pointer-coarse:h-11"
    >
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 bg-accent', holding ? 'w-full transition-[width] ease-linear' : 'w-0')}
        style={holding ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
      />
      <span className="relative">Hand back · hold</span>
    </button>
  )
}
