import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Panel } from '@ppe/ui/components/panel'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { t } from '@/i18n'
import { type Need, barPercent, monthLabel, niceCeiling, sortNeeds } from '@/lib/dashboard'
import type { Route } from '@/lib/router'

/*
 * Building blocks shared by the dashboards. Charts are plain elements drawn for the eye (aria-hidden); each
 * carries its figures as text or a visually hidden table for screen readers.
 */

/** A date without the time, in the organisation's timezone. */
export const formatDate = (iso: string, tz: string) => formatDateTime(iso, tz).slice(0, 10)

export const inlineLink = 'rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Scrolls to the first element matching selector (a row in Needs you, a
 * panel), flashes it so the eye finds it, and moves focus to its first button
 * or link, so a keyboard user lands on the action.
 */
export function jumpTo(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' })
  el.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true })
  el.dataset['flash'] = ''
  setTimeout(() => delete el.dataset['flash'], 1600)
}

export interface Series {
  label: string
  /** The bar's colour class; neutral foreground tints follow the theme. */
  className: string
  values: number[]
}

/**
 * Bars per month, one per series side by side. The same figures go into a
 * visually hidden table whose cells are cell(series, month index).
 */
export function MonthChart({
  months,
  series,
  format,
  caption,
  cell,
}: {
  months: string[]
  series: Series[]
  format: (n: number) => string
  caption: string
  cell: (s: Series, i: number) => string
}) {
  const scale = niceCeiling(Math.max(0, ...series.flatMap((s) => s.values)))
  return (
    <>
      <div aria-hidden className="flex items-center gap-4 pb-3 text-xs text-muted-foreground">
        {series.length > 1
          ? series.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className={cn('size-2.5 rounded-sm', s.className)} /> {s.label}
              </span>
            ))
          : null}
        <span className="ml-auto tabular-nums">{t.dashboard.scale(format(scale))}</span>
      </div>
      <div aria-hidden className="relative h-44 border-b border-border md:h-52">
        {[25, 50, 75, 100].map((p) => (
          <div key={p} className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ bottom: `${p}%` }} />
        ))}
        <div className="relative flex h-full items-end gap-0.5 sm:gap-1.5">
          {months.map((m, i) => (
            <div
              key={m}
              title={`${monthLabel(m, true)}: ${series.map((s) => `${s.label.toLowerCase()} ${format(s.values[i] ?? 0)}`).join(', ')}`}
              className="flex h-full min-w-0 flex-1 items-end justify-center gap-px sm:gap-0.5"
            >
              {series.map((s) => (
                <div
                  key={s.label}
                  className={cn('w-full rounded-t-sm', series.length > 1 ? 'max-w-4' : 'max-w-8', s.className)}
                  style={{ height: `${barPercent(s.values[i] ?? 0, scale)}%` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className="flex gap-0.5 pt-1.5 text-center text-[0.625rem] text-muted-foreground sm:gap-1.5 sm:text-xs">
        {months.map((m, i) => (
          // Every month on wider screens; every other one on a phone, where twelve labels collide.
          <span key={m} className={cn('min-w-0 flex-1 truncate', i % 2 === 1 && months.length > 8 && 'max-sm:invisible')}>
            {monthLabel(m)}
          </span>
        ))}
      </div>
      {/* In a div: a table will not shrink to sr-only's 1px, and would widen a phone's page. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t.dashboard.month}</th>
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m}>
                <th scope="row">{monthLabel(m, true)}</th>
                {series.map((s) => (
                  <td key={s.label}>{cell(s, i)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** A ranked list with a bar under each entry, scaled to the largest value. */
export function BarList({ items }: { items: { key: string; label: string; value: number; text: string }[] }) {
  const scale = Math.max(1, ...items.map((i) => i.value))
  return (
    <ol className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{i.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{i.text}</span>
          </div>
          <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-foreground/70" style={{ width: `${barPercent(i.value, scale)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

/**
 * What to do next, the most urgent first, each with the one action that does
 * it: send a confirmation link, reorder a replacement, fill in a size. It
 * turns a dashboard's lists into a to-do list; the figures come below it.
 */
export function NeedsYouPanel({
  needs,
  navigate,
  empty,
  footer,
  className,
}: {
  needs: Need[]
  navigate: (to: Route) => void
  /** Shown when nothing needs doing. */
  empty: string
  footer?: ReactNode
  className?: string
}) {
  const sorted = sortNeeds(needs)
  return (
    <Panel
      title={sorted.length > 0 ? t.dashboard.needsYouCount(sorted.length) : t.dashboard.needsYou}
      description={t.dashboard.needsYouDescription}
      descriptionClassName="max-md:hidden"
      className={className}
    >
      {sorted.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-4" /> {empty}
        </p>
      ) : (
        <ul aria-label={t.dashboard.needsYou} className="divide-y divide-border">
          {sorted.map((n) => (
            <li
              key={n.key}
              data-need={n.key}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-700 data-flash:bg-accent"
            >
              <Badge variant={n.urgent ? 'destructive' : 'secondary'} className="w-18 shrink-0 justify-center tabular-nums">
                {n.tag}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{n.title}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{n.detail}</div>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => navigate(n.action.to)}>
                {n.action.label}
                <span className="sr-only"> {n.action.context}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {footer ? <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{footer}</div> : null}
    </Panel>
  )
}

/** A quiet link to the screen that holds the whole list. */
export function MoreLink({ label, to, navigate }: { label: string; to: Route; navigate: (to: Route) => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={() => navigate(to)}>
      {label} <ArrowRight aria-hidden />
    </Button>
  )
}
