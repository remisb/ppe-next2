/** The pictures an App Launcher tile may show; the API's launcher.Icons, in its order. */
export const APP_ICONS = [
  'shirt',
  'order',
  'orders',
  'employees',
  'dashboard',
  'sim',
  'equipment',
  'scan',
  'crew',
  'admin',
  'help',
  'box',
  'flask',
  'pen',
  'check',
  'chart',
  'calendar',
  'truck',
  'wrench',
] as const
export type AppIcon = (typeof APP_ICONS)[number]
