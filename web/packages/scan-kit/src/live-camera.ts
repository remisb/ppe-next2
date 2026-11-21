import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { beep, buzz, eachFrame, guideCrop, startCamera, stopCamera, torchOf, type Torch } from './camera.ts'

/** The guide frame over the camera picture, as fractions of the video element's box. */
export interface Guide {
  x: number
  y: number
  w: number
  h: number
}

/** One frame to read: the video, the guide's part of it in the video's pixels, and whether Read Now asked for it. */
export interface LiveFrame {
  video: HTMLVideoElement
  crop: { x: number; y: number; w: number; h: number }
  /** Read Now: take this frame's reading as it is, without waiting for a second one. Once. */
  now: boolean
}

export interface LiveCamera {
  /** The video element the camera shows in. */
  video: RefObject<HTMLVideoElement | null>
  /** Why the camera could not start: not allowed (a setting the user can change), or anything else. */
  problem: 'denied' | 'failed' | null
  /** Something was read a moment ago: the guide shows it. */
  justRead: boolean
  /** Says a reading was taken: a beep, a buzz and `justRead` for a moment. */
  signal: () => void
  /** The next frame is read as it is (LiveFrame.now). */
  readNow: () => void
  torch: { available: boolean; on: boolean; toggle: () => void }
}

/**
 * A phone's camera, frame by frame, for a screen that reads something in it: the camera
 * started (with whatever the reader must load first, `prepare`, in parallel) and stopped
 * with the hook, the torch, Read Now, and the moment's flash after a reading. `guide` is
 * the frame's place in the video's box, fixed or worked out from the box's size. What is
 * read, and what it means, is the caller's (`onFrame`); taken from Scan SIMs' live scan.
 */
export function useLiveCamera<R>({
  guide,
  prepare,
  onFrame,
}: {
  guide: Guide | ((width: number, height: number) => Guide)
  prepare: () => Promise<R>
  onFrame: (frame: LiveFrame, readers: R) => Promise<void>
}): LiveCamera {
  const video = useRef<HTMLVideoElement>(null)
  const [problem, setProblem] = useState<'denied' | 'failed' | null>(null)
  const [justRead, setJustRead] = useState(false)
  const [torch, setTorch] = useState<{ control: Torch; on: boolean }>({ control: torchOf(null), on: false })
  // The caller's callbacks and guide change on each render; the camera must not restart with them.
  const guideRef = useRef(guide)
  guideRef.current = guide
  const prepareRef = useRef(prepare)
  prepareRef.current = prepare
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const nowRef = useRef(false)
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const signal = useCallback(() => {
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
    let alive = true
    void Promise.all([startCamera(el), prepareRef.current()]).then(
      ([s, readers]) => {
        if (!alive) return stopCamera(s)
        stream = s
        setTorch({ control: torchOf(s), on: false })
        stop = eachFrame(el, async () => {
          if (!el.videoWidth) return
          const g = guideRef.current
          const frame = typeof g === 'function' ? g(el.clientWidth || el.videoWidth, el.clientHeight || el.videoHeight) : g
          const now = nowRef.current
          nowRef.current = false
          await onFrameRef.current({ video: el, crop: guideCrop(el, frame), now }, readers)
        })
      },
      (e: unknown) => {
        setProblem(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'failed')
      },
    )
    return () => {
      alive = false
      stop()
      stopCamera(stream)
      clearTimeout(readTimer.current)
    }
  }, [])

  return {
    video,
    problem,
    justRead,
    signal,
    readNow: () => {
      nowRef.current = true
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
