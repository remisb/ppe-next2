import { useApi } from '@ppe/app-shell'
import { appChannel, appVersion, basePath, stripBase } from '@ppe/routing'
import { useEffect } from 'react'

import { channelName, channelPath, channelsOf, chosenHref, mayOpenChannel } from './channels.ts'
import { rememberChoice, useLauncher } from './load.ts'
import { launcherText } from './text.ts'

/** The screen open now, below where the app is mounted: /apps/<slug>/<channel>/x → /x. */
const here = () => stripBase(window.location.pathname)

/**
 * A published app's reminder that it is off Stable (decision D12): a thin
 * stripe naming the channel and the version, a switch between the channels
 * the user sees, and the way back to Stable; choosing one also makes it the
 * user's choice, here and in App Launcher. Nothing on Stable or in an app on
 * an address of its own.
 *
 * It also sends the user where they belong once their launcher list is in:
 * from the app's Stable address to the channel they chose, and from a
 * channel they may not open (a link passed on, an audience changed) to Stable.
 */
export function ChannelStripe({ slug }: { slug: string }) {
  const { client, session } = useApi()
  const { list } = useLauncher()
  const off = appChannel !== null && appChannel !== 'stable'
  const allowed = !list || !session || mayOpenChannel(list, slug, appChannel, session.can('apps.manage'))
  useEffect(() => {
    if (off && !allowed) {
      window.location.replace(channelPath(slug, 'stable', here(), window.location.search))
      return
    }
    const chosen = chosenHref(list, slug, appChannel, basePath, window.location.pathname, window.location.search)
    if (chosen) window.location.replace(chosen)
  }, [off, allowed, list, slug])
  if (!off || !allowed || appChannel === null) return null
  const t = launcherText()
  const channels = channelsOf(list, slug)
  // Keeps the choice, then opens the same screen on that channel.
  const go = (channel: string) => {
    const href = channelPath(slug, channel, here(), window.location.search)
    if (!session) return window.location.assign(href)
    void client.launcher
      .chooseChannel(slug, channel)
      .then(() => rememberChoice(session.userId, slug, channel))
      .catch(() => undefined)
      .finally(() => window.location.assign(href))
  }
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-200 px-4 py-1 text-center text-xs text-amber-950 dark:bg-amber-900 dark:text-amber-50">
      <span>
        {t.onChannel(channelName(appChannel, channels))} · {t.version} {appVersion}
      </span>
      {channels.length > 2 && channels.some((c) => c.name === appChannel) ? (
        <select
          aria-label={t.versions}
          value={appChannel}
          onChange={(e) => go(e.target.value)}
          className="rounded border border-amber-950/30 bg-transparent px-1 py-0.5 text-xs dark:border-amber-50/30"
        >
          {channels.map((c) => (
            <option key={c.name} value={c.name}>
              {channelName(c.name, channels)}
            </option>
          ))}
        </select>
      ) : null}
      <a
        href={channelPath(slug, 'stable', here(), window.location.search)}
        onClick={(e) => {
          // Stable from now on, here and in App Launcher, not just this once.
          if (e.metaKey || e.ctrlKey || e.shiftKey) return
          e.preventDefault()
          go('stable')
        }}
        className="font-medium underline underline-offset-2"
      >
        {t.backToStable}
      </a>
    </div>
  )
}
