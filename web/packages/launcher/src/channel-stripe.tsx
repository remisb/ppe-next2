import { useApi } from '@ppe/app-shell'
import { appChannel, appVersion, stripBase } from '@ppe/routing'
import { useEffect } from 'react'

import { channelName, channelsOf, mayOpenChannel } from './channels.ts'
import { rememberChoice, useLauncher } from './load.ts'
import { launcherText } from './text.ts'

/** Stable's address for the page open now: /apps/<slug>/<channel>/x → /apps/<slug>/x. */
function stableHref(slug: string): string {
  const rest = stripBase(window.location.pathname)
  return `/apps/${slug}${rest === '/' ? '/' : rest}${window.location.search}`
}

/**
 * A published app's reminder that it is off Stable (decision D12): a thin
 * stripe naming the channel and the version, with the way back to Stable
 * (which also makes Stable the user's choice).
 * Nothing on Stable or in an app on an address of its own. It also moves a
 * user who may not open the channel (a link passed on, an audience changed)
 * to Stable once their launcher list says so.
 */
export function ChannelStripe({ slug }: { slug: string }) {
  const { client, session } = useApi()
  const { list } = useLauncher()
  const off = appChannel !== null && appChannel !== 'stable'
  const allowed = !list || !session || mayOpenChannel(list, slug, appChannel, session.can('apps.manage'))
  useEffect(() => {
    if (off && !allowed) window.location.replace(stableHref(slug))
  }, [off, allowed, slug])
  if (!off || !allowed || appChannel === null) return null
  const t = launcherText()
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-200 px-4 py-1 text-center text-xs text-amber-950 dark:bg-amber-900 dark:text-amber-50">
      <span>
        {t.onChannel(channelName(appChannel, channelsOf(list, slug)))} · {t.version} {appVersion}
      </span>
      <a
        href={stableHref(slug)}
        onClick={(e) => {
          // Stable from now on, here and in App Launcher, not just this once.
          if (!session || e.metaKey || e.ctrlKey || e.shiftKey) return
          e.preventDefault()
          const href = stableHref(slug)
          void client.launcher
            .chooseChannel(slug, 'stable')
            .then(() => rememberChoice(session.userId, slug, 'stable'))
            .catch(() => undefined)
            .finally(() => window.location.assign(href))
        }}
        className="font-medium underline underline-offset-2"
      >
        {t.backToStable}
      </a>
    </div>
  )
}
