import type { IdentityDocumentKind } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { COPY_MAX_SIDE, VIEW_RATIO, guideFor, type DocType } from '@ppe/id-docs/flow'
import { loadReader, todayHere } from '@ppe/id-docs/reader'
import type { Mrz } from '@ppe/mrz'
import { Steady, canvasOf } from '@ppe/scan-kit'
import { guideCrop } from '@ppe/scan-kit/camera'
import { useLiveCamera } from '@ppe/scan-kit/live-camera'
import { Button } from '@ppe/ui/components/button'
import { cn } from '@ppe/ui/lib/utils'
import { CameraOff, Check, ChevronRight, Flashlight, ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import { draftFrom, kindFrom } from '@/lib/flow'
import { keepScan, makePages, readingOf } from '@/lib/pages'
import { useRouter } from '@/lib/router'
import { useSessions } from '@/lib/sessions'

/** A live frame is read smaller than a photo: sooner, and the code lines still a few dozen pixels tall. */
const LIVE_SIDE = 1400

interface Taken {
  key: string
  blob: Blob
  url: string
  /** The MRZ was read live on it: a card's back. */
  read: boolean
}

/**
 * The camera, full screen, as a phone's Camera app (DS-2): the guide in the document's shape,
 * the MRZ read live and, with AUTO, the photo taken once two frames read the same lines; the
 * shutter for a photo by hand (a card's front, which has no code lines). A card needs both
 * sides, in either order. Photos reads pictures already taken. Review makes the pages, keeps
 * the scan on the server and opens it.
 */
export function CameraScreen() {
  const { client } = useApi()
  const { navigate } = useRouter()
  const sessions = useSessions()
  const retake = sessions.retake
  const [mode, setMode] = useState<DocType>(retake ? (retake.kind === 'passport' ? 'passport' : 'card') : 'card')
  const [auto, setAuto] = useState(true)
  const [taken, setTaken] = useState<Taken[]>([])
  const [flash, setFlash] = useState(false)
  const [busy, setBusy] = useState<{ step: 'making' | 'keeping'; n: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const photos = useRef<HTMLInputElement>(null)
  const steady = useRef(new Steady<Mrz>())
  const autoRef = useRef(auto)
  autoRef.current = auto
  const takenRef = useRef(taken)
  takenRef.current = taken
  const { guide, band } = guideFor(mode)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => d?.close()
  }, [])
  useEffect(() => () => takenRef.current.forEach((x) => URL.revokeObjectURL(x.url)), [])

  const hasBack = taken.some((x) => x.read)
  const hasFront = taken.some((x) => !x.read)
  const complete = mode === 'passport' ? hasBack : hasBack && hasFront
  const waitingForFront = mode === 'card' && hasBack && !hasFront

  const add = (blob: Blob, read: boolean) => {
    setFlash(true)
    setTimeout(() => setFlash(false), 350)
    setTaken((cur) => {
      // One page with code lines and one without: a second of either replaces the first.
      const dropped = cur.filter((x) => x.read === read)
      dropped.forEach((x) => URL.revokeObjectURL(x.url))
      return [...cur.filter((x) => x.read !== read), { key: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), read }]
    })
  }

  const camera = useLiveCamera({
    guide,
    prepare: loadReader,
    onFrame: async ({ video, crop, now }, reader) => {
      if (!autoRef.current && !now) return
      const done = takenRef.current
      if (done.some((x) => x.read)) return
      const mrz = await reader.readFrame(canvasOf(video, crop, LIVE_SIDE), todayHere())
      const got = now ? mrz : steady.current.see(mrz ?? null, (m) => m.lines.join('\n'))
      if (!got) return
      steady.current.reset()
      camera.signal()
      add(await snapshot(video, crop), true)
    },
  })

  const shutter = async () => {
    const el = camera.video.current
    if (!el?.videoWidth) return
    add(await snapshot(el, guideCrop(el, guide)), false)
  }

  const review = async (more: readonly Blob[] = []) => {
    const blobs = [...taken.map((x) => x.blob), ...more]
    if (blobs.length === 0) return
    setFailed(false)
    const kind: IdentityDocumentKind = mode === 'passport' ? 'passport' : 'id_card'
    try {
      setBusy({ step: 'making', n: blobs.length })
      const pages = await makePages(blobs, kind)
      const m = readingOf(pages)
      setBusy({ step: 'keeping', n: blobs.length })
      const s = await keepScan(client, kindFrom(m, kind), pages, draftFrom(m), m, retake?.replaces)
      sessions.put(s)
      if (retake) sessions.drop(retake.replaces)
      sessions.setRetake(null)
      navigate({ name: 'scan', id: s.id })
    } catch {
      setFailed(true)
      setBusy(null)
    }
  }

  const close = () => {
    const back = retake?.replaces
    sessions.setRetake(null)
    navigate(back ? { name: 'scan', id: back } : { name: 'home' })
  }

  const pct = (n: number) => `${n * 100}%`
  const status = camera.problem
    ? null
    : waitingForFront
      ? t.camera.front
      : camera.justRead
        ? t.camera.read
        : t.camera.looking(mode === 'card')
  const last = taken.at(-1)

  return (
    <dialog
      ref={dialog}
      aria-label={t.camera.title}
      className="dark m-0 h-dvh max-h-none w-full max-w-none border-0 bg-black p-0 text-white backdrop:bg-black"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-2">
          <Button variant="ghost" size="icon" className="rounded-full bg-white/10" aria-label={t.camera.close} onClick={close}>
            <X aria-hidden className="size-5" />
          </Button>
          <button
            type="button"
            aria-pressed={auto}
            title={t.camera.autoHint}
            onClick={() => setAuto((a) => !a)}
            className={cn('h-8 min-w-16 rounded-full px-3 text-xs font-bold tracking-wide uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring', auto ? 'bg-yellow-400 text-black' : 'bg-white/15')}
          >
            {t.camera.auto}
          </button>
          {camera.torch.available ? (
            <Button variant="ghost" size="icon" aria-pressed={camera.torch.on} aria-label={t.camera.torch} className={cn('rounded-full', camera.torch.on ? 'bg-yellow-400 text-black' : 'bg-white/10')} onClick={camera.torch.toggle}>
              <Flashlight aria-hidden className="size-5" />
            </Button>
          ) : (
            <span className="size-11" />
          )}
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-x-0 top-1/2 mx-auto w-full max-w-xl -translate-y-1/2" style={{ aspectRatio: String(VIEW_RATIO) }}>
            <video ref={camera.video} className="size-full object-cover" playsInline muted aria-label={t.camera.title} />
            {camera.problem ? null : (
              <>
                <div
                  aria-hidden
                  className={cn('pointer-events-none absolute rounded-xl border-[3px] transition-colors', camera.justRead ? 'border-emerald-400' : 'border-white/85')}
                  style={{ left: pct(guide.x), top: pct(guide.y), width: pct(guide.w), height: pct(guide.h) }}
                />
                {waitingForFront ? null : (
                  <div aria-hidden className="pointer-events-none absolute border-t-2 border-dashed border-white/70 bg-white/10" style={{ left: pct(band.x), top: pct(band.y), width: pct(band.w), height: pct(band.h) }} />
                )}
              </>
            )}
            {flash ? <div aria-hidden className="pointer-events-none absolute inset-0 bg-white motion-safe:animate-out motion-safe:fade-out" /> : null}
          </div>
          {camera.problem ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <CameraOff aria-hidden className="size-10 text-white/70" />
              <p role="alert" className="max-w-sm text-sm">
                {camera.problem === 'denied' ? t.camera.denied : t.camera.failed}
              </p>
            </div>
          ) : (
            <p role="status" aria-live="polite" className={cn('absolute top-3 left-1/2 max-w-[90%] -translate-x-1/2 rounded-full px-4 py-2 text-center text-sm font-semibold backdrop-blur', camera.justRead ? 'bg-emerald-600/90' : 'bg-black/60')}>
              {status}
            </p>
          )}
          {mode === 'card' ? (
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
              {(['back', 'front'] as const).map((side) => {
                const done = side === 'back' ? hasBack : hasFront
                return (
                  <span key={side} className={cn('flex h-7 items-center gap-1 rounded-full px-3 text-xs font-semibold whitespace-nowrap', done ? 'bg-black/60 text-emerald-400' : 'bg-black/60 text-white/80')}>
                    {done ? <Check aria-hidden className="size-3.5" /> : null}
                    {t.camera.sides[side]}
                  </span>
                )
              })}
            </div>
          ) : null}
          {complete ? (
            <Button className="absolute top-3 right-3 rounded-full bg-yellow-400 text-black hover:bg-yellow-300" onClick={() => void review()}>
              {t.camera.review}
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>

        <div role="group" aria-label={t.camera.modes} className="flex justify-center gap-6 py-3 text-xs font-semibold tracking-widest uppercase">
          {(['card', 'passport'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn('min-h-11 px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring', mode === m ? 'text-yellow-400' : 'text-white/70')}
            >
              {t.camera[m]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-8 pb-2">
          <button
            type="button"
            disabled={taken.length === 0}
            onClick={() => void review()}
            aria-label={last ? `${t.camera.review} · ${t.camera.taken(taken.length)}` : t.camera.review}
            className="relative size-14 justify-self-start overflow-hidden rounded-lg border-2 border-white/40 bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            {last ? <img src={last.url} alt="" className="size-full object-cover" /> : null}
            {taken.length > 0 ? <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-yellow-400 text-xs font-bold text-black">{taken.length}</span> : null}
          </button>
          <button
            type="button"
            aria-label={t.camera.shutter}
            disabled={!!camera.problem}
            onClick={() => void shutter()}
            className="grid size-20 place-items-center rounded-full border-4 border-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <span className={cn('size-16 rounded-full bg-white transition-transform active:scale-90', camera.justRead && 'bg-emerald-400')} />
          </button>
          <div className="flex flex-col items-center gap-1 justify-self-end text-xs text-white/80">
            <Button variant="ghost" size="icon" className="rounded-full bg-white/10" aria-label={t.camera.photos} onClick={() => photos.current?.click()}>
              <ImagePlus aria-hidden className="size-5" />
            </Button>
            {t.camera.photos}
            <input
              ref={photos}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label={t.camera.photos}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (files.length > 0) void review(files)
              }}
            />
          </div>
        </div>
      </div>

      {busy ? (
        <div role="status" aria-live="polite" className="fixed inset-0 z-10 grid place-items-center bg-black/75 text-center text-base font-semibold">
          <div className="flex flex-col items-center gap-3">
            <span aria-hidden className="size-9 animate-spin rounded-full border-[3px] border-white/25 border-t-white motion-reduce:animate-none" />
            {busy.step === 'making' ? t.camera.making(busy.n) : t.camera.keeping}
          </div>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="fixed inset-x-4 bottom-32 z-10 rounded-xl bg-destructive px-4 py-3 text-center text-sm text-white">
          {t.camera.failedPages}
        </p>
      ) : null}
    </dialog>
  )
}

/** The guide's part of the picture as a JPEG, at most a Document Copy's size. */
function snapshot(el: HTMLVideoElement, crop: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const canvas = canvasOf(el, crop, COPY_MAX_SIDE)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be taken'))), 'image/jpeg', 0.9))
}
