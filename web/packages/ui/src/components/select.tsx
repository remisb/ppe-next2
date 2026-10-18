import { CSPProvider } from '@base-ui/react/csp-provider'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { type ReactNode, createContext, use, useState } from 'react'

import { cn } from '../lib/utils.ts'

/*
 * The shadcn registry's Select, on Base UI's Select: a list of our own in
 * place of the platform's, with keyboard, typeahead and focus from Base UI.
 * Set to look like the Orders Date filter (period-filter.tsx), so the two read
 * as one kind of control: the trigger is a field (`CONTROL` in field.tsx); the
 * list opens over it, as wide and in its place, never flipped above, its head
 * the field's row with the arrow turned up (choosing it closes), the choice
 * ticked on the left. The native `Select` in field.tsx stays for forms.
 * Base UI's own <style> element would break the Content-Security-Policy, so
 * CSPProvider turns it off and styles.css carries its one rule.
 */

/** Lets the list's head row close the list it heads. */
const CloseContext = createContext<() => void>(() => {})

function Select<Value>({ open: openProp, onOpenChange, ...props }: SelectPrimitive.Root.Props<Value>) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen: NonNullable<SelectPrimitive.Root.Props<Value>['onOpenChange']> = (next, details) => {
    setOpenState(next)
    onOpenChange?.(next, details)
  }
  return (
    <CSPProvider disableStyleElements>
      <CloseContext value={() => setOpenState(false)}>
        <SelectPrimitive.Root data-slot="select" open={open} onOpenChange={setOpen} {...props} />
      </CloseContext>
    </CSPProvider>
  )
}

function SelectLabel({ className, ...props }: SelectPrimitive.Label.Props) {
  return <SelectPrimitive.Label data-slot="select-label" className={cn('text-sm font-medium', className)} {...props} />
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" className={cn('min-w-0 flex-1 truncate text-left', className)} {...props} />
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-base outline-none select-none md:text-sm',
        'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="flex shrink-0">
        <ChevronDown aria-hidden className="pointer-events-none size-4 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

/** head: what the head row shows, when it says more than the choice (a phone's "Sort by: Date, newest first"). */
function SelectContent({ className, children, head, ...props }: SelectPrimitive.Popup.Props & { head?: ReactNode }) {
  const close = use(CloseContext)
  return (
    <SelectPrimitive.Portal>
      {/* Over the trigger, as the Date filter's panel: its top on the trigger's, never flipped above it. */}
      <SelectPrimitive.Positioner
        alignItemWithTrigger={false}
        side="bottom"
        align="start"
        sideOffset={({ anchor }) => -anchor.height}
        collisionAvoidance={{ side: 'none', align: 'none' }}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'relative isolate z-50 flex max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) flex-col overflow-hidden rounded-md border border-input bg-popover text-popover-foreground shadow-lg outline-none',
            className,
          )}
          {...props}
        >
          {/* The field's row, its choice and its arrow turned up; choosing it closes, as the Date filter's head does. */}
          <div
            aria-hidden
            onClick={close}
            className="flex h-11 shrink-0 cursor-pointer items-center justify-between gap-2 border-b border-border px-3 text-base md:text-sm"
          >
            <span className="min-w-0 flex-1 truncate">{head ?? <SelectPrimitive.Value />}</span>
            <ChevronUp className="size-4 shrink-0 opacity-60" />
          </div>
          <SelectPrimitive.List className="overflow-y-auto p-1">{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex min-h-9 w-full cursor-pointer items-center rounded-md py-1.5 pr-2 pl-8 text-base outline-none select-none pointer-coarse:min-h-11 md:text-sm',
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
        <Check aria-hidden className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue }
