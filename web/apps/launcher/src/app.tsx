import type { LauncherList } from '@ppe/api-client'
import { type Session, useApi } from '@ppe/app-shell'
import { currentLang } from '@ppe/i18n'
import { APP_GROUPS, SignedIn, appIcons, launcherPlaces, launcherText, useLauncher } from '@ppe/launcher'
import { staffHref } from '@ppe/routing'
import { GavortEmblem } from '@ppe/ui/components/gavort-logo'
import { ErrorState, Loading } from '@ppe/ui/components/states'
import { formatDate } from '@ppe/ui/lib/dates'
import { errorText } from '@ppe/ui/lib/use-load'
import { LauncherScreen } from '@remisb/launcher-react'

/**
 * App Launcher (ADR 0006): the apps and shortcuts the user's roles open, from
 * the API's registry, as big tiles in groups (@remisb/launcher-react's
 * LauncherScreen, ADR 0009). It shares the staff app's sign-in, so signing in
 * or out here does so there too; the recent apps keep the origin's
 * `workwear.launcher.*` keys.
 */
export function App() {
  return (
    <SignedIn appName={launcherText().launcherName} tagline={launcherText().signInTagline}>
      {(session) => <Signed session={session} />}
    </SignedIn>
  )
}

/** The launcher once the user's list is in: loading, failed with Try again, or the tiles. */
function Signed({ session }: { session: Session }) {
  const { client, signOut } = useApi()
  const launcher = useLauncher()
  if (launcher.list) {
    // Keyed by user: its pins and choices are state taken from the list once.
    return <Launcher key={session.userId} session={session} list={launcher.list} client={client} onSignOut={() => void signOut()} />
  }
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl content-center px-4 py-8">
      {launcher.failed ? (
        <ErrorState error={new Error(launcherText().loadFailed)} title={launcherText().loadFailed} onRetry={launcher.retry} retryLabel={launcherText().retry} />
      ) : (
        <Loading />
      )}
    </main>
  )
}

function Launcher({ session, list, client, onSignOut }: { session: Session; list: LauncherList; client: ReturnType<typeof useApi>['client']; onSignOut: () => void }) {
  const text = launcherText()
  return (
    <LauncherScreen
      list={list}
      client={client.launcher}
      user={{ id: session.userId, name: session.name }}
      lang={currentLang()}
      words={text}
      groups={APP_GROUPS.map((key) => ({ key, name: text.groups[key] }))}
      places={launcherPlaces}
      logo={<GavortEmblem className="size-8 shrink-0 text-brand-mark" />}
      accountHref={staffHref('/account')}
      onSignOut={onSignOut}
      formatDate={(iso) => formatDate(iso, undefined)}
      errorText={errorText}
      icons={appIcons}
    />
  )
}
