/**
 * Which way up a photo is (docs-import's Scan Document): it is read as it
 * is first, then upside down, then on each side, and the first turn whose MRZ
 * reads valid wins; failing that, the first turn where a band was found at
 * all, for the user to put right. Pure, so its order is tested.
 */

/** Degrees clockwise the photo is turned before it is read. */
export type Turn = 0 | 90 | 180 | 270

/** The order turns are tried in: as taken, then upside down (a page held the wrong way), then sideways. */
export const TURNS: readonly Turn[] = [0, 180, 90, 270]

export async function firstTurn<T>(
  attempt: (turn: Turn) => Promise<T>,
  good: (r: T) => boolean,
  usable: (r: T) => boolean,
): Promise<{ turn: Turn; result: T } | undefined> {
  let fallback: { turn: Turn; result: T } | undefined
  for (const turn of TURNS) {
    const result = await attempt(turn)
    if (good(result)) return { turn, result }
    if (!fallback && usable(result)) fallback = { turn, result }
  }
  return fallback
}

/** A canvas holding source turned clockwise by turn. */
export function turnedCanvas(source: HTMLCanvasElement, turn: Turn): HTMLCanvasElement {
  if (turn === 0) return source
  const c = document.createElement('canvas')
  const sideways = turn === 90 || turn === 270
  c.width = sideways ? source.height : source.width
  c.height = sideways ? source.width : source.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((turn * Math.PI) / 180)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return c
}
