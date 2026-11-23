import type { ShareDays } from './types.ts'

/** The days a shared link may stay open, from the shortest (share.Durations in Go). */
export const SHARE_DAYS: readonly ShareDays[] = [1, 7, 30]

/** The most rows a shared link, or Copy as Text, may hold (share.MaxRows in Go). */
export const SHARE_MAX_ROWS = 10
