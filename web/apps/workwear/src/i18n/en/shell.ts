import { plural } from '@ppe/i18n'

/** The app's frame: the Main navigation, ⌘K palette, shortcuts, sign-in and shared list controls. */
export const shell = {
  // Section names: the navigation's full labels, and the palette's screens.
  createOrder: 'Create Order',
  history: 'Orders',
  employees: 'Employees',
  companyAssets: 'Company Assets',
  catalogue: 'Item Catalogue',
  itemSets: 'Item Sets',
  dashboard: 'Dashboard',
  administration: 'Administration',
  replacements: 'Replacements due',
  accountAndPassword: 'Account and password',
  // Short labels under the icons in the phone tab bar and tablet rail.
  shortOrder: 'Order',
  shortHistory: 'Orders',
  shortEmployees: 'Employees',
  shortAssets: 'Assets',
  shortCatalogue: 'Catalogue',
  shortItemSets: 'Sets',
  shortDashboard: 'Home',
  shortAdministration: 'Admin',
  shortKeys: 'Keys',
  shortAccount: 'Account',
  mainNav: 'Main',
  skipToContent: 'Skip to content',
  searchEllipsis: 'Search…',
  more: 'More',
  signOut: 'Sign out',
  keyboardShortcuts: 'Keyboard shortcuts',
  help: 'Help',
  userGuide: 'User guide',
  shortcutsHint: 'Letters work anywhere except while typing in a field.',
  /** The phone's raised Create Order button, without and with a saved draft. */
  newOrderButton: 'New order',
  draft: 'Draft',
  draftLines: (n: number) => plural(n, { one: '(draft, # line)', other: '(draft, # lines)' }),
  waiting: (n: number) => plural(n, { one: '(# waiting for confirmation)', other: '(# waiting for confirmation)' }),
  shortcuts: {
    palette: 'Search record numbers, SIMs, employees, items and screens, and jump to them',
    search: 'Go to the search or Add Item field on this screen',
    newOrder: 'New order',
    /** The key names stay; only the word between them is translated. */
    goToKeys: 'G then D, O, H, E, A, C, S, U',
    goTo: 'Go to Dashboard, Create Order, Orders, Employees, Company Assets, Catalogue, Item Sets, Users',
    nextPrevious: 'Orders: the next or previous order, beside the list',
    closeOrder: 'Orders: close the order beside the list',
    review: 'Create Order: review the order before Mark as Ordered',
    quantity: 'Create Order: one more or one fewer, in a quantity field',
    help: 'Show these shortcuts',
  },
  // The ⌘K palette.
  searchOrJump: 'Search or jump to',
  paletteHint: 'Search orders, company assets, employees, items and screens…',
  results: 'Results',
  groups: {
    orders: 'Orders',
    assets: 'Company Assets',
    actions: 'Actions',
    screens: 'Screens',
    employees: 'Employees',
    items: 'Items',
  },
  newOrder: 'New order',
  newOrderFor: (name: string) => `New order for ${name}`,
  compactRows: 'Compact table rows',
  comfortableRows: 'Comfortable table rows',
  density: 'Density',
  /**
   * Beginnings of words that find the density switch, besides the English
   * ones the palette always knows ("compact", "comfortable", "density", "dense", "table rows").
   */
  densityWords: { compact: 'compact', comfortable: 'comfortable', density: 'density', rows: 'table rows' },
  theme: 'Theme',
  lightTheme: 'Light theme',
  darkTheme: 'Dark theme',
  systemTheme: 'Theme as on the device',
  /** Beginnings of words that find the theme switch, besides the English ones the palette always knows. */
  themeWords: { theme: 'theme', light: 'light', dark: 'dark', system: 'system' },
  nothingMatches: (q: string) => `Nothing matches “${q}”.`,
  // Sign in (the rest of its words are @ppe/app-shell's).
  signInTagline: 'Orders, hand-overs and signed receipts, in one place.',
}

export type ShellText = typeof shell
