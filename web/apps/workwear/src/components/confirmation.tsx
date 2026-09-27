import type { OrderRecord } from '@ppe/api-client'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn, formatSize } from '@/lib/utils'

/*
 * What an employee sees to confirm receipt, on their own phone (the public
 * confirmation page) or on a staff member's device at the counter (hand-over
 * mode): the same summary, the same record and the same consent.
 */

/**
 * What the employee is asked, before the full record: whose items, how many,
 * and each one with its size and quantity. The record below is the document
 * they agree to; this only makes the task clear at a glance.
 */
export function ConfirmSummary({ record }: { record: OrderRecord }) {
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

/**
 * The consent: the confirmation text as a checkbox whose whole label is the tap
 * target, and Confirm, enabled once it is ticked. Pinned to the bottom of the
 * screen, above the home bar, while the record scrolls behind it.
 */
export function ConsentBar({
  busy,
  error,
  onConfirm,
  className,
}: {
  busy: boolean
  error?: string | undefined
  onConfirm: () => void
  className?: string
}) {
  const [checked, setChecked] = useState(false)
  return (
    <section
      aria-label="Confirm receipt / Подтверждение"
      className={cn(
        'sticky bottom-0 z-10 -mx-4 mt-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_16px_-12px_rgb(0_0_0/0.25)] backdrop-blur',
        'sm:mx-auto sm:max-w-4xl sm:rounded-t-lg sm:border-x sm:px-6 print:hidden',
        className,
      )}
    >
      <label className="flex cursor-pointer items-start gap-3 rounded-md p-1 text-sm has-checked:text-foreground">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>
          I have received the items listed above and agree with the confirmation text.
          <br />
          <span lang="ru">Я получил(а) перечисленные выше предметы и согласен(на) с текстом подтверждения.</span>
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button size="lg" className="w-full sm:w-fit" disabled={!checked || busy} onClick={onConfirm}>
        {busy ? '…' : 'Confirm Receipt / Подтвердить'}
      </Button>
    </section>
  )
}
