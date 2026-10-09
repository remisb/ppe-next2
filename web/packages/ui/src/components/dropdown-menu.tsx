import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../lib/utils.ts'

/**
 * A menu of actions opened from a button, on Base UI's Menu: keyboard
 * navigation, typeahead, focus return and dismissal come with it. The shadcn
 * registry's DropdownMenu, trimmed to the parts this app uses.
 */
function DropdownMenu(props: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: ComponentProps<typeof MenuPrimitive.Trigger>) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  align = 'end',
  side = 'bottom',
  sideOffset = 4,
  onClick,
  ...props
}: ComponentProps<typeof MenuPrimitive.Popup> & Pick<ComponentProps<typeof MenuPrimitive.Positioner>, 'align' | 'side' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="isolate z-50 outline-none" align={align} side={side} sideOffset={sideOffset}>
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'min-w-44 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none',
            'data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95',
            'motion-reduce:animate-none',
            className,
          )}
          // The popup is portalled, but React still bubbles its clicks through the
          // component tree: a clickable table row must not also open its record.
          onClick={(e) => {
            onClick?.(e)
            e.stopPropagation()
          }}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { variant?: 'default' | 'destructive' }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none',
        // 44px rows on touch screens, as for buttons.
        'pointer-coarse:min-h-11',
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

/** A set of choices of which one is current, such as a SIM card's status; choosing one closes the menu. */
function DropdownMenuRadioGroup(props: ComponentProps<typeof MenuPrimitive.RadioGroup>) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      closeOnClick
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-sm outline-none select-none pointer-coarse:min-h-11',
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <MenuPrimitive.RadioItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
        <Check aria-hidden className="size-4" />
      </MenuPrimitive.RadioItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

/** Words above a menu's items that are not an action: what the choices mean. */
function DropdownMenuNote({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="dropdown-menu-note" className={cn('max-w-72 px-2 py-1.5 text-xs text-muted-foreground', className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuNote,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
}
