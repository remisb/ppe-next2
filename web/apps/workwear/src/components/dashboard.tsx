import type { Dashboard } from '@ppe/api-client'
import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'

import { EmptyState } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { barPercent, monthLabel, niceCeiling } from '@/lib/dashboard'
import { formatDateTime } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { cn, formatSize } from '@/lib/utils'

/*
 * Building blocks shared by the dashboards. Charts are plain elements drawn for the eye (aria-hidden); each
 * carries its figures as text or a visually hidden table for screen readers.
 */

/** A date without the time, in the organisation's timezone. */
export const formatDate = (iso: string, tz: string) => formatDateTime(iso, tz).slice(0, 10)

export const inlineLink = 'rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/** A dashboard section: a card whose title is a level-2 heading. */
export function Panel({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: ReactNode
  className?: string | undefined
  children: ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** The row of headline figures. */
export function KeyFigures({ children }: { children: ReactNode }) {
  return (
    <ul aria-label="Key figures" className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:gap-4 lg:grid-cols-4">
      {children}
    </ul>
  )
}

export function Kpi({ label, value, detail, change, alert = false }: { label: string; value: string; detail: string; change?: string; alert?: boolean }) {
  return (
    <li>
      <Card size="sm" className="h-full">
        <CardContent className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {label}
            {alert ? <AlertTriangle aria-label="Needs attention" className="size-3.5 text-destructive" /> : null}
          </span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
          <span className="text-xs text-muted-foreground">
            {detail}
            {change ? <span className="block">{change}</span> : null}
          </span>
        </CardContent>
      </Card>
    </li>
  )
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
        <span className="ml-auto tabular-nums">Scale {format(scale)}</span>
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
              <th scope="col">Month</th>
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
 * Items due for replacement, soonest first, with the employee and the receipt
 * they were given on. Shared by the administrator's and the employee role's dashboards.
 */
export function ReplacementsPanel({
  replacements: r,
  timezone,
  navigate,
}: {
  replacements: Dashboard['replacements']
  timezone: string
  navigate: (to: Route) => void
}) {
  const more = r.overdue + r.due_soon - r.next.length
  return (
    <Panel
      title="Replacements due"
      description={`Items whose service period has ended or ends within ${r.due_soon_days} days, counted from the date given and not already on an open order.`}
    >
      {r.next.length === 0 ? (
        <EmptyState>Nothing is due for replacement.</EmptyState>
      ) : (
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Receipt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.next.map((x) => (
              <TableRow key={`${x.employee_id}-${x.catalogue_item_id}`}>
                <TableCell className="stacked:mb-1">
                  <a {...linkTo({ name: 'employee', id: x.employee_id }, navigate)} className={inlineLink}>
                    {x.employee_name}
                  </a>
                  {x.employee_code ? <span className="block text-xs text-muted-foreground">{x.employee_code}</span> : null}
                </TableCell>
                <TableCell label="Item" className="whitespace-normal">
                  {x.item_name}
                  {x.size ? <span className="text-muted-foreground"> · {formatSize(x.size)}</span> : null}
                </TableCell>
                <TableCell label="Due" className="tabular-nums">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {formatDate(x.due_at, timezone)}
                    <Badge variant={x.overdue ? 'destructive' : 'secondary'}>{x.overdue ? 'Overdue' : 'Due soon'}</Badge>
                  </span>
                </TableCell>
                <TableCell label="Receipt">
                  <a {...linkTo({ name: 'record', id: x.order_id }, navigate)} aria-label={`Receipt ${x.record_number}`} className={inlineLink}>
                    {x.record_number}
                  </a>
                  <span className="block text-xs text-muted-foreground">given {formatDate(x.given_at, timezone)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {more > 0 ? <p className="mt-3 text-xs text-muted-foreground">And {more} more, due later.</p> : null}
    </Panel>
  )
}
