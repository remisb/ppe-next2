import { type RowMark, type ScanCard, blocks, simScanText } from '@ppe/sim-scan'
import { CardFields, message } from '@ppe/sim-scan/review-list'
import { Thumb } from '@ppe/scan-kit/thumb'
import { Button } from '@ppe/ui/components/button'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { Trash2 } from 'lucide-react'

/**
 * A card from the phone camera's list, in a sheet: its two pictures and its
 * SIM No., PIN and PUK as fields, to check against the card in hand and
 * correct a value read wrong (the list's marks follow as it is typed), with
 * its notes, the way to a card already in SIM Cards, Remove and Done.
 */
export function CardSheet({
  n,
  card,
  marks,
  pictures,
  existingHref,
  onChange,
  onRemove,
  onClose,
}: {
  n: number
  card: ScanCard
  marks: readonly RowMark[]
  pictures: ReadonlyMap<string, string>
  existingHref: (id: string) => string
  onChange: (patch: Partial<Pick<ScanCard, 'simNo' | 'pin' | 'puk'>>) => void
  onRemove: () => void
  onClose: () => void
}) {
  const t = simScanText()
  const notes = marks.filter((m) => !blocks(m))
  const existing = marks.find((m) => m.code === 'registered' && m.existingId)?.existingId
  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.currentCard(n)}
      description={t.cardSheetHint}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="text-destructive" onClick={onRemove}>
            <Trash2 aria-hidden className="size-4" />
            {t.removeCard}
          </Button>
          <Button className="flex-1" onClick={onClose}>
            {t.doneCard}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <CardFields
          card={card}
          editing
          marks={marks}
          front={<Thumb src={card.front ? pictures.get(card.front) : undefined} alt={t.front} />}
          back={<Thumb src={card.back ? pictures.get(card.back) : undefined} alt={t.back} />}
          onChange={onChange}
        />
        {existing ? (
          <a href={existingHref(existing)} className="text-sm underline underline-offset-4">
            {t.openExisting}
          </a>
        ) : null}
        {card.unread || notes.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {card.unread ? <li className="text-warning">{t.problems.unread}</li> : null}
            {notes.map((m) => (
              <li key={m.code}>{message(m)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </FormSheet>
  )
}
