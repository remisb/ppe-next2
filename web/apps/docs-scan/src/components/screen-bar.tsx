import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import { type Route, linkTo, useRouter } from '@/lib/router'

/** A screen's bar: the way back (named), its title, and what sits at its end. */
export function ScreenBar({ back, title, end }: { back?: { to: Route; label: string }; title: string; end?: ReactNode }) {
  const { navigate } = useRouter()
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div>
        {back ? (
          <a {...linkTo(back.to, navigate)} className="inline-flex min-h-11 items-center gap-0.5 text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronLeft aria-hidden className="size-5" />
            {back.label}
          </a>
        ) : null}
      </div>
      <h1 className="truncate text-center text-base font-semibold">{title}</h1>
      <div className="flex justify-end">{end}</div>
    </div>
  )
}

/** A grouped list, as a phone's settings are. */
export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      {title ? <h2 className="px-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2> : null}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{children}</div>
      {footer ? <div className="px-4 text-xs leading-snug text-muted-foreground">{footer}</div> : null}
    </section>
  )
}

/** A source chip: where a value came from. */
export function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'plain' | 'info'; children: ReactNode }) {
  const tones = {
    ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
    plain: 'bg-muted text-muted-foreground',
    info: 'bg-primary/10 text-primary',
  }
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tones[tone]}`}>{children}</span>
}

/** A row of a group: a label over a value, and what sits at its end. */
export function Row({ label, children, end }: { label: string; children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="truncate">{children}</span>
      </div>
      {end}
    </div>
  )
}
