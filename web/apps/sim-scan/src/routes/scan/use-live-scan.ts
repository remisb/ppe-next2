import { Steady } from '@ppe/scan-kit'
import { type Guide, useLiveCamera } from '@ppe/scan-kit/live-camera'
import { type ScanCard, pickSimNo, simKey, simScanText } from '@ppe/sim-scan'
import { type RefObject, useRef, useState } from 'react'

import { loadReaders } from '@/lib/readers'

import { newKey } from './scan-list'

export type { Guide }

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

const readers = () =>
  loadReaders().then((r) => {
    r.warmUpReaders()
    return r
  })

/**
 * The camera, card after card: the front's barcode, then the back's PIN and
 * PUK, each taken once read the same twice in a row (or at once after Read
 * Now: a photo is read once too, and the list checks what was read); No Back
 * adds the card without them. A front already in the list is not taken again.
 * The camera itself (started, stopped, the torch, Read Now, the flash) is
 * @ppe/scan-kit's useLiveCamera; `guide` is the frame's place in the video's box.
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
  const [step, setStep] = useState<{ side: 'front' } | { side: 'back'; simNo: string; front: Blob }>({ side: 'front' })
  const [status, setStatus] = useState<string>(t.aimFront)
  const [duplicateOf, setDuplicateOf] = useState<number | null>(null)
  const stepRef = useRef(step)
  stepRef.current = step
  const knownRef = useRef(known)
  knownRef.current = known
  const fronts = useRef(new Steady<string>())
  const backs = useRef(new Steady<{ pin: string; puk: string }>())
  const snapshot = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? new Blob()), 'image/jpeg', 0.7))

  const camera = useLiveCamera({
    guide,
    prepare: readers,
    onFrame: async ({ video, crop, now }, { LIVE_BARCODE_SIDE, barcodesIn, canvasOf, codesIn, imageDataOf }) => {
      const cur = stepRef.current
      // The front's barcode is read smaller, and so sooner; the back's digits at full size.
      const canvas = canvasOf(video, crop, cur.side === 'front' ? LIVE_BARCODE_SIDE : undefined)
      if (cur.side === 'front') {
        const seen = pickSimNo(await barcodesIn(imageDataOf(canvas)))
        const simNo = now ? seen : fronts.current.see(seen, (v) => v)
        if (!simNo) {
          if (now) setStatus(t.readNothing)
          return
        }
        const other = knownRef.current.indexOf(simKey(simNo))
        if (other >= 0) {
          setDuplicateOf(other)
          return setStatus(t.aimNext)
        }
        camera.signal()
        fronts.current.reset()
        setDuplicateOf(null)
        setStep({ side: 'back', simNo, front: await snapshot(canvas) })
        setStatus(t.aimBack(simNo))
        return
      }
      const codes = await codesIn(canvas)
      const seen = codes.pin && codes.puk ? { pin: codes.pin, puk: codes.puk } : null
      const got = now ? seen : backs.current.see(seen, (c) => `${c.pin} ${c.puk}`)
      if (!got) {
        if (now) setStatus(t.readNothing)
        return
      }
      camera.signal()
      backs.current.reset()
      const front = newKey()
      const back = newKey()
      onCard({ key: front, simNo: cur.simNo, pin: got.pin, puk: got.puk, front, back }, cur.front, await snapshot(canvas))
      setStep({ side: 'front' })
      setStatus(t.readBack)
    },
  })

  return {
    video: camera.video,
    side: step.side,
    status,
    problem: camera.problem === 'denied' ? t.cameraDenied : camera.problem === 'failed' ? t.cameraFailed : null,
    denied: camera.problem === 'denied',
    duplicateOf,
    justRead: camera.justRead,
    noBack: () => {
      const cur = stepRef.current
      if (cur.side !== 'back') return
      const front = newKey()
      onCard({ key: front, simNo: cur.simNo, pin: '', puk: '', front }, cur.front, null)
      setStep({ side: 'front' })
      setStatus(t.aimFront)
    },
    readNow: () => {
      camera.readNow()
      setStatus(t.readingNow)
    },
    torch: camera.torch,
  }
}
