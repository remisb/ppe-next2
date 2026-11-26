/**
 * The SIM card's action icons (docs/ux/mockups/sim-action-icons.html): lucide's
 * CardSim, moved left and opened at the bottom right for a badge that says the
 * act, on lucide's 24 grid with its 2px round strokes, so they sit beside the
 * vocabulary's other icons. Equipment keeps the plain icons.
 */
import { type IconNode, createLucideIcon } from 'lucide-react'

/** CardSim at x 2–17, its outline open where the badge (x 13–22, y 13–22) goes, and its chip. */
const card: IconNode = [
  ['path', { d: 'M11 22H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8.172a2 2 0 0 1 1.414.586l2.828 2.828A2 2 0 0 1 17 6.828V11' }],
  ['rect', { x: '5', y: '6', width: '8', height: '8', rx: '2' }],
  ['path', { d: 'M5 10h8' }],
  ['path', { d: 'M9 10v4' }],
]

/** Each shape keyed, as lucide's own icons are: it draws them as one array of children. */
const sim = (name: string, badge: IconNode) =>
  createLucideIcon(
    name,
    [...card, ...badge].map(([tag, attrs], i): IconNode[number] => [tag, { ...attrs, key: `${name}-${i}` }]),
  )

/** Give SIM: the card leaves the office, the mirror of SimReturn. */
export const SimGive = sim('sim-give', [
  ['path', { d: 'M14 18h8' }],
  ['path', { d: 'm19 15 3 3-3 3' }],
])

/** Return: the card comes back. */
export const SimReturn = sim('sim-return', [
  ['path', { d: 'M22 18h-8' }],
  ['path', { d: 'm17 15-3 3 3 3' }],
])

/** Connection status Active: a check. */
export const SimActive = sim('sim-active', [['path', { d: 'm14 18 3 3 5-5' }]])

/** Connection status Blocked: a ban sign. */
export const SimBlocked = sim('sim-blocked', [
  ['circle', { cx: '18', cy: '18', r: '4' }],
  ['path', { d: 'm15.17 15.17 5.66 5.66' }],
])

/** Connection status Not Activated: a clock, waiting for the provider. */
export const SimNotActivated = sim('sim-not-activated', [
  ['circle', { cx: '18', cy: '18', r: '4' }],
  ['path', { d: 'M18 16v2l1.5 1' }],
])

/** Mark as Not Returned: an alert sign. */
export const SimNotReturned = sim('sim-not-returned', [
  ['circle', { cx: '18', cy: '18', r: '4' }],
  ['path', { d: 'M18 16v2' }],
  ['path', { d: 'M18 20h.01' }],
])
