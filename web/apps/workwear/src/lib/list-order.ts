/*
 * Moving one id within an ordered list of ids: a dragged row (useRowDrag), and
 * an item in the Item Catalogue's display order. Pure, so screens only wire
 * events to it.
 */

/** ids with the one at from put at to. */
export function moveTo(ids: readonly string[], from: number, to: number): string[] {
  const out = [...ids]
  const [id] = out.splice(from, 1)
  if (id !== undefined) out.splice(to, 0, id)
  return out
}

/** all with id put in front of before, or last when before is null. */
export function placeBefore(all: readonly string[], id: string, before: string | null): string[] {
  const rest = all.filter((x) => x !== id)
  const at = before === null ? rest.length : rest.indexOf(before)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/** Whether two orders hold the same ids in the same places. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, n) => id === b[n])
}

/**
 * Where an item dropped in a list that may show only some of the catalogue (a
 * status tab) goes in the whole of it: in front of the item now after it in the
 * list as shown, or, dropped last, in front of the item that follows the one
 * now above it. null is last of all. all is every item in display order.
 */
export function moveBefore(all: readonly string[], shown: readonly string[], moved: string): string | null {
  const at = shown.indexOf(moved)
  const next = shown[at + 1]
  if (next !== undefined) return next
  const above = shown[at - 1]
  if (above === undefined) return null
  const rest = all.filter((id) => id !== moved)
  return rest[rest.indexOf(above) + 1] ?? null
}
