import type { AddedSim, Settings, SimProblem } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { euroInput, formatEuro, parseEuro } from '@ppe/i18n'
import { staffHref } from '@ppe/routing'
import {
  type BatchSettings,
  MAX_CARDS,
  type PictureRead,
  type ScanCard,
  Steady,
  batchRequest,
  blocks,
  cardComplete,
  pairPhotos,
  pickSimNo,
  rowMarks,
  simKey,
  simScanText,
  withPhoto,
} from '@ppe/sim-scan'
import { beep, cameraAvailable, eachFrame, guideCrop, startCamera, stopCamera } from '@ppe/sim-scan/camera'
import { CardFields, ReviewList, Thumb, message } from '@ppe/sim-scan/review-list'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { DateInput } from '@ppe/ui/components/date-input'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { ActionError, PageHeader } from '@ppe/ui/components/states'
import { formatDay, isoDay } from '@ppe/ui/lib/dates'
import { cn } from '@ppe/ui/lib/utils'
import { Camera, CircleCheck, ImagePlus, Loader2, Pencil, Square } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { loadReaders } from '@/lib/readers'

/** The guide frame over the camera picture, as fractions of it: a card held across. */
const GUIDE = { x: 0.06, y: 0.22, w: 0.88, h: 0.56 }

let nextKey = 0
const newKey = () => `p${++nextKey}`

/**
 * Scan SIMs: what the batch shares (from Settings), the cards read with the
 * camera or from photos, the review list, then Add, all or none. Pictures and
 * codes live in this screen's memory only, and go when it is left or the
 * batch is added (docs/specs/asset-service.md "Scan SIM cards").
 */
export function ScanPage() {
  const { client } = useApi()
  const t = simScanText()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [batch, setBatch] = useState<BatchSettings>({ provider: '', plan: '', valueCents: null, receivedDate: '', comment: '' })
  const [cards, setCards] = useState<ScanCard[]>([])
  const pictures = useRef(new Map<string, string>())
  const [, redraw] = useState(0)
  const [apiProblems, setApiProblems] = useState<SimProblem[]>([])
  const [reading, setReading] = useState<{ done: number; all: number } | null>(null)
  const [camera, setCamera] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [added, setAdded] = useState<AddedSim[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

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

  const keep = useCallback((id: string, blob: Blob) => {
    pictures.current.set(id, URL.createObjectURL(blob))
  }, [])
  const forget = useCallback((ids: (string | undefined)[]) => {
    for (const id of ids) {
      const url = id ? pictures.current.get(id) : undefined
      if (url) URL.revokeObjectURL(url)
      if (id) pictures.current.delete(id)
    }
  }, [])
  const clearAll = useCallback(() => {
    forget([...pictures.current.keys()])
    setCards([])
    setApiProblems([])
  }, [forget])
  useEffect(() => () => forget([...pictures.current.keys()]), [forget])

  // Leaving with cards not yet added asks first.
  useEffect(() => {
    if (cards.length === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [cards.length])

  // The API's check, a moment after the list or the settings change: it alone knows the register.
  const request = useMemo(() => batchRequest(batch, cards), [batch, cards])
  useEffect(() => {
    if (cards.length === 0 || request.provider === '') return setApiProblems([])
    const timer = setTimeout(() => {
      client.assets.checkSimCards(request).then(setApiProblems, () => setApiProblems([]))
    }, 400)
    return () => clearTimeout(timer)
  }, [client, request, cards.length])

  const marks = useMemo(() => rowMarks(cards, apiProblems), [cards, apiProblems])
  const toFix = marks.filter((row) => row.some(blocks)).length

  const choosePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setAdded(null)
    const list = [...files].slice(0, 2 * MAX_CARDS)
    const reads: PictureRead[] = []
    setReading({ done: 0, all: list.length })
    let readers: Awaited<ReturnType<typeof loadReaders>>
    try {
      readers = await loadReaders()
    } catch (e) {
      setReading(null)
      return setError(e)
    }
    for (const file of list) {
      const id = newKey()
      keep(id, file)
      reads.push(await readers.readPhoto(id, file))
      setReading({ done: reads.length, all: list.length })
    }
    setReading(null)
    setCards((cur) => [...cur, ...pairPhotos(reads)].slice(0, MAX_CARDS))
  }

  const add = async () => {
    setAdding(true)
    setError(null)
    try {
      const sims = await client.assets.addSimCards(request)
      clearAll()
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
          keep={keep}
          picture={(id) => pictures.current.get(id)}
          onDone={(card) => {
            setAdded(null)
            setCards((cur) => (cur.length >= MAX_CARDS ? cur : [...cur, card]))
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
        {camera ? (
          <LiveScan
            known={cards.map((c) => simKey(c.simNo))}
            onCard={(card, frontBlob, backBlob) => {
              keep(card.front!, frontBlob)
              if (backBlob && card.back) keep(card.back, backBlob)
              setCards((cur) => (cur.length >= MAX_CARDS ? cur : [...cur, card]))
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
            <Button variant="ghost" size="sm" onClick={clearAll}>
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
            pictures={pictures.current}
            existingHref={(id) => staffHref(`/assets/sim-cards/${id}`)}
            onRemove={(i) => {
              forget([cards[i]?.front, cards[i]?.back])
              setCards((cur) => cur.filter((_, j) => j !== i))
              redraw((n) => n + 1)
            }}
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

/** A refused batch names its row: "SIM 3: …". */
function addErrorTitle(error: unknown): string | undefined {
  return error instanceof ApiError && error.index !== undefined ? `SIM ${error.index + 1}` : undefined
}

/**
 * The camera, card after card: the front's barcode, then the back's PIN and
 * PUK, each taken once read the same twice in a row; No Back adds the card
 * without them. A front already in the list is not taken again.
 */
function LiveScan({
  known,
  onCard,
  onClose,
}: {
  known: string[]
  onCard: (card: ScanCard, front: Blob, back: Blob | null) => void
  onClose: () => void
}) {
  const t = simScanText()
  const video = useRef<HTMLVideoElement>(null)
  const [step, setStep] = useState<{ side: 'front' } | { side: 'back'; simNo: string; front: Blob }>({ side: 'front' })
  const [status, setStatus] = useState<string>(t.aimFront)
  const [problem, setProblem] = useState<string | null>(null)
  const stepRef = useRef(step)
  stepRef.current = step
  const knownRef = useRef(known)
  knownRef.current = known
  // The parent's callback changes on each render; the camera must not restart with it.
  const onCardRef = useRef(onCard)
  onCardRef.current = onCard

  useEffect(() => {
    const el = video.current
    if (!el) return
    let stream: MediaStream | null = null
    let stop = () => {}
    const fronts = new Steady<string>()
    const backs = new Steady<{ pin: string; puk: string }>()
    const snapshot = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? new Blob()), 'image/jpeg', 0.7))
    let alive = true
    void Promise.all([startCamera(el), loadReaders()]).then(
      ([s, { barcodesIn, canvasOf, codesIn, imageDataOf, warmUpReaders }]) => {
        if (!alive) return stopCamera(s)
        stream = s
        warmUpReaders()
        stop = eachFrame(el, async () => {
          if (!el.videoWidth) return
          const canvas = canvasOf(el, guideCrop(el, GUIDE))
          const cur = stepRef.current
          if (cur.side === 'front') {
            const simNo = fronts.see(pickSimNo(await barcodesIn(imageDataOf(canvas))), (v) => v)
            if (!simNo) return
            if (knownRef.current.includes(simKey(simNo))) return setStatus(message({ field: 'sim_no', code: 'duplicate', other: knownRef.current.indexOf(simKey(simNo)) }) ?? '')
            beep()
            fronts.reset()
            setStep({ side: 'back', simNo, front: await snapshot(canvas) })
            setStatus(t.aimBack(simNo))
            return
          }
          const codes = await codesIn(canvas)
          const got = backs.see(codes.pin && codes.puk ? { pin: codes.pin, puk: codes.puk } : null, (c) => `${c.pin} ${c.puk}`)
          if (!got) return
          beep()
          backs.reset()
          const front = `c${Date.now()}f`
          const back = `c${Date.now()}b`
          onCardRef.current({ key: front, simNo: cur.simNo, pin: got.pin, puk: got.puk, front, back }, cur.front, await snapshot(canvas))
          setStep({ side: 'front' })
          setStatus(t.readBack)
        })
      },
      (e: unknown) => setProblem(e instanceof DOMException && e.name === 'NotAllowedError' ? t.cameraDenied : t.cameraUnavailable),
    )
    return () => {
      alive = false
      stop()
      stopCamera(stream)
    }
  }, [t])

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full max-w-xl overflow-hidden rounded-lg bg-black">
        <video ref={video} className="size-full object-cover" playsInline muted />
        <div
          aria-hidden
          className={cn('pointer-events-none absolute rounded-md border-2', step.side === 'front' ? 'border-white' : 'border-warning')}
          style={{ left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%` }}
        />
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {problem ?? status}
      </p>
      <div className="flex flex-wrap gap-2">
        {step.side === 'back' ? (
          <Button
            variant="outline"
            onClick={() => {
              const front = `c${Date.now()}f`
              onCard({ key: front, simNo: step.simNo, pin: '', puk: '', front }, step.front, null)
              setStep({ side: 'front' })
              setStatus(t.aimFront)
            }}
          >
            {t.skipBack}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          {t.stopCamera}
        </Button>
      </div>
    </div>
  )
}

/**
 * The card being scanned: a photo of each side, each read as it is taken, its
 * SIM No., PIN and PUK to check or type. Only once both photos are in and the
 * three fields are right does it go to the list, and the next card starts: at
 * once when the photos fill them, else with Next SIM.
 */
function CardInProgress({
  list,
  keep,
  picture,
  onDone,
}: {
  list: readonly ScanCard[]
  keep: (id: string, blob: Blob) => void
  picture: (id: string) => string | undefined
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
      keep(id, file)
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
          ) : id && picture(id) ? (
            <Thumb src={picture(id)} alt={label} />
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

/**
 * What every SIM of the batch shares (For every SIM), filled in from Settings:
 * shown read only, a label and its value a line, with Edit at its top right. Edit flips
 * it over to the form; Save or Cancel (or Escape) flips it back. Without a
 * provider to fill in, it opens on the form.
 */
function BatchCard({
  settings,
  batch,
  onSave,
  missingProvider,
}: {
  settings: Settings | null
  batch: BatchSettings
  onSave: (batch: BatchSettings) => void
  missingProvider: boolean
}) {
  const t = simScanText()
  const [editing, setEditing] = useState(false)
  // Only a change of side flips; the card as first shown does not.
  const [flipped, setFlipped] = useState(false)
  const [draft, setDraft] = useState(batch)
  const [valueText, setValueText] = useState('')
  const editButton = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const loaded = settings !== null
  const providerChoices = settings?.sim_providers.map((p) => p.name) ?? []
  const valueBad = valueText.trim() !== '' && Number.isNaN(parseEuro(valueText))
  const open = editing

  const start = () => {
    setDraft(batch)
    setValueText(euroInput(batch.valueCents))
    setFlipped(true)
    setEditing(true)
  }
  const close = () => {
    setFlipped(true)
    setEditing(false)
    requestAnimationFrame(() => editButton.current?.focus())
  }
  const save = () => {
    if (draft.provider.trim() === '' || valueBad) return
    onSave({ ...draft, valueCents: parseEuro(valueText) })
    close()
  }

  // With no provider to fill in from Settings, it opens on the form, unflipped.
  useEffect(() => {
    if (!loaded || batch.provider.trim() !== '' || editing) return
    setDraft(batch)
    setValueText(euroInput(batch.valueCents))
    setEditing(true)
  }, [loaded, batch, editing])

  // The form's first field takes the focus as it opens.
  useEffect(() => {
    if (editing) form.current?.querySelector<HTMLElement>('select, input')?.focus()
  }, [editing])

  const flip = flipped ? 'motion-safe:animate-flip-in origin-top' : undefined
  return (
    <section aria-labelledby="batch" className="mb-5 [perspective:900px]">
      {!open ? (
        <div key="view" className={cn('flex items-start gap-2 rounded-lg border border-border px-3 py-2', flip)}>
          <div className="min-w-0 flex-1">
            <h2 id="batch" className="text-sm font-semibold">
              {t.batch}
            </h2>
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
              {[
                [t.provider, batch.provider],
                [t.plan, batch.plan],
                [t.nonReturnValue, batch.valueCents === null ? '' : formatEuro(batch.valueCents)],
                [t.receivedDate, batch.receivedDate === '' ? '' : formatDay(batch.receivedDate)],
                [t.comment, batch.comment],
              ]
                .filter(([, v]) => v !== '')
                .map(([label, value]) => (
                  <Fragment key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </Fragment>
                ))}
            </dl>
          </div>
          <Button
            ref={editButton}
            type="button"
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-2 shrink-0"
            aria-label={t.editBatch}
            title={t.editBatch}
            disabled={!loaded}
            onClick={start}
          >
            <Pencil aria-hidden className="size-4" />
          </Button>
        </div>
      ) : (
        <form
          key="edit"
          ref={form}
          className={cn('flex flex-col gap-4 rounded-lg border border-border p-3 sm:p-4', flip)}
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && batch.provider.trim() !== '') close()
          }}
        >
          <h2 id="batch" className="text-base font-semibold">
            {t.batch}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t.provider} required error={(missingProvider || editing) && draft.provider.trim() === '' ? t.providerRequired : undefined}>
              {(p) =>
                providerChoices.length > 0 ? (
                  <Select
                    {...controlProps(p)}
                    value={draft.provider}
                    onChange={(e) => {
                      const provider = e.target.value
                      const plan = settings?.sim_providers.find((x) => x.name === provider)?.default_plan ?? ''
                      setDraft((b) => ({ ...b, provider, plan }))
                    }}
                  >
                    <option value="" disabled>
                      {t.provider}
                    </option>
                    {providerChoices.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input {...controlProps(p)} value={draft.provider} onChange={(e) => setDraft((b) => ({ ...b, provider: e.target.value }))} />
                )
              }
            </Field>
            <Field label={t.plan}>
              {(p) => <Input {...controlProps(p)} value={draft.plan} onChange={(e) => setDraft((b) => ({ ...b, plan: e.target.value }))} />}
            </Field>
            <Field label={t.nonReturnValue} error={valueBad ? t.valueInvalid : undefined}>
              {(p) => <Input {...controlProps(p)} inputMode="decimal" value={valueText} onChange={(e) => setValueText(e.target.value)} />}
            </Field>
            <Field label={t.receivedDate}>
              {(p) => (
                <DateInput
                  {...controlProps(p)}
                  value={draft.receivedDate}
                  max={settings ? isoDay(new Date(), settings.timezone) : undefined}
                  onChange={(v) => setDraft((b) => ({ ...b, receivedDate: v }))}
                />
              )}
            </Field>
          </div>
          <Field label={t.comment}>
            {(p) => <Textarea {...controlProps(p)} rows={2} value={draft.comment} onChange={(e) => setDraft((b) => ({ ...b, comment: e.target.value }))} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={draft.provider.trim() === '' || valueBad}>
              {t.saveBatch}
            </Button>
            {batch.provider.trim() !== '' ? (
              <Button type="button" variant="outline" onClick={close}>
                {t.cancel}
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  )
}
