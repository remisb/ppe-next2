/**
 * A record's actions as data (docs/ux/record-actions.md, Option B): what the
 * record's action bar draws and what its ⋯ lists, from one model per record
 * kind, and the pure rules that decide how much of the bar fits.
 */
import {
  Copy,
  FileText,
  KeyRound,
  Link2,
  type LucideIcon,
  Mail,
  Maximize2,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  Signature,
  Trash2,
  Undo2,
} from 'lucide-react'

import type { Help } from '../components/tooltip.tsx'

/**
 * The icon vocabulary: one meaning per icon across the apps. An action may be
 * an icon-only tool only with one of these, so a second meaning for an icon
 * is a new name here, where review sees it.
 */
export const actionIcons = {
  edit: { icon: Pencil },
  print: { icon: Printer },
  /** A confirmation link. */
  link: { icon: Link2 },
  /** Open the document (View Order). */
  document: { icon: FileText },
  /** Mark as signed. Not PenLine: at 16px it reads as Pencil. */
  sign: { icon: Signature, className: 'text-warning' },
  /** Show PIN and PUK. */
  codes: { icon: KeyRound },
  /** Prepare an email. */
  email: { icon: Mail },
  /** WhatsApp, in its green. */
  whatsapp: { icon: MessageCircle, className: 'text-whatsapp' },
  copy: { icon: Copy },
  /** New, Add. */
  add: { icon: Plus },
  /** Take back: Return. */
  return: { icon: Undo2 },
  /** Open the record as a page, the width of the screen (the employee's page from the pane). */
  page: { icon: Maximize2 },
  /** Delete: only ever in ⋯, never a tool. */
  delete: { icon: Trash2 },
} as const satisfies Record<string, { icon: LucideIcon; className?: string }>

export type ActionIcon = keyof typeof actionIcons

/** One action on a record: in its bar (the main action or a tool) or in its ⋯. */
export interface RecordAction {
  /** Stable within the record: a React key, and how tests and the menu tell actions apart. */
  id: string
  /** Full words: the accessible name, the tooltip, the item in ⋯. */
  label: string
  /** Words for the bar when `label` is over the main action's budget: "Create link". */
  short?: string | undefined
  /** From the vocabulary. Without one an action is never icon-only: a tool without an icon is a ⋯ item. */
  icon?: ActionIcon | undefined
  /** Where it starts: the one main action, a tool in the bar, or ⋯ only. */
  place: 'main' | 'tool' | 'menu'
  /** Red in ⋯. */
  destructive?: boolean | undefined
  /** Asks first, or opens a window to fill in: last in ⋯, after a separator. */
  asks?: boolean | undefined
  /** Why it cannot be used now, in its tooltip; the control stays visible, disabled. */
  disabledReason?: string | undefined
  /** Busy: disabled without a reason, while what it started runs. */
  pending?: boolean | undefined
  /** What the main action does, in its tooltip (HelpTooltip), where its words alone are terse: Return. */
  help?: Help | undefined
  /** A disclosure: whether what it shows is open (a chevron, aria-expanded). */
  expanded?: boolean | undefined
  /** The id of what a disclosure shows. */
  controls?: string | undefined
  run: () => void
}

/** The step of the ladder the bar is drawn at (record-actions.md §3 B). */
export type BarStep = 'full' | 'short' | 'icon'

export interface BarMeasure {
  /** The bar's inner width. */
  room: number
  /** The main action's width with its full words, its short words, and as an icon; null without a main action. */
  main: { full: number; short?: number | undefined; icon?: number | undefined } | null
  /** How many tools the record has (all of them, before any cap). */
  tools: number
  /** The most tools shown: 3 beside a list or on a page, 2 on a phone. */
  maxTools: number
  /** Whether ⋯ holds something whatever the tools do (menu-only actions, or a touch screen's names of the tools). */
  menu: boolean
  toolWidth: number
  moreWidth: number
  gap: number
}

export interface BarLayout {
  step: BarStep
  /** How many of the tools are in the bar, the first ones; the rest are in ⋯. */
  tools: number
  /** Whether ⋯ is shown. */
  more: boolean
}

function width(m: BarMeasure, mainWidth: number | null, tools: number, more: boolean): number {
  const items = (mainWidth === null ? 0 : 1) + tools + (more ? 1 : 0)
  return (mainWidth ?? 0) + tools * m.toolWidth + (more ? m.moreWidth : 0) + Math.max(0, items - 1) * m.gap
}

/**
 * The collapse ladder, one step at a time until the bar fits: the main
 * action's full words with every tool (up to the cap); its short words; tools
 * into ⋯, the last first; the main action as its icon alone. Without short
 * words a step is skipped; without an icon the main action keeps its words
 * (and the bar may be too narrow, which the main action's truncating takes).
 */
export function layoutActions(m: BarMeasure): BarLayout {
  const capped = Math.min(m.tools, m.maxTools)
  const more = (tools: number) => m.menu || tools < m.tools
  const fits = (mainWidth: number | null, tools: number) => width(m, mainWidth, tools, more(tools)) <= m.room

  const words: { step: BarStep; width: number | null }[] = m.main
    ? [{ step: 'full', width: m.main.full }, ...(m.main.short === undefined ? [] : [{ step: 'short' as const, width: m.main.short }])]
    : [{ step: 'full', width: null }]
  // Full words, then short words, with every tool the cap allows.
  for (const w of words) if (fits(w.width, capped)) return { step: w.step, tools: capped, more: more(capped) }
  // Fewer tools, with the shortest words there are.
  const shortest = words[words.length - 1]!
  for (let n = capped - 1; n >= 0; n--) if (fits(shortest.width, n)) return { step: shortest.step, tools: n, more: more(n) }
  // The main action as its icon, with as many tools as then fit.
  if (m.main?.icon !== undefined) {
    for (let n = capped; n >= 0; n--) if (fits(m.main.icon, n)) return { step: 'icon', tools: n, more: more(n) }
    return { step: 'icon', tools: 0, more: more(0) }
  }
  return { step: shortest.step, tools: 0, more: more(0) }
}

/**
 * ⋯'s groups, separated in the menu: the tools that are not in the bar (in
 * the bar's order; on a touch screen every tool, so their names are never
 * hover-only), then the menu's own actions, then those that ask first or are
 * destructive. The main action is never in ⋯.
 */
export function menuGroups(actions: readonly RecordAction[], toolsShown: number, coarse: boolean): RecordAction[][] {
  const tools = actions.filter((a) => a.place === 'tool')
  const moved = coarse ? tools : tools.slice(toolsShown)
  const menu = actions.filter((a) => a.place === 'menu')
  const last = (a: RecordAction) => a.asks || a.destructive
  return [moved, menu.filter((a) => !last(a)), menu.filter(last)].filter((g) => g.length > 0)
}

/**
 * A list row's ⋯ (record-actions.md §5, "The action model"): the same model as
 * the record's bar, every action an item. The main action and the tools come
 * first, in the bar's order, then the menu's own actions, then those that ask
 * first or are destructive, each group after a separator. `shown` names the
 * actions the row already shows as buttons (an item's Edit, Give SIM), which
 * ⋯ leaves out rather than offering twice.
 */
export function rowMenuGroups(actions: readonly RecordAction[], shown: readonly string[] = []): RecordAction[][] {
  const sorted = sortActions(actions).filter((a) => !shown.includes(a.id))
  const first = sorted.filter((a) => a.place !== 'menu')
  return [first, ...menuGroups(sorted.filter((a) => a.place === 'menu'), 0, false)].filter((g) => g.length > 0)
}

/**
 * A record's actions in order: the main action first (only one), the tools in
 * the order given. A tool without an icon cannot be icon-only, so it is a
 * ⋯ item; so is any destructive tool.
 */
export function sortActions(actions: readonly RecordAction[]): RecordAction[] {
  const fixed = actions.map((a): RecordAction => (a.place === 'tool' && (!a.icon || a.destructive) ? { ...a, place: 'menu' } : a))
  const main = fixed.filter((a) => a.place === 'main')
  if (main.length > 1) throw new Error(`a record has one main action, not ${main.map((a) => a.id).join(', ')}`)
  return [...main, ...fixed.filter((a) => a.place === 'tool'), ...fixed.filter((a) => a.place === 'menu')]
}
