import type { KeptScan } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { Segmented } from '@ppe/ui/components/segmented'
import { ActionError, EmptyState, ListSkeleton } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Camera, Check, CircleAlert, Dot } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { t } from '@/i18n'
import { badgeOf } from '@/lib/flow'
import { useRouter } from '@/lib/router'
import { useSessions } from '@/lib/sessions'

type Filter = 'all' | 'open' | 'saved'

/** The day a scan was made, as Scans groups them. */
function dayOf(iso: string, now = new Date()): 'today' | 'yesterday' | 'earlier' {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : 'earlier'
}

/**
 * Scans (DS-1): the user's kept scans as a photo grid, newest first, by day, each with a badge
 * saying what it needs. Nothing is on the phone: the grid is the API's kept scans, sealed,
 * the user's alone, gone after 3 days. Scan Document opens the camera.
 */
export function ScansScreen() {
  const { client } = useApi()
  const { navigate } = useRouter()
  const sessions = useSessions()
  const [filter, setFilter] = useState<Filter>('all')
  const list = useLoad(() => client.personnel.scans.list(), [client])
  const all = list.data ?? []
  const open = all.filter((s) => s.state !== 'saved').length
  const shown = all.filter((s) => filter === 'all' || (filter === 'saved' ? s.state === 'saved' : s.state !== 'saved'))
  const groups = useMemo(() => {
    const out: { day: 'today' | 'yesterday' | 'earlier'; scans: KeptScan[] }[] = []
    for (const s of shown) {
      const day = dayOf(s.created_at)
      const g = out.find((x) => x.day === day)
      if (g) g.scans.push(s)
      else out.push({ day, scans: [s] })
    }
    return out
  }, [shown])

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">{t.scans.title}</h1>
        {list.data ? <p className="text-sm text-muted-foreground">{t.scans.summary(all.length, open)}</p> : null}
      </header>
      <Segmented
        label={t.scans.filters.label}
        layout="fit"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t.scans.filters.all },
          { value: 'open', label: t.scans.filters.open },
          { value: 'saved', label: t.scans.filters.saved },
        ]}
      />
      <ActionError error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? <ListSkeleton rows={3} /> : null}
      {list.data && shown.length === 0 ? <EmptyState>{all.length === 0 ? `${t.scans.empty} ${t.scans.emptyHint}` : t.scans.empty}</EmptyState> : null}
      {groups.map((g) => (
        <section key={g.day} aria-labelledby={`day-${g.day}`} className="flex flex-col gap-2">
          <h2 id={`day-${g.day}`} className="flex items-baseline justify-between text-xl font-bold">
            {t.scans[g.day]}
            <span className="text-sm font-normal text-muted-foreground">{t.scans.count(g.scans.length)}</span>
          </h2>
          <ul className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-lg sm:grid-cols-4 lg:grid-cols-6">
            {g.scans.map((s) => (
              <li key={s.id}>
                <Tile scan={s} onOpen={() => navigate({ name: 'scan', id: s.id })} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="px-4 text-center text-sm text-muted-foreground">{t.scans.kept}</p>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Button
          size="lg"
          className="pointer-events-auto h-14 rounded-full px-6 text-base shadow-lg"
          onClick={() => {
            sessions.setRetake(null)
            navigate({ name: 'camera' })
          }}
        >
          <Camera aria-hidden className="size-5" />
          {t.scans.scanDocument}
        </Button>
      </div>
    </div>
  )
}

/** A scan's tile: its first page, a badge, and the person's name once read. */
function Tile({ scan, onOpen }: { scan: KeptScan; onOpen: () => void }) {
  const { client } = useApi()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let made: string | undefined
    client.personnel.scans.page(scan.id, 1).then(
      (blob) => {
        if (!live) return
        made = URL.createObjectURL(blob)
        setUrl(made)
      },
      () => {},
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [client, scan.id])
  const badge = badgeOf(scan.state)
  const name = badge === 'unread' ? t.scans.badge.unread : `${scan.given_names} ${scan.surname}`.trim()
  const Icon = badge === 'saved' ? Check : badge === 'unread' ? CircleAlert : Dot
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name} · ${t.kinds[scan.kind]} · ${t.scans.badge[badge]}`}
      className="relative grid aspect-square w-full place-items-center overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {url ? <img src={url} alt="" className="size-[88%] -rotate-2 object-contain shadow-md" /> : null}
      <span
        aria-hidden
        className={cn(
          'absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full text-white shadow',
          badge === 'saved' ? 'bg-emerald-600' : badge === 'unread' ? 'bg-destructive' : 'bg-amber-500',
        )}
      >
        <Icon className="size-4" />
      </span>
      <span aria-hidden className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/65 to-transparent px-2 pt-5 pb-1.5 text-left text-xs font-semibold text-white">
        {name}
      </span>
    </button>
  )
}
