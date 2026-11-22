import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const camera = vi.hoisted(() => ({
  start: vi.fn<(v: HTMLVideoElement) => Promise<MediaStream>>(),
  stop: vi.fn(),
  frame: null as null | (() => Promise<void>),
  stopFrames: vi.fn(),
}))
vi.mock('./camera.ts', () => ({
  startCamera: camera.start,
  stopCamera: camera.stop,
  eachFrame: (_v: HTMLVideoElement, fn: () => Promise<void>) => {
    camera.frame = fn
    return camera.stopFrames
  },
  guideCrop: (_v: HTMLVideoElement, g: { x: number; y: number; w: number; h: number }) => ({ x: g.x * 100, y: g.y * 100, w: g.w * 100, h: g.h * 100 }),
  torchOf: () => ({ available: false, set: async () => false }),
  beep: () => {},
  buzz: () => {},
}))

const { useLiveCamera } = await import('./live-camera.ts')

type Seen = { crop: { x: number }; now: boolean; readers: string }
let api: ReturnType<typeof useLiveCamera> | undefined
let unmount = () => {}

function mount(onFrame: (s: Seen) => void) {
  function Probe() {
    api = useLiveCamera({
      guide: { x: 0.1, y: 0.2, w: 0.8, h: 0.5 },
      prepare: async () => 'readers',
      onFrame: async ({ crop, now }, readers) => onFrame({ crop, now, readers }),
    })
    return <video ref={api.video} />
  }
  const el = document.body.appendChild(document.createElement('div'))
  const root = createRoot(el)
  act(() => root.render(<Probe />))
  unmount = () => {
    act(() => root.unmount())
    el.remove()
  }
}

const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

afterEach(() => {
  unmount()
  camera.frame = null
  vi.clearAllMocks()
})

describe('useLiveCamera', () => {
  it('reads each frame inside the guide with what prepare loaded, Read Now marking the next frame only, and stops on unmount', async () => {
    const stream = {} as MediaStream
    camera.start.mockResolvedValue(stream)
    const seen: Seen[] = []
    mount((s) => seen.push(s))
    await settle()
    const video = document.querySelector('video')!
    Object.defineProperty(video, 'videoWidth', { value: 640 })
    await act(async () => await camera.frame!())
    act(() => api!.readNow())
    await act(async () => await camera.frame!())
    await act(async () => await camera.frame!())
    expect(seen.map((s) => [s.crop.x, s.now, s.readers])).toEqual([
      [10, false, 'readers'],
      [10, true, 'readers'],
      [10, false, 'readers'],
    ])
    unmount()
    unmount = () => {}
    expect(camera.stopFrames).toHaveBeenCalled()
    expect(camera.stop).toHaveBeenCalledWith(stream)
  })

  it('reads nothing until the video has a picture', async () => {
    camera.start.mockResolvedValue({} as MediaStream)
    const seen: Seen[] = []
    mount((s) => seen.push(s))
    await settle()
    await act(async () => await camera.frame!())
    expect(seen).toEqual([])
  })

  it('says a refused camera is denied, and any other failure failed', async () => {
    camera.start.mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    mount(() => {})
    await settle()
    expect(api!.problem).toBe('denied')
    unmount()
    camera.start.mockRejectedValue(new Error('no camera'))
    mount(() => {})
    await settle()
    expect(api!.problem).toBe('failed')
  })

  it('shows a reading for a moment after signal()', async () => {
    vi.useFakeTimers()
    camera.start.mockResolvedValue({} as MediaStream)
    mount(() => {})
    act(() => api!.signal())
    expect(api!.justRead).toBe(true)
    act(() => vi.advanceTimersByTime(700))
    expect(api!.justRead).toBe(false)
    vi.useRealTimers()
  })
})
