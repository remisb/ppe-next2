/**
 * The review list's state, as a pure reducer: the cards, the ones the API
 * found in the register (by SIM No., registeredOf), the notice when a batch
 * would hold more than MAX_CARDS, and the pictures a change let go of. The
 * pictures themselves are the PictureStore's (blob URLs must be revoked, which
 * a reducer may not do): every action that drops a card puts its pictures in
 * `released`, and the screen forgets them and says so (`released` again).
 */
import type { ScannedSimInput, SimProblem } from '@ppe/api-client'
import { MAX_CARDS, type ScanCard, registeredMarks, registeredOf, rowMarks, type RowMark } from '@ppe/sim-scan'

export interface ScanList {
  cards: ScanCard[]
  /** The cards the API found in the register: SIM key → the register's id. */
  registered: ReadonlyMap<string, string | undefined>
  /** Said once a batch would have held more than MAX_CARDS; cleared by the next card or Clear List. */
  notice: 'too_many' | null
  /** Picture ids no card shows any more, for the screen to forget. */
  released: string[]
}

export type ScanListAction =
  /** Cards read, in order: as many as there is room for are kept; `more` says photos were left unread too. */
  | { type: 'add'; cards: readonly ScanCard[]; more?: boolean }
  | { type: 'remove'; index: number }
  | { type: 'clear' }
  /** The API's check of `sent`, the cards as they were sent. */
  | { type: 'checked'; sent: readonly ScannedSimInput[]; problems: readonly SimProblem[] }
  /** No check applies (an empty list, no provider) or it failed: no card is marked as registered. */
  | { type: 'unchecked' }
  | { type: 'too_many' }
  | { type: 'released'; ids: readonly string[] }

export const emptyScanList: ScanList = { cards: [], registered: new Map(), notice: null, released: [] }

const picturesOf = (cards: readonly ScanCard[]) => cards.flatMap((c) => [c.front, c.back]).filter((id): id is string => id !== undefined)

export function scanList(state: ScanList, action: ScanListAction): ScanList {
  switch (action.type) {
    case 'add': {
      const room = Math.max(0, MAX_CARDS - state.cards.length)
      const kept = action.cards.slice(0, room)
      const dropped = action.cards.slice(room)
      const tooMany = dropped.length > 0 || action.more === true
      return {
        ...state,
        cards: kept.length > 0 ? [...state.cards, ...kept] : state.cards,
        notice: tooMany ? 'too_many' : action.cards.length > 0 ? null : state.notice,
        released: dropped.length > 0 ? [...state.released, ...picturesOf(dropped)] : state.released,
      }
    }
    case 'remove': {
      const card = state.cards[action.index]
      if (!card) return state
      return {
        ...state,
        cards: state.cards.filter((_, i) => i !== action.index),
        released: [...state.released, ...picturesOf([card])],
      }
    }
    case 'clear':
      return { cards: [], registered: new Map(), notice: null, released: [...state.released, ...picturesOf(state.cards)] }
    case 'checked':
      return { ...state, registered: registeredOf(action.sent, action.problems) }
    case 'unchecked':
      return state.registered.size === 0 ? state : { ...state, registered: new Map() }
    case 'too_many':
      return { ...state, notice: 'too_many' }
    case 'released': {
      const gone = new Set(action.ids)
      return { ...state, released: state.released.filter((id) => !gone.has(id)) }
    }
  }
}

/** Each row's marks: the list's own and, by SIM No., the API's registered cards. */
export function marksOf(state: Pick<ScanList, 'cards' | 'registered'>): RowMark[][] {
  return rowMarks(state.cards, registeredMarks(state.cards, state.registered))
}

let nextKey = 0
/** A key for a card or a picture, unique in this page. */
export const newKey = () => `p${++nextKey}`
