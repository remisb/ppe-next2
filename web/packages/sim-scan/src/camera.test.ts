import { describe, expect, it } from 'vitest'

import { guideCrop } from './camera.ts'

/** A video element as guideCrop reads it: the stream's size and the element's box. */
const video = (videoWidth: number, videoHeight: number, clientWidth: number, clientHeight: number) =>
  ({ videoWidth, videoHeight, clientWidth, clientHeight }) as HTMLVideoElement

const whole = { x: 0, y: 0, w: 1, h: 1 }

describe('guideCrop', () => {
  it('maps the frame straight through when the box has the video’s shape', () => {
    expect(guideCrop(video(1920, 1080, 640, 360), { x: 0.25, y: 0.5, w: 0.5, h: 0.25 })).toEqual({ x: 480, y: 540, w: 960, h: 270 })
  })

  it('crops the sides a wider video loses to object-fit: cover in a 4:3 box', () => {
    // 1920×1080 covering 800×600: scale 600/1080, so 1440 of the 1920 columns are shown, 240 cut from each side.
    const c = guideCrop(video(1920, 1080, 800, 600), whole)
    expect(c.x).toBeCloseTo(240)
    expect(c.y).toBeCloseTo(0)
    expect(c.w).toBeCloseTo(1440)
    expect(c.h).toBeCloseTo(1080)
  })

  it('crops the top and bottom a portrait video loses in a landscape box', () => {
    // A phone's 1080×1920 covering 400×300: 1080 columns, 810 rows shown, 555 cut above and below.
    const c = guideCrop(video(1080, 1920, 400, 300), { x: 0.06, y: 0.22, w: 0.88, h: 0.56 })
    expect(c.x).toBeCloseTo(0.06 * 1080)
    expect(c.y).toBeCloseTo(555 + 0.22 * 810)
    expect(c.w).toBeCloseTo(0.88 * 1080)
    expect(c.h).toBeCloseTo(0.56 * 810)
  })

  it('takes the whole video while the element has no box yet', () => {
    expect(guideCrop(video(1280, 720, 0, 0), whole)).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
  })
})
