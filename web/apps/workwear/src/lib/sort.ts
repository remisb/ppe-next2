/**
 * Column sorting for the tables. Lists loaded whole sort here; History is
 * paged, so it sends the same SortState to the API instead.
 */
export type SortDir = 'asc' | 'desc'

export interface SortState<K extends string = string> {
  key: K
  dir: SortDir
}

/** What a column sorts by. Empty values (null, undefined, '') always go last. */
export type SortValue = string | number | null | undefined

export interface SortColumn<K extends string = string> {
  key: K
  label: string
  /** The first click's direction: 'desc' for dates, where newest first is the useful start. */
  firstDir?: SortDir
}

/**
 * The state after a click on column key. A new column starts at its first
 * direction, a second click reverses it, and a third returns to the list's
 * natural order (null) when it has one, or starts over otherwise.
 */
export function nextSort<K extends string>(
  cur: SortState<K> | null,
  column: SortColumn<K>,
  allowNone: boolean,
): SortState<K> | null {
  const first = column.firstDir ?? 'asc'
  if (cur?.key !== column.key) return { key: column.key, dir: first }
  if (cur.dir === first) return { key: column.key, dir: first === 'asc' ? 'desc' : 'asc' }
  return allowNone ? null : { key: column.key, dir: first }
}

// Numeric so "W-10" follows "W-9"; base sensitivity so case and accents do not split names.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const isEmpty = (v: SortValue) => v === null || v === undefined || v === ''

export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

/**
 * rows ordered by sort (a new array; null keeps the given order). Stable, so
 * ties keep the natural order, and empty values stay last in both directions.
 */
export function sortRows<T, K extends string>(rows: readonly T[], sort: SortState<K> | null, value: (row: T, key: K) => SortValue): T[] {
  if (!sort) return [...rows]
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows
    .map((row, i) => ({ row, i, v: value(row, sort.key) }))
    .sort((a, b) => {
      const ea = isEmpty(a.v)
      const eb = isEmpty(b.v)
      if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1
      return sign * compareValues(a.v, b.v) || a.i - b.i
    })
    .map((x) => x.row)
}

/** The position of v in a fixed vocabulary (clothing sizes S…3XL), for sorting by size rather than by spelling. */
export function rankIn(order: readonly string[], v: string | null | undefined): number | null {
  if (!v) return null
  const i = order.indexOf(v)
  return i === -1 ? order.length : i
}
