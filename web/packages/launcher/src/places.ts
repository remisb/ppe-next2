import { devicePlaces } from '@remisb/launcher-core'

/**
 * Each user's recently opened apps and Show apps in testing, kept on this
 * device (@remisb/launcher-core's devicePlaces); pins are kept by the API.
 * The keys follow the origin's `workwear.*` names, shared by every app on it.
 */
/** This site's places, for the launcher screen (LauncherScreen's places). */
export const launcherPlaces = devicePlaces('workwear.launcher')

export const { loadRecent, noteOpened, devicePins, forgetDevicePins, loadShowTesting, saveShowTesting } = launcherPlaces
export { RECENT_MAX, togglePin } from '@remisb/launcher-core'
