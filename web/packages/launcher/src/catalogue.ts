import type { AppGroup } from '@ppe/api-client'

/**
 * App Launcher's tiles come from the API's registry (ADR 0006, phase 2;
 * GET /api/v1/launcher, already filtered for the signed-in user); the rules
 * the apps apply to them are @remisb/launcher-core's (ADR 0009). This site's
 * groups are these.
 */

/** The groups, in the launcher's order (the API's launcherConfig.Groups). */
export const APP_GROUPS: readonly AppGroup[] = ['workwear', 'assets', 'people', 'admin']

export { appBySlug, hasSeveralApps, inTesting } from '@remisb/launcher-core'
