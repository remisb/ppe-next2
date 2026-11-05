import type { AddedSim, Settings } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { staffHref } from '@ppe/routing'
import { type BatchSettings, MAX_CARDS, type PictureRead, batchRequest, blocks, pairPhotos, simKey, simScanText } from '@ppe/sim-scan'
import { cameraAvailable } from '@ppe/sim-scan/camera'
import { ReviewList } from '@ppe/sim-scan/review-list'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { ActionError, PageHeader } from '@ppe/ui/components/states'
import { isoDay } from '@ppe/ui/lib/dates'
import { Camera, CircleCheck, ImagePlus, Square } from 'lucide-react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { loadReaders } from '@/lib/readers'

import { BatchCard } from './batch-card'
import { CardInProgress } from './card-in-progress'
import { LiveScan } from './live-scan'
import { usePictureStore } from './picture-store'
import { emptyScanList, marksOf, newKey, scanList } from './scan-list'

/**
 * Scan SIMs: what the batch shares (from Settings), the cards read with the
 * camera or from photos, the review list, then Add, all or none. Pictures and
 * codes live in this screen's memory only, and go when it is left or the
 * batch is added (docs/specs/asset-service.md "Scan SIM cards"). The app
 * keeps it mounted, hidden, while PIN and PUK is open (active false), so a tab
 * switch keeps the list; the camera stops while it is hidden.
 *
 * The list is a reducer (scan-list.ts) and its pictures a PictureStore
 * (picture-store.ts); this file wires them to the readers, the API and the
 * screen's parts (batch-card, card-in-progress, live-scan).
 */
export function ScanPage({ active = true }: { active?: boolean }) {
  const { client } = useApi()
  const t = simScanText()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [batch, setBatch] = useState<BatchSettings>({ provider: '', plan: '', valueCents: null, receivedDate: '', comment: '' })
  const [list, dispatch] = useReducer(scanList, emptyScanList)
  const { cards } = list
  const pictures = usePictureStore()
  const [reading, setReading] = useState<{ done: number; all: number } | null>(null)
  const [camera, setCamera] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [added, setAdded] = useState<AddedSim[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Hidden behind PIN and PUK, the camera stops: nothing films a screen no one sees.
  useEffect(() => {
    if (!active) setCamera(false)
  }, [active])

  // What the batch shares, filled in from Settings: the default provider, its plan, the default value, today.
  useEffect(() => {
    let live = true
    void client.settings().then(
      (s) => {
        if (!live) return
        setSettings(s)
        const provider = s.default_sim_provider ?? s.sim_providers[0]?.name ?? ''
        setBatch((b) => ({
          ...b,
          provider,
          plan: s.sim_providers.find((p) => p.name === provider)?.default_plan ?? '',
          valueCents: s.default_sim_non_return_value_cents,
          receivedDate: isoDay(new Date(), s.timezone),
        }))
      },
      (e: unknown) => live && setError(e),
    )
    return () => {
      live = false
    }
  }, [client])

  // Pictures no card shows any more (removed, cleared, beyond the batch) are forgotten.
  useEffect(() => {
    if (list.released.length === 0) return
    pictures.forget(list.released)
    dispatch({ type: 'released', ids: list.released })
  }, [list.released, pictures])

  // Leaving with cards not yet added asks first.
  useEffect(() => {
    if (cards.length === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [cards.length])

  // The API's check, a moment after the list or the settings change: it alone knows the register.
  // An answer to an earlier list is dropped (live): the list it was for has changed since.
  const request = useMemo(() => batchRequest(batch, cards), [batch, cards])
  useEffect(() => {
    if (cards.length === 0 || request.provider === '') return dispatch({ type: 'unchecked' })
    let live = true
    const timer = setTimeout(() => {
      client.assets.checkSimCards(request).then(
        (problems) => live && dispatch({ type: 'checked', sent: request.cards, problems }),
        () => live && dispatch({ type: 'unchecked' }),
      )
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [client, request, cards.length])

  const marks = useMemo(() => marksOf(list), [list])
  const toFix = marks.filter((row) => row.some(blocks)).length

  const choosePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setAdded(null)
    // At most two photos a card, for the cards the batch still has room for.
    const room = MAX_CARDS - cards.length
    const chosen = [...files].slice(0, 2 * Math.max(0, room))
    if (chosen.length === 0) return dispatch({ type: 'too_many' })
    const reads: PictureRead[] = []
    setReading({ done: 0, all: chosen.length })
    let readers: Awaited<ReturnType<typeof loadReaders>>
    try {
      readers = await loadReaders()
    } catch (e) {
      setReading(null)
      return setError(e)
    }
    for (const file of chosen) {
      const id = newKey()
      pictures.keep(id, file)
      reads.push(await readers.readPhoto(id, file))
      setReading({ done: reads.length, all: chosen.length })
    }
    setReading(null)
    // A photo on which nothing was read is a row of its own, so the pairs may still be more than the room:
    // the list keeps what fits, and lets the rest's pictures go.
    dispatch({ type: 'add', cards: pairPhotos(reads), more: chosen.length < files.length })
  }

  const add = async () => {
    setAdding(true)
    setError(null)
    try {
      const sims = await client.assets.addSimCards(request)
      dispatch({ type: 'clear' })
      setAdded(sims)
    } catch (e) {
      setError(e)
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <PageHeader title={t.scanTitle} description={t.scanDescription} />

      {added ? (
        <section className="mb-6 flex flex-col gap-3 border-y border-border py-4" aria-live="polite">
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck aria-hidden className="size-5 text-success" />
            {t.added(added.length)}
          </p>
          <p className="font-mono text-sm">{added.map((s) => s.inventory_no).join(', ')}</p>
          <div className="flex flex-wrap gap-2">
            <a href={staffHref('/assets/sim-cards')} className={buttonVariants()}>
              {t.openSimCards}
            </a>
            <Button variant="outline" onClick={() => setAdded(null)}>
              {t.scanMore}
            </Button>
          </div>
        </section>
      ) : null}

      <BatchCard settings={settings} batch={batch} onSave={setBatch} missingProvider={batch.provider.trim() === '' && cards.length > 0} />

      {!camera ? (
        <CardInProgress
          list={cards}
          pictures={pictures}
          onDone={(card) => {
            setAdded(null)
            dispatch({ type: 'add', cards: [card] })
          }}
        />
      ) : null}

      <section className="mb-6 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground max-md:hidden">{t.otherWays}</p>
        <p className="text-sm text-muted-foreground md:hidden">{t.waysOnPhone}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={camera ? 'secondary' : 'outline'}
            onClick={() => {
              setAdded(null)
              setCamera((c) => !c)
            }}
            disabled={!cameraAvailable() || reading !== null}
          >
            {camera ? <Square aria-hidden className="size-4" /> : <Camera aria-hidden className="size-4" />}
            {camera ? t.stopCamera : t.camera}
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={reading !== null || camera}>
            <ImagePlus aria-hidden className="size-4" />
            {t.choosePhotos}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            aria-label={t.choosePhotos}
            onChange={(e) => {
              void choosePhotos(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        <p className="text-sm text-muted-foreground">{cameraAvailable() ? t.photosHint : t.cameraUnavailable}</p>
        {reading ? (
          <p role="status" className="text-sm">
            {t.readingPhotos(reading.done, reading.all)}
          </p>
        ) : null}
        {list.notice === 'too_many' ? (
          <p role="status" className="text-sm text-warning">
            {t.tooMany(MAX_CARDS)}
          </p>
        ) : null}
        {camera ? (
          <LiveScan
            known={cards.map((c) => simKey(c.simNo))}
            onCard={(card, frontBlob, backBlob) => {
              // Kept first, as every picture is; a full list takes no card and lets its pictures go.
              pictures.keep(card.front!, frontBlob)
              if (backBlob && card.back) pictures.keep(card.back, backBlob)
              dispatch({ type: 'add', cards: [card] })
            }}
            onClose={() => setCamera(false)}
          />
        ) : null}
      </section>

      <section aria-labelledby="cards" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="cards" className="text-base font-semibold">
            {t.cards(cards.length)}
          </h2>
          {cards.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'clear' })}>
              {t.removeAll}
            </Button>
          ) : null}
        </div>
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noCards}</p>
        ) : (
          <ReviewList
            cards={cards}
            marks={marks}
            pictures={pictures.urls}
            existingHref={(id) => staffHref(`/assets/sim-cards/${id}`)}
            onRemove={(index) => dispatch({ type: 'remove', index })}
          />
        )}
        <ActionError error={error} title={addErrorTitle(error)} />
        {cards.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void add()} disabled={adding || toFix > 0 || batch.provider.trim() === ''}>
              {adding ? t.adding : t.add(cards.length)}
            </Button>
            {toFix > 0 ? <p className="text-sm text-destructive">{t.fixFirst(toFix)}</p> : null}
          </div>
        ) : null}
      </section>
    </>
  )
}

/** A refused batch names its row, as the list does: "SIM 3: …". */
function addErrorTitle(error: unknown): string | undefined {
  return error instanceof ApiError && error.index !== undefined ? simScanText().currentCard(error.index + 1) : undefined
}
