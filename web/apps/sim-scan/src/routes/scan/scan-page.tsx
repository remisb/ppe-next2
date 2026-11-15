import type { AddedSim, Settings } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { basePath, staffHref } from '@ppe/routing'
import { type BatchSettings, MAX_CARDS, type PictureRead, batchRequest, blocks, pairPhotos, simKey, simScanText } from '@ppe/sim-scan'
import { cameraAvailable } from '@ppe/scan-kit/camera'
import { usePictureStore } from '@ppe/scan-kit/pictures'
import { ReviewList } from '@ppe/sim-scan/review-list'
import { formatEuro } from '@ppe/i18n'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { ActionError, PageHeader } from '@ppe/ui/components/states'
import { cn } from '@ppe/ui/lib/utils'
import { formatDay, isoDay } from '@ppe/ui/lib/dates'
import { Camera, CircleCheck, ImagePlus, Loader2, Pencil, Square } from 'lucide-react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { usePhone } from '@/lib/phone'
import { loadReaders } from '@/lib/readers'

import { BatchCard } from './batch-card'
import { CardInProgress } from './card-in-progress'
import { CardSheet } from './card-sheet'
import { LiveScan } from './live-scan'
import { PhoneBatchSheet } from './phone-batch-sheet'
import { PhoneCamera } from './phone-camera'
import { PhoneReview } from './phone-review'
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
 * (@ppe/scan-kit/pictures); this file wires them to the readers, the API and the
 * screen's parts (batch-card, card-in-progress, live-scan, and on a phone
 * phone-camera: the camera full screen, as a camera app, its cards above it).
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
  // Each Try Again mounts the phone's camera anew.
  const [cameraKey, setCameraKey] = useState(0)
  // A phone's card sheet (the list's row opened) and For every SIM's sheet.
  const [openCard, setOpenCard] = useState<number | null>(null)
  const [batchSheet, setBatchSheet] = useState(false)
  // Set once the user agreed to leave, so the browser does not ask a second time.
  const leaving = useRef(false)
  const phone = usePhone()
  // A phone scans in PhoneCamera, full screen; from 768px the camera is inline (LiveScan).
  const phoneCamera = camera && phone
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [added, setAdded] = useState<AddedSim[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // A phone with a camera scans with it: Choose Photos is there only when the camera cannot be used.
  const photosOnPhone = !cameraAvailable()

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

  // Leaving with cards not yet added asks first: a link out of the app (SIM Cards, Apps, a card's Open) with the
  // app's own question, the browser's for the rest (closing the tab, typing an address).
  useEffect(() => {
    if (cards.length === 0) return
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault()
    }
    const ask = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!a || (a.target !== '' && a.target !== '_self') || a.hasAttribute('download')) return
      const to = new URL(a.href, window.location.href)
      if (to.origin === window.location.origin && (to.pathname === basePath || to.pathname.startsWith(`${basePath}/`))) return
      if (window.confirm(t.leaveQuestion(cards.length))) leaving.current = true
      else e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', ask, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', ask, true)
    }
  }, [cards.length, t])

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

  const n = cards.length
  // On a phone with SIMs in the list, the camera is Scan More, in the bar at the thumb.
  const phoneList = phone && n > 0
  const summary = [batch.provider, batch.plan, batch.valueCents === null ? '' : formatEuro(batch.valueCents), batch.receivedDate === '' ? '' : formatDay(batch.receivedDate)]
    .filter((x) => x !== '')
    .join(' · ')
  const openCamera = () => {
    setAdded(null)
    setCamera(true)
  }
  const clear = () => {
    if (window.confirm(t.clearQuestion(n))) dispatch({ type: 'clear' })
  }
  const addDisabled = adding || toFix > 0 || batch.provider.trim() === ''
  const refusal = <ActionError error={error} title={addErrorTitle(error)} />

  return (
    <>
      <PageHeader title={t.scanTitle} description={t.scanDescription} />

      {added ? (
        <section className="mb-6 flex flex-col gap-3 border-y border-border py-4" aria-live="polite">
          <p className="flex items-center gap-2 font-medium">
            <CircleCheck aria-hidden className="size-5 text-success" />
            {t.added(added.length)}
          </p>
          <p className="text-sm text-muted-foreground">{t.addedNote}</p>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border md:max-w-xl">
            {added.map((sim) => (
              <li key={sim.id}>
                <a href={staffHref(`/assets/sim-cards/${sim.id}`)} className="flex min-h-11 items-center gap-3 px-3 py-2 hover:bg-muted">
                  <span className="w-24 shrink-0 font-mono text-sm font-semibold">{sim.inventory_no}</span>
                  <span className="min-w-0 truncate font-mono text-sm text-muted-foreground">{sim.sim_no}</span>
                </a>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <a href={staffHref('/assets/sim-cards')} className={buttonVariants()}>
              {t.openSimCards}
            </a>
            <Button variant="outline" onClick={phone ? openCamera : () => setAdded(null)}>
              {t.scanMore}
            </Button>
          </div>
        </section>
      ) : null}

      {phone ? (
        <button
          type="button"
          aria-label={`${t.editBatch}: ${summary}`}
          onClick={() => setBatchSheet(true)}
          className="mb-5 flex min-h-12 w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-muted-foreground">{t.batch}</span>
            {batch.provider.trim() === '' ? <span className="text-sm text-destructive">{t.providerRequired}</span> : <span className="truncate text-sm">{summary}</span>}
          </span>
          <Pencil aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <BatchCard settings={settings} batch={batch} onSave={setBatch} />
      )}

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

      <section className={cn('flex flex-col gap-3', phoneList && !photosOnPhone && !reading && list.notice === null ? 'hidden' : 'mb-6')}>
        <p className="text-sm text-muted-foreground max-md:hidden">{t.otherWays}</p>
        <p className="text-sm text-muted-foreground md:hidden">{t.waysOnPhone}</p>
        <div className="flex flex-wrap gap-2">
          {phoneList ? null : (
            <Button
              variant={phone ? 'default' : camera ? 'secondary' : 'outline'}
              onClick={() => {
                setAdded(null)
                setCamera((c) => !c)
              }}
              disabled={!cameraAvailable() || reading !== null}
            >
              {camera && !phone ? <Square aria-hidden className="size-4" /> : <Camera aria-hidden className="size-4" />}
              {camera && !phone ? t.stopCamera : phone ? t.openCamera : t.camera}
            </Button>
          )}
          <Button
            variant="outline"
            className={photosOnPhone ? undefined : 'max-md:hidden'}
            onClick={() => fileInput.current?.click()}
            disabled={reading !== null || (camera && !phone)}
          >
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
        <p className={cn('text-sm text-muted-foreground', !photosOnPhone && 'max-md:hidden')}>{cameraAvailable() ? t.photosHint : t.cameraUnavailable}</p>
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
        {camera && !phone ? (
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
          <div className="flex flex-col">
            <h2 id="cards" className="text-base font-semibold">
              {t.cards(n)}
            </h2>
            {phoneList ? <span className={cn('text-sm', toFix > 0 ? 'text-destructive' : 'text-success')}>{toFix > 0 ? t.toFix(toFix) : t.allReady}</span> : null}
          </div>
          {n > 0 ? (
            <Button variant="ghost" size="sm" onClick={clear} disabled={adding}>
              {t.removeAll}
            </Button>
          ) : null}
        </div>
        {phone ? refusal : null}
        {n === 0 ? (
          <p className="text-sm text-muted-foreground">
            <span className={photosOnPhone ? undefined : 'max-md:hidden'}>{t.noCards}</span>
            {photosOnPhone ? null : <span className="md:hidden">{t.noCardsPhone}</span>}
          </p>
        ) : phone ? (
          <div aria-busy={adding} className={cn(adding && 'pointer-events-none opacity-50')}>
            <PhoneReview cards={cards} marks={marks} pictures={pictures.urls} onOpen={setOpenCard} />
          </div>
        ) : (
          <ReviewList
            cards={cards}
            marks={marks}
            pictures={pictures.urls}
            existingHref={(id) => staffHref(`/assets/sim-cards/${id}`)}
            onRemove={(index) => dispatch({ type: 'remove', index })}
          />
        )}
        {phone ? null : refusal}
        {n > 0 && phone ? (
          // Add and Scan More at the thumb: the bar is pinned to the screen's bottom, the list ending above it.
          <>
          <div aria-hidden className="h-32" />
          <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 border-t border-border bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {toFix > 0 ? <p className="text-sm text-destructive">{t.fixFirst(toFix)}</p> : null}
            <div className="flex gap-2">
              <Button variant="outline" className="h-12" onClick={openCamera} disabled={adding || !cameraAvailable()}>
                <Camera aria-hidden className="size-4" />
                {t.scanMore}
              </Button>
              <Button className="h-12 flex-1" onClick={() => void add()} disabled={addDisabled}>
                {adding ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                {adding ? t.adding : t.add(n)}
              </Button>
            </div>
          </div>
          </>
        ) : n > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void add()} disabled={addDisabled}>
              {adding ? t.adding : t.add(n)}
            </Button>
            {toFix > 0 ? <p className="text-sm text-destructive">{t.fixFirst(toFix)}</p> : null}
          </div>
        ) : null}
      </section>

      {phoneCamera ? (
        <PhoneCamera
          key={cameraKey}
          cards={cards}
          marks={marks}
          pictures={pictures.urls}
          settings={settings}
          batch={batch}
          onBatch={setBatch}
          onCard={(card, frontBlob, backBlob) => {
            pictures.keep(card.front!, frontBlob)
            if (backBlob && card.back) pictures.keep(card.back, backBlob)
            dispatch({ type: 'add', cards: [card] })
          }}
          onUpdate={(index, patch) => dispatch({ type: 'update', index, patch })}
          onRemove={(index) => dispatch({ type: 'remove', index })}
          onChoosePhotos={(files) => {
            setCamera(false)
            void choosePhotos(files)
          }}
          onRetry={() => setCameraKey((k) => k + 1)}
          onClose={() => setCamera(false)}
        />
      ) : null}

      {phone && !phoneCamera && openCard !== null && cards[openCard] ? (
        <CardSheet
          n={openCard + 1}
          card={cards[openCard]}
          marks={marks[openCard] ?? []}
          pictures={pictures.urls}
          provider={batch.provider}
          onChange={(patch) => dispatch({ type: 'update', index: openCard, patch })}
          onRemove={() => {
            dispatch({ type: 'remove', index: openCard })
            setOpenCard(null)
          }}
          onClose={() => setOpenCard(null)}
        />
      ) : null}

      {phone && batchSheet ? (
        <PhoneBatchSheet
          settings={settings}
          batch={batch}
          onSave={(b) => {
            setBatch(b)
            setBatchSheet(false)
          }}
          onClose={() => setBatchSheet(false)}
        />
      ) : null}
    </>
  )
}

/** A refused batch says nothing was added and names its row, as the list does: "SIM 3". */
function addErrorTitle(error: unknown): string | undefined {
  return error instanceof ApiError && error.index !== undefined ? simScanText().refused(error.index + 1) : undefined
}
