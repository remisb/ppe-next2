import type { Mrz } from '@ppe/mrz'
import { Steady, canvasOf } from '@ppe/scan-kit'
import { beep, eachFrame, guideCrop, startCamera, stopCamera } from '@ppe/scan-kit/camera'
import { Button } from '@ppe/ui/components/button'
import { cn } from '@ppe/ui/lib/utils'
import { Aperture, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import { COPY_MAX_SIDE, VIEW_RATIO, guideFor, type DocType } from '@/lib/flow'
import { loadReader, todayHere } from '@/lib/reader'

/** A live frame is read smaller than a photo: sooner, and the code lines still a few dozen pixels tall. */
const LIVE_SIDE = 1400

/**
 * The live camera (FR-2, FR-4): the picture with a guide frame in the
 * document's shape and its code lines' band; each frame's guide is read, and
 * a reading is taken once two frames in a row give the same valid lines
 * (Steady), with a beep, as a photo of the guide. Take Picture takes the
 * guide as it is, for a card's front, which has no code lines. Only the
 * guide's part of the picture is read or kept; the camera stops when the view
 * goes. Nothing read is ever put into an error.
 */
export function LiveCapture({
  type,
  onRead,
  onPicture,
  onClose,
}: {
  type: DocType
  /** Two frames gave the same lines: the guide's picture and the reading. */
  onRead: (picture: Blob, mrz: Mrz) => void
  /** Take Picture: the guide's picture, to be read as a photo. */
  onPicture: (picture: Blob) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<string>(t.capture.aim(type))
  const [problem, setProblem] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const { guide, band } = guideFor(type)
  // The parent's callbacks change on each render; the camera must not restart with them.
  const onReadRef = useRef(onRead)
  onReadRef.current = onRead
  const busy = useRef(false)

  useEffect(() => {
    const el = video.current
    if (!el) return
    let stream: MediaStream | null = null
    let stop = () => {}
    let alive = true
    const steady = new Steady<Mrz>()
    void Promise.all([startCamera(el), loadReader()]).then(
      ([s, reader]) => {
        if (!alive) return stopCamera(s)
        stream = s
        setReady(true)
        reader.warmUp()
        stop = eachFrame(el, async () => {
          if (!el.videoWidth || busy.current) return
          const crop = guideCrop(el, guide)
          const mrz = await reader.readFrame(canvasOf(el, crop, LIVE_SIDE), todayHere())
          const got = steady.see(mrz ?? null, (m) => m.lines.join('\n'))
          if (!got) return
          steady.reset()
          busy.current = true
          beep()
          setStatus(t.capture.liveRead)
          onReadRef.current(await snapshot(el, crop), got)
          busy.current = false
        })
      },
      (e: unknown) => setProblem(e instanceof DOMException && e.name === 'NotAllowedError' ? t.capture.cameraDenied : t.capture.cameraUnavailable),
    )
    return () => {
      alive = false
      stop()
      stopCamera(stream)
    }
    // Once: the guide follows the document type, which remounts the view (its key).
  }, [])

  const takePicture = async () => {
    const el = video.current
    if (!el?.videoWidth) return
    onPicture(await snapshot(el, guideCrop(el, guide)))
  }

  const pct = (n: number) => `${n * 100}%`
  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full max-w-xl overflow-hidden rounded-lg bg-black" style={{ aspectRatio: String(VIEW_RATIO) }}>
        <video ref={video} className="size-full object-cover" playsInline muted aria-label={t.capture.liveLabel} />
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-md border-2 border-white"
          style={{ left: pct(guide.x), top: pct(guide.y), width: pct(guide.w), height: pct(guide.h) }}
        />
        <div
          aria-hidden
          className={cn('pointer-events-none absolute border-t-2 border-dashed border-white/80 bg-white/10')}
          style={{ left: pct(band.x), top: pct(band.y), width: pct(band.w), height: pct(band.h) }}
        />
      </div>
      <p role="status" aria-live="polite" className={cn('text-sm', problem && 'text-destructive')}>
        {problem ?? status}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void takePicture()} disabled={!ready}>
          <Aperture aria-hidden className="size-4" />
          {t.capture.takePicture}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          <Square aria-hidden className="size-4" />
          {t.capture.stopCamera}
        </Button>
      </div>
    </div>
  )
}

/** The guide's part of the picture as a JPEG, at most a Document Copy's size. */
function snapshot(el: HTMLVideoElement, crop: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const canvas = canvasOf(el, crop, COPY_MAX_SIDE)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be taken'))), 'image/jpeg', 0.9),
  )
}
