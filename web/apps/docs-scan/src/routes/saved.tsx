import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { ErrorState, Loading } from '@ppe/ui/components/states'
import { Camera, CircleCheck, ExternalLink, GitMerge, Lock, UserRound } from 'lucide-react'

import { Group, Row } from '@/components/screen-bar'
import { t } from '@/i18n'
import { useRouter } from '@/lib/router'
import { useSessions } from '@/lib/sessions'
import { useScan } from '@/lib/use-scan'

/** Saved: what was saved and changed, each on a line; Scan Next Document, the employee's page, Scans. */
export function SavedScreen({ id }: { id: string }) {
  const { scan, error, loading } = useScan(id)
  const { navigate } = useRouter()
  const sessions = useSessions()
  if (loading) return <Loading label={t.scans.opening} />
  if (!scan) return <ErrorState title={t.problems.scanGone} error={error} />
  const s = scan.saved
  const employee = s?.employeeId ?? scan.employeeId
  const kind = t.kinds[scan.kind]
  return (
    <div className="flex flex-col gap-5 pt-6 pb-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <CircleCheck aria-hidden className="size-20 text-emerald-600 motion-safe:animate-in motion-safe:zoom-in-50" />
        <h1 className="text-2xl font-bold">{t.saved.title}</h1>
        {s ? <p className="text-muted-foreground">{t.saved.savedTo(kind, s.name)}</p> : null}
      </div>
      {s ? (
        <Group footer={t.saved.audit}>
          <Row label={t.saved.copies} end={<Lock aria-hidden className="size-4 text-emerald-600" />}>
            {t.saved.copiesOf(s.sides.map((x) => t.details.sides[x]).join(', '))}
          </Row>
          {s.created ? (
            <Row label={t.saved.created} end={<UserRound aria-hidden className="size-4 text-emerald-600" />}>
              {s.name}
            </Row>
          ) : (
            <Row label={t.saved.record} end={<UserRound aria-hidden className="size-4 text-emerald-600" />}>
              {s.changed.length > 0 ? t.saved.updated(s.changed.map((f) => t.update.fields[f]).join(', ')) : t.saved.notChanged}
            </Row>
          )}
          {s.merged ? (
            <Row label={t.saved.merged} end={<GitMerge aria-hidden className="size-4 text-emerald-600" />}>
              {t.saved.mergedOf(s.merged)}
            </Row>
          ) : null}
        </Group>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          onClick={() => {
            sessions.setRetake(null)
            navigate({ name: 'camera' })
          }}
        >
          <Camera aria-hidden className="size-4" />
          {t.saved.scanNext}
        </Button>
        {employee ? (
          <a href={staffHref(`/employees/${employee}/page`)} className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            <ExternalLink aria-hidden className="size-4" />
            {t.saved.openEmployee}
          </a>
        ) : null}
        <Button variant="ghost" onClick={() => navigate({ name: 'home' })}>
          {t.saved.backToScans}
        </Button>
      </div>
    </div>
  )
}
