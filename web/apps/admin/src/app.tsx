import { CheckingSignIn, ConfirmPassword, Offline, SignIn, applyDensity, loadDensity, useApi } from '@ppe/app-shell'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Brand, moreIcon, moreItem, navIcon, navItem } from '@ppe/ui/components/main-nav'
import { EmptyState, PageHeader } from '@ppe/ui/components/states'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowLeft, DatabaseBackup, Ellipsis, KeyRound, LogOut, ScrollText, Settings as SettingsIcon, UserCog, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import { type Route, type Screen, linkTo, screenRoute, screens, startRoute, useRouter } from '@/lib/router'

import { AuditPage } from './routes/audit'
import { BackupsPage } from './routes/backups'
import { RolesPage } from './routes/roles'
import { SettingsPage } from './routes/settings'
import { UsersPage } from './routes/users'

interface Section {
  name: Screen
  label: string
  short: string
  icon: typeof UserCog
}

/** Each screen's place in the Main navigation, in the language in use (built on each render, never at import). */
const sections = (): Record<Screen, Section> => ({
  users: { name: 'users', label: t.shell.users, short: t.shell.shortUsers, icon: UserCog },
  roles: { name: 'roles', label: t.shell.roles, short: t.shell.shortRoles, icon: KeyRound },
  audit: { name: 'audit', label: t.shell.audit, short: t.shell.shortAudit, icon: ScrollText },
  settings: { name: 'settings', label: t.shell.settings, short: t.shell.shortSettings, icon: SettingsIcon },
  backups: { name: 'backups', label: t.shell.backups, short: t.shell.shortBackups, icon: DatabaseBackup },
})

/** The phone bar's columns, by how many sections the user may open (one to five): those, and More. */
const phoneColumns = ['grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5', 'grid-cols-6']

/*
 * Administration's frame, the staff app's in look (@ppe/ui main-nav): a
 * bottom bar on a phone, a rail on a tablet, a sidebar on a desktop. Its
 * sections are the screens the user's permissions open; More (a phone) and
 * the rail and sidebar's foot hold the way back to the staff app, Account
 * (the staff app's) and Sign out. Both apps share one sign-in, so signing in
 * or out here does so there too.
 */
export function App() {
  const { session, status, retry, signOut, passwordPrompt } = useApi()
  const { route: asked, navigate } = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const morePanel = useRef<HTMLDivElement>(null)

  // The signed-in user's table density; no one's once signed out.
  useEffect(() => applyDensity(session ? loadDensity(session.userId) : null), [session?.userId])

  // More closes when a section is chosen (any navigation) and on Escape.
  useEffect(() => setMoreOpen(false), [asked])
  useEffect(() => {
    if (!moreOpen) return
    morePanel.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  if (status === 'starting') return <CheckingSignIn />
  if (status === 'offline') return <Offline onRetry={retry} />
  if (!session) return <SignIn appName={t.common.appName} tagline={t.shell.signInTagline} />

  const route = startRoute(asked, session.can)
  if (!route) return <NotForYou onSignOut={signOut} />
  const all = sections()
  const shown = screens.filter((s) => session.can(s.permission)).map((s) => all[s.name])
  const link = (to: Route) => linkTo(to, navigate)

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[5.5rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        {t.shell.skipToContent}
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
        <div className="flex h-14 items-center px-4">
          <Brand name={t.common.appName} />
        </div>
      </header>

      <aside className="md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-border md:bg-sidebar">
        <div className="hidden h-16 shrink-0 items-center justify-center px-3 md:flex xl:justify-start xl:px-5">
          <Brand name={t.common.appName} />
        </div>
        {/* A phone's More panel dims the page; a tap outside closes it. */}
        {moreOpen ? <div aria-hidden className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMoreOpen(false)} /> : null}
        <nav
          aria-label={t.shell.mainNav}
          className={cn(
            'fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80',
            phoneColumns[shown.length - 1],
            'md:static md:flex md:flex-col md:gap-1 md:border-0 md:bg-transparent md:p-2 md:backdrop-blur-none xl:p-3',
          )}
        >
          {shown.map((s) => (
            <a key={s.name} {...link(screenRoute(s.name))} aria-current={route.name === s.name ? 'page' : undefined} className={navItem}>
              <span className={navIcon}>
                <s.icon aria-hidden className="size-5 xl:size-4" />
              </span>
              <span aria-hidden className="max-w-full truncate px-0.5 xl:hidden">
                {s.short}
              </span>
              <span className="sr-only xl:not-sr-only">{s.label}</span>
            </a>
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="more-sections"
            data-active={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            className={cn(navItem, 'cursor-pointer md:hidden')}
          >
            <span className={navIcon}>
              <Ellipsis aria-hidden className="size-5" />
            </span>
            {t.shell.more}
          </button>
          {/* The way back, the account and Sign out: a panel above the tab bar on a phone, the foot of the rail and sidebar. */}
          <div
            id="more-sections"
            ref={morePanel}
            className={cn(
              moreOpen
                ? 'fixed inset-x-0 bottom-[var(--bottom-nav)] z-30 flex max-h-[70dvh] flex-col gap-1 overflow-y-auto rounded-t-2xl border-t border-border bg-background p-2 shadow-lg'
                : 'hidden',
              'md:hidden',
            )}
          >
            <FootLinks name={session.name} onSignOut={signOut} item={moreItem} icon={moreIcon} />
          </div>
        </nav>
        <div className="mt-auto hidden flex-col gap-1 border-t border-border p-2 md:flex xl:p-3">
          <FootLinks name={session.name} onSignOut={signOut} item={navItem} icon={navIcon} />
        </div>
      </aside>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl px-4 pt-5 pb-[calc(var(--bottom-nav)+1.5rem)] outline-none md:px-6 md:py-8 xl:px-10"
      >
        {route.name === 'users' ? <UsersPage navigate={navigate} /> : null}
        {route.name === 'roles' ? <RolesPage /> : null}
        {route.name === 'audit' ? <AuditPage route={route} navigate={navigate} /> : null}
        {route.name === 'settings' ? <SettingsPage /> : null}
        {route.name === 'backups' ? <BackupsPage /> : null}
      </main>
      <ConfirmPassword prompt={passwordPrompt} />
    </div>
  )
}

/** Back to the staff app, the account (the staff app's Account) and Sign out. */
function FootLinks({ name, onSignOut, item, icon }: { name: string; onSignOut: () => void; item: string; icon: string }) {
  const phoneRow = item === moreItem
  return (
    <>
      <a href={staffHref('/')} title={t.shell.workwear} className={item}>
        <span className={icon}>
          <ArrowLeft aria-hidden className="size-5 xl:size-4" />
        </span>
        <span aria-hidden className={cn('xl:hidden', phoneRow && 'max-md:hidden')}>
          {t.shell.shortWorkwear}
        </span>
        <span className={cn('sr-only xl:not-sr-only', phoneRow && 'max-md:not-sr-only')}>{t.shell.workwear}</span>
      </a>
      <a href={staffHref('/account')} title={t.shell.accountAndPassword} className={item}>
        <span className={icon}>
          <UserRound aria-hidden className="size-5 xl:size-4" />
        </span>
        <span className={cn('xl:hidden', phoneRow && 'max-md:hidden')}>{t.shell.shortAccount}</span>
        <span className={cn('hidden truncate xl:inline', phoneRow && 'max-md:inline')}>{name}</span>
      </a>
      <button type="button" onClick={onSignOut} className={cn(item, 'w-full cursor-pointer')}>
        <span className={icon}>
          <LogOut aria-hidden className="size-5 xl:size-4" />
        </span>
        {t.shell.signOut}
      </button>
    </>
  )
}

/** A signed-in user whose roles open none of Administration's screens. */
function NotForYou({ onSignOut }: { onSignOut: () => void }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl content-center px-4 py-8">
      <PageHeader title={t.shell.notForYouTitle} />
      <EmptyState
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <a href={staffHref('/')} className={buttonVariants()}>
              {t.shell.backToWorkwear}
            </a>
            <Button variant="outline" onClick={onSignOut}>
              {t.shell.signOut}
            </Button>
          </div>
        }
      >
        {t.shell.notForYou}
      </EmptyState>
    </main>
  )
}
