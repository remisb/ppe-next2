import { Button } from '@ppe/ui/components/button'
import { DateInput } from '@ppe/ui/components/date-input'
import { Popover, PopoverContent } from '@ppe/ui/components/popover'
import { formatDay } from '@ppe/ui/lib/dates'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import { DATE_PERIODS, type DatePeriod, periodRange } from '@/lib/history'

/** The Date filter's choice: a period, or Custom range with its From and To (YYYY-MM-DD or ''). */
export interface PeriodChoice {
  period: DatePeriod
  from: string
  to: string
}

/** What the list offers: the periods, the range applied ('range') and Custom range… ('custom'). */
type Option = DatePeriod | 'range'

interface Draft {
  from: string
  to: string
  /** A From or To left with something that is not a date (DateInput's problem). */
  notFrom?: string | undefined
  notTo?: string | undefined
}

/** The field's look, as a select's (`CONTROL` in @ppe/ui's field). */
const control =
  'flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm'

/**
 * Orders' Date filter: one control in the select's look. It opens over
 * itself, as wide and in its place, its head the field's own row: first the
 * list of periods, then, on Custom range…, From above To in the same panel,
 * starting from the days shown. Apply makes them the filter, and the range
 * applied joins the list as the choice ("2026-09-01 – 2026-09-30"), before
 * Custom range…, which opens it again to change it. The head row, Cancel,
 * Escape or a click outside close it, leaving the filter as it was. A
 * select-only combobox: arrows, Home and End move through the list, Enter or
 * Space chooses.
 */
export function PeriodFilter({
  id,
  value,
  today,
  onChange,
  className,
}: {
  id: string
  value: PeriodChoice
  /** YYYY-MM-DD in the organisation timezone, which the periods count from. */
  today: string
  onChange: (next: PeriodChoice) => void
  className?: string | undefined
}) {
  const field = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'range'>('list')
  const [draft, setDraftState] = useState<Draft>({ from: '', to: '' })
  // Read by Apply: Enter in a field passes its date on and submits in the same keypress, before a render.
  const latest = useRef(draft)
  const setDraft = (update: (d: Draft) => Draft) => {
    latest.current = update(latest.current)
    setDraftState(latest.current)
  }

  const custom = value.period === 'custom'
  const rangeLabel =
    value.from && value.to
      ? `${formatDay(value.from)} – ${formatDay(value.to)}`
      : value.from
        ? t.history.rangeFrom(formatDay(value.from))
        : t.history.rangeTo(formatDay(value.to))
  const options: { value: Option; label: string }[] = [
    ...DATE_PERIODS.filter((p) => p !== 'custom').map((p) => ({ value: p, label: t.history.periods[p] })),
    ...(custom ? [{ value: 'range' as const, label: rangeLabel }] : []),
    { value: 'custom', label: t.history.periods.custom },
  ]
  const current: Option = custom ? 'range' : value.period
  const currentLabel = options.find((o) => o.value === current)?.label ?? ''
  const labelId = `${id}-label`
  const optionId = (o: Option) => `${id}-option-${o}`

  const openList = () => {
    setView('list')
    setOpen(true)
  }

  const openRange = () => {
    // Starts from the days shown: the range applied, or the period chosen.
    const shown = custom ? value : periodRange(value.period, today)
    latest.current = { from: shown?.from ?? '', to: shown?.to ?? '' }
    setDraftState(latest.current)
    setView('range')
  }

  // From takes the focus once the range is in the panel (the option that had it is gone).
  useEffect(() => {
    if (open && view === 'range') document.getElementById(`${id}-from`)?.focus()
  }, [open, view, id])

  const choose = (o: Option) => {
    if (o === 'custom') return openRange()
    if (o !== 'range') onChange({ period: o, from: '', to: '' })
    setOpen(false)
  }

  const problem = (d: Draft) => d.notFrom ?? d.notTo ?? (d.from && d.to && d.from > d.to ? t.history.fromAfterTo : undefined)
  const shownProblem = problem(draft)

  const apply = (e: FormEvent) => {
    e.preventDefault()
    const d = latest.current
    if (problem(d)) return
    // A range with neither day is no filter at all.
    onChange(d.from || d.to ? { period: 'custom', from: d.from, to: d.to } : { period: 'all', from: '', to: '' })
    setOpen(false)
  }

  // Through the list: the arrows one by one, Home and End to the ends.
  const moveInList = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=option]')]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = ({ ArrowDown: Math.min(at + 1, items.length - 1), ArrowUp: Math.max(at - 1, 0), Home: 0, End: items.length - 1 } as Record<string, number>)[e.key]
    if (next === undefined) return
    e.preventDefault()
    items[next]?.focus()
  }

  return (
    <div className={className}>
      {/* Without a visible heading: its choice ("All dates") says what it is. Still its name. */}
      <label id={labelId} htmlFor={id} className="sr-only">
        {t.history.period}
      </label>
      <button
        ref={field}
        id={id}
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={openList}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            openList()
          }
        }}
        className={control}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
      </button>
      <Popover open={open} onOpenChange={(next) => !next && setOpen(false)}>
        {/* The field opened: exactly over it, as wide, never flipped above it, its head the field's own row. */}
        <PopoverContent
          anchor={field}
          align="start"
          sideOffset={({ anchor }) => -anchor.height}
          collisionAvoidance={{ side: 'none', align: 'none' }}
          initialFocus={() => document.getElementById(optionId(current))}
          finalFocus={field}
          aria-label={view === 'range' ? t.history.customRange : t.history.period}
          className="w-(--anchor-width) gap-0 rounded-md border border-input p-0 shadow-lg ring-0 data-closed:animate-none data-open:animate-none"
        >
          {/* The field's row, its choice and its arrow turned up; choosing it closes, as a select's list would. */}
          <button
            type="button"
            aria-expanded
            onClick={() => setOpen(false)}
            className="flex h-11 w-full shrink-0 cursor-pointer items-center justify-between gap-2 rounded-t-md border-b border-border px-3 text-left text-base outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:text-sm"
          >
            <span className="truncate">{view === 'range' ? t.history.periods.custom : currentLabel}</span>
            <ChevronUp aria-hidden className="size-4 shrink-0 opacity-60" />
          </button>
          {view === 'list' ? (
            <div role="listbox" aria-labelledby={labelId} onKeyDown={moveInList} className="flex flex-col p-1">
              {options.map((o) => (
                <button
                  key={o.value}
                  id={optionId(o.value)}
                  type="button"
                  role="option"
                  aria-selected={o.value === current}
                  tabIndex={o.value === current ? 0 : -1}
                  onClick={() => choose(o.value)}
                  className="relative flex min-h-9 w-full cursor-pointer items-center rounded-md py-1.5 pr-2 pl-8 text-left text-base outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground pointer-coarse:min-h-11 md:text-sm"
                >
                  {o.value === current ? <Check aria-hidden className="absolute left-2 size-4" /> : null}
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={apply} noValidate className="flex flex-col gap-3 p-3">
              {/* From above To, one column. */}
              <div className="grid gap-3">
                <div>
                  <label htmlFor={`${id}-from`} className="text-sm font-medium">
                    {t.history.from}
                  </label>
                  <DateInput
                    id={`${id}-from`}
                    aria-describedby={shownProblem ? `${id}-problem` : undefined}
                    className="mt-1.5"
                    value={draft.from}
                    max={draft.to || undefined}
                    invalid={Boolean(draft.notFrom) || shownProblem === t.history.fromAfterTo}
                    onChange={(v, p) => setDraft((d) => ({ ...d, from: v, notFrom: p }))}
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-to`} className="text-sm font-medium">
                    {t.history.to}
                  </label>
                  <DateInput
                    id={`${id}-to`}
                    aria-describedby={shownProblem ? `${id}-problem` : undefined}
                    className="mt-1.5"
                    value={draft.to}
                    min={draft.from || undefined}
                    invalid={Boolean(draft.notTo) || shownProblem === t.history.fromAfterTo}
                    onChange={(v, p) => setDraft((d) => ({ ...d, to: v, notTo: p }))}
                  />
                </div>
              </div>
              {shownProblem ? (
                <p id={`${id}-problem`} role="alert" className="text-sm text-destructive">
                  {shownProblem}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t.common.cancel}
                </Button>
                <Button type="submit" disabled={shownProblem !== undefined}>
                  {t.history.apply}
                </Button>
              </div>
            </form>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
