import { type Session, useApi } from '@ppe/app-shell'
import { AppFrame, SignedIn } from '@ppe/launcher'
import { staffHref } from '@ppe/routing'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { EmptyState, PageHeader } from '@ppe/ui/components/states'

import { useState } from 'react'

import { t } from '@/i18n'
import { linkTo, useRouter } from '@/lib/router'

import { ImportPage, type ImportStart } from './routes/import/import-page'
import { ScanPage } from './routes/scan/scan-page'

/*
 * Import Documents in a small app's frame (@ppe/launcher's SignedIn and
 * AppFrame): its name, the way back to Employees, App Launcher and Sign out.
 * It shares the staff app's sign-in. It is for Personnel Documents
 * (personnel.documents.manage, ADR 0007), shown by session.can(...), never by
 * role. Published under App Launcher (ADR 0006): off Stable, the frame's
 * stripe says which channel and version.
 */
export function App() {
  return (
    <SignedIn appName={t.shell.appName} tagline={t.shell.signInTagline}>
      {(session) => <Screens session={session} />}
    </SignedIn>
  )
}

/**
 * Two screens as tabs: Import to Personnel and Scan Document. Once opened,
 * both stay mounted, the other one hidden, so moving between them never
 * loses work in either. Scan Document's Save to Personnel hands its pages to Import, which
 * starts again from them (its key changes).
 */
function Screens({ session }: { session: Session }) {
  const { signOut } = useApi()
  const { route, navigate } = useRouter()
  const [start, setStart] = useState<{ key: number; start: ImportStart } | null>(null)
  // Scan Document is mounted once opened, then kept (its work survives a visit to Import).
  const [scanOpened, setScanOpened] = useState(false)
  if (route.name === 'scan' && !scanOpened) setScanOpened(true)
  if (!session.can('personnel.documents.manage')) return <NotForYou onSignOut={() => void signOut()} />
  const tabs = [
    { route: { name: 'home' } as const, label: t.shell.importTab },
    { route: { name: 'scan' } as const, label: t.shell.scanTab },
  ]
  return (
    <AppFrame
      slug="docs-import"
      name={t.shell.appName}
      back={{ href: staffHref('/employees'), label: t.shell.employees }}
      navLabel={t.shell.mainNav}
      tabs={tabs.map((x) => ({ key: x.route.name, label: x.label, current: route.name === x.route.name, ...linkTo(x.route, navigate) }))}
    >
      <div hidden={route.name !== 'home'}>
        <ImportPage key={start?.key ?? 0} {...(start ? { start: start.start } : {})} />
      </div>
      {scanOpened || route.name === 'scan' ? (
        <div hidden={route.name !== 'scan'}>
          <ScanPage
            onSaveToPersonnel={(s) => {
              setStart((cur) => ({ key: (cur?.key ?? 0) + 1, start: s }))
              navigate({ name: 'home' })
            }}
          />
        </div>
      ) : null}
    </AppFrame>
  )
}

/** A signed-in user whose roles do not open the app. */
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
