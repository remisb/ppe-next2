import { CalendarDays } from 'lucide-react'
import { type ComponentProps, useEffect, useRef, useState } from 'react'

import { formatDay, parseDay, typeDate } from '../lib/dates.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { Input } from './field.tsx'

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
 * (parseDay). A date is passed on as soon as it is a real one; left as
 * anything else it is refused, with the form to type. The button beside it
 * opens the browser's calendar.
 */
export function DateInput({ value, onChange, min, max, invalid, className, onBlur, onKeyDown, disabled, ...props }: DateInputProps) {
  const [text, setText] = useState(() => formatDay(value))
  const [bad, setBad] = useState(false)
  const sent = useRef(value)
  const picker = useRef<HTMLInputElement>(null)

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

  // Leaving the field, or Enter: a date is written in the language's form; anything else is refused.
  const commit = () => {
    if (text.trim() === '') return
    const day = parseDay(text)
    if (day) {
      setText(formatDay(day))
      if (day !== sent.current || bad) send(day)
      return
    }
    const today = new Date()
    const example = formatDay(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)
    send('', uiText().notADate(example))
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={uiText().datePattern}
        disabled={disabled}
        value={text}
        invalid={invalid || bad}
        className="pr-11 tabular-nums"
        onChange={(e) => {
          const next = typeDate(text, e.target.value)
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
      {/* The browser's calendar, opened by the button; never focused or read on its own. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          setText(formatDay(e.target.value))
          send(e.target.value)
        }}
        className="pointer-events-none absolute right-0 bottom-0 size-px opacity-0"
      />
      <button
        type="button"
        aria-label={uiText().pickDate}
        title={uiText().pickDate}
        disabled={disabled}
        onClick={() => {
          try {
            picker.current?.showPicker()
          } catch {
            // No calendar here (an old browser): the date is typed.
          }
        }}
        className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CalendarDays aria-hidden className="size-4" />
      </button>
    </div>
  )
}
