/**
 * The phone's camera for live scanning: the rear camera, a frame at a time,
 * cropped to the guide frame drawn over the picture. Needs a secure context
 * (https, or localhost) and the user's permission.
 */

/** Whether this browser can use a camera at all. */
export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext
}

/** Starts the rear camera in video; stop the returned stream's tracks to end it. */
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  })
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  return stream
}

export function stopCamera(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop())
}

/**
 * The part of the video inside the guide frame, as shown: the frame is
 * `guide` (fractions of the element's box), and the video is drawn covering
 * the element (object-fit: cover), so the crop is mapped through that.
 */
export function guideCrop(video: HTMLVideoElement, guide: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const ew = video.clientWidth || vw
  const eh = video.clientHeight || vh
  const scale = Math.max(ew / vw, eh / vh)
  const shownW = ew / scale
  const shownH = eh / scale
  const offX = (vw - shownW) / 2
  const offY = (vh - shownH) / 2
  return { x: offX + guide.x * shownW, y: offY + guide.y * shownH, w: guide.w * shownW, h: guide.h * shownH }
}

/** Calls fn for each new video frame until the returned stop is called; fn's promise is awaited before the next. */
export function eachFrame(video: HTMLVideoElement, fn: () => Promise<void>): () => void {
  let stopped = false
  const next = () => {
    if (stopped) return
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => void run())
    else setTimeout(() => void run(), 150)
  }
  const run = async () => {
    if (stopped) return
    try {
      await fn()
    } finally {
      next()
    }
  }
  next()
  return () => {
    stopped = true
  }
}

/** A short beep: a reading was taken. */
export function beep(): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 1320
    gain.gain.value = 0.08
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.09)
    osc.onended = () => void ctx.close()
  } catch {
    // No sound is no matter: the screen says it too.
  }
}
