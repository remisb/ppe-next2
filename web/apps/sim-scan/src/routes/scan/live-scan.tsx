import { type ScanCard, Steady, pickSimNo, simKey, simScanText } from '@ppe/sim-scan'
import { beep, eachFrame, guideCrop, startCamera, stopCamera } from '@ppe/sim-scan/camera'
import { message } from '@ppe/sim-scan/review-list'
import { Button } from '@ppe/ui/components/button'
import { cn } from '@ppe/ui/lib/utils'
import { useEffect, useRef, useState } from 'react'

import { loadReaders } from '@/lib/readers'

import { newKey } from './scan-list'

/** The guide frame over the camera picture, as fractions of it: a card held across. */
const GUIDE = { x: 0.06, y: 0.22, w: 0.88, h: 0.56 }

/**
 * The camera, card after card: the front's barcode, then the back's PIN and
 * PUK, each taken once read the same twice in a row; No Back adds the card
 * without them. A front already in the list is not taken again.
 */
export function LiveScan({
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
          const front = newKey()
          const back = newKey()
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
              const front = newKey()
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
