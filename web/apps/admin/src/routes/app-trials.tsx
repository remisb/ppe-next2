import type { LauncherApp } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { channelName, launcherText } from '@ppe/launcher'
import { Badge } from '@ppe/ui/components/badge'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { ErrorState, Loading } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { useLoad } from '@ppe/ui/lib/use-load'

import { t } from '@/i18n'

/**
 * A published app's Trials view (ADR 0006, phase 5): each version beside the
 * others, with the channels opening it, how many people used it (over Usage's
 * window), the errors last seen on it and the feedback given on it, so a
 * Beta or a variant is judged on what happened rather than by asking around.
 */
export function AppTrials({ app, timeZone }: { app: LauncherApp; timeZone: string | undefined }) {
  const { client } = useApi()
  const trials = useLoad(() => client.apps.trials(app.slug), [app.slug, app.updated_at])
  const versions = trials.data?.versions ?? []
  return (
    <DisclosureSection id="app-trials" title={t.apps.trials} rememberAs="app-trials" className="mb-0">
      {trials.error ? (
        <ErrorState error={trials.error} onRetry={trials.reload} />
      ) : !trials.data ? (
        <Loading />
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.apps.notPublished}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t.apps.trialsHint(trials.data.days)}</p>
          <Table stack="list" stackBelow="md">
            <TableHeader>
              <TableRow>
                <TableHead>{t.apps.version}</TableHead>
                <TableHead className="text-right">{t.apps.trialPeople}</TableHead>
                <TableHead className="text-right">{t.apps.trialErrors}</TableHead>
                <TableHead>{t.apps.feedback}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v) => (
                <TableRow key={v.version}>
                  <TableCell className="whitespace-normal stacked:w-auto stacked:min-w-0 stacked:flex-1">
                    <code className="text-xs">{v.version}</code>
                    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {v.channels.map((c) => (
                        <Badge key={c.name} variant={c.name === 'stable' ? 'default' : 'secondary'}>
                          {channelName(c.name)}
                        </Badge>
                      ))}
                      <RelativeDate iso={v.published_at} timeZone={timeZone} />
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {v.people}
                    <span className="block text-xs text-muted-foreground">{t.apps.trialDays(v.days)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {v.error_kinds === 0 ? (
                      <span className="text-muted-foreground">0</span>
                    ) : (
                      <>
                        <span className="font-medium text-destructive">{v.error_kinds}</span>
                        <span className="block text-xs text-muted-foreground">{t.apps.trialOccurrences(v.errors)}</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant="outline">
                        {launcherText().ratings.works} {v.feedback.works}
                      </Badge>
                      <Badge variant={v.feedback.confusing ? 'secondary' : 'outline'}>
                        {launcherText().ratings.confusing} {v.feedback.confusing}
                      </Badge>
                      <Badge variant={v.feedback.broken ? 'destructive' : 'outline'}>
                        {launcherText().ratings.broken} {v.feedback.broken}
                      </Badge>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </DisclosureSection>
  )
}
