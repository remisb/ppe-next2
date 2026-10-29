import type { AddedSim, Settings, SimProblem } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { euroInput, parseEuro } from '@ppe/i18n'
import { staffHref } from '@ppe/routing'
import {
  type BatchSettings,
  MAX_CARDS,
  type PictureRead,
  type ScanCard,
  Steady,
  batchRequest,
  blocks,
  pairPhotos,
  pickSimNo,
  rowMarks,
  simKey,
  simScanText,
} from '@ppe/sim-scan'
import { beep, cameraAvailable, eachFrame, guideCrop, startCamera, stopCamera } from '@ppe/sim-scan/camera'
import { ReviewList, message } from '@ppe/sim-scan/review-list'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { DateInput } from '@ppe/ui/components/date-input'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { ActionError, PageHeader } from '@ppe/ui/components/states'
import { isoDay } from '@ppe/ui/lib/dates'
import { cn } from '@ppe/ui/lib/utils'
import { Camera, CircleCheck, ImagePlus, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const [valueText, setValueText] = useState('')
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
        setValueText(euroInput(s.default_sim_non_return_value_cents))
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
  const valueBad = valueText.trim() !== '' && Number.isNaN(parseEuro(valueText))

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

  const providerChoices = settings?.sim_providers.map((p) => p.name) ?? []
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

      <section aria-labelledby="batch" className="mb-6 flex flex-col gap-4">
        <h2 id="batch" className="text-base font-semibold">
          {t.batch}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t.provider} required error={batch.provider === '' && cards.length > 0 ? t.providerRequired : undefined}>
            {(p) =>
              providerChoices.length > 0 ? (
                <Select
                  {...controlProps(p)}
                  value={batch.provider}
                  onChange={(e) => {
                    const provider = e.target.value
                    const plan = settings?.sim_providers.find((x) => x.name === provider)?.default_plan ?? ''
                    setBatch((b) => ({ ...b, provider, plan }))
                  }}
                >
                  {providerChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...controlProps(p)} value={batch.provider} onChange={(e) => setBatch((b) => ({ ...b, provider: e.target.value }))} />
              )
            }
          </Field>
          <Field label={t.plan}>
            {(p) => <Input {...controlProps(p)} value={batch.plan} onChange={(e) => setBatch((b) => ({ ...b, plan: e.target.value }))} />}
          </Field>
          <Field label={t.nonReturnValue} error={valueBad ? t.valueInvalid : undefined}>
            {(p) => (
              <Input
                {...controlProps(p)}
                inputMode="decimal"
                value={valueText}
                onChange={(e) => {
                  setValueText(e.target.value)
                  const cents = parseEuro(e.target.value)
                  if (!Number.isNaN(cents)) setBatch((b) => ({ ...b, valueCents: cents }))
                }}
              />
            )}
          </Field>
          <Field label={t.receivedDate}>
            {(p) => (
              <DateInput
                {...controlProps(p)}
                value={batch.receivedDate}
                max={settings ? isoDay(new Date(), settings.timezone) : undefined}
                onChange={(v) => setBatch((b) => ({ ...b, receivedDate: v }))}
              />
            )}
          </Field>
        </div>
        <Field label={t.comment}>
          {(p) => <Textarea {...controlProps(p)} rows={2} value={batch.comment} onChange={(e) => setBatch((b) => ({ ...b, comment: e.target.value }))} />}
        </Field>
      </section>

      <section className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={camera ? 'secondary' : 'default'}
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
            onChange={(i, patch) => setCards((cur) => cur.map((c, j) => (j === i ? { ...c, ...patch } : c)))}
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
            <Button onClick={() => void add()} disabled={adding || toFix > 0 || batch.provider.trim() === '' || valueBad}>
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
