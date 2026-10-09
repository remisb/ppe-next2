import { CheckingSignIn, ConfirmPassword, Offline, SignIn, applyDensity, canAdminister, loadDensity, useApi } from '@ppe/app-shell'
import { adminHref } from '@ppe/routing'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { Brand, moreIcon, moreItem, navIcon, navItem } from '@ppe/ui/components/main-nav'
import { Loading } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { BookOpen, Boxes, ClipboardList, Ellipsis, History as HistoryIcon, Keyboard, LayoutDashboard, LogOut, Package, Plus, RotateCcw, Search, ShieldCheck, Shirt, UserRound, Users } from 'lucide-react'
import { Suspense, lazy, useEffect, useRef, useState } from 'react'

import { CommandPalette, type PaletteSection } from '@/components/command-palette'
import { t } from '@/i18n'
import { type Route, canGoBack, linkTo, startRoute, useRouter } from '@/lib/router'
import { type GoTarget, shortcutList, useShortcuts } from '@/lib/shortcuts'
import { draftLineCount } from '@/lib/working-order'

import { Account } from './routes/account'
import { AssetPage } from './routes/asset'
import { AssetFormPage } from './routes/asset-form'
import { Assets } from './routes/assets'
import { Catalogue } from './routes/catalogue'
import { CatalogueItemPage } from './routes/catalogue-item'
import { ConfirmPage } from './routes/confirm'
import { CreateOrder } from './routes/create-order'
import { Dashboard } from './routes/dashboard'
import { EmployeePage } from './routes/employee'
import { EmployeeDashboard } from './routes/employee-dashboard'
import { Employees } from './routes/employees'
import { History } from './routes/history'
import { ItemSets } from './routes/item-sets'
import { ManagerDashboard } from './routes/manager-dashboard'
import { RecordPage } from './routes/record'
import { Replacements } from './routes/replacements'

// The guide's text in three languages is read rarely: its own chunk, loaded when Help opens.
const Help = lazy(() => import('./routes/help').then((m) => ({ default: m.Help })))

interface Tab {
  route: Route
  label: string
  short: string
  icon: typeof Users
}

/** The everyday sections, in the language in use (so built on each render, never at import). */
const tabs = (): Tab[] => [
  { route: { name: 'createOrder' }, label: t.shell.createOrder, short: t.shell.shortOrder, icon: ClipboardList },
  { route: { name: 'history' }, label: t.shell.history, short: t.shell.shortHistory, icon: HistoryIcon },
  { route: { name: 'employees' }, label: t.shell.employees, short: t.shell.shortEmployees, icon: Users },
  { route: { name: 'assets' }, label: t.shell.companyAssets, short: t.shell.shortAssets, icon: Boxes },
  { route: { name: 'catalogue' }, label: t.shell.catalogue, short: t.shell.shortCatalogue, icon: Shirt },
  { route: { name: 'itemSets' }, label: t.shell.itemSets, short: t.shell.shortItemSets, icon: Package },
]
/** A start screen's tab: the Dashboard for administrators, managers and the employee role alike. */
const homeTab = (name: 'dashboard' | 'managerDashboard' | 'employeeDashboard'): Tab => ({
  route: { name },
  label: t.shell.dashboard,
  short: t.shell.shortDashboard,
  icon: LayoutDashboard,
})
/**
 * A record belongs to Orders (History in the code), an employee to Employees
 * and an item to Item Catalogue, so those stay the current section; so does
 * Orders for Create Order, which the rail and sidebar reach through it; so does a user's one Dashboard tab for another role's
 * dashboard opened from it.
 */
function isCurrent(current: Route['name'], tab: Route['name']): boolean {
  return (
    current === tab ||
    (current === 'record' && tab === 'history') ||
    (current === 'createOrder' && tab === 'history') ||
    (current === 'employee' && tab === 'employees') ||
    ((current === 'asset' || current === 'assetForm') && tab === 'assets') ||
    (current === 'catalogueItem' && tab === 'catalogue') ||
    (current === 'managerDashboard' && tab === 'dashboard') ||
    (current === 'employeeDashboard' && (tab === 'dashboard' || tab === 'managerDashboard')) ||
    // Replacements due is opened from a dashboard: the user's one Dashboard tab stays current.
    (current === 'replacements' && (tab === 'dashboard' || tab === 'managerDashboard' || tab === 'employeeDashboard'))
  )
}

/** The phone tab bar holds this many sections; the rest, the account and Sign out are under More. */
const phoneTabs = 4
/**
 * Where the phone bar puts the other sections: Create Order is the raised
 * button in the middle (order 3) and More is last, so the rail and sidebar
 * keep the one order of the markup.
 */
const phoneOrder = ['max-md:order-1', 'max-md:order-2', 'max-md:order-4', 'max-md:order-5']

export function App() {
  const { session, status, retry, signOut, client, passwordPrompt } = useApi()
  const { route: asked, navigate } = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const morePanel = useRef<HTMLDivElement>(null)
  // Orders waiting for the employee's confirmation, as a count on History;
  // refreshed on every navigation, so it follows Mark as Ordered and confirmations.
  const awaiting = useLoad(
    () => (session ? client.orders.list({ status: 'ORDERED', page_size: 1 }).then((p) => p.total) : Promise.resolve(0)),
    [asked, session?.token],
  )

  // "G then a letter" goes to a section the user has; D is their start screen.
  const goTo: Record<GoTarget, Route> = {
    d: { name: 'home' },
    o: { name: 'createOrder' },
    h: { name: 'history' },
    e: { name: 'employees' },
    a: { name: 'assets' },
    c: { name: 'catalogue' },
    s: { name: 'itemSets' },
    u: { name: 'administration', path: '/users' },
  }
  useShortcuts(
    {
      palette: () => setPaletteOpen(true),
      // The screen's own search or Add Item field; the palette where there is none.
      search: () => {
        const field = document.querySelector<HTMLElement>('[data-shortcut=search]')
        if (field) field.focus()
        else setPaletteOpen(true)
      },
      newOrder: () => navigate({ name: 'createOrder' }),
      go: (k) => {
        if (k !== 'u' || session?.can('users.manage')) navigate(goTo[k])
      },
      help: () => setHelpOpen(true),
    },
    session !== null,
  )

  // The signed-in user's table density; no one's once signed out.
  useEffect(() => applyDensity(session ? loadDensity(session.userId) : null), [session?.userId])

  // More closes when a section is chosen (any navigation) and on Escape.
  useEffect(() => setMoreOpen(false), [asked])
  // Users, Settings and Backups are Administration's now: their old addresses, links and G then U go there.
  useEffect(() => {
    if (asked.name === 'administration') window.location.replace(adminHref(asked.path))
  }, [asked])
  useEffect(() => {
    if (!moreOpen) return
    morePanel.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  // The public confirmation page is checked before the session gate: its
  // visitor is an employee with a link, not a signed-in user.
  if (asked.name === 'confirm') return <ConfirmPage token={asked.token} />
  // A screen that moved to Administration: the effect above sends the browser there.
  if (asked.name === 'administration') return <CheckingSignIn />
  // The refresh cookie answers whether this browser is signed in; until then, neither the app nor Sign in.
  if (status === 'starting') return <CheckingSignIn />
  if (status === 'offline') return <Offline onRetry={retry} />
  if (!session) return <SignIn appName={t.common.appName} tagline={t.shell.signInTagline} />
  const route = startRoute(asked, session.can)
  // Administration's link, for users who may open one of its screens.
  const administration = canAdminister(session)
  const home = startRoute({ name: 'home' }, session.can)
  const shownTabs = [
    ...(home.name === 'dashboard' || home.name === 'managerDashboard' || home.name === 'employeeDashboard' ? [homeTab(home.name)] : []),
    ...tabs(),
  ]

  const sections: PaletteSection[] = [
    ...shownTabs.map((tab) => ({ route: tab.route, label: tab.label, icon: tab.icon })),
    { route: { name: 'replacements' }, label: t.shell.replacements, icon: RotateCcw },
    { route: { name: 'account' }, label: t.shell.accountAndPassword, icon: UserRound },
    { route: { name: 'help' }, label: t.shell.userGuide, icon: BookOpen },
  ]
  const primary = shownTabs.slice(0, phoneTabs)
  const more = shownTabs.slice(phoneTabs)
  const moreCurrent = route.name === 'account' || more.some((tab) => isCurrent(route.name, tab.route.name))
  const waiting = awaiting.data ?? 0
  // The saved draft's lines, read again on every render (each navigation among them): the New order button shows them.
  const draftLines = draftLineCount(session.userId)
  let placed = 0

  const link = (to: Route) => linkTo(to, navigate)
  /** Back to where the user came from inside the app, else to the given screen (a shared or bookmarked link). */
  const back = (fallback: Route) => () => (canGoBack() ? window.history.back() : navigate(fallback))

  // No grid in print: the navigation is hidden there, and the page would fall into its narrow column.
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[5.5rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)] print:block">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        {t.shell.skipToContent}
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden print:hidden">
        <div className="flex h-14 items-center px-4">
          <Brand name={t.common.appName} />
        </div>
      </header>

      <aside className="print:hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-border md:bg-sidebar">
        <div className="hidden h-16 shrink-0 items-center justify-center px-3 md:flex xl:justify-start xl:px-5">
          <Brand name={t.common.appName} />
        </div>
        {/* The palette's way in for the mouse: an icon in the rail, a search field look in the sidebar. */}
        <div className="hidden px-2 pb-1 md:block xl:px-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={cn(
              navItem,
              'w-full cursor-pointer xl:justify-between xl:border xl:border-border xl:bg-background xl:py-2 xl:text-muted-foreground xl:hover:bg-background',
            )}
          >
            <span className={navIcon}>
              <Search aria-hidden className="size-5 xl:size-4" />
            </span>
            <span className="xl:hidden">{t.common.search}</span>
            <span className="hidden flex-1 text-left xl:inline">{t.shell.searchEllipsis}</span>
            <kbd className="hidden rounded border border-border px-1.5 font-mono text-[0.625rem] xl:inline">⌘K</kbd>
          </button>
        </div>
        {/* A phone's More panel dims the page; a tap outside closes it. */}
        {moreOpen ? <div aria-hidden className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMoreOpen(false)} /> : null}
        <nav
          aria-label={t.shell.mainNav}
          className={cn(
            'fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80',
            'md:static md:flex md:flex-col md:gap-1 md:border-0 md:bg-transparent md:p-2 md:backdrop-blur-none xl:p-3',
          )}
        >
          {primary.map((tab) =>
            tab.route.name === 'createOrder' ? (
              <NewOrderLink key={tab.route.name} tab={tab} current={isCurrent(route.name, tab.route.name)} link={link} draftLines={draftLines} />
            ) : (
              <NavLink
                key={tab.route.name}
                tab={tab}
                current={isCurrent(route.name, tab.route.name)}
                link={link}
                badge={tab.route.name === 'history' ? waiting : 0}
                className={phoneOrder[placed++]}
              />
            ),
          )}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="more-sections"
            data-active={moreOpen || moreCurrent}
            onClick={() => setMoreOpen((o) => !o)}
            className={cn(navItem, 'cursor-pointer max-md:order-5 md:hidden')}
          >
            <span className={navIcon}>
              <Ellipsis aria-hidden className="size-5" />
            </span>
            {t.shell.more}
          </button>
          {/*
            The rest of the sections: a panel above the tab bar on a phone,
            opened by More; from md they flow on in the rail and sidebar.
          */}
          <div
            id="more-sections"
            ref={morePanel}
            className={cn(
              moreOpen
                ? 'fixed inset-x-0 bottom-[var(--bottom-nav)] z-30 flex max-h-[70dvh] flex-col gap-1 overflow-y-auto rounded-t-2xl border-t border-border bg-background p-2 shadow-lg'
                : 'hidden',
              'md:contents',
            )}
          >
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false)
                setPaletteOpen(true)
              }}
              className={cn(moreItem, 'w-full cursor-pointer md:hidden')}
            >
              <span className={moreIcon}>
                <Search aria-hidden className="size-5" />
              </span>
              {t.common.search}
            </button>
            {more.map((tab) => (
              <NavLink key={tab.route.name} tab={tab} current={isCurrent(route.name, tab.route.name)} link={link} item={moreItem} icon={moreIcon} />
            ))}
            {/* The rail and sidebar show the account and Sign out at their foot instead. */}
            <div className="mt-1 flex flex-col gap-1 border-t border-border pt-1 md:hidden">
              {administration ? (
                <a href={adminHref('/')} className={moreItem}>
                  <span className={moreIcon}>
                    <ShieldCheck aria-hidden className="size-5" />
                  </span>
                  {t.shell.administration}
                </a>
              ) : null}
              <a {...link({ name: 'help' })} aria-current={route.name === 'help' ? 'page' : undefined} className={moreItem}>
                <span className={moreIcon}>
                  <BookOpen aria-hidden className="size-5" />
                </span>
                {t.shell.help}
              </a>
              <a {...link({ name: 'account' })} aria-current={route.name === 'account' ? 'page' : undefined} className={moreItem}>
                <span className={moreIcon}>
                  <UserRound aria-hidden className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col items-start leading-tight">
                  <span className="truncate">{session.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{t.shell.accountAndPassword}</span>
                </span>
              </a>
              <button type="button" onClick={signOut} className={cn(moreItem, 'w-full cursor-pointer')}>
                <span className={moreIcon}>
                  <LogOut aria-hidden className="size-5" />
                </span>
                {t.shell.signOut}
              </button>
            </div>
          </div>
        </nav>
        <div className="mt-auto hidden flex-col gap-1 border-t border-border p-2 md:flex xl:p-3">
          {administration ? (
            <a href={adminHref('/')} title={t.shell.administration} className={navItem}>
              <span className={navIcon}>
                <ShieldCheck aria-hidden className="size-5 xl:size-4" />
              </span>
              <span aria-hidden className="xl:hidden">
                {t.shell.shortAdministration}
              </span>
              <span className="sr-only xl:not-sr-only">{t.shell.administration}</span>
            </a>
          ) : null}
          <a {...link({ name: 'help' })} aria-current={route.name === 'help' ? 'page' : undefined} title={t.shell.userGuide} className={navItem}>
            <span className={navIcon}>
              <BookOpen aria-hidden className="size-5 xl:size-4" />
            </span>
            {t.shell.help}
          </a>
          <button type="button" onClick={() => setHelpOpen(true)} className={cn(navItem, 'w-full cursor-pointer pointer-coarse:hidden')}>
            <span className={navIcon}>
              <Keyboard aria-hidden className="size-5 xl:size-4" />
            </span>
            <span className="xl:hidden">{t.shell.shortKeys}</span>
            <span className="hidden xl:inline">{t.shell.keyboardShortcuts}</span>
          </button>
          <a
            {...link({ name: 'account' })}
            aria-current={route.name === 'account' ? 'page' : undefined}
            title={t.shell.accountAndPassword}
            className={navItem}
          >
            <span className={navIcon}>
              <UserRound aria-hidden className="size-5 xl:size-4" />
            </span>
            <span className="xl:hidden">{t.shell.shortAccount}</span>
            <span className="hidden truncate xl:inline">{session.name}</span>
          </a>
          <button type="button" onClick={signOut} className={cn(navItem, 'w-full cursor-pointer')}>
            <span className={navIcon}>
              <LogOut aria-hidden className="size-5 xl:size-4" />
            </span>
            {t.shell.signOut}
          </button>
        </div>
      </aside>

      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'mx-auto w-full max-w-6xl px-4 pt-5 pb-[calc(var(--bottom-nav)+1.5rem)] outline-none',
          'md:px-6 md:py-8 xl:px-10 print:max-w-none print:p-0',
        )}
      >
        {route.name === 'dashboard' ? <Dashboard navigate={navigate} /> : null}
        {route.name === 'managerDashboard' ? <ManagerDashboard navigate={navigate} /> : null}
        {route.name === 'employeeDashboard' ? <EmployeeDashboard navigate={navigate} /> : null}
        {route.name === 'createOrder' ? <CreateOrder prefill={route.prefill} navigate={navigate} /> : null}
        {route.name === 'employees' ? <Employees missing={route.missing ?? false} navigate={navigate} /> : null}
        {route.name === 'employee' ? <EmployeePage id={route.id} navigate={navigate} onBack={back({ name: 'employees' })} /> : null}
        {route.name === 'assets' ? <Assets key={route.tile ?? 'all'} tile={route.tile} navigate={navigate} /> : null}
        {route.name === 'asset' ? <AssetPage id={route.id} navigate={navigate} onBack={back({ name: 'assets' })} /> : null}
        {route.name === 'assetForm' ? (
          <AssetFormPage
            id={route.id}
            assignment={route.assignment}
            draft={route.draft}
            autoPrint={route.print ?? false}
            onBack={back({ name: 'asset', id: route.id })}
          />
        ) : null}
        {route.name === 'catalogue' ? <Catalogue navigate={navigate} /> : null}
        {route.name === 'catalogueItem' ? (
          <CatalogueItemPage id={route.id} navigate={navigate} onBack={back({ name: 'catalogue' })} />
        ) : null}
        {route.name === 'itemSets' ? <ItemSets navigate={navigate} /> : null}
        {route.name === 'replacements' ? <Replacements navigate={navigate} onBack={back({ name: 'home' })} /> : null}
        {route.name === 'account' ? <Account onSignOut={signOut} /> : null}
        {route.name === 'help' ? (
          <Suspense fallback={<Loading />}>
            <Help />
          </Suspense>
        ) : null}
        {route.name === 'history' ? (
          <History
            selected={route.order}
            status={route.status}
            navigate={navigate}
            onOpenRecord={(id, print) => navigate({ name: 'record', id, print })}
          />
        ) : null}
        {route.name === 'record' ? (
          <RecordPage id={route.id} autoPrint={route.print ?? false} onBack={back({ name: 'history' })} />
        ) : null}
      </main>
      <ConfirmPassword prompt={passwordPrompt} />
      <CommandPalette open={paletteOpen} sections={sections} userId={session.userId} onClose={() => setPaletteOpen(false)} navigate={navigate} />
      <FormSheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={t.shell.keyboardShortcuts}
        description={t.shell.shortcutsHint}
        footer={
          <a
            {...link({ name: 'help' })}
            onClick={(e) => {
              setHelpOpen(false)
              link({ name: 'help' }).onClick(e)
            }}
            className="inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
          >
            <BookOpen aria-hidden className="size-4" />
            {t.shell.userGuide}
          </a>
        }
      >
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
          {shortcutList().map((s) => (
            <div key={s.keys} className="contents">
              <dt>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">{s.keys}</kbd>
              </dt>
              <dd className="text-muted-foreground max-sm:mb-2">{s.does}</dd>
            </div>
          ))}
        </dl>
      </FormSheet>
    </div>
  )
}

/** One section's link: icon, a short label in the tab bar and rail, the full label in the sidebar. */
function NavLink({
  tab: { route: r, label, short, icon: Icon },
  current,
  link,
  badge = 0,
  item = navItem,
  icon = navIcon,
  className,
}: {
  tab: Tab
  current: boolean
  link: (to: Route) => ReturnType<typeof linkTo>
  /** A count beside the icon, such as orders waiting; 0 shows none. */
  badge?: number
  item?: string
  icon?: string
  /** Placement, such as the phone bar's order. */
  className?: string | undefined
}) {
  return (
    <a {...link(r)} aria-current={current ? 'page' : undefined} className={cn(item, className)}>
      <span className={cn(icon, 'relative')}>
        <Icon aria-hidden className="size-5 xl:size-4" />
        {/* On the icon in the tab bar and rail; at the end of the row in the sidebar. */}
        {badge > 0 ? <Count n={badge} className="absolute -top-1 left-[calc(50%+0.25rem)] xl:hidden" /> : null}
      </span>
      <span aria-hidden className={cn('max-w-full truncate px-0.5 xl:hidden', item === moreItem && 'max-md:hidden')}>
        {short}
      </span>
      <span className={cn('sr-only xl:not-sr-only', item === moreItem && 'max-md:not-sr-only')}>{label}</span>
      {badge > 0 ? (
        <>
          <Count n={badge} className="ml-auto hidden xl:block" />
          <span className="sr-only"> {t.shell.waiting(badge)}</span>
        </>
      ) : null}
    </a>
  )
}

/**
 * Create Order. On a phone it is the raised button in the middle of the tab
 * bar, labelled New order, or Draft with its line count when a draft is
 * saved: the button reopens it, as Create Order always does. The rail and
 * sidebar leave it out: there it is Orders' Create Order button (and ⌘K, G O).
 */
function NewOrderLink({
  tab: { route: r, label, short, icon: Icon },
  current,
  link,
  draftLines,
}: {
  tab: Tab
  current: boolean
  link: (to: Route) => ReturnType<typeof linkTo>
  draftLines: number
}) {
  const draft = draftLines > 0
  return (
    <a {...link(r)} aria-current={current ? 'page' : undefined} className={cn(navItem, 'max-md:order-3 max-md:justify-end max-md:pb-1.5 md:hidden')}>
      <span
        className={cn(
          navIcon,
          'relative',
          // The phone's raised button: above the bar, in the primary colour, whatever the state.
          'max-md:-mt-5 max-md:size-12 max-md:max-w-none max-md:rounded-2xl max-md:bg-primary max-md:text-primary-foreground max-md:shadow-lg max-md:ring-4 max-md:ring-background',
          'max-md:group-hover:bg-primary/90 max-md:group-aria-[current=page]:bg-primary',
        )}
      >
        <Plus aria-hidden className="size-6 md:hidden" />
        <Icon aria-hidden className="size-5 max-md:hidden xl:size-4" />
        {draft && !current ? (
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full border border-border bg-background px-1 text-center text-[0.6875rem] leading-[1.125rem] font-semibold text-foreground tabular-nums md:hidden"
          >
            {draftLines > 99 ? '99+' : draftLines}
          </span>
        ) : null}
      </span>
      <span aria-hidden className="max-w-full truncate px-0.5 md:hidden">
        {draft ? t.shell.draft : t.shell.newOrderButton}
      </span>
      <span aria-hidden className="max-w-full truncate px-0.5 max-md:hidden xl:hidden">
        {short}
      </span>
      <span className="sr-only xl:not-sr-only">{label}</span>
      {draft ? <span className="sr-only"> {t.shell.draftLines(draftLines)}</span> : null}
    </a>
  )
}

function Count({ n, className }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('min-w-4 rounded-full bg-destructive px-1 text-center text-[0.625rem] leading-4 font-semibold text-white tabular-nums', className)}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
