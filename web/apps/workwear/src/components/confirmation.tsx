import type { OrderRecord } from '@ppe/api-client'
import { CheckCircle2, ChevronDown, FileText } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'

import { ReceiptDocument } from '@/components/receipt'
import { Button } from '@/components/ui/button'
import { type ConfirmLang, confirmText, formatDay, formatMoney, formatTime } from '@/lib/confirm-text'
import { cn, formatSize } from '@/lib/utils'

/*
 * What an employee sees to confirm receipt, on their own phone (the public
 * confirmation page) or on a staff member's device at the counter (hand-over
 * mode): the task in plain words and the items first, the full record one tap
 * away, and the consent pinned in reach. The EN / RU switch changes only this
 * wording; the record stays bilingual and locked.
 */

/** EN / RU: the interface language, as two pressed-state buttons. */
export function LanguageSwitch({ lang, onChange }: { lang: ConfirmLang; onChange: (lang: ConfirmLang) => void }) {
  return (
    <div role="group" aria-label="Language / Язык" className="inline-grid grid-flow-col gap-1 rounded-lg bg-muted p-1 print:hidden">
      {(['en', 'ru'] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          aria-label={confirmText[l].name}
          onClick={() => onChange(l)}
          className="h-8 min-w-11 cursor-pointer rounded-md px-2.5 text-xs font-semibold text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-10"
        >
          {l}
        </button>
      ))}
    </div>
  )
}

/**
 * What the employee is asked: whose items, how many, from whom and when, each
 * item with its size and quantity, and the confirmation statement they agree
 * to, taken from the locked record in the chosen language.
 */
export function ConfirmSummary({ record, lang, timeZone }: { record: OrderRecord; lang: ConfirmLang; timeZone?: string | undefined }) {
  const t = confirmText[lang]
  const r = record.receipt
  const headingId = useId()
  return (
    <section lang={lang} aria-labelledby={headingId} className="mx-auto mb-4 w-full max-w-4xl">
      <h2 id={headingId} className="text-xl font-semibold text-balance sm:text-2xl">
        {t.ask(r.employee_first_name, r.lines.length)}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t.meta(r.record_number, r.prepared_by_name, formatDay(r.ordered_at, lang, timeZone))}</p>
      {/* Each line's quantity, unit price and amount, and the order's total, as on the record. */}
      <div className="mt-3 rounded-lg border border-border bg-card">
        <ul aria-label={t.items} className="divide-y divide-border">
          {r.lines.map((l) => (
            <li key={l.line_no} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="font-medium">{l.item_name}</span>
                {l.size ? <span className="text-muted-foreground"> · {formatSize(l.size)}</span> : null}
                <span className="block text-sm text-muted-foreground tabular-nums">{t.each(l.quantity, formatMoney(l.unit_price_cents, lang))}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatMoney(l.total_cents, lang)}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-baseline justify-between gap-3 border-t border-border px-4 py-3 font-semibold">
          <span>{t.total}</span>
          <span className="text-lg tabular-nums">{formatMoney(r.total_cents, lang)}</span>
        </p>
      </div>
      <figure className="mt-3 rounded-lg bg-muted/60 px-4 py-3 text-sm">
        <figcaption className="mb-1 text-xs font-medium text-muted-foreground">{t.statement}</figcaption>
        <blockquote>{lang === 'ru' ? r.confirmation_text_ru : r.confirmation_text_en}</blockquote>
      </figure>
    </section>
  )
}

/**
 * The full Items Given Record behind one button, unchanged and bilingual,
 * whichever interface language is chosen.
 */
export function FullRecord({
  record,
  lang,
  label,
  center,
  timeZone,
}: {
  record: OrderRecord
  lang: ConfirmLang
  /** The button's words when closed; "View full record" by default. */
  label?: string
  /** Centre the button, under the confirmed state. */
  center?: boolean
  timeZone?: string | undefined
}) {
  const t = confirmText[lang]
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="mx-auto w-full max-w-4xl pb-4">
      <div className={cn('flex', center && 'justify-center')}>
        <Button lang={lang} variant="outline" className={cn(!center && 'w-full sm:w-auto')} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <FileText aria-hidden />
          {open ? t.hideRecord : (label ?? t.viewRecord)}
          <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      <div id={id} className="mt-4 empty:hidden">
        {open ? <ReceiptDocument record={record} timeZone={timeZone} /> : null}
      </div>
    </div>
  )
}

/**
 * The consent: the confirmation text as a checkbox whose whole label is the tap
 * target, and Confirm, enabled once it is ticked. Pinned to the bottom of the
 * screen, above the home bar, while the page scrolls behind it.
 */
export function ConsentBar({
  lang,
  busy,
  error,
  onConfirm,
  className,
}: {
  lang: ConfirmLang
  busy: boolean
  error?: string | undefined
  onConfirm: () => void
  className?: string
}) {
  const t = confirmText[lang]
  const [checked, setChecked] = useState(false)
  return (
    <section
      lang={lang}
      aria-label={t.consentGroup}
      className={cn(
        'sticky bottom-0 z-10 -mx-4 mt-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_16px_-12px_rgb(0_0_0/0.25)] backdrop-blur',
        'sm:mx-auto sm:w-full sm:max-w-4xl sm:rounded-t-lg sm:border-x sm:px-6 print:hidden',
        className,
      )}
    >
      <label className="flex cursor-pointer items-start gap-3 rounded-md p-1 text-sm has-checked:text-foreground">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>{t.consent}</span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button size="lg" className="w-full sm:w-fit" disabled={!checked || busy} onClick={onConfirm}>
        {busy ? '…' : t.confirm}
      </Button>
    </section>
  )
}

/**
 * After the employee confirmed: a clear end state with when it was recorded,
 * what to do now (close the page, or hand the device back), and the caller's
 * actions below.
 */
export function Confirmed({
  record,
  lang,
  next,
  timeZone,
  children,
}: {
  record: OrderRecord
  lang: ConfirmLang
  /** What the employee does now: close the page, or hand the device back. */
  next: string
  timeZone?: string | undefined
  children?: ReactNode
}) {
  const t = confirmText[lang]
  const r = record.receipt
  const at = record.confirmation?.confirmed_at ?? record.given_at
  return (
    <section lang={lang} className="flex flex-col items-center gap-4 py-10 text-center sm:py-16">
      <CheckCircle2 aria-hidden className="size-16 text-primary" />
      <h2 className="text-2xl font-semibold">{t.confirmed}</h2>
      <p className="max-w-md text-muted-foreground">
        {at ? t.thanks(r.employee_first_name, r.record_number, formatDay(at, lang, timeZone), formatTime(at, timeZone)) : null} {next}
      </p>
      {children}
    </section>
  )
}
