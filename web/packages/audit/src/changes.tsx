import type { AuditEntry } from '@ppe/api-client'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { EmptyState, ErrorState, Loading } from '@ppe/ui/components/states'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'

import { type DescribeOptions, type FieldChange, auditChanges, auditTitle, deviceText, sourceLabel } from './describe.ts'
import { auditText } from './text.ts'

/** Each changed field: its name, then the old value struck through and the new one. */
export function ChangedFields({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return null
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
      {changes.map((c) => (
        <div key={c.key} className="contents">
          <dt className="text-muted-foreground">{c.label}</dt>
          <dd className="min-w-0 break-words">
            {c.before !== null ? (
              <>
                <del className="text-muted-foreground">{c.before}</del>
                {c.after !== null ? ' → ' : null}
              </>
            ) : null}
            {c.after !== null ? <ins className="font-medium no-underline">{c.after}</ins> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Who made a change: the person, else where it came from (a confirmation link, the system). */
export function changedBy(entry: AuditEntry): string {
  return entry.actor_name ?? sourceLabel(entry.source)
}

/**
 * A record's Changes, newest first: each action, when and by whom, and the
 * fields it changed. For a record's own page; the Audit log has its own list.
 */
export function ChangeList({
  entries,
  timeZone,
  options,
}: {
  entries: AuditEntry[]
  timeZone: string | undefined
  options?: DescribeOptions | undefined
}) {
  return (
    <ol className="divide-y divide-border rounded-lg border border-border sm:max-w-2xl">
      {entries.map((e) => (
        <li key={e.id} className="grid gap-1.5 px-4 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{auditTitle(e.event)}</span>
            <RelativeDate iso={e.occurred_at} timeZone={timeZone} time className="text-xs text-muted-foreground tabular-nums" />
          </div>
          <span className="text-xs text-muted-foreground">{changedBy(e)}</span>
          <ChangedFields changes={auditChanges(e, options)} />
        </li>
      ))}
    </ol>
  )
}

/**
 * One change in full, for the Audit log's detail: the action and record,
 * when, who, where and on which device, its reference, and every field it
 * changed. record is the record's name, a link where it can be opened.
 */
export function ChangeDetail({
  entry,
  timeZone,
  record,
  options,
}: {
  entry: AuditEntry
  timeZone: string | undefined
  record: ReactNode
  options?: DescribeOptions | undefined
}) {
  const t = auditText()
  const changes = auditChanges(entry, options)
  const facts: [string, ReactNode][] = [
    [t.record, record],
    [t.when, formatDateTime(entry.occurred_at, timeZone)],
    [t.who, entry.actor_name ?? t.nobody],
    [t.where, sourceLabel(entry.source)],
  ]
  if (entry.session_user_agent) facts.push([t.device, deviceText(entry.session_user_agent)])
  if (entry.request_id) facts.push([t.reference, <span className="font-mono text-xs break-all">{entry.request_id}</span>])
  facts.push([t.event, <span className="font-mono text-xs break-all">{entry.event}</span>])
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {changes.length > 0 ? (
        <div className="rounded-lg border border-border p-3">
          <ChangedFields changes={changes} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t.noDetails}</p>
      )}
    </div>
  )
}

/**
 * A record page's Changes section: its recorded changes, newest first. load
 * reads them (client.audit.history); a new value in deps, such as the record's
 * updated_at, loads them again, so an edit made on the page shows at once.
 * collapsible makes the heading a disclosure, closed at first; the changes are
 * read only once it is opened.
 */
export function RecordChanges({
  load,
  deps,
  timeZone,
  options,
  collapsible = false,
  className,
}: {
  load: () => Promise<AuditEntry[]>
  deps: readonly unknown[]
  timeZone: string | undefined
  options?: DescribeOptions | undefined
  collapsible?: boolean
  /** Replaces the room below it (mb-8), for a section that ends a smaller panel. */
  className?: string | undefined
}) {
  const t = auditText()
  const [open, setOpen] = useState(!collapsible)
  const bodyId = useId()
  return (
    <section aria-labelledby="record-changes" className={cn('mb-8', className)}>
      {collapsible ? (
        <h2 id="record-changes" className="mb-1 text-lg font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
            className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.changes}
            <ChevronDown aria-hidden className={cn('size-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
          </button>
        </h2>
      ) : (
        <h2 id="record-changes" className="mb-1 text-lg font-semibold">
          {t.changes}
        </h2>
      )}
      <div id={bodyId} className="empty:hidden">
        {open ? <ChangesBody load={load} deps={deps} timeZone={timeZone} options={options} /> : null}
      </div>
    </section>
  )
}

/** The intro and the changes themselves, read when shown. */
function ChangesBody({
  load,
  deps,
  timeZone,
  options,
}: {
  load: () => Promise<AuditEntry[]>
  deps: readonly unknown[]
  timeZone: string | undefined
  options?: DescribeOptions | undefined
}) {
  const t = auditText()
  const changes = useLoad(load, deps)
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t.changesIntro}</p>
      {changes.error ? (
        <ErrorState error={changes.error} onRetry={changes.reload} />
      ) : !changes.data ? (
        <Loading />
      ) : changes.data.length === 0 ? (
        <EmptyState>{t.noChanges}</EmptyState>
      ) : (
        <ChangeList entries={changes.data} timeZone={timeZone} options={options} />
      )}
    </>
  )
}
