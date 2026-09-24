import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'

import { cn } from '@/lib/utils'

/*
 * Text is 16px (`text-base`) on every control, not for legibility but because
 * iOS Safari zooms the page when a focused input is smaller and never zooms
 * back. `md:text-sm` restores the denser desktop size where no such zoom exists.
 */
const CONTROL = cn(
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm',
  'placeholder:text-muted-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

/*
 * `Field` and `Input` are hand-written here, and deliberately not the registry's.
 *
 * The registry ships its own `Field`; this one predates it and differs in shape —
 * a render prop, so the wiring of `id`, `aria-describedby`, and `aria-invalid`
 * cannot be forgotten at a call site the way it can when they are separate
 * components. Registry examples that use `<Field>` therefore will NOT paste in
 * unchanged; adapt them to the render prop rather than adding a second Field.
 *
 * `Input` lives here rather than in its own `input.tsx` for the same reason: one
 * `Input` per app, so there is never a question of which is the live one.
 */
interface FieldProps {
  label: string
  /** Rendered under the control and announced with it. */
  error?: string | undefined
  hint?: string | undefined
  required?: boolean
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/** A labelled control with its error and hint wired up for screen readers. */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>

      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}

      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Input({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(CONTROL, invalid && 'border-destructive focus-visible:ring-destructive', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

export function Select({
  className,
  invalid,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      // A native select, deliberately: it gets the platform's own picker, which
      // is reachable one-handed on a phone and needs no popover of our own.
      className={cn(CONTROL, invalid && 'border-destructive focus-visible:ring-destructive', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

/**
 * A multiline control, for free text that runs past one line.
 *
 * Shares `CONTROL` with `Input` so border, focus ring, disabled state, and the
 * 16px iOS-zoom floor stay identical — a textarea that styled itself separately
 * would drift the moment either was touched.
 *
 * Two deliberate departures from `CONTROL`:
 *
 * - **`h-auto` replaces its fixed `h-11`.** A textarea sized to one line is an
 *   `Input` with extra steps; `rows` decides the height instead, and the 44px
 *   floor is cleared several times over at the default 4.
 * - **`resize-y`**, not the browser default `resize: both`. Vertical growth is
 *   what long text needs; horizontal dragging breaks the form's column and, on
 *   a phone, can push the page into a horizontal scroll the contract forbids.
 */
export function Textarea({
  className,
  invalid,
  rows = 4,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      rows={rows}
      className={cn(
        CONTROL,
        'h-auto min-h-24 resize-y py-2 leading-relaxed',
        invalid && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

/** Spread a Field's render-prop wiring onto an Input, Select or Textarea. */
export function controlProps(p: { id: string; describedBy: string | undefined; invalid: boolean }) {
  return { id: p.id, 'aria-describedby': p.describedBy, invalid: p.invalid }
}
