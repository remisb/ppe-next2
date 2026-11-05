import type { AppChannel, AppVersion, LauncherApp } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { FIXED_CHANNELS, channelName } from '@ppe/launcher'
import { Badge } from '@ppe/ui/components/badge'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { ActionError, ErrorState, ListSkeleton } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { useAction } from '@ppe/ui/lib/use-action'
import { useLoad } from '@ppe/ui/lib/use-load'
import { useEffect, useState } from 'react'

import { t } from '@/i18n'

/**
 * A published app's versions and channels (ADR 0006, phase 3): which version
 * each channel opens and who sees it; Make Stable, Beta or Preview on any
 * version (promoting, or rolling back to an older one). Stable follows deploys moves Stable with
 * every deploy; off, a note says when Preview is newer than Stable. An app on
 * an address of its own has none, and says how one is published.
 */
export function AppReleases({ app, timeZone, onChanged }: { app: LauncherApp; timeZone: string | undefined; onChanged: () => void }) {
  const { client } = useApi()
  const releases = useLoad(() => client.apps.releases(app.slug), [app.slug])
  const action = useAction()
  const [done, setDone] = useState<string>()
  const channels = releases.data?.channels ?? []
  const versions = releases.data?.versions ?? []

  const stable = channels.find((c) => c.name === 'stable')
  const preview = channels.find((c) => c.name === 'preview')
  // A deploy reaches only Preview: say so while Stable is behind it.
  // Ticked at once; put back if saving fails.
  const [follows, setFollows] = useState(app.stable_follows_deploys)
  useEffect(() => setFollows(app.stable_follows_deploys), [app.stable_follows_deploys])
  const behind = !follows && stable && preview && preview.version_id !== stable.version_id && preview.published_at > stable.published_at
  const follow = (on: boolean) => {
    setFollows(on)
    void action.run(async () => {
      try {
        await client.apps.setStableFollowsDeploys(app.slug, on)
      } catch (err) {
        setFollows(!on)
        throw err
      }
      onChanged()
    })
  }

  const point = (name: string, version: AppVersion) =>
    void action.run(async () => {
      await client.apps.pointChannel(app.slug, name, { version: version.version })
      releases.reload()
      onChanged()
      setDone(t.apps.channelMoved(channelName(name), version.version))
    })

  return (
    <DisclosureSection id="app-releases" title={t.apps.releases} count={versions.length || undefined} rememberAs="app-releases" className="mb-0">
      {releases.error ? (
        <ErrorState error={releases.error} onRetry={releases.reload} />
      ) : !releases.data ? (
        <ListSkeleton rows={3} />
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.apps.notPublished}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-label={t.apps.channels} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t.apps.channels}</h3>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-primary"
                checked={follows}
                onChange={(e) => follow(e.target.checked)}
              />
              <span>
                <span className="font-medium">{t.apps.stableFollowsDeploys}</span>
                <span className="block text-xs text-muted-foreground">{t.apps.stableFollowsDeploysHint}</span>
              </span>
            </label>
            {behind ? (
              <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
                {t.apps.previewAhead(preview.version)}
              </p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {channels.map((c) => (
                <li key={c.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {channelName(c.name)}
                      <code className="text-xs font-normal text-muted-foreground">{c.version}</code>
                    </span>
                    <span className="block text-xs text-muted-foreground">{whoSees(c)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label={t.apps.versions} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t.apps.versions}</h3>
            <Table stack="list" stackBelow="md">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.apps.version}</TableHead>
                  <TableHead>{t.apps.publishedAt}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.apps.actionsColumn}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => {
                  const on = channels.filter((c) => c.version_id === v.id)
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="whitespace-normal stacked:w-auto stacked:min-w-0 stacked:flex-1">
                        <code className="text-xs">{v.version}</code>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {on.map((c) => (
                            <Badge key={c.name} variant={c.name === 'stable' ? 'default' : 'secondary'}>
                              {channelName(c.name)}
                            </Badge>
                          ))}
                          <span className="text-xs text-muted-foreground">
                            {t.apps.profiles[v.profile]}
                            {v.commit ? ` · ${v.commit}` : ''}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        <RelativeDate iso={v.published_at} timeZone={timeZone} />
                      </TableCell>
                      <TableCell className="w-0 text-right stacked:w-auto">
                        <MoreActions label={t.apps.versionActions(v.version)}>
                          {FIXED_CHANNELS.map((name) => (
                            <DropdownMenuItem key={name} disabled={on.some((c) => c.name === name) || action.pending} onClick={() => point(name, v)}>
                              {t.apps.makeChannel(channelName(name))}
                            </DropdownMenuItem>
                          ))}
                        </MoreActions>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </section>
          <ActionError error={action.error} />
          {done ? (
            <p role="status" className="text-sm text-muted-foreground">
              {done}
            </p>
          ) : null}
        </div>
      )}
    </DisclosureSection>
  )
}

/** Who sees a channel: Stable whoever sees the app, Beta and Preview testers. */
const whoSees = (c: AppChannel): string => (c.name === 'stable' ? t.apps.seenByApp : t.apps.seenByTesters)
