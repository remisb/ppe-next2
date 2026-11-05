import type { AppChannel, FeedbackRating, LauncherApp, LauncherList } from '@ppe/api-client'
import { CheckingSignIn, ConfirmPassword, Offline, type Session, SignIn, applyDensity, loadDensity, useApi } from '@ppe/app-shell'
import { currentLang } from '@ppe/i18n'
import {
  appIcons,
  appName,
  channelName,
  channelsOf,
  chosenChannel,
  devicePins,
  forgetDevicePins,
  launcherText,
  loadRecent,
  loadShowTesting,
  noteOpened,
  openHref,
  parentName,
  rememberChoice,
  rememberPins,
  saveShowTesting,
  togglePin,
  useLauncher,
} from '@ppe/launcher'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Field, Textarea, controlProps } from '@ppe/ui/components/field'
import { GavortEmblem } from '@ppe/ui/components/gavort-logo'
import { Kbd } from '@ppe/ui/components/kbd'
import { Segmented } from '@ppe/ui/components/segmented'
import { ActionError, ErrorState, Loading } from '@ppe/ui/components/states'
import { formatDate } from '@ppe/ui/lib/dates'
import { errorText } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Box, Ellipsis, ExternalLink, LogOut, Pin, PinOff, Search, UserRound, X } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { type Shelf, deviceOf, matching, pinnedOf, recentOf, sections, shownTiles } from '@/lib/tiles'

/**
 * App Launcher (ADR 0006): the apps and shortcuts the user's roles open, from
 * the API's registry, as big tiles in groups, like a till. Pinned tiles (kept
 * by the API) and recent apps (on this device) come first; from lg a rail of
 * groups narrows the tiles. A tile opens its app as a page (a linked site in a
 * new tab); ⋯ or a right-click shows where it runs, pins it and takes
 * feedback, and for a published app with more than Stable to offer the user,
 * which version (channel) opens for them. Testers show apps in testing with a switch. It shares the staff
 * app's sign-in, so signing in or out here does so there too.
 */
export function App() {
  const { session, status, retry, signOut, passwordPrompt } = useApi()
  const launcher = useLauncher()

  useEffect(() => applyDensity(session ? loadDensity(session.userId) : null), [session?.userId])

  if (status === 'starting') return <CheckingSignIn />
  if (status === 'offline') return <Offline onRetry={retry} />
  if (!session) return <SignIn appName={launcherText().launcherName} tagline={launcherText().signInTagline} />
  return (
    <>
      {launcher.list ? (
        // Keyed by user: its pins and choices are state taken from the list once.
        <Launcher key={session.userId} session={session} list={launcher.list} onSignOut={() => void signOut()} />
      ) : (
        <main className="mx-auto grid min-h-dvh w-full max-w-xl content-center px-4 py-8">
          {launcher.failed ? (
            <ErrorState error={new Error(launcherText().loadFailed)} title={launcherText().loadFailed} onRetry={launcher.retry} retryLabel={launcherText().retry} />
          ) : (
            <Loading />
          )}
        </main>
      )}
      <ConfirmPassword prompt={passwordPrompt} />
    </>
  )
}

function Launcher({ session, list, onSignOut }: { session: Session; list: LauncherList; onSignOut: () => void }) {
  const { client } = useApi()
  const text = launcherText()
  const [q, setQ] = useState('')
  const [shelf, setShelf] = useState<Shelf>('all')
  const [pins, setPins] = useState<string[]>(list.pins)
  const [recent, setRecent] = useState<string[]>(() => loadRecent(session.userId))
  const [showTesting, setShowTesting] = useState(() => list.preview && loadShowTesting(session.userId))
  const [about, setAbout] = useState<LauncherApp | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>(list.choices ?? {})
  const search = useRef<HTMLInputElement>(null)
  const current: LauncherList = { ...list, choices }
  const hrefOf = (app: LauncherApp) => openHref(app, current)

  const shown = shownTiles(list.apps, showTesting)
  const found = matching(shown, q)
  const searching = q.trim() !== ''
  const pinned = pinnedOf(shown, pins)
  const recentApps = recentOf(shown, recent)

  // A save that fails puts things back as they were and says so, here and in the ⋯ dialog.
  const [saveError, setSaveError] = useState<{ title: string; error: unknown } | null>(null)
  const savePins = (next: string[]): Promise<boolean> => {
    const before = pins
    setPins(next)
    return client.launcher.setPins(next).then(
      (r) => {
        rememberPins(session.userId, r.slugs)
        setSaveError(null)
        return true
      },
      (error: unknown) => {
        setPins(before)
        setSaveError({ title: text.pinsNotSaved, error })
        return false
      },
    )
  }
  const opened = (app: LauncherApp) => setRecent(noteOpened(session.userId, app.slug))
  const chooseChannel = (app: LauncherApp, channel: string) => {
    const before = choices
    const next = { ...choices }
    if (channel === 'stable') delete next[app.slug]
    else next[app.slug] = channel
    setChoices(next)
    client.launcher.chooseChannel(app.slug, channel).then(
      () => {
        rememberChoice(session.userId, app.slug, channel)
        setSaveError(null)
      },
      (error: unknown) => {
        setChoices(before)
        setSaveError({ title: text.choiceNotSaved, error })
      },
    )
  }

  // Pins phase 1 kept on this device go to the API once, while it has none.
  useEffect(() => {
    // Forgotten on this device only once the API has them, or has pins of its own.
    const device = devicePins(session.userId).filter((slug) => list.apps.some((a) => a.slug === slug))
    if (device.length && !list.pins.length) void savePins(device).then((saved) => saved && forgetDevicePins(session.userId))
    else forgetDevicePins(session.userId)
    // Once per load of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])

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
    else window.location.assign(hrefOf(first))
  }

  const shelves: { shelf: Shelf; label: string; count: number }[] = [
    { shelf: 'all', label: text.all, count: shown.length },
    ...(pinned.length ? [{ shelf: 'pinned' as const, label: text.pinned, count: pinned.length }] : []),
    ...sections(shown, 'all').map((s) => ({ shelf: s.group, label: text.groups[s.group], count: s.apps.length })),
  ]
  const onShelf = shelves.some((s) => s.shelf === shelf) ? shelf : 'all'
  const grid = (apps: LauncherApp[]) => <Grid apps={apps} list={current} onOpen={opened} onAbout={setAbout} />

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
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium hover:bg-accent aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-foreground"
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
          <ActionError title={saveError?.title} error={saveError?.error} />
          <div className="flex flex-col gap-3">
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
            {list.preview ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm">
                <input
                  type="checkbox"
                  role="switch"
                  checked={showTesting}
                  onChange={(e) => {
                    setShowTesting(e.target.checked)
                    saveShowTesting(session.userId, e.target.checked)
                  }}
                  className="size-5 accent-primary"
                />
                <span>
                  <span className="font-medium">{text.showTesting}</span>
                  <span className="block text-xs text-muted-foreground">{text.showTestingHint}</span>
                </span>
              </label>
            ) : null}
          </div>

          {searching ? (
            found.length ? (
              grid(found)
            ) : (
              <p className="text-muted-foreground">{text.noMatch(q.trim())}</p>
            )
          ) : onShelf === 'pinned' ? (
            grid(pinned)
          ) : (
            <>
              {onShelf === 'all' && pinned.length ? <Section title={text.pinned}>{grid(pinned)}</Section> : null}
              {onShelf === 'all' && recentApps.length ? (
                <Section title={text.recent}>
                  <ul className="flex flex-wrap gap-2">
                    {recentApps.map((app) => (
                      <li key={app.slug}>
                        <a
                          {...openProps(app, hrefOf(app))}
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
                  {grid(s.apps)}
                </Section>
              ))}
            </>
          )}
        </main>
      </div>

      <About
        app={about}
        list={current}
        onChoose={chooseChannel}
        pinned={about ? pins.includes(about.slug) : false}
        onPin={() => about && void savePins(togglePin(pins, about.slug))}
        saveError={saveError}
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

/** How a tile's link opens: on this origin as a page (a published app on the user's channel), a linked site in a new tab. */
const openProps = (app: LauncherApp, href: string) => (app.tier === 'linked' ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href })

function TileIcon({ app, className }: { app: LauncherApp; className?: string }) {
  const Icon = appIcons[app.icon] ?? Box
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center text-white', className)} style={{ backgroundColor: app.color }}>
      <Icon className="size-full" />
    </span>
  )
}

function Grid({ apps, list, onOpen, onAbout }: { apps: LauncherApp[]; list: LauncherList; onOpen: (a: LauncherApp) => void; onAbout: (a: LauncherApp) => void }) {
  const text = launcherText()
  const all = list.apps
  return (
    // Four on a tablet and five from lg (beside the rail), so a long name has room; a word that still
    // does not fit is hyphenated in the page's language, and broken only as a last resort.
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
      {apps.map((app) => {
        const Icon = appIcons[app.icon] ?? Box
        const name = appName(app)
        const channel = chosenChannel(list, app.slug)
        return (
          <li key={app.slug} className="relative min-w-0">
            <a
              {...openProps(app, openHref(app, list))}
              onClick={() => onOpen(app)}
              onContextMenu={(e) => {
                e.preventDefault()
                onAbout(app)
              }}
              title={parentName(app, all) ? text.screenIn(parentName(app, all)!) : undefined}
              className="flex aspect-square flex-col justify-between rounded-2xl p-3 text-white shadow-sm transition-transform outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] md:p-4"
              style={{ backgroundColor: app.color }}
            >
              <Icon aria-hidden className="size-7 md:size-9" />
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="text-sm leading-tight font-semibold text-balance hyphens-auto [overflow-wrap:anywhere] xl:text-base">{name}</span>
                {app.stage !== 'live' ? (
                  <span className="rounded-md bg-white/20 px-1.5 py-px text-[11px] font-semibold tracking-wide uppercase">{text.stages[app.stage]}</span>
                ) : null}
                {channel !== 'stable' ? (
                  <span className="rounded-md bg-amber-200 px-1.5 py-px text-[11px] font-semibold text-amber-950">{channelName(channel, channelsOf(list, app.slug))}</span>
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

/**
 * Where a tile runs, Open and Pin, and for an app its Feedback: a sheet from
 * the bottom on a phone, a dialog elsewhere.
 */
function About({
  app,
  list,
  onChoose,
  pinned,
  onPin,
  onOpen,
  onClose,
  saveError,
}: {
  app: LauncherApp | null
  list: LauncherList
  onChoose: (app: LauncherApp, channel: string) => void
  pinned: boolean
  onPin: () => void
  onOpen: () => void
  onClose: () => void
  saveError: { title: string; error: unknown } | null
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const text = launcherText()
  const [tab, setTab] = useState<'about' | 'feedback' | 'versions'>('about')
  const all = list.apps
  // Versions only when there is more than Stable to choose from.
  const channels = app ? channelsOf(list, app.slug) : []

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (app && !d.open) {
      setTab('about')
      d.showModal()
    } else if (!app && d.open) d.close()
  }, [app])

  const parent = app ? parentName(app, all) : undefined
  const href = app ? openHref(app, list) : ''
  const address = app ? (app.tier === 'linked' ? href : window.location.origin + href) : ''
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
          <ActionError title={saveError?.title} error={saveError?.error} />
          {app.kind === 'app' ? (
            <Segmented
              label={appName(app)}
              options={[
                { value: 'about', label: text.about },
                ...(channels.length > 1 ? [{ value: 'versions' as const, label: text.versions }] : []),
                { value: 'feedback', label: text.feedback },
              ]}
              value={tab}
              onChange={setTab}
            />
          ) : null}
          {tab === 'feedback' && app.kind === 'app' ? (
            <FeedbackForm key={app.slug} app={app} />
          ) : tab === 'versions' && channels.length > 1 ? (
            <Versions channels={channels} chosen={chosenChannel(list, app.slug)} onChoose={(c) => onChoose(app, c)} />
          ) : (
            <>
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
                <a {...openProps(app, href)} onClick={onOpen} className={cn(buttonVariants({ size: 'lg' }), 'flex-1')}>
                  {app.tier === 'linked' ? <ExternalLink aria-hidden className="size-4" /> : null}
                  {text.open}
                </a>
                <Button variant="outline" size="lg" onClick={onPin} aria-pressed={pinned}>
                  {pinned ? <PinOff aria-hidden className="size-4" /> : <Pin aria-hidden className="size-4" />}
                  {pinned ? text.unpin : text.pin}
                </Button>
              </div>
              {app.tier === 'linked' ? <p className="text-xs text-muted-foreground">{text.newTab}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </dialog>
  )
}

/** The channels of a published app the user sees, each with its version; choosing one opens the app on it from now on. */
function Versions({ channels, chosen, onChoose }: { channels: AppChannel[]; chosen: string; onChoose: (channel: string) => void }) {
  const text = launcherText()
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-muted-foreground">{text.versionsHint}</legend>
      {channels.map((c) => (
        <label
          key={c.name}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 has-checked:border-primary has-checked:bg-accent"
        >
          <input type="radio" name="channel" value={c.name} checked={chosen === c.name} onChange={() => onChoose(c.name)} className="size-4 accent-primary" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{channelName(c.name, channels)}</span>
            <span className="block text-xs text-muted-foreground">
              {text.version} {c.version} · {text.published(formatDate(c.published_at, undefined))}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** Works well, Confusing or Something broke, and what they were doing; sent with the device and language. */
function FeedbackForm({ app }: { app: LauncherApp }) {
  const { client } = useApi()
  const text = launcherText()
  const [rating, setRating] = useState<FeedbackRating | undefined>()
  const [note, setNote] = useState('')
  const [state, setState] = useState<{ busy?: boolean; sent?: boolean; error?: string }>({})

  if (state.sent) return <p role="status">{text.feedbackSent(appName(app))}</p>
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!rating) {
      setState({ error: text.chooseRating })
      return
    }
    setState({ busy: true })
    try {
      await client.launcher.sendFeedback({ app: app.slug, rating, text: note, device: deviceOf(window.innerWidth), language: currentLang() })
      setState({ sent: true })
    } catch (err) {
      setState({ error: errorText(err) })
    }
  }
  return (
    <form onSubmit={send} className="flex flex-col gap-3" noValidate>
      <p className="text-sm">{text.feedbackAsk(appName(app))}</p>
      <Segmented
        label={text.feedbackAsk(appName(app))}
        options={(['works', 'confusing', 'broken'] as const).map((r) => ({ value: r, label: text.ratings[r] }))}
        value={rating}
        onChange={setRating}
      />
      <Field label={text.feedbackText}>{(p) => <Textarea {...controlProps(p)} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />}</Field>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={state.busy}>
        {text.sendFeedback}
      </Button>
    </form>
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
