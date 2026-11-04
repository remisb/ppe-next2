import { CheckingSignIn, ConfirmPassword, Offline, type Session, SignIn, applyDensity, loadDensity, useApi } from '@ppe/app-shell'
import { type AppIcon, type LauncherApp, type Places, appName, launcherText, loadPlaces, noteOpened, parentName, savePlaces, togglePin, visibleApps } from '@ppe/launcher'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { GavortEmblem } from '@ppe/ui/components/gavort-logo'
import { Kbd } from '@ppe/ui/components/kbd'
import { cn } from '@ppe/ui/lib/utils'
import {
  BookOpen,
  CardSim,
  ClipboardList,
  ClipboardPlus,
  Ellipsis,
  ExternalLink,
  Gauge,
  HardHat,
  LogOut,
  type LucideIcon,
  Package,
  Pin,
  PinOff,
  ScanBarcode,
  Search,
  ShieldCheck,
  Shirt,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { type Shelf, matching, pinnedOf, recentOf, sections } from '@/lib/tiles'

const icons: Record<AppIcon, LucideIcon> = {
  shirt: Shirt,
  order: ClipboardPlus,
  orders: ClipboardList,
  employees: Users,
  dashboard: Gauge,
  sim: CardSim,
  equipment: Package,
  scan: ScanBarcode,
  crew: HardHat,
  admin: ShieldCheck,
  help: BookOpen,
}

/**
 * App Launcher (ADR 0006): the apps and shortcuts the user's roles open, as big
 * tiles in groups, like a till. Pinned tiles and recent apps come first; from
 * lg a rail of groups narrows the tiles. A tile opens its app as a page (a
 * linked site in a new tab); ⋯ or a right-click shows where it runs and pins it.
 * It shares the staff app's sign-in, so signing in or out here does so there too.
 */
export function App() {
  const { session, status, retry, signOut, passwordPrompt } = useApi()

  useEffect(() => applyDensity(session ? loadDensity(session.userId) : null), [session?.userId])

  if (status === 'starting') return <CheckingSignIn />
  if (status === 'offline') return <Offline onRetry={retry} />
  if (!session) return <SignIn appName={launcherText().launcherName} tagline={launcherText().signInTagline} />
  return (
    <>
      <Launcher session={session} onSignOut={() => void signOut()} />
      <ConfirmPassword prompt={passwordPrompt} />
    </>
  )
}

function Launcher({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const text = launcherText()
  const [q, setQ] = useState('')
  const [shelf, setShelf] = useState<Shelf>('all')
  const [places, setPlaces] = useState<Places>(() => loadPlaces(session.userId))
  const [about, setAbout] = useState<LauncherApp | null>(null)
  const search = useRef<HTMLInputElement>(null)

  const shown = visibleApps(session.can)
  const found = matching(shown, q)
  const searching = q.trim() !== ''
  const pinned = pinnedOf(shown, places)
  const recent = recentOf(shown, places)

  const change = (next: Places) => {
    setPlaces(next)
    savePlaces(session.userId, next)
  }
  const opened = (app: LauncherApp) => change(noteOpened(places, app.id))

  // ⌘K, Ctrl+K or / puts the cursor in the search box, as ⌘K does in the staff app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable="true"]')
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Enter opens the first tile found.
  const openFirst = (e: FormEvent) => {
    e.preventDefault()
    const first = found[0]
    if (!first) return
    opened(first)
    if (first.tier === 'linked') window.open(first.href, '_blank', 'noopener')
    else window.location.assign(first.href)
  }

  const shelves: { shelf: Shelf; label: string; count: number }[] = [
    { shelf: 'all', label: text.all, count: shown.length },
    ...(pinned.length ? [{ shelf: 'pinned' as const, label: text.pinned, count: pinned.length }] : []),
    ...sections(shown, 'all').map((s) => ({ shelf: s.group, label: text.groups[s.group], count: s.apps.length })),
  ]
  const onShelf = shelves.some((s) => s.shelf === shelf) ? shelf : 'all'

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        {text.skipToContent}
      </a>
      {/* The rail, from lg: the groups, as a till's categories. */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r border-border bg-sidebar p-3 lg:flex">
        <div className="flex items-center gap-2 px-2 pt-1 pb-4 font-semibold">
          <GavortEmblem className="size-8 shrink-0 text-brand-mark" />
          {text.apps}
        </div>
        <nav aria-label={text.groupsNav} className="flex flex-col gap-1">
          {shelves.map((s) => (
            <button
              key={s.shelf}
              type="button"
              aria-pressed={onShelf === s.shelf}
              onClick={() => {
                setShelf(s.shelf)
                setQ('')
              }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-accent aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-pressed:font-semibold"
            >
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-2">
          <AccountLinks name={session.name} onSignOut={onSignOut} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex h-14 items-center gap-2 px-4 md:px-6">
            <span className="flex items-center gap-2 font-semibold lg:hidden">
              <GavortEmblem className="size-8 shrink-0 text-brand-mark" />
              {text.apps}
            </span>
            <h1 className="sr-only lg:not-sr-only lg:text-lg lg:font-semibold">{text.apps}</h1>
            <div className="ml-auto flex items-center gap-1 lg:hidden">
              <AccountLinks name={session.name} onSignOut={onSignOut} compact />
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex min-w-0 flex-col gap-6 px-4 pt-4 pb-12 outline-none md:px-6 md:pt-6">
          <form role="search" onSubmit={openFirst} className="max-w-xl">
            <label className="flex min-h-12 items-center gap-2 rounded-xl border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <input
                ref={search}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={text.search}
                aria-label={text.search}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none"
              />
              <Kbd className="pointer-coarse:hidden">⌘K</Kbd>
            </label>
          </form>

          {searching ? (
            found.length ? (
              <Grid apps={found} onOpen={opened} onAbout={setAbout} />
            ) : (
              <p className="text-muted-foreground">{text.noMatch(q.trim())}</p>
            )
          ) : onShelf === 'pinned' ? (
            <Grid apps={pinned} onOpen={opened} onAbout={setAbout} />
          ) : (
            <>
              {onShelf === 'all' && pinned.length ? (
                <Section title={text.pinned}>
                  <Grid apps={pinned} onOpen={opened} onAbout={setAbout} />
                </Section>
              ) : null}
              {onShelf === 'all' && recent.length ? (
                <Section title={text.recent}>
                  <ul className="flex flex-wrap gap-2">
                    {recent.map((app) => (
                      <li key={app.id}>
                        <a
                          {...openProps(app)}
                          onClick={() => opened(app)}
                          className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-card py-1 pr-4 pl-1 text-sm font-medium hover:bg-accent"
                        >
                          <TileIcon app={app} className="size-8 rounded-full p-1.5" />
                          {appName(app)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
              {sections(shown, onShelf).map((s) => (
                <Section key={s.group} title={text.groups[s.group]}>
                  <Grid apps={s.apps} onOpen={opened} onAbout={setAbout} />
                </Section>
              ))}
            </>
          )}
        </main>
      </div>

      <About
        app={about}
        pinned={about ? places.pinned.includes(about.id) : false}
        onPin={() => about && change(togglePin(places, about.id))}
        onOpen={() => about && opened(about)}
        onClose={() => setAbout(null)}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

/** How a tile's link opens: on this origin as a page, a linked site in a new tab. */
const openProps = (app: LauncherApp) => (app.tier === 'linked' ? { href: app.href, target: '_blank', rel: 'noopener noreferrer' } : { href: app.href })

function TileIcon({ app, className }: { app: LauncherApp; className?: string }) {
  const Icon = icons[app.icon]
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center text-white', className)} style={{ backgroundColor: app.color }}>
      <Icon className="size-full" />
    </span>
  )
}

function Grid({ apps, onOpen, onAbout }: { apps: LauncherApp[]; onOpen: (a: LauncherApp) => void; onAbout: (a: LauncherApp) => void }) {
  const text = launcherText()
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 md:gap-4 xl:grid-cols-6 2xl:grid-cols-8">
      {apps.map((app) => {
        const Icon = icons[app.icon]
        const name = appName(app)
        return (
          <li key={app.id} className="relative min-w-0">
            <a
              {...openProps(app)}
              onClick={() => onOpen(app)}
              onContextMenu={(e) => {
                e.preventDefault()
                onAbout(app)
              }}
              className="flex aspect-square flex-col justify-between rounded-2xl p-3 text-white shadow-sm transition-transform outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] md:p-4"
              style={{ backgroundColor: app.color }}
            >
              <Icon aria-hidden className="size-7 md:size-9" />
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="text-sm leading-tight font-semibold text-balance [overflow-wrap:anywhere] md:text-base">{name}</span>
                {app.stage !== 'live' ? (
                  <span className="rounded-md bg-white/20 px-1.5 py-px text-[11px] font-semibold tracking-wide uppercase">{text.stages[app.stage]}</span>
                ) : null}
              </span>
            </a>
            {app.tier === 'linked' ? <ExternalLink aria-hidden className="pointer-events-none absolute top-3.5 right-12 size-4 text-white/85" /> : null}
            <button
              type="button"
              aria-label={text.moreAbout(name)}
              title={text.moreAbout(name)}
              onClick={() => onAbout(app)}
              className="absolute top-1 right-1 grid size-11 cursor-pointer place-items-center rounded-xl text-white/90 hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <Ellipsis aria-hidden className="size-5" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Where a tile runs, and Open and Pin: a sheet from the bottom on a phone, a dialog elsewhere. */
function About({ app, pinned, onPin, onOpen, onClose }: { app: LauncherApp | null; pinned: boolean; onPin: () => void; onOpen: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const text = launcherText()

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (app && !d.open) d.showModal()
    else if (!app && d.open) d.close()
  }, [app])

  const parent = app ? parentName(app) : undefined
  const address = app ? (app.tier === 'linked' ? app.href : window.location.origin + app.href) : ''
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-label={app ? appName(app) : undefined}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] max-w-none rounded-2xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl backdrop:bg-black/40 max-sm:mb-0 max-sm:w-full max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]"
    >
      {app ? (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <TileIcon app={app} className="size-12 rounded-xl p-2.5" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg leading-tight font-semibold">{appName(app)}</h2>
              <p className="text-sm text-muted-foreground">{parent ? text.screenIn(parent) : text.stages[app.stage]}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label={text.close} title={text.close} onClick={onClose}>
              <X aria-hidden className="size-5" />
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{text.where}</dt>
            <dd>{app.tier === 'linked' ? text.linked : text.here}</dd>
            {app.kind === 'app' ? (
              <>
                <dt className="text-muted-foreground">{text.stage}</dt>
                <dd>{text.stages[app.stage]}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{text.address}</dt>
            <dd className="font-mono text-xs [overflow-wrap:anywhere]">{address}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <a {...openProps(app)} onClick={onOpen} className={cn(buttonVariants({ size: 'lg' }), 'flex-1')}>
              {app.tier === 'linked' ? <ExternalLink aria-hidden className="size-4" /> : null}
              {text.open}
            </a>
            <Button variant="outline" size="lg" onClick={onPin} aria-pressed={pinned}>
              {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
              {pinned ? text.unpin : text.pin}
            </Button>
          </div>
          {app.tier === 'linked' ? <p className="text-xs text-muted-foreground">{text.newTab}</p> : null}
        </div>
      ) : null}
    </dialog>
  )
}

/** The account (the staff app's Account) and Sign out: at the rail's foot from lg, icons in the header below it. */
function AccountLinks({ name, onSignOut, compact = false }: { name: string; onSignOut: () => void; compact?: boolean }) {
  const text = launcherText()
  const item = compact
    ? cn(buttonVariants({ variant: 'ghost', size: 'icon' }))
    : 'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-accent'
  return (
    <>
      <a href={staffHref('/account')} title={text.account} aria-label={compact ? `${text.account}: ${name}` : undefined} className={item}>
        <UserRound aria-hidden className="size-4 shrink-0" />
        {compact ? null : <span className="min-w-0 truncate">{name}</span>}
      </a>
      <button type="button" onClick={onSignOut} title={text.signOut} aria-label={compact ? text.signOut : undefined} className={item}>
        <LogOut aria-hidden className="size-4 shrink-0" />
        {compact ? null : text.signOut}
      </button>
    </>
  )
}
