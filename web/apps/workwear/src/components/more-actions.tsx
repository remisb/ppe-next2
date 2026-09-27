import { Ellipsis } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/**
 * The ⋯ button that holds a record's less frequent actions, destructive ones
 * last, so Delete and Deactivate are never one stray tap away. Always visible,
 * not revealed on hover: touch screens have no hover.
 */
export function MoreActions({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" className={className} />} aria-label={label}>
        <Ellipsis aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}
