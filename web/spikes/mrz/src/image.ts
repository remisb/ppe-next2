/**
 * The image half of reading an MRZ (docs-import plan §5.2, steps 2–3), in
 * plain TypeScript on pixels, no OpenCV: grey scale, Sauvola's adaptive
 * threshold, the skew from projection profiles, the MRZ band (the bottom-most
 * group of 2 or 3 evenly spaced, equally long text rows), and the band cut
 * out straightened at a fixed character height and thresholded for the OCR.
 * Runs in image.worker.ts; no DOM. Moves to @ppe/scan-kit's image module
 * when docs-import is built (plan §6).
 */

/** An RGBA picture, as ImageData holds it. */
export interface Rgba {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** A grey picture: one byte a pixel, 0 black. */
export interface Grey {
  width: number
  height: number
  data: Uint8Array
}

export function greyOf(img: Rgba): Grey {
  const n = img.width * img.height
  const data = new Uint8Array(n)
  const s = img.data
  for (let i = 0, j = 0; i < n; i++, j += 4) data[i] = (s[j]! * 77 + s[j + 1]! * 150 + s[j + 2]! * 29) >> 8
  return { width: img.width, height: img.height, data }
}

/** g scaled by factor (< 1: each output pixel the mean of the box it covers). */
export function scaled(g: Grey, factor: number): Grey {
  const width = Math.max(1, Math.round(g.width * factor))
  const height = Math.max(1, Math.round(g.height * factor))
  const data = new Uint8Array(width * height)
  const fx = g.width / width
  const fy = g.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let sum = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += g.data[yy * g.width + xx]!
      data[y * width + x] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return { width, height, data }
}

/**
 * Sauvola's threshold: a pixel is ink when it is darker than
 * m · (1 + k · (s / R − 1)), m and s the mean and deviation of the window
 * around it. A local threshold keeps OCR-B's strokes and drops a guilloche's
 * light lines, which a single threshold for the page cannot (plan §5.2).
 * Returns 1 for ink, 0 for paper.
 */
export function sauvola(g: Grey, window: number, k = 0.3, R = 128): Uint8Array {
  const { width: w, height: h, data } = g
  const W = w + 1
  const sum = new Float64Array(W * (h + 1))
  const sq = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let rs = 0
    let rq = 0
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x]!
      rs += v
      rq += v * v
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1]! + rs
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1]! + rq
    }
  }
  const r = Math.max(1, window >> 1)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const n = (y1 - y0) * (x1 - x0)
      const s = sum[y1 * W + x1]! - sum[y0 * W + x1]! - sum[y1 * W + x0]! + sum[y0 * W + x0]!
      const q = sq[y1 * W + x1]! - sq[y0 * W + x1]! - sq[y1 * W + x0]! + sq[y0 * W + x0]!
      const m = s / n
      const sd = Math.sqrt(Math.max(0, q / n - m * m))
      out[y * w + x] = data[y * w + x]! < m * (1 + k * (sd / R - 1)) ? 1 : 0
    }
  }
  return out
}

/**
 * The skew of the text in a thresholded picture, in degrees within ±range:
 * the angle whose rows, turned by it, gather the ink into the sharpest
 * profile (the largest sum of squared row counts).
 */
export function skewAngle(ink: Uint8Array, w: number, h: number, range = 12): number {
  const xs: number[] = []
  const ys: number[] = []
  // A sample of the ink is enough, and keeps this quick on a busy page.
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 400_000)))
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (ink[y * w + x]) (xs.push(x), ys.push(y))
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180
    const sin = Math.sin(a)
    const cos = Math.cos(a)
    const off = w * Math.abs(sin) + 1
    const bins = new Float64Array(Math.ceil(h + 2 * off) + 2)
    for (let i = 0; i < xs.length; i++) bins[Math.round(ys[i]! * cos - xs[i]! * sin + off)]! += 1
    let s = 0
    for (const b of bins) s += b * b
    return s
  }
  let best = 0
  let bestScore = -1
  for (let d = -range; d <= range; d += 0.5) {
    const s = score(d)
    if (s > bestScore) (bestScore = s), (best = d)
  }
  const coarse = best
  for (let d = coarse - 0.5; d <= coarse + 0.5; d += 0.1) {
    const s = score(d)
    if (s > bestScore) (bestScore = s), (best = d)
  }
  return Math.round(best * 10) / 10
}

/**
 * Samples a turned rectangle of g: the output's pixel (u, v) is the source's
 * point centre + R(angle) · ((u − outW/2) / scale, (v − outH/2) / scale),
 * read bilinearly; outside the source is white.
 */
export function sampleRect(g: Grey, cx: number, cy: number, angleDeg: number, outW: number, outH: number, scale: number): Grey {
  const a = (angleDeg * Math.PI) / 180
  const cos = Math.cos(a) / scale
  const sin = Math.sin(a) / scale
  const data = new Uint8Array(outW * outH)
  const { width: w, height: h } = g
  for (let v = 0; v < outH; v++) {
    const dv = v - outH / 2
    for (let u = 0; u < outW; u++) {
      const du = u - outW / 2
      const x = cx + du * cos - dv * sin
      const y = cy + du * sin + dv * cos
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) {
        data[v * outW + u] = 255
        continue
      }
      const fx = x - x0
      const fy = y - y0
      const i = y0 * w + x0
      const top = g.data[i]! * (1 - fx) + g.data[i + 1]! * fx
      const bottom = g.data[i + w]! * (1 - fx) + g.data[i + w + 1]! * fx
      data[v * outW + u] = top * (1 - fy) + bottom * fy
    }
  }
  return { width: outW, height: outH, data }
}

/** A row of text found in a straightened, thresholded picture. */
export interface Band {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * The rows of text: runs of rows with many ink transitions (text crosses
 * from paper to ink twice or more a character), each with the longest run of
 * columns holding ink without a gap wider than a few characters.
 */
export function textBands(ink: Uint8Array, w: number, h: number): Band[] {
  const trans = new Float64Array(h)
  for (let y = 0; y < h; y++) {
    let t = 0
    for (let x = 1; x < w; x++) if (ink[y * w + x] && !ink[y * w + x - 1]) t++
    trans[y] = t
  }
  const smooth = trans.map((_, y) => (trans[Math.max(0, y - 1)]! + trans[y]! + trans[Math.min(h - 1, y + 1)]!) / 3)
  let max = 0
  for (const t of smooth) max = Math.max(max, t)
  const threshold = Math.max(6, max * 0.22)
  const bands: Band[] = []
  let y = 0
  while (y < h) {
    if (smooth[y]! < threshold) {
      y++
      continue
    }
    const top = y
    while (y < h && smooth[y]! >= threshold) y++
    const bottom = y
    if (bottom - top < 3) continue
    // Columns with ink in the band; the longest stretch with gaps under three line heights.
    const gap = (bottom - top) * 3
    let bestL = 0
    let bestR = -1
    let l = -1
    let last = -1
    for (let x = 0; x < w; x++) {
      let inkHere = false
      for (let yy = top; yy < bottom && !inkHere; yy++) inkHere = ink[yy * w + x] === 1
      if (!inkHere) continue
      if (l === -1 || x - last > gap) l = x
      last = x
      if (last - l > bestR - bestL) (bestL = l), (bestR = last)
    }
    if (bestR > bestL) bands.push({ top, bottom, left: bestL, right: bestR + 1 })
  }
  return bands
}

/** Where the MRZ is: its rows, in the straightened picture they were found in. */
export interface MrzBand {
  lines: 2 | 3
  /** The format the rows' length suggests, from the characters' pitch. */
  format: 'TD1' | 'TD2' | 'TD3'
  rows: Band[]
}

/**
 * The MRZ among the rows: the bottom-most group of 2 or 3 rows of the same
 * height and length, evenly spaced, about as many characters long as an MRZ
 * line (an OCR-B character is about as wide as it is tall, at the ICAO
 * pitch of 2.54 mm).
 */
export function mrzBand(bands: Band[]): MrzBand | undefined {
  const len = (b: Band) => b.right - b.left
  const ht = (b: Band) => b.bottom - b.top
  for (let i = bands.length - 1; i >= 0; i--) {
    for (const n of [3, 2] as const) {
      const rows = bands.slice(i - n + 1, i + 1)
      if (rows.length !== n) continue
      const hs = rows.map(ht)
      const ls = rows.map(len)
      const h = hs.reduce((a, b) => a + b, 0) / n
      if (Math.max(...hs) / Math.min(...hs) > 1.7) continue
      if (Math.max(...ls) / Math.min(...ls) > 1.15) continue
      const gaps = rows.slice(1).map((r, k) => (r.top + r.bottom) / 2 - (rows[k]!.top + rows[k]!.bottom) / 2)
      if (gaps.some((g) => g < h * 1.1 || g > h * 3.2)) continue
      if (n === 3 && Math.max(...gaps) / Math.min(...gaps) > 1.3) continue
      const chars = (ls.reduce((a, b) => a + b, 0) / n) / (h * 1.0)
      // Two rows of a TD1's length are its last two, the first lost (run into the print above it):
      // the band takes one more row's place above them, for the OCR to read all three.
      const lostFirst = n === 2 && chars < 33
      const format = n === 3 || lostFirst ? 'TD1' : chars > 39 ? 'TD3' : 'TD2'
      const expected = format === 'TD1' ? 30 : format === 'TD2' ? 36 : 44
      if (chars < expected * 0.6 || chars > expected * 1.6) continue
      if (lostFirst) {
        const g = gaps[0]!
        const r0 = rows[0]!
        return { lines: 3, format, rows: [{ ...r0, top: Math.round(r0.top - g), bottom: Math.round(r0.bottom - g) }, ...rows] }
      }
      return { lines: n, format, rows }
    }
  }
  return undefined
}

export interface FoundMrz {
  /** The band cut out, straightened, about CHAR_HEIGHT pixels a character, thresholded: black ink on white. */
  image: Grey
  /** Where in the source: the band's centre, its turn in degrees, and its size in source pixels. */
  centre: { x: number; y: number }
  angle: number
  size: { width: number; height: number }
  format: MrzBand['format']
  /** Milliseconds each step took. */
  times: Record<string, number>
}

/** The height a character is cut out at: Tesseract's LSTM models read best at 30–40 pixels. */
export const CHAR_HEIGHT = 32
/** The width the page is searched at: enough for a character to be ~8 px tall on a page that fills a fifth of it. */
const WORK_WIDTH = 1000

export interface FindOptions {
  /** A clock (performance.now) for the step times. */
  now?: () => number
  /** Sauvola's k for the cut-out band. */
  k?: number
}

/** Finds the MRZ in a picture and cuts it out for the OCR, or undefined when there is none. */
export function findMrz(img: Rgba, options: FindOptions = {}): FoundMrz | undefined {
  const now = options.now ?? (() => 0)
  const times: Record<string, number> = {}
  let t = now()
  const lap = (name: string) => {
    const n = now()
    times[name] = n - t
    t = n
  }
  const grey = greyOf(img)
  const f = Math.min(1, WORK_WIDTH / Math.max(grey.width, grey.height))
  const work = f < 1 ? scaled(grey, f) : grey
  lap('grey')
  const ink = sauvola(work, 31, 0.3)
  lap('threshold')
  const angle = skewAngle(ink, work.width, work.height)
  lap('skew')
  // Straighten the search picture (its ink, turned about its centre) and find the rows.
  const cx = work.width / 2
  const cy = work.height / 2
  const turned = angle === 0 ? ink : turnInk(ink, work.width, work.height, angle)
  const band = mrzBand(textBands(turned, work.width, work.height))
  lap('band')
  if (!band) return undefined
  const first = band.rows[0]!
  const last = band.rows[band.rows.length - 1]!
  const lineHeight = band.rows.reduce((s, r) => s + r.bottom - r.top, 0) / band.rows.length
  // Margins of a little under a character: Tesseract needs some paper round the text, and more
  // takes in the document's edge or print beside it, read as a stray character.
  const left = Math.min(...band.rows.map((r) => r.left)) - lineHeight * 0.8
  const right = Math.max(...band.rows.map((r) => r.right)) + lineHeight * 0.8
  const top = first.top - lineHeight * 0.8
  const bottom = last.bottom + lineHeight * 0.8
  // The band's centre, back in the source picture's pixels.
  const a = (angle * Math.PI) / 180
  const dx = (left + right) / 2 - cx
  const dy = (top + bottom) / 2 - cy
  const sx = (cx + dx * Math.cos(a) - dy * Math.sin(a)) / f
  const sy = (cy + dx * Math.sin(a) + dy * Math.cos(a)) / f
  const width = (right - left) / f
  const height = (bottom - top) / f
  // Rows found by ink transitions are about a capital's height.
  const scale = CHAR_HEIGHT / (lineHeight / f)
  const outW = Math.round(width * scale)
  const outH = Math.round(height * scale)
  const cut = sampleRect(grey, sx, sy, angle, outW, outH, scale)
  const binary = sauvola(cut, CHAR_HEIGHT * 2 + 1, options.k ?? 0.25)
  const data = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) data[i] = binary[i] ? 0 : 255
  lap('cut')
  return { image: { width: outW, height: outH, data }, centre: { x: sx, y: sy }, angle, size: { width, height }, format: band.format, times }
}

/** Ink turned by angle about the picture's centre (nearest pixel): the straightened picture. */
function turnInk(ink: Uint8Array, w: number, h: number, angleDeg: number): Uint8Array {
  const a = (angleDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const out = new Uint8Array(w * h)
  const cx = w / 2
  const cy = h / 2
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const x = Math.round(cx + (u - cx) * cos - (v - cy) * sin)
      const y = Math.round(cy + (u - cx) * sin + (v - cy) * cos)
      if (x >= 0 && y >= 0 && x < w && y < h) out[v * w + u] = ink[y * w + x]!
    }
  }
  return out
}

/** A grey picture as RGBA, for a canvas or for Tesseract. */
export function rgbaOf(g: Grey): Rgba {
  const data = new Uint8ClampedArray(g.width * g.height * 4)
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) {
    data[j] = data[j + 1] = data[j + 2] = g.data[i]!
    data[j + 3] = 255
  }
  return { width: g.width, height: g.height, data }
}
