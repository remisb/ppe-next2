/**
 * Scan SIMs' review list: one row per card, each field editable, with its
 * pictures and marks (sim-scan.ts rowMarks). A problem stops Add; a note (no
 * back, no front) does not. The PIN and PUK are shown here as read, since
 * checking them is the point of the list; they live only in the screen's
 * memory. A card reads as it was photographed: the SIM No. on one line with
 * the front's picture, the PIN and PUK on the next with the back's
 * (CardFields, which the card being scanned uses too), as plain text. A card
 * in the list is not edited: a wrong one is removed and scanned again.
 */
import { Input } from '@ppe/ui/components/field'
import { Button } from '@ppe/ui/components/button'
import { cn } from '@ppe/ui/lib/utils'
import { CircleAlert, Info, Trash2 } from 'lucide-react'
import { type ReactNode, useId } from 'react'

import { type RowMark, type ScanCard, blocks } from './sim-scan.ts'
import { simScanText } from './text.ts'

export interface ReviewListProps {
  cards: readonly ScanCard[]
  marks: readonly RowMark[][]
  /** Each picture's thumbnail (a blob: URL), by its id. */
  pictures: ReadonlyMap<string, string>
  onRemove: (index: number) => void
  /** The address of a SIM card in the register, for "Already in SIM Cards". */
  existingHref: (id: string) => string
}

export function ReviewList({ cards, marks, pictures, onRemove, existingHref }: ReviewListProps) {
  const t = simScanText()
  return (
    <ol className="flex flex-col divide-y divide-border border-y border-border" aria-label={t.cards(cards.length)}>
      {cards.map((c, i) => {
        const row = marks[i] ?? []
        const notes = row.filter((m) => !blocks(m))
        const n = i + 1
        return (
          <li key={c.key} className="flex flex-col gap-2 py-3" data-testid="scan-row">
            <div className="-my-2 flex items-center">
              <span className="mr-auto text-sm font-medium text-muted-foreground">{t.currentCard(n)}</span>
              <Button type="button" variant="ghost" size="icon" aria-label={t.remove(n)} title={t.remove(n)} onClick={() => onRemove(i)}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
            <CardFields
              card={c}
              editing={false}
              marks={row}
              front={<Thumb src={c.front ? pictures.get(c.front) : undefined} alt={t.front} className="h-9" />}
              back={<Thumb src={c.back ? pictures.get(c.back) : undefined} alt={t.back} className="h-9" />}
              onChange={() => {}}
            />
            {row
              .filter((m) => m.code === 'registered' && m.existingId)
              .map((m) => (
                <a key="existing" href={existingHref(m.existingId!)} className="text-sm underline underline-offset-4">
                  {t.openExisting}
                </a>
              ))}
            {c.unread || notes.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {c.unread ? <Note icon="alert">{t.problems.unread}</Note> : null}
                {notes.map((m) => (
                  <Note key={m.code} icon="info">
                    {message(m)}
                  </Note>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export interface CardFieldsProps {
  card: Pick<ScanCard, 'simNo' | 'pin' | 'puk'>
  /** Fields to type in (the card being scanned, on Edit); else the values as plain text. */
  editing: boolean
  marks: readonly RowMark[]
  /** What leads each line: the side's picture, or the control that takes it. */
  front: ReactNode
  back: ReactNode
  onChange: (patch: Partial<Pick<ScanCard, 'simNo' | 'pin' | 'puk'>>) => void
  className?: string | undefined
}

/**
 * One card's three values as its two sides: the front's picture and the SIM
 * No. on one line; the back's picture, PIN and PUK on the next. Plain text,
 * to take little room, or fields while editing. Each line's problems are
 * under it.
 */
export function CardFields({ card, editing, marks, front, back, onChange, className }: CardFieldsProps) {
  const t = simScanText()
  const id = useId()
  const error = (field: RowMark['field']) => message(marks.find((m) => m.field === field && blocks(m)))
  const simError = error('sim_no')
  const codeErrors = [error('pin'), error('puk')].filter((e): e is string => e !== undefined)
  return (
    <div className={cn('grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-2 gap-y-2 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-x-3', className)}>
      {front}
      <div className="flex min-w-0 flex-col gap-1">
        <div className={cn('flex min-w-0 items-center gap-2', editing ? 'min-h-11' : 'min-h-9')}>
          <Value
            editing={editing}
            id={`${id}-sim`}
            label={t.simNo}
            value={card.simNo}
            error={simError}
            errorId={`${id}-sim-error`}
            onChange={(v) => onChange({ simNo: v })}
          />
        </div>
        <Problems id={`${id}-sim-error`} messages={simError ? [simError] : []} />
      </div>
      {back}
      <div className="flex min-w-0 flex-col gap-1">
        <div className={cn('flex min-w-0 items-center gap-2', editing ? 'min-h-11' : 'min-h-9')}>
          <Value
            editing={editing}
            id={`${id}-pin`}
            label={t.pin}
            value={card.pin}
            error={error('pin')}
            errorId={`${id}-codes-error`}
            className="basis-20"
            onChange={(v) => onChange({ pin: v })}
          />
          <Value
            editing={editing}
            id={`${id}-puk`}
            label={t.puk}
            value={card.puk}
            error={error('puk')}
            errorId={`${id}-codes-error`}
            className="basis-28"
            onChange={(v) => onChange({ puk: v })}
          />
        </div>
        <Problems id={`${id}-codes-error`} messages={codeErrors} />
      </div>
    </div>
  )
}

/** A value's label and the value: plain text, a dash when there is none, or its field while editing. */
function Value({
  editing,
  id,
  label,
  value,
  error,
  errorId,
  className,
  onChange,
}: {
  editing: boolean
  id: string
  label: string
  value: string
  error: string | undefined
  errorId: string
  className?: string
  onChange: (value: string) => void
}) {
  if (!editing) {
    return (
      <span className="flex min-w-0 items-baseline gap-2">
        <span id={`${id}-label`} className="shrink-0 text-sm text-muted-foreground">
          {label}
        </span>
        <span
          aria-labelledby={`${id}-label`}
          aria-describedby={error ? errorId : undefined}
          className={cn('min-w-0 font-mono tracking-tight break-all', error && 'text-destructive')}
          data-testid={id.endsWith('-sim') ? 'sim-no' : id.endsWith('-pin') ? 'pin' : 'puk'}
        >
          {value === '' ? '–' : value}
        </span>
      </span>
    )
  }
  return (
    <>
      <label htmlFor={id} className="shrink-0 text-sm font-medium">
        {label}
      </label>
      <CodeInput id={id} value={value} error={error} errorId={errorId} className={className} onChange={onChange} />
    </>
  )
}

function CodeInput({
  id,
  value,
  error,
  errorId,
  className,
  onChange,
}: {
  id: string
  value: string
  error: string | undefined
  errorId: string
  className?: string | undefined
  onChange: (value: string) => void
}) {
  return (
    <Input
      id={id}
      value={value}
      invalid={error !== undefined}
      aria-describedby={error ? errorId : undefined}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      className={cn('min-w-0 flex-1 px-2 font-mono tracking-tight', className)}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function Problems({ id, messages }: { id: string; messages: string[] }) {
  if (messages.length === 0) return null
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {messages.join(' ')}
    </p>
  )
}

/** A side's picture as a line's lead, or an empty frame where there is none. */
export function Thumb({ src, alt, className }: { src: string | undefined; alt: string; className?: string | undefined }) {
  return src ? (
    <img src={src} alt={alt} className={cn('h-11 w-full rounded border border-border object-cover', className)} />
  ) : (
    <span aria-hidden className={cn('h-11 w-full rounded border border-dashed border-border', className)} />
  )
}

/** What a mark says, in the language in use. */
export function message(m: RowMark | undefined): string | undefined {
  if (!m) return undefined
  const p = simScanText().problems
  if (m.code === 'duplicate') return p.duplicate((m.other ?? 0) + 1)
  return p[m.code]
}

function Note({ icon, children }: { icon: 'alert' | 'info'; children: React.ReactNode }) {
  const Icon = icon === 'alert' ? CircleAlert : Info
  return (
    <li className={cn('flex items-start gap-2 text-sm', icon === 'alert' ? 'text-warning' : 'text-muted-foreground')}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </li>
  )
}
