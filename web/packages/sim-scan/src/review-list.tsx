/**
 * Scan SIMs' review list: one row per card, each field editable, with its
 * pictures and marks (sim-scan.ts rowMarks). A problem stops Add; a note (no
 * back, no front) does not. The PIN and PUK are shown here as read, since
 * checking them is the point of the list; they live only in the screen's
 * memory.
 */
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { Button } from '@ppe/ui/components/button'
import { cn } from '@ppe/ui/lib/utils'
import { CircleAlert, Info, Trash2 } from 'lucide-react'

import { type RowMark, type ScanCard, blocks } from './sim-scan.ts'
import { simScanText } from './text.ts'

export interface ReviewListProps {
  cards: readonly ScanCard[]
  marks: readonly RowMark[][]
  /** Each picture's thumbnail (a blob: URL), by its id. */
  pictures: ReadonlyMap<string, string>
  onChange: (index: number, patch: Partial<Pick<ScanCard, 'simNo' | 'pin' | 'puk'>>) => void
  onRemove: (index: number) => void
  /** The address of a SIM card in the register, for "Already in SIM Cards". */
  existingHref: (id: string) => string
}

export function ReviewList({ cards, marks, pictures, onChange, onRemove, existingHref }: ReviewListProps) {
  const t = simScanText()
  return (
    <ol className="flex flex-col divide-y divide-border border-y border-border" aria-label={t.cards(cards.length)}>
      {cards.map((c, i) => {
        const row = marks[i] ?? []
        const on = (field: RowMark['field']) => row.filter((m) => m.field === field && blocks(m))
        const error = (field: RowMark['field']) => on(field)[0]
        const notes = row.filter((m) => !blocks(m))
        const n = i + 1
        return (
          <li key={c.key} className="flex flex-col gap-3 py-4" data-testid="scan-row">
            <div className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-sm font-medium text-muted-foreground tabular-nums">{n}</span>
              <div className="flex gap-2">
                {[c.front, c.back].map((id, side) =>
                  id && pictures.get(id) ? (
                    <img
                      key={side}
                      src={pictures.get(id)}
                      alt={side === 0 ? t.front : t.back}
                      className="h-14 w-20 rounded border border-border object-cover"
                    />
                  ) : null,
                )}
              </div>
              <Button type="button" variant="ghost" size="icon" className="ml-auto" aria-label={t.remove(n)} title={t.remove(n)} onClick={() => onRemove(i)}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Field label={t.simNo} error={message(error('sim_no'))}>
                {(p) => (
                  <Input
                    {...controlProps(p)}
                    value={c.simNo}
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    onChange={(e) => onChange(i, { simNo: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t.pin} error={message(error('pin'))}>
                {(p) => (
                  <Input
                    {...controlProps(p)}
                    value={c.pin}
                    inputMode="numeric"
                    autoComplete="off"
                    className="font-mono"
                    onChange={(e) => onChange(i, { pin: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t.puk} error={message(error('puk'))}>
                {(p) => (
                  <Input
                    {...controlProps(p)}
                    value={c.puk}
                    inputMode="numeric"
                    autoComplete="off"
                    className="font-mono"
                    onChange={(e) => onChange(i, { puk: e.target.value })}
                  />
                )}
              </Field>
            </div>
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
