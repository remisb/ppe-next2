import type { ComponentProps } from 'react'

import { cn } from '../lib/utils.ts'

const sizes = {
  /** In a sentence or a hint line: "J / K next or previous". */
  inline: 'px-1',
  /** A key on its own, as Help and Keyboard shortcuts list them. */
  chip: 'bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap',
  /** A small hint beside a control: ⌘K on the search, esc in the palette. */
  tiny: 'px-1.5 text-[0.625rem]',
}

/** A key the user presses, drawn the same way wherever the apps name one. */
export function Kbd({ size = 'inline', className, ...props }: ComponentProps<'kbd'> & { size?: keyof typeof sizes }) {
  return <kbd className={cn('rounded border border-border font-mono', sizes[size], className)} {...props} />
}
