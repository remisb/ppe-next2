import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '../lib/utils.ts'
import { Button } from './button.tsx'

/**
 * The way back from a record or a page to where it was opened from, named by
 * that place ("Orders", "Item Catalogue"): a ghost button with an arrow,
 * pulled left so its text lines up with the content below. A pane passes
 * lg:hidden, as beside the list its ✕ closes it instead.
 */
export function BackButton({ onClick, className, children }: { onClick: () => void; className?: string | undefined; children: ReactNode }) {
  return (
    <Button variant="ghost" className={cn('-ml-3', className)} onClick={onClick}>
      <ArrowLeft aria-hidden /> {children}
    </Button>
  )
}
