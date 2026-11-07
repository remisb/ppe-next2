import { Button } from '@ppe/ui/components/button'
import { cn } from '@ppe/ui/lib/utils'
import { RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { reloadWhenFilesAreGone, watchForNewBuild } from './app-update.ts'
import { shellText } from './text.ts'

/**
 * Says a newer version of the app is deployed, with Reload, and reloads by
 * itself when a file of the old build is gone (app-update.ts). It never
 * reloads unasked otherwise: a form being filled in would be lost. It floats
 * above the phone's tab bar (aboveNav, the default) or the screen's foot.
 */
export function AppUpdateNotice({ aboveNav = true }: { aboveNav?: boolean }) {
  const [newer, setNewer] = useState(false)
  const [later, setLater] = useState(false)
  useEffect(() => {
    const stopWatching = watchForNewBuild(() => setNewer(true))
    const stopReloading = reloadWhenFilesAreGone()
    return () => {
      stopWatching()
      stopReloading()
    }
  }, [])
  if (!newer || later) return null
  const text = shellText()
  return (
    <div
      role="status"
      data-slot="app-update"
      className={cn(
        'fixed inset-x-3 z-50 flex items-center gap-2 rounded-xl border border-border bg-popover py-2 pr-2 pl-4 text-sm text-popover-foreground shadow-lg md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm print:hidden',
        aboveNav ? 'bottom-[calc(var(--bottom-nav)+0.75rem)]' : 'bottom-[max(0.75rem,env(safe-area-inset-bottom))]',
      )}
    >
      <p className="min-w-0 flex-1">{text.newVersionReady}</p>
      <Button size="sm" onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden />
        {text.reload}
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={text.notNow} onClick={() => setLater(true)}>
        <X aria-hidden />
      </Button>
    </div>
  )
}
