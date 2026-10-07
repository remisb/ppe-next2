import { barPercent, heatLevel, niceCeiling, sparkPoints } from '../lib/charts.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'

/*
 * Charts drawn for the eye (aria-hidden) with their figures beside them for
 * screen readers: a visually hidden table, or the caller's own words. Plain
 * elements and SVG, no chart library: the shapes are few and the bundle stays
 * small (proposal 4.3).
 */

export interface Series {
  label: string
  /** The bar's colour class; neutral foreground tints follow the theme. */
  className: string
  values: number[]
}

/** A column of a bar chart: its short label under the bars and its full name for the table. */
export interface Column {
  key: string
  short: string
  long: string
}

/**
 * Bars per column (a month, a day), one per series side by side. The same
 * figures go into a visually hidden table whose cells are cell(series,
 * column index); columnHead names its first column. With dense, the labels
 * thin out to every few columns.
 */
export function BarChart({
  columns,
  series,
  format,
  caption,
  cell,
  columnHead,
  dense = false,
}: {
  columns: Column[]
  series: Series[]
  format: (n: number) => string
  caption: string
  cell: (s: Series, i: number) => string
  columnHead: string
  dense?: boolean
}) {
  const scale = niceCeiling(Math.max(0, ...series.flatMap((s) => s.values)))
  const every = dense ? Math.max(1, Math.ceil(columns.length / 6)) : 1
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
        <span className="ml-auto tabular-nums">{uiText().scale(format(scale))}</span>
      </div>
      <div aria-hidden className="relative h-44 border-b border-border md:h-52">
        {[25, 50, 75, 100].map((p) => (
          <div key={p} className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ bottom: `${p}%` }} />
        ))}
        <div className={cn('relative flex h-full items-end', dense ? 'gap-px' : 'gap-0.5 sm:gap-1.5')}>
          {columns.map((c, i) => (
            <div
              key={c.key}
              title={`${c.long}: ${series.map((s) => `${s.label.toLowerCase()} ${format(s.values[i] ?? 0)}`).join(', ')}`}
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
      <div aria-hidden className={cn('flex pt-1.5 text-center text-[0.625rem] text-muted-foreground sm:text-xs', dense ? 'gap-px' : 'gap-0.5 sm:gap-1.5')}>
        {columns.map((c, i) => (
          // Every column on wider screens; every other one on a phone, where twelve labels collide.
          <span
            key={c.key}
            className={cn(
              'min-w-0 flex-1',
              dense ? 'overflow-visible whitespace-nowrap' : 'truncate',
              dense && i % every !== 0 && 'invisible',
              !dense && i % 2 === 1 && columns.length > 8 && 'max-sm:invisible',
            )}
          >
            {c.short}
          </span>
        ))}
      </div>
      {/* In a div: a table will not shrink to sr-only's 1px, and would widen a phone's page. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{columnHead}</th>
              {series.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((c, i) => (
              <tr key={c.key}>
                <th scope="row">{c.long}</th>
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

/**
 * A small line of values, oldest first, for a trend beside a figure. It is
 * drawn for the eye; label says in words what it shows.
 */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const width = 100
  const height = 24
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`-1 -1 ${width + 2} ${height + 2}`}
      preserveAspectRatio="none"
      className={cn('h-6 w-full overflow-visible text-primary', className)}
    >
      <polyline points={sparkPoints(values, width, height)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const heat = ['bg-muted', 'bg-primary/20', 'bg-primary/40', 'bg-primary/65', 'bg-primary/90']

/**
 * Rows of cells shaded by value against the largest (a week of changes per
 * area). The figures are in a visually hidden table.
 */
export function HeatStrip({
  rows,
  columns,
  caption,
  rowHead,
}: {
  rows: { key: string; label: string; values: number[] }[]
  columns: Column[]
  caption: string
  rowHead: string
}) {
  const max = Math.max(0, ...rows.flatMap((r) => r.values))
  return (
    <>
      <div aria-hidden className="grid gap-1 text-xs" style={{ gridTemplateColumns: `minmax(6rem, auto) repeat(${columns.length}, minmax(0, 1fr))` }}>
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <span className="truncate pr-2 text-muted-foreground">{r.label}</span>
            {columns.map((c, i) => (
              <span
                key={c.key}
                title={`${r.label}, ${c.long}: ${r.values[i] ?? 0}`}
                className={cn('h-5 rounded-sm', heat[heatLevel(r.values[i] ?? 0, max)])}
              />
            ))}
          </div>
        ))}
        <span />
        {columns.map((c, i) => (
          // Every label where there is room; every fourth on a phone, in full, over its hidden neighbours.
          <span key={c.key} className={cn('overflow-visible text-[0.625rem] whitespace-nowrap text-muted-foreground sm:truncate sm:text-center', i % 4 !== 0 && 'max-sm:invisible')}>
            {c.short}
          </span>
        ))}
      </div>
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{rowHead}</th>
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.long}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                {columns.map((c, i) => (
                  <td key={c.key}>{r.values[i] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
