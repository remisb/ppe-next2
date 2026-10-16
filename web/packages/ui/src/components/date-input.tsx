import { CalendarDays } from 'lucide-react'
import { type ComponentProps, Suspense, lazy, useEffect, useRef, useState } from 'react'

import { formatDay, parseDay, parseDayInYear, typeDate } from '../lib/dates.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { Input } from './field.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'

/** The calendar, loaded when one is first opened (or about to be: the button hovered or focused). */
const loadCalendar = () => import('./date-calendar.tsx')
const DateCalendar = lazy(loadCalendar)

/** A calendar day (YYYY-MM-DD) as the calendar's local midnight, or undefined. */
function dateOf(day: string | undefined): Date | undefined {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined
}

/** The calendar's day as YYYY-MM-DD. */
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** d, or the nearer limit when it is outside them: the month the calendar opens on. */
function within(d: Date, first: Date | undefined, last: Date | undefined): Date {
  if (first && d < first) return first
  if (last && d > last) return last
  return d
}

/** The current year, as a date field starts in it. */
const thisYear = () => String(new Date().getFullYear())

type DateInputProps = Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max'> & {
  /** The date, YYYY-MM-DD, or '' for none. */
  value: string
  /**
   * A real date as YYYY-MM-DD, or '' when the field is emptied or left with
   * something that is not a date; then problem says so, for the field's error.
   */
  onChange: (value: string, problem?: string) => void
  /** The calendar's limits, YYYY-MM-DD; typing past them is the caller's to refuse, with its own words. */
  min?: string | undefined
  max?: string | undefined
  invalid?: boolean
  /** On the field and its button together, e.g. a margin. */
  className?: string | undefined
}

/**
 * A date field in the one form every date takes in the language in use
 * (formatDay: 2026.10.15 in Lithuanian), whatever the browser's own date
 * field would show. It is typed, the separators coming by themselves, so a
 * phone needs only its number pad; a pasted date in another order is read too
 * (parseDay). Typed into an empty field, it starts in the current year, which
 * can be typed over (typeDate). A date is passed on as soon as it is a real one; left as
 * anything else it is refused, with the form to type. The button beside it
 * opens a calendar (Calendar in a Popover) in the language in use, the days
 * outside min and max not to be chosen, with month and year lists.
 */
export function DateInput({ value, onChange, min, max, invalid, className, onBlur, onKeyDown, disabled, ...props }: DateInputProps) {
  const [text, setText] = useState(() => formatDay(value))
  const [bad, setBad] = useState(false)
  const sent = useRef(value)
  const field = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const selected = dateOf(value)
  const first = dateOf(min)
  const last = dateOf(max)

  // Changed from outside (Clear filters, a reset form): show it.
  useEffect(() => {
    if (value === sent.current) return
    sent.current = value
    setText(formatDay(value))
    setBad(false)
  }, [value])

  const send = (next: string, problem?: string) => {
    sent.current = next
    setBad(problem !== undefined)
    onChange(next, problem)
  }

  // Leaving the field, or Enter: a date is written in the language's form, in this year when
  // typed without one; anything else is refused.
  const commit = () => {
    if (text.trim() === '') return
    const day = parseDay(text) ?? parseDayInYear(text, thisYear())
    if (day) {
      setText(formatDay(day))
      if (day !== sent.current || bad) send(day)
      return
    }
    const example = formatDay(isoOf(new Date()))
    send('', uiText().notADate(example))
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        {...props}
        ref={field}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={uiText().datePattern}
        disabled={disabled}
        value={text}
        invalid={invalid || bad}
        className="pr-11 tabular-nums"
        onChange={(e) => {
          const next = typeDate(text, e.target.value, thisYear())
          setText(next)
          if (next.trim() === '') send('')
          else {
            const day = parseDay(next)
            if (day && (day !== sent.current || bad)) send(day)
          }
        }}
        onBlur={(e) => {
          commit()
          onBlur?.(e)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          onKeyDown?.(e)
        }}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Inside a FormSheet's modal <dialog> the calendar opens in it, or it would be beneath it.
          if (next) setContainer(field.current?.closest('dialog') ?? null)
          setOpen(next)
        }}
      >
        <PopoverTrigger
          aria-label={uiText().pickDate}
          title={uiText().pickDate}
          disabled={disabled}
          onPointerEnter={() => void loadCalendar()}
          onFocus={() => void loadCalendar()}
          className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarDays aria-hidden className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          container={container ?? undefined}
          align="end"
          initialFocus={false}
          className="w-auto p-0"
          // Escape closes the calendar only: kept from a FormSheet's <dialog>, whose cancel would close the sheet too.
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.preventDefault()
          }}
        >
          <Suspense fallback={<div className="h-[19.5rem] w-[17rem] pointer-coarse:h-[24rem] pointer-coarse:w-[20.5rem]" />}>
            <DateCalendar
              selected={selected}
              month={selected ?? within(new Date(), first, last)}
              first={first}
              last={last}
              onSelect={(d) => {
                const day = isoOf(d)
                setText(formatDay(day))
                if (day !== sent.current || bad) send(day)
                setOpen(false)
              }}
            />
          </Suspense>
        </PopoverContent>
      </Popover>
    </div>
  )
}
