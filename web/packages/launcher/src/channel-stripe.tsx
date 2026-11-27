import { useApi } from '@ppe/app-shell'
import { appChannel, appVersion, basePath } from '@ppe/routing'
import { ChannelStripe as Stripe } from '@remisb/launcher-react'

import { useLauncher } from './load.ts'
import { launcherText } from './text.ts'

/**
 * A published app's reminder that it is off Stable (decision D12), and the
 * sending on to the user's channel or back to Stable: @remisb/launcher-react's
 * ChannelStripe, with this page's channel, version and mount (its ppe-* meta
 * tags), the user's launcher list and this site's sign-in.
 */
export function ChannelStripe({ slug }: { slug: string }) {
  const { client, session } = useApi()
  const { list, failed } = useLauncher()
  return (
    <Stripe
      slug={slug}
      channel={appChannel}
      version={appVersion ?? ''}
      mount={basePath}
      list={list}
      failed={failed}
      userId={session?.userId ?? null}
      managesApps={session?.can('apps.manage') ?? false}
      choose={(s, c) => client.launcher.chooseChannel(s, c)}
      words={launcherText()}
    />
  )
}
