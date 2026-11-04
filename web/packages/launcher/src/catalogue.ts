import type { AppGroup, LauncherApp } from '@ppe/api-client'

/**
 * App Launcher's tiles come from the API's registry (ADR 0006, phase 2;
 * GET /api/v1/launcher, already filtered for the signed-in user). These are
 * the rules the apps apply to the list they were given.
 */

/** The groups, in the launcher's order. */
export const APP_GROUPS: readonly AppGroup[] = ['workwear', 'assets', 'people', 'admin']

/**
 * Whether the user has more than one app (shortcuts aside): only then is there
 * a launcher worth landing on and an Apps entry worth showing. Someone with one
 * app goes straight to it (decision D10); /apps/ still works for them.
 */
export const hasSeveralApps = (apps: readonly LauncherApp[]) => apps.filter((a) => a.kind === 'app').length > 1

/** Apps in testing (POC, In development), which a tester shows with Show apps in testing. */
export const inTesting = (app: LauncherApp) => app.stage === 'poc' || app.stage === 'dev'

export const appBySlug = (apps: readonly LauncherApp[], slug: string) => apps.find((a) => a.slug === slug)
