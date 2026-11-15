import { type RowMark, type ScanCard, blocks, simScanText } from '@ppe/sim-scan'
import { message } from '@ppe/sim-scan/review-list'
import { Thumb } from '@ppe/scan-kit/thumb'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Input } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { HelpPopover } from '@ppe/ui/components/tooltip'
import { cn } from '@ppe/ui/lib/utils'
import { CircleAlert, Pencil, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { type Photo, PhotoViewer } from './photo-viewer'

type Key = 'simNo' | 'pin' | 'puk'

/**
 * A card from a phone's list (the camera's or the review's), in a sheet, as the
 * wireframe draws it: the card's two pictures on the title's line, SIM N with
 * the batch's provider, a pencil at the header's end, and no × (Done, Escape or
 * a tap outside closes it); then its SIM No. and, side by side, its PIN and PUK,
 * labels above, read only (no keyboard comes up) until the pencil turns them
 * into fields, to correct a value read wrong against the card in hand.
 *
 * What is wrong shows on the field itself, as it is typed: framed red for a
 * problem (a SIM No. already in SIM Cards or listed twice, a PIN or PUK of the
 * wrong length, one without the other), amber for the PIN and PUK of a card
 * without its back; an alert at the field's end opens a tooltip saying why
 * (HelpPopover: a tap, as well as pointing at it or focusing it), and a screen
 * reader hears it with the field. The bin (Remove SIM N) is beside Done. A
 * tap on either picture shows the photos enlarged (PhotoViewer).
 */
export function CardSheet({
  n,
  card,
  marks,
  pictures,
  provider,
  onChange,
  onRemove,
  onClose,
}: {
  n: number
  card: ScanCard
  marks: readonly RowMark[]
  pictures: ReadonlyMap<string, string>
  /** The batch's provider, under the sheet's title. */
  provider: string
  onChange: (patch: Partial<Pick<ScanCard, 'simNo' | 'pin' | 'puk'>>) => void
  onRemove: () => void
  onClose: () => void
}) {
  const t = simScanText()
  const id = useId()
  const noBack = marks.some((m) => m.code === 'no_back')
  const wrong = (field: RowMark['field']) => marks.some((m) => m.field === field && blocks(m))
  // A card without its back: its PIN and PUK are framed amber, a note rather than a problem.
  const missing = (field: RowMark['field']) => noBack && (field === 'pin' || field === 'puk')
  /** Why a field is framed, for its tooltip; undefined when it is not. */
  const why = (field: RowMark['field']): string | undefined => {
    const mark = marks.find((m) => m.field === field && blocks(m))
    if (mark) return mark.code === 'registered' ? t.sheetRegistered : message(mark)
    return missing(field) ? t.sheetNoBack : undefined
  }

  // The card's photos: a tap on one shows it enlarged (PhotoViewer), with the other side a tap away.
  const sides = [
    { label: t.front, src: card.front ? pictures.get(card.front) : undefined },
    { label: t.back, src: card.back ? pictures.get(card.back) : undefined },
  ]
  const photos: Photo[] = sides.filter((s): s is Photo => s.src !== undefined)
  const [viewing, setViewing] = useState<number | null>(null)

  // Read only until the pencil turns the values into fields: no field takes the focus, so no keyboard comes up.
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (editing) document.getElementById(`${id}-simNo`)?.focus()
  }, [editing, id])

  /** The alert at a framed field's end: its tooltip says why. */
  const tip = (key: Key, label: string, field: RowMark['field']) => {
    const text = why(field)
    if (!text) return null
    const bad = wrong(field)
    return (
      <>
        <span id={`${id}-${key}-why`} hidden>
          {text}
        </span>
        <HelpPopover
          help={{ body: text }}
          label={t.whyMarked(label)}
          describedBy={`${id}-${key}-why`}
          // The alert pops in as the problem appears.
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
            'shrink-0 rounded-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-200',
            bad ? 'text-destructive' : 'text-warning',
          )}
        >
          {bad ? <CircleAlert aria-hidden className="size-5" /> : <TriangleAlert aria-hidden className="size-5" />}
        </HelpPopover>
      </>
    )
  }

  const field = (key: Key, label: string, mark: RowMark['field']) => {
    const framed = why(mark) !== undefined
    const describedBy = framed ? `${id}-${key}-why` : undefined
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {editing ? (
          <label htmlFor={`${id}-${key}`} className="text-sm text-muted-foreground">
            {label}
          </label>
        ) : (
          <span id={`${id}-${key}-label`} className="text-sm text-muted-foreground">
            {label}
          </span>
        )}
        {editing ? (
          <div className="relative">
            <Input
              id={`${id}-${key}`}
              value={card[key]}
              invalid={wrong(mark)}
              aria-describedby={describedBy}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'h-12 font-mono text-base tracking-tight',
                framed && 'pr-11',
                !wrong(mark) && missing(mark) && 'border-warning focus-visible:ring-warning',
              )}
              onChange={(e) => onChange({ [key]: e.target.value })}
            />
            {framed ? <div className="absolute top-1/2 right-1 -translate-y-1/2">{tip(key, label, mark)}</div> : null}
          </div>
        ) : (
          <div
            className={cn(
              'flex h-12 min-w-0 items-center gap-1 rounded-md border bg-muted/50 pr-1 pl-3 transition-colors duration-300',
              !framed ? 'border-transparent' : cn('border-2', wrong(mark) ? 'border-destructive' : 'border-warning'),
            )}
          >
            <span
              aria-labelledby={`${id}-${key}-label`}
              aria-describedby={describedBy}
              data-testid={key === 'simNo' ? 'sim-no' : key}
              className={cn('min-w-0 flex-1 truncate font-mono text-base tracking-tight', card[key] === '' && 'text-muted-foreground')}
            >
              {card[key] === '' ? '–' : card[key]}
            </span>
            {tip(key, label, mark)}
          </div>
        )}
      </div>
    )
  }

  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.currentCard(n)}
      closeButton={false}
      rules={false}
      action={
        <Button
          type="button"
          variant={editing ? 'default' : 'outline'}
          size="icon"
          className="size-11 shrink-0 rounded-full"
          aria-pressed={editing}
          aria-label={t.editCardValues}
          title={t.editCardValues}
          onClick={() => setEditing((e) => !e)}
        >
          <Pencil aria-hidden className="size-4" />
        </Button>
      }
      lead={
        <div className="flex shrink-0 gap-1.5">
          {sides.map((side, i) =>
            side.src ? (
              <button
                key={side.label}
                type="button"
                aria-label={t.showPhoto(side.label)}
                title={t.showPhoto(side.label)}
                onClick={() => setViewing(photos.findIndex((p) => p.label === side.label))}
                className="h-11 w-16 shrink-0 rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Thumb src={side.src} alt="" className="h-11 w-16" />
              </button>
            ) : (
              <Thumb key={side.label ?? i} src={undefined} alt={side.label} className="h-11 w-16" />
            ),
          )}
        </div>
      }
      {...(provider ? { description: provider } : {})}
      footer={
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-12 shrink-0 border-destructive/30 text-destructive"
            aria-label={t.remove(n)}
            title={t.remove(n)}
            onClick={onRemove}
          >
            <Trash2 aria-hidden className="size-5" />
          </Button>
          <Button className="h-12 flex-1" onClick={onClose}>
            {t.doneCard}
          </Button>
        </div>
      }
    >
      {/* Read only or fields: the switch fades the values in, so the change is seen. */}
      <div key={editing ? 'edit' : 'view'} className="flex flex-col gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
        {field('simNo', t.simNo, 'sim_no')}
        <div className="grid grid-cols-2 gap-3">
          {field('pin', t.pin, 'pin')}
          {field('puk', t.puk, 'puk')}
        </div>
      </div>
      {viewing !== null ? <PhotoViewer photos={photos} start={viewing} onClose={() => setViewing(null)} /> : null}
    </FormSheet>
  )
}
