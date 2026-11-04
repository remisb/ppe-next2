export {
  APP_GROUPS,
  APPS,
  type AppGroup,
  type AppIcon,
  type AppStage,
  type AppTier,
  type LauncherApp,
  appById,
  hasSeveralApps,
  sees,
  visibleApps,
} from './catalogue.ts'
export { type Places, RECENT_MAX, loadPlaces, noteOpened, savePlaces, togglePin } from './places.ts'
export { appName, launcherText, parentName } from './text.ts'
