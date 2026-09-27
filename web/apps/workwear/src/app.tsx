import { ClipboardList, Ellipsis, HardHat, History as HistoryIcon, LayoutDashboard, LogOut, Package, Shirt, UserCog, UserRound, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useApi } from '@/lib/api'
import { type Route, canGoBack, linkTo, startRoute, useRouter } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn } from '@/lib/utils'

import { Account } from './routes/account'
import { Catalogue } from './routes/catalogue'
import { CatalogueItemPage } from './routes/catalogue-item'
import { CreateOrder } from './routes/create-order'
import { Dashboard } from './routes/dashboard'
import { EmployeePage } from './routes/employee'
import { EmployeeDashboard } from './routes/employee-dashboard'
import { Employees } from './routes/employees'
import { History } from './routes/history'
import { ConfirmPage } from './routes/confirm'
import { ItemSets } from './routes/item-sets'
import { ManagerDashboard } from './routes/manager-dashboard'
import { RecordPage } from './routes/record'
import { SignIn } from './routes/sign-in'
import { UsersPage } from './routes/users'

const tabs: { route: Route; label: string; short: string; icon: typeof Users }[] = [
  { route: { name: 'createOrder' }, label: 'Create Order', short: 'Order', icon: ClipboardList },
  { route: { name: 'history' }, label: 'History', short: 'History', icon: HistoryIcon },
  { route: { name: 'employees' }, label: 'Employees', short: 'Employees', icon: Users },
  { route: { name: 'catalogue' }, label: 'Item Catalogue', short: 'Catalogue', icon: Shirt },
  { route: { name: 'itemSets' }, label: 'Item Sets', short: 'Sets', icon: Package },
]
/** Administrators only: the Dashboard first, as their start screen, and Users after the everyday sections. */
const dashboardTab = { route: { name: 'dashboard' }, label: 'Dashboard', short: 'Home', icon: LayoutDashboard } satisfies (typeof tabs)[number]
/**
 * Managers' start screen, first in their tabs. An administrator who is also a
 * manager keeps the one Dashboard tab and reaches this one from the Dashboard.
 */
const managerTab = { route: { name: 'managerDashboard' }, label: 'Dashboard', short: 'Home', icon: LayoutDashboard } satisfies (typeof tabs)[number]
/** The employee role's start screen, first in their tabs, as for managers. */
const employeeTab = { route: { name: 'employeeDashboard' }, label: 'Dashboard', short: 'Home', icon: LayoutDashboard } satisfies (typeof tabs)[number]
const usersTab = { route: { name: 'users' }, label: 'Users', short: 'Users', icon: UserCog } satisfies (typeof tabs)[number]

/**
 * A record belongs to History, an employee to Employees and an item to Item
 * Catalogue, so those stay the
 * current section; so does a user's one Dashboard tab for another role's
 * dashboard opened from it.
 */
function isCurrent(current: Route['name'], tab: Route['name']): boolean {
  return (
    current === tab ||
    (current === 'record' && tab === 'history') ||
    (current === 'employee' && tab === 'employees') ||
    (current === 'catalogueItem' && tab === 'catalogue') ||
    (current === 'managerDashboard' && tab === 'dashboard') ||
    (current === 'employeeDashboard' && (tab === 'dashboard' || tab === 'managerDashboard'))
  )
}

/** The phone tab bar holds this many sections; the rest, the account and Sign out are under More. */
const phoneTabs = 4

/*
 * One navigation, three layouts:
 *   phone (< md)   the first four sections are a bottom tab bar within thumb
 *                  reach, above the home bar; More opens a panel above it with
 *                  the other sections, the account and Sign out
 *   tablet (md)    a 5.5rem side rail: icon over a short label. It stays up to
 *                  xl so a landscape tablet (1024px) keeps room for tables
 *   desktop (xl)   a 15rem sidebar: icon beside the full label
 * The link's accessible name is always the full label, from its (visually
 * hidden) text rather than aria-label, which would also turn up in label
 * lookups such as a field's "Item Set".
 */
const navItem = cn(
  'group relative flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors',
  'h-16 focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:rounded-lg md:py-2',
  'xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:py-2.5 xl:text-sm',
  'hover:text-foreground aria-[current=page]:text-foreground data-[active=true]:text-foreground xl:hover:bg-accent xl:aria-[current=page]:bg-accent',
)
/** The icon's pill is the phone and rail's active marker; the sidebar highlights the whole row. */
const navIcon = cn(
  'flex h-8 w-full max-w-14 items-center justify-center rounded-full transition-colors xl:h-auto xl:w-auto xl:max-w-none',
  'group-hover:bg-accent/60 group-aria-[current=page]:bg-accent group-data-[active=true]:bg-accent xl:group-hover:bg-transparent xl:group-aria-[current=page]:bg-transparent',
)
/** A section under More: a full-width row in the phone's panel, a normal item in the rail and sidebar. */
const moreItem = cn(
  navItem,
  'max-md:h-12 max-md:flex-row max-md:justify-start max-md:gap-3 max-md:rounded-lg max-md:px-3 max-md:text-sm',
  'max-md:hover:bg-accent max-md:aria-[current=page]:bg-accent',
)
const moreIcon = cn(navIcon, 'max-md:h-auto max-md:w-auto max-md:group-aria-[current=page]:bg-transparent max-md:group-hover:bg-transparent')

export function App() {
  const { session, signOut, client } = useApi()
  const { route: asked, navigate } = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const morePanel = useRef<HTMLDivElement>(null)
  // Orders waiting for the employee's confirmation, as a count on History;
  // refreshed on every navigation, so it follows Mark as Ordered and confirmations.
  const awaiting = useLoad(
    () => (session ? client.orders.list({ status: 'ORDERED', page_size: 1 }).then((p) => p.total) : Promise.resolve(0)),
    [asked, session?.token],
  )

  // More closes when a section is chosen (any navigation) and on Escape.
  useEffect(() => setMoreOpen(false), [asked])
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
  if (!session) return <SignIn />
  const route = startRoute(asked, session)
  const shownTabs = session.isAdmin
    ? [dashboardTab, ...tabs, usersTab]
    : session.isManager
      ? [managerTab, ...tabs]
      : session.isEmployee
        ? [employeeTab, ...tabs]
        : tabs

  const primary = shownTabs.slice(0, phoneTabs)
  const more = shownTabs.slice(phoneTabs)
  const moreCurrent = route.name === 'account' || more.some((t) => isCurrent(route.name, t.route.name))
  const waiting = awaiting.data ?? 0

  const link = (to: Route) => linkTo(to, navigate)
  /** Back to where the user came from inside the app, else to the given screen (a shared or bookmarked link). */
  const back = (fallback: Route) => () => (canGoBack() ? window.history.back() : navigate(fallback))

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[5.5rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden print:hidden">
        <div className="flex h-14 items-center px-4">
          <Brand />
        </div>
      </header>

      <aside className="print:hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-border md:bg-sidebar">
        <div className="hidden h-16 shrink-0 items-center justify-center px-3 md:flex xl:justify-start xl:px-5">
          <Brand />
        </div>
        {/* A phone's More panel dims the page; a tap outside closes it. */}
        {moreOpen ? <div aria-hidden className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMoreOpen(false)} /> : null}
        <nav
          aria-label="Main"
          className={cn(
            'fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80',
            'md:static md:flex md:flex-col md:gap-1 md:border-0 md:bg-transparent md:p-2 md:backdrop-blur-none xl:p-3',
          )}
        >
          {primary.map((t) => (
            <NavLink key={t.route.name} tab={t} current={isCurrent(route.name, t.route.name)} link={link} badge={t.route.name === 'history' ? waiting : 0} />
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="more-sections"
            data-active={moreOpen || moreCurrent}
            onClick={() => setMoreOpen((o) => !o)}
            className={cn(navItem, 'cursor-pointer md:hidden')}
          >
            <span className={navIcon}>
              <Ellipsis aria-hidden className="size-5" />
            </span>
            More
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
            {more.map((t) => (
              <NavLink key={t.route.name} tab={t} current={isCurrent(route.name, t.route.name)} link={link} item={moreItem} icon={moreIcon} />
            ))}
            {/* The rail and sidebar show the account and Sign out at their foot instead. */}
            <div className="mt-1 flex flex-col gap-1 border-t border-border pt-1 md:hidden">
              <a {...link({ name: 'account' })} aria-current={route.name === 'account' ? 'page' : undefined} className={moreItem}>
                <span className={moreIcon}>
                  <UserRound aria-hidden className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col items-start leading-tight">
                  <span className="truncate">{session.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">Account and password</span>
                </span>
              </a>
              <button type="button" onClick={signOut} className={cn(moreItem, 'w-full cursor-pointer')}>
                <span className={moreIcon}>
                  <LogOut aria-hidden className="size-5" />
                </span>
                Sign out
              </button>
            </div>
          </div>
        </nav>
        <div className="mt-auto hidden flex-col gap-1 border-t border-border p-2 md:flex xl:p-3">
          <a
            {...link({ name: 'account' })}
            aria-current={route.name === 'account' ? 'page' : undefined}
            title="Account and password"
            className={navItem}
          >
            <span className={navIcon}>
              <UserRound aria-hidden className="size-5 xl:size-4" />
            </span>
            <span className="xl:hidden">Account</span>
            <span className="hidden truncate xl:inline">{session.name}</span>
          </a>
          <button type="button" onClick={signOut} className={cn(navItem, 'w-full cursor-pointer')}>
            <span className={navIcon}>
              <LogOut aria-hidden className="size-5 xl:size-4" />
            </span>
            Sign out
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
        {route.name === 'createOrder' ? <CreateOrder navigate={navigate} /> : null}
        {route.name === 'employees' ? <Employees navigate={navigate} /> : null}
        {route.name === 'employee' ? <EmployeePage id={route.id} navigate={navigate} onBack={back({ name: 'employees' })} /> : null}
        {route.name === 'catalogue' ? <Catalogue navigate={navigate} /> : null}
        {route.name === 'catalogueItem' ? (
          <CatalogueItemPage id={route.id} navigate={navigate} onBack={back({ name: 'catalogue' })} />
        ) : null}
        {route.name === 'itemSets' ? <ItemSets /> : null}
        {route.name === 'users' ? <UsersPage /> : null}
        {route.name === 'account' ? <Account onSignOut={signOut} /> : null}
        {route.name === 'history' ? <History onOpenRecord={(id, print) => navigate({ name: 'record', id, print })} /> : null}
        {route.name === 'record' ? (
          <RecordPage id={route.id} autoPrint={route.print ?? false} onBack={back({ name: 'history' })} />
        ) : null}
      </main>
    </div>
  )
}

type Tab = (typeof tabs)[number]

/** One section's link: icon, a short label in the tab bar and rail, the full label in the sidebar. */
function NavLink({
  tab: { route: r, label, short, icon: Icon },
  current,
  link,
  badge = 0,
  item = navItem,
  icon = navIcon,
}: {
  tab: Tab
  current: boolean
  link: (to: Route) => ReturnType<typeof linkTo>
  /** A count beside the icon, such as orders waiting; 0 shows none. */
  badge?: number
  item?: string
  icon?: string
}) {
  return (
    <a {...link(r)} aria-current={current ? 'page' : undefined} className={item}>
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
          <span className="sr-only"> ({badge} waiting for confirmation)</span>
        </>
      ) : null}
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

/** The app mark; the name shows where there is room for it (phone bar, desktop sidebar). */
function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <HardHat aria-hidden className="size-4.5" />
      </span>
      <span className="leading-tight md:sr-only xl:not-sr-only">Workwear &amp; Equipment</span>
    </span>
  )
}
