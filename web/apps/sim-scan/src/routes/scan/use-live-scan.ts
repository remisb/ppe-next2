import { Steady } from '@ppe/scan-kit'
import { beep, buzz, eachFrame, guideCrop, startCamera, stopCamera, torchOf, type Torch } from '@ppe/scan-kit/camera'
import { type ScanCard, pickSimNo, simKey, simScanText } from '@ppe/sim-scan'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { loadReaders } from '@/lib/readers'

import { newKey } from './scan-list'

/** The guide frame over the camera picture, as fractions of the video element's box. */
export interface Guide {
  x: number
  y: number
  w: number
  h: number
}

export type Side = 'front' | 'back'

export interface LiveScan {
  /** The video element the camera shows in. */
  video: RefObject<HTMLVideoElement | null>
  side: Side
  /** What to do now, or what was just done. */
  status: string
  /** The camera could not start: why, in words. */
  problem: string | null
  /** It could not start because it was not allowed: the browser's or the phone's setting, which the user can change. */
  denied: boolean
  /** The front just seen is already in the list, as this card (its index); not taken again. */
  duplicateOf: number | null
  /** A side was read a moment ago: the guide shows it. */
  justRead: boolean
  /** Adds the card whose front was read without its PIN and PUK. */
  noBack: () => void
  /** Takes the next frame's reading at once, without waiting for it to be read the same twice. */
  readNow: () => void
  torch: { available: boolean; on: boolean; toggle: () => void }
}

/**
 * The camera, card after card: the front's barcode, then the back's PIN and
 * PUK, each taken once read the same twice in a row (or at once after Read
 * Now: a photo is read once too, and the list checks what was read); No Back
 * adds the card without them. A front already in the list is not taken again.
 * The camera runs while the hook is mounted. `guide` is the frame's place in
 * the video's box, fixed or worked out from the box's size.
 */
export function useLiveScan({
  known,
  onCard,
  guide,
}: {
  /** The list's cards, by simKey. */
  known: string[]
  onCard: (card: ScanCard, front: Blob, back: Blob | null) => void
  guide: Guide | ((width: number, height: number) => Guide)
}): LiveScan {
  const t = simScanText()
  const video = useRef<HTMLVideoElement>(null)
  const [step, setStep] = useState<{ side: 'front' } | { side: 'back'; simNo: string; front: Blob }>({ side: 'front' })
  const [status, setStatus] = useState<string>(t.aimFront)
  const [problem, setProblem] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [duplicateOf, setDuplicateOf] = useState<number | null>(null)
  const [justRead, setJustRead] = useState(false)
  const [torch, setTorch] = useState<{ control: Torch; on: boolean }>({ control: torchOf(null), on: false })
  const stepRef = useRef(step)
  stepRef.current = step
  const knownRef = useRef(known)
  knownRef.current = known
  // The parent's callback and guide change on each render; the camera must not restart with them.
  const onCardRef = useRef(onCard)
  onCardRef.current = onCard
  const guideRef = useRef(guide)
  guideRef.current = guide
  const nowRef = useRef(false)
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const read = useCallback(() => {
    beep()
    buzz()
    setJustRead(true)
    clearTimeout(readTimer.current)
    readTimer.current = setTimeout(() => setJustRead(false), 650)
  }, [])

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
      ([s, { LIVE_BARCODE_SIDE, barcodesIn, canvasOf, codesIn, imageDataOf, warmUpReaders }]) => {
        if (!alive) return stopCamera(s)
        stream = s
        setTorch({ control: torchOf(s), on: false })
        warmUpReaders()
        stop = eachFrame(el, async () => {
          if (!el.videoWidth) return
          const cur = stepRef.current
          const g = guideRef.current
          const frame = typeof g === 'function' ? g(el.clientWidth || el.videoWidth, el.clientHeight || el.videoHeight) : g
          // The front's barcode is read smaller, and so sooner; the back's digits at full size.
          const canvas = canvasOf(el, guideCrop(el, frame), cur.side === 'front' ? LIVE_BARCODE_SIDE : undefined)
          // Read Now takes this frame's reading as it is, once.
          const now = nowRef.current
          nowRef.current = false
          if (cur.side === 'front') {
            const seen = pickSimNo(await barcodesIn(imageDataOf(canvas)))
            const simNo = now ? seen : fronts.see(seen, (v) => v)
            if (!simNo) {
              if (now) setStatus(t.readNothing)
              return
            }
            const other = knownRef.current.indexOf(simKey(simNo))
            if (other >= 0) {
              setDuplicateOf(other)
              return setStatus(t.aimNext)
            }
            read()
            fronts.reset()
            setDuplicateOf(null)
            setStep({ side: 'back', simNo, front: await snapshot(canvas) })
            setStatus(t.aimBack(simNo))
            return
          }
          const codes = await codesIn(canvas)
          const seen = codes.pin && codes.puk ? { pin: codes.pin, puk: codes.puk } : null
          const got = now ? seen : backs.see(seen, (c) => `${c.pin} ${c.puk}`)
          if (!got) {
            if (now) setStatus(t.readNothing)
            return
          }
          read()
          backs.reset()
          const front = newKey()
          const back = newKey()
          onCardRef.current({ key: front, simNo: cur.simNo, pin: got.pin, puk: got.puk, front, back }, cur.front, await snapshot(canvas))
          setStep({ side: 'front' })
          setStatus(t.readBack)
        })
      },
      (e: unknown) => {
        const refused = e instanceof DOMException && e.name === 'NotAllowedError'
        setDenied(refused)
        setProblem(refused ? t.cameraDenied : t.cameraFailed)
      },
    )
    return () => {
      alive = false
      stop()
      stopCamera(stream)
      clearTimeout(readTimer.current)
    }
  }, [t, read])

  return {
    video,
    side: step.side,
    status,
    problem,
    denied,
    duplicateOf,
    justRead,
    noBack: () => {
      const cur = stepRef.current
      if (cur.side !== 'back') return
      const front = newKey()
      onCard({ key: front, simNo: cur.simNo, pin: '', puk: '', front }, cur.front, null)
      setStep({ side: 'front' })
      setStatus(t.aimFront)
    },
    readNow: () => {
      nowRef.current = true
      setStatus(t.readingNow)
    },
    torch: {
      available: torch.control.available,
      on: torch.on,
      toggle: () => {
        const on = !torch.on
        void torch.control.set(on).then((done) => done && setTorch((x) => ({ ...x, on })))
      },
    },
  }
}
