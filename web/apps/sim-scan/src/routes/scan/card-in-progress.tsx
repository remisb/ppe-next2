import { MAX_CARDS, type ScanCard, cardComplete, rowMarks, simScanText, withPhoto } from '@ppe/sim-scan'
import { CardFields } from '@ppe/sim-scan/review-list'
import type { PictureStore } from '@ppe/scan-kit/pictures'
import { Thumb } from '@ppe/scan-kit/thumb'
import { Button } from '@ppe/ui/components/button'
import { ActionError } from '@ppe/ui/components/states'
import { Camera, CircleCheck, Loader2, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'

import { loadReaders } from '@/lib/readers'

import { newKey } from './scan-list'

/**
 * The card being scanned: a photo of each side, each read as it is taken, its
 * SIM No., PIN and PUK to check or type. Only once both photos are in and the
 * three fields are right does it go to the list, and the next card starts: at
 * once when the photos fill them, else with Next SIM.
 */
export function CardInProgress({
  list,
  pictures,
  onDone,
}: {
  list: readonly ScanCard[]
  /** Its photos are kept here as taken; the list's forgets them with the card. */
  pictures: PictureStore
  onDone: (card: ScanCard) => void
}) {
  const t = simScanText()
  const fresh = (): ScanCard => ({ key: newKey(), simNo: '', pin: '', puk: '' })
  const [card, setCard] = useState<ScanCard>(fresh)
  const [reading, setReading] = useState<'front' | 'back' | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [edit, setEdit] = useState(false)
  const inputs = { front: useRef<HTMLInputElement>(null), back: useRef<HTMLInputElement>(null) }
  const complete = cardComplete(card, list)
  // Plain text, unless Edit is on, or both photos are in and something is still to type.
  const editing = edit || (card.front !== undefined && card.back !== undefined && !complete)
  // A field still empty is not wrong yet: it waits for its photo.
  const filled = { sim_no: card.simNo, pin: card.pin, puk: card.puk }
  const marks = (rowMarks([...list, card])[list.length] ?? []).filter((m) => filled[m.field].trim() !== '' || m.code === 'codes_incomplete')

  const finish = (c: ScanCard) => {
    onDone(c)
    setDone(list.length + 1)
    setCard(fresh())
    setEdit(false)
  }

  const take = async (slot: 'front' | 'back', file: File | undefined) => {
    if (!file) return
    setReading(slot)
    setError(null)
    setDone(null)
    try {
      const readers = await loadReaders()
      const id = newKey()
      pictures.keep(id, file)
      const next = withPhoto(card, slot, await readers.readPhoto(id, file))
      if (cardComplete(next, list)) finish(next)
      else setCard(next)
    } catch (e) {
      setError(e)
    } finally {
      setReading(null)
    }
  }

  const slot = (side: 'front' | 'back') => {
    const id = side === 'front' ? card.front : card.back
    const label = side === 'front' ? t.frontPhoto : t.backPhoto
    return (
      <>
        <button
          type="button"
          title={label}
          aria-label={label}
          disabled={reading !== null}
          onClick={() => inputs[side].current?.click()}
          className="relative flex h-11 w-full cursor-pointer items-center justify-center overflow-hidden rounded border border-input bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-wait"
        >
          {reading === side ? (
            <Loader2 aria-hidden className="size-5 animate-spin" />
          ) : pictures.url(id) ? (
            <Thumb src={pictures.url(id)} alt={label} />
          ) : (
            <Camera aria-hidden className="size-5" />
          )}
        </button>
        <input
          ref={inputs[side]}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void take(side, e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </>
    )
  }

  return (
    // Not on a phone, which scans with the camera or chooses photos.
    <section aria-labelledby="current" className="mb-6 flex flex-col gap-3 rounded-lg border border-border p-4 max-md:hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="current" className="text-base font-semibold">
          {t.currentCard(list.length + 1)}
        </h2>
        {done !== null ? (
          <p role="status" className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck aria-hidden className="size-4" />
            {t.inList(done)}
          </p>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t.cardHint}</p>
      <CardFields
        card={card}
        editing={editing}
        marks={marks}
        front={slot('front')}
        back={slot('back')}
        onChange={(patch) => setCard((c) => ({ ...c, ...patch }))}
      />
      {reading ? (
        <p role="status" className="text-sm">
          {t.readingPhoto}
        </p>
      ) : null}
      <ActionError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => finish(card)} disabled={!complete || reading !== null || list.length >= MAX_CARDS}>
          {t.nextCard}
        </Button>
        {!editing ? (
          <Button variant="ghost" onClick={() => setEdit(true)}>
            <Pencil aria-hidden className="size-4" />
            {t.editCard}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
