import {
  createDrawerController,
  Drawer as Root,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerTitle,
  type DrawerController,
  type SnapPoint,
} from '@ui-sdk/react/drawer'
import type { ReactNode } from 'react'

import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'

/*
 * ui-sdk's Drawer (docs: packages/ui/node_modules/@ui-sdk/react/docs/components/drawer.md),
 * drawn in the apps' look: a bottom sheet a finger drags, rests on snap points and swipes
 * away, as a phone's own sheets do. FormSheet stays the sheet for a form that becomes a
 * dialog from md:; this one is for phone-first screens (Scan Documents).
 */

const backdrop = 'bg-black/40'
const sheet = cn(
  'flex max-h-[calc(100dvh-3rem)] w-full flex-col rounded-t-2xl bg-background text-foreground shadow-2xl outline-none',
  'pb-[env(safe-area-inset-bottom)] md:mx-auto md:max-w-lg',
  // Covers the gap under the sheet while it is pulled past its top point.
  'after:absolute after:inset-x-0 after:top-full after:h-[50vh] after:bg-background',
)

function Grip({ snapPoints }: { snapPoints: readonly SnapPoint[] | undefined }) {
  // A handle that does nothing is a button that lies; one resting point gets a plain bar.
  return snapPoints && snapPoints.length > 1 ? (
    <DrawerHandle aria-label={uiText().resizeSheet} className="mx-auto mt-2 flex h-6 w-16 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
    </DrawerHandle>
  ) : (
    <div aria-hidden className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40" />
  )
}

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Shown to screen readers only, for a sheet whose content says what it is (a photo's details). */
  hideTitle?: boolean
  /** Where it may rest: fractions of the screen, pixels, or 'content' (its own height, the default). */
  snapPoints?: SnapPoint[]
  defaultSnapPoint?: SnapPoint
  /** Kept at the bottom, outside the scrolling body: the sheet's main action. */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

export function Drawer({ open, onOpenChange, title, description, hideTitle = false, snapPoints, defaultSnapPoint, footer, children, className }: DrawerProps) {
  return (
    <Root
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      {...(snapPoints ? { snapPoints } : {})}
      {...(defaultSnapPoint !== undefined ? { defaultSnapPoint } : {})}
    >
      <DrawerBackdrop className={backdrop} />
      <DrawerContent className={cn(sheet, className)}>
        <Grip snapPoints={snapPoints} />
        <div className={cn('flex flex-col gap-1 px-4 pt-2 pb-3', hideTitle && 'sr-only')}>
          <DrawerTitle className="text-lg font-semibold">{title}</DrawerTitle>
          {description ? <DrawerDescription className="text-sm text-muted-foreground">{description}</DrawerDescription> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer ? <div className="flex flex-col gap-2 border-t border-border px-4 pt-3 pb-4">{footer}</div> : null}
      </DrawerContent>
    </Root>
  )
}

/** One choice on an action sheet; `destructive` draws it red (Delete Scan). */
export interface SheetAction<V extends string> {
  value: V
  label: string
  destructive?: boolean
}

/**
 * The handle an action sheet is opened through: `const { returnValue } = await sheet.open()`
 * gives the chosen action's value, or undefined when it was cancelled, swiped away or
 * dismissed with Escape.
 */
export type ActionSheetHandle<V extends string> = DrawerController<undefined, V>

export function createActionSheet<V extends string>(): ActionSheetHandle<V> {
  return createDrawerController<undefined, V>()
}

const choice = 'flex min-h-14 w-full items-center justify-center px-4 text-lg outline-none focus-visible:bg-muted data-pending:opacity-60'

/**
 * A phone's action sheet: a title, a few choices, and Cancel apart from them. The least
 * risky choice comes first, because a keyboard opens the sheet on the first one.
 */
export function ActionSheet<V extends string>({ sheet, title, description, actions }: {
  sheet: ActionSheetHandle<V>
  title: string
  description?: string
  actions: readonly SheetAction<V>[]
}) {
  return (
    <Root controller={sheet}>
      <DrawerBackdrop className={backdrop} />
      <DrawerContent className="flex w-full flex-col gap-2 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] outline-none md:mx-auto md:max-w-md">
        <div className="overflow-hidden rounded-2xl bg-background/95 backdrop-blur-xl">
          <div className="flex flex-col gap-0.5 border-b border-border px-4 py-3 text-center">
            <DrawerTitle className="text-sm font-semibold">{title}</DrawerTitle>
            {description ? <DrawerDescription className="text-sm text-muted-foreground">{description}</DrawerDescription> : null}
          </div>
          <div className="flex flex-col divide-y divide-border">
            {actions.map((a) => (
              <DrawerClose key={a.value} value={a.value} className={cn(choice, a.destructive ? 'text-destructive' : 'text-primary')}>
                {a.label}
              </DrawerClose>
            ))}
          </div>
        </div>
        <DrawerClose className={cn(choice, 'rounded-2xl bg-background font-semibold text-primary')}>{uiText().cancel}</DrawerClose>
      </DrawerContent>
    </Root>
  )
}
