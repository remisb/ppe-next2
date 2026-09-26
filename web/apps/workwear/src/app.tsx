import { ClipboardList, HardHat, History as HistoryIcon, LayoutDashboard, LogOut, Package, Shirt, UserCog, UserRound, Users } from 'lucide-react'

import { useApi } from '@/lib/api'
import { type Route, canGoBack, linkTo, startRoute, useRouter } from '@/lib/router'
import { cn } from '@/lib/utils'

import { Account } from './routes/account'
import { Catalogue } from './routes/catalogue'
import { CreateOrder } from './routes/create-order'
import { Dashboard } from './routes/dashboard'
import { EmployeePage } from './routes/employee'
import { Employees } from './routes/employees'
import { History } from './routes/history'
import { ConfirmPage } from './routes/confirm'
import { ItemSets } from './routes/item-sets'
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
const usersTab = { route: { name: 'users' }, label: 'Users', short: 'Users', icon: UserCog } satisfies (typeof tabs)[number]

/** A record belongs to History and an employee to Employees, so those stay the current section. */
function isCurrent(current: Route['name'], tab: Route['name']): boolean {
  return current === tab || (current === 'record' && tab === 'history') || (current === 'employee' && tab === 'employees')
}

/*
 * One navigation, three layouts:
 *   phone (< md)   top bar with the account; the sections are a bottom tab bar
 *                  within thumb reach, above the home bar
 *   tablet (md)    a 5.5rem side rail: icon over a short label
 *   desktop (lg)   a 15rem sidebar: icon beside the full label
 * The link's accessible name is always the full label, from its (visually
 * hidden) text rather than aria-label, which would also turn up in label
 * lookups such as a field's "Item Set".
 */
const navItem = cn(
  'group flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors',
  'h-16 focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:rounded-lg md:py-2',
  'lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm',
  'hover:text-foreground aria-[current=page]:text-foreground lg:hover:bg-accent lg:aria-[current=page]:bg-accent',
)
/** The icon's pill is the phone and rail's active marker; the sidebar highlights the whole row. */
const navIcon = cn(
  // w-full up to w-14: an administrator's seven phone tabs are narrower than the pill.
  'flex h-8 w-full max-w-14 items-center justify-center rounded-full transition-colors lg:h-auto lg:w-auto lg:max-w-none',
  'group-hover:bg-accent/60 group-aria-[current=page]:bg-accent lg:group-hover:bg-transparent lg:group-aria-[current=page]:bg-transparent',
)

export function App() {
  const { session, signOut } = useApi()
  const { route: asked, navigate } = useRouter()

  // The public confirmation page is checked before the session gate: its
  // visitor is an employee with a link, not a signed-in user.
  if (asked.name === 'confirm') return <ConfirmPage token={asked.token} />
  if (!session) return <SignIn />
  const route = startRoute(asked, session.isAdmin)
  const shownTabs = session.isAdmin ? [dashboardTab, ...tabs, usersTab] : tabs

  const link = (to: Route) => linkTo(to, navigate)
  /** Back to where the user came from inside the app, else to the given screen (a shared or bookmarked link). */
  const back = (fallback: Route) => () => (canGoBack() ? window.history.back() : navigate(fallback))

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[5.5rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden print:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Brand />
          <a
            {...link({ name: 'account' })}
            aria-current={route.name === 'account' ? 'page' : undefined}
            aria-label={`${session.name}, account`}
            className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
          >
            <UserRound aria-hidden className="size-5" />
          </a>
        </div>
      </header>

      <aside className="print:hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-border md:bg-sidebar">
        <div className="hidden h-16 shrink-0 items-center justify-center px-3 md:flex lg:justify-start lg:px-5">
          <Brand />
        </div>
        <nav
          aria-label="Main"
          className={cn(
            'fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80',
            'md:static md:flex md:flex-col md:gap-1 md:border-0 md:bg-transparent md:p-2 md:backdrop-blur-none lg:p-3',
            // One column per section: seven for an administrator, whose extra tabs are Dashboard and Users.
            shownTabs.length > 5 ? 'grid-cols-7' : 'grid-cols-5',
          )}
        >
          {shownTabs.map(({ route: r, label, short, icon: Icon }) => (
            <a
              key={r.name}
              {...link(r)}
              aria-current={isCurrent(route.name, r.name) ? 'page' : undefined}
              className={navItem}
            >
              <span className={navIcon}>
                <Icon aria-hidden className="size-5 lg:size-4" />
              </span>
              <span aria-hidden className="max-w-full truncate px-0.5 lg:hidden">
                {short}
              </span>
              <span className="sr-only lg:not-sr-only">{label}</span>
            </a>
          ))}
        </nav>
        <div className="mt-auto hidden flex-col gap-1 border-t border-border p-2 md:flex lg:p-3">
          <a
            {...link({ name: 'account' })}
            aria-current={route.name === 'account' ? 'page' : undefined}
            title="Account and password"
            className={navItem}
          >
            <span className={navIcon}>
              <UserRound aria-hidden className="size-5 lg:size-4" />
            </span>
            <span className="lg:hidden">Account</span>
            <span className="hidden truncate lg:inline">{session.name}</span>
          </a>
          <button type="button" onClick={signOut} className={cn(navItem, 'w-full cursor-pointer')}>
            <span className={navIcon}>
              <LogOut aria-hidden className="size-5 lg:size-4" />
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
          'md:px-6 md:py-8 lg:px-10 print:max-w-none print:p-0',
        )}
      >
        {route.name === 'dashboard' ? <Dashboard navigate={navigate} /> : null}
        {route.name === 'createOrder' ? <CreateOrder /> : null}
        {route.name === 'employees' ? <Employees navigate={navigate} /> : null}
        {route.name === 'employee' ? <EmployeePage id={route.id} navigate={navigate} onBack={back({ name: 'employees' })} /> : null}
        {route.name === 'catalogue' ? <Catalogue /> : null}
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

/** The app mark; the name shows where there is room for it (phone bar, desktop sidebar). */
function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <HardHat aria-hidden className="size-4.5" />
      </span>
      <span className="leading-tight md:sr-only lg:not-sr-only">Workwear &amp; Equipment</span>
    </span>
  )
}
