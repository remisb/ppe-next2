/** A round scale at or above max (1, 2, 2.5, 5 × a power of ten); 1 for nothing. */
export function niceCeiling(max: number): number {
  if (!(max > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= max) return step * power
  }
  return 10 * power
}

/** A bar's length as a percentage of the scale; a non-zero value always shows at least a sliver. */
export function barPercent(value: number, scale: number): number {
  if (value <= 0 || scale <= 0) return 0
  return Math.max(2, Math.min(100, (value / scale) * 100))
}

/**
 * A heat cell's strength, 0 (none) to 4, against the largest value: four
 * steps the eye tells apart, any non-zero value at least 1.
 */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0
  return Math.max(1, Math.min(4, Math.ceil((value / max) * 4))) as 1 | 2 | 3 | 4
}

/** The points of a sparkline in a width × height box, oldest first; a flat line for one value or none. */
export function sparkPoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const step = values.length > 1 ? width / (values.length - 1) : 0
  return values
    .map((v, i) => {
      const y = max === min ? height / 2 : height - ((v - min) / span) * height
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
