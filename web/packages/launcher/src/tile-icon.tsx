import type { LauncherApp } from '@ppe/api-client'
import { cn } from '@ppe/ui/lib/utils'
import { Box } from 'lucide-react'

import { appIcons } from './icons.ts'

/** A tile's icon on its colour, sized and rounded by className. */
export function TileIcon({ app, className }: { app: Pick<LauncherApp, 'icon' | 'color'>; className?: string }) {
  const Icon = appIcons[app.icon] ?? Box
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center text-white', className)} style={{ backgroundColor: app.color }}>
      <Icon className="size-full" />
    </span>
  )
}
