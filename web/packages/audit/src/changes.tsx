import type { AuditEntry } from '@ppe/api-client'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { RuleList } from '@ppe/ui/components/rule-list'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { Loaded } from '@ppe/ui/components/states'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { useLoad } from '@ppe/ui/lib/use-load'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import type { ReactNode } from 'react'

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
  // Flat, as the panels holding it are: a rule between changes, no frame.
  return (
    <RuleList ordered className="sm:max-w-2xl">
      {entries.map((e) => (
        <li key={e.id} className="grid gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{auditTitle(e.event)}</span>
            <RelativeDate iso={e.occurred_at} timeZone={timeZone} time className="text-xs text-muted-foreground tabular-nums" />
          </div>
          <span className="text-xs text-muted-foreground">{changedBy(e)}</span>
          <ChangedFields changes={auditChanges(e, options)} />
        </li>
      ))}
    </RuleList>
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
      {/* Flat, as a pane's facts: between two rules, then what changed below them, no box. */}
      <FactGrid layout="rows" ruled>
        {facts.map(([label, value]) => (
          <Fact key={label} label={label}>
            {value}
          </Fact>
        ))}
      </FactGrid>
      {changes.length > 0 ? (
        <ChangedFields changes={changes} />
      ) : (
        <p className="text-sm text-muted-foreground">{t.noDetails}</p>
      )}
    </div>
  )
}

/**
 * A record's Changes section: its recorded changes, newest first, closed at
 * first and read only once opened; rememberAs keeps it open or closed as it was
 * left. load reads them (client.audit.history); a new value in deps, such as the
 * record's updated_at, loads them again, so an edit shows at once. What Changes
 * are is in the section's ⓘ (DisclosureSection's description).
 */
export function RecordChanges({
  load,
  deps,
  timeZone,
  options,
  rememberAs,
  className,
}: {
  load: () => Promise<AuditEntry[]>
  deps: readonly unknown[]
  timeZone: string | undefined
  options?: DescribeOptions | undefined
  rememberAs?: string | undefined
  className?: string | undefined
}) {
  const t = auditText()
  return (
    <DisclosureSection id="record-changes" title={t.changes} description={t.changesIntro} rememberAs={rememberAs} className={className}>
      <ChangesBody load={load} deps={deps} timeZone={timeZone} options={options} />
    </DisclosureSection>
  )
}

/** The changes themselves, read when shown. */
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
      <Loaded load={changes} emptyState={t.noChanges}>
        {(data) => (
          <ChangeList entries={data} timeZone={timeZone} options={options} />
        )}
      </Loaded>
    </>
  )
}
