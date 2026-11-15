import { type RowMark, type ScanCard, blocks, simScanText } from '@ppe/sim-scan'
import { message } from '@ppe/sim-scan/review-list'
import { Thumb } from '@ppe/scan-kit/thumb'
import { Button } from '@ppe/ui/components/button'
import { Input } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { cn } from '@ppe/ui/lib/utils'
import { Trash2 } from 'lucide-react'
import { useId } from 'react'

/**
 * A card from a phone's list (the camera's or the review's), in a sheet, as the
 * wireframe draws it: the card's two pictures on the title's line, SIM N with
 * the batch's provider, and no × (Done, Escape or a tap outside closes it);
 * then its SIM No. and, side by side, its PIN and PUK as fields with their
 * labels above, to check against the card in hand and correct a value read
 * wrong. What is wrong shows on the fields themselves, as it is typed: red for a
 * problem (a SIM No. already in SIM Cards or listed twice, a PIN or PUK of the
 * wrong length, one without the other), amber for the PIN and PUK of a card
 * without its back; no line of words, though a screen reader hears it with the
 * field. The bin (Remove SIM N) is beside Done.
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
  const problem = marks.find(blocks)
  const noBack = marks.some((m) => m.code === 'no_back')
  const said = problem
    ? problem.code === 'registered'
      ? t.sheetRegistered
      : message(problem)
    : card.unread
      ? t.problems.unread
      : noBack
        ? t.sheetNoBack
        : undefined
  const wrong = (field: RowMark['field']) => marks.some((m) => m.field === field && blocks(m))
  // A card without its back: its PIN and PUK are framed amber, a note rather than a problem.
  const missing = (field: RowMark['field']) => noBack && (field === 'pin' || field === 'puk')

  const field = (key: 'simNo' | 'pin' | 'puk', label: string, mark: RowMark['field']) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`${id}-${key}`} className="text-sm text-muted-foreground">
        {label}
      </label>
      <Input
        id={`${id}-${key}`}
        value={card[key]}
        invalid={wrong(mark)}
        aria-describedby={said && (wrong(mark) || missing(mark)) ? `${id}-said` : undefined}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        className={cn('h-12 font-mono text-base tracking-tight', !wrong(mark) && missing(mark) && 'border-warning focus-visible:ring-warning')}
        onChange={(e) => onChange({ [key]: e.target.value })}
      />
    </div>
  )

  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.currentCard(n)}
      closeButton={false}
      rules={false}
      lead={
        <div className="flex shrink-0 gap-1.5">
          <Thumb src={card.front ? pictures.get(card.front) : undefined} alt={t.front} className="h-11 w-16" />
          <Thumb src={card.back ? pictures.get(card.back) : undefined} alt={t.back} className="h-11 w-16" />
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
      <div className="flex flex-col gap-4">
        {said ? (
          <span id={`${id}-said`} className="sr-only">
            {said}
          </span>
        ) : null}
        {field('simNo', t.simNo, 'sim_no')}
        <div className="grid grid-cols-2 gap-3">
          {field('pin', t.pin, 'pin')}
          {field('puk', t.puk, 'puk')}
        </div>
      </div>
    </FormSheet>
  )
}
