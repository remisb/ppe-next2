import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test'

import { admin, webURL } from '../env.ts'

// One ordered story, run in sequence: each step builds on the data the
// previous one created. It covers the manual's §7 validation rows and every
// status transition through the real UI, API and database.
test.describe.configure({ mode: 'serial' })

let page: Page
let recordNumber = ''
/** The second order, signed on paper after the price change. */
let paperRecord = ''
let confirmationURL = ''
/** What the browser refused under the Content-Security-Policy, in any tab of the run's context (Caddy sends it; Vite does not). */
const cspViolations: string[] = []

test.beforeAll(async ({ browser }) => {
  // Its own context, so a step can open a second tab in it (a tab closed and reopened shares localStorage).
  const context = await browser.newContext({ baseURL: webURL })
  context.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) cspViolations.push(`${msg.location().url}: ${msg.text()}`)
  })
  page = await context.newPage()
  // Print Record opens the print dialog; record the call instead.
  await page.addInitScript(() => {
    window.print = () => {
      ;(window as unknown as { __printed: number }).__printed = ((window as unknown as { __printed?: number }).__printed ?? 0) + 1
    }
  })
})

test.afterAll(async () => {
  await page.context().close()
})

/** Administration's sections: the staff app links there, and it links back. */
const administrationTabs = ['Overview', 'Users', 'Roles & permissions', 'Audit log', 'Security', 'System', 'Usage', 'Settings']

/** Follows a link at the foot of the rail or sidebar, or under More on a phone, to the other app. */
async function switchApp(linkName: string) {
  const link = page.getByRole('link', { name: linkName, exact: true }).filter({ visible: true })
  if ((await link.count()) === 0) await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }).click()
  await link.click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

/**
 * Opens a section from the Main navigation; on a phone the fifth and later are
 * under More. Users, Settings and System are in Administration, reached by
 * its link and left by Workwear & Equipment, as people do.
 */
async function openTab(name: string) {
  const inAdministration = new URL(page.url()).pathname.startsWith('/admin/')
  if (administrationTabs.includes(name) && !inAdministration) await switchApp('Administration')
  if (!administrationTabs.includes(name) && inAdministration) await switchApp('Workwear & Equipment')
  const nav = page.getByRole('navigation', { name: 'Main' })
  const link = nav.getByRole('link', { name })
  // The rail and sidebar have no Create Order: it is Orders' Create Order button there.
  if (name === 'Create Order' && !(await link.isVisible())) {
    await openTab('Orders')
    await page.getByRole('main').getByRole('link', { name: 'Create Order' }).click()
    return
  }
  if (!(await link.isVisible())) await nav.getByRole('button', { name: 'More' }).click()
  await link.click()
}

/** Add Item is a search: type part of the name, then choose the item. */
async function addItem(search: string, name: RegExp) {
  await page.getByRole('combobox', { name: 'Add Item' }).fill(search)
  await page.getByRole('option', { name }).click()
}

/** Opens an order from the Orders list; its detail and actions show beside the list (or instead of it on a phone). */
async function openOrder(record: string) {
  await page.getByRole('link', { name: record, exact: true }).click()
  return page.getByRole('complementary', { name: 'Order' })
}

/** Create Order's way on to the review: "Review · 3 lines · €…" in the bar, or "Review and mark as ordered" in the panel. */
function reviewButton() {
  return page.getByRole('button', { name: /^Review/ })
}

/** Mark as Ordered asks for a review first; confirm it there. Every new order gets its confirmation link. */
async function markAsOrdered() {
  await reviewButton().click()
  const review = page.getByRole('dialog', { name: 'Review order' })
  await review.getByRole('button', { name: 'Mark as Ordered' }).click()
}

async function addCatalogueItem(item: { name: string; details: string; group: string; price?: string; months?: string; rank: string }) {
  await page.getByRole('button', { name: 'Add Item' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Item name').fill(item.name)
  await dialog.getByLabel('Manufacturer / model').fill(item.details)
  await dialog.getByLabel('Size group').selectOption(item.group)
  if (item.price) await dialog.getByLabel('Price (€)', { exact: true }).fill(item.price)
  if (item.months) await dialog.getByLabel('Service period (months)').fill(item.months)
  await dialog.getByLabel('Display order').fill(item.rank)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: new RegExp(item.name) })).toBeVisible()
}

test('sign in', async () => {
  await page.goto('/')
  // Gavort's logo from the brand book, navy on the page's own background (one drawn at a time: with its tagline from lg).
  const logo = page.getByRole('img', { name: 'GAVORT' })
  await expect(logo).toBeVisible()
  expect(await logo.evaluate((e) => getComputedStyle(e).fill)).not.toMatch(/^url/)
  // Its emblem is the tab's icon and the home-screen icon: every one the page and its manifest name is served.
  const icons = await page.locator('link[rel=icon], link[rel=apple-touch-icon]').evaluateAll((links) => links.map((l) => (l as HTMLLinkElement).href))
  const manifest = (await (await page.request.get('/manifest.json')).json()) as { icons: { src: string }[] }
  expect(icons).toHaveLength(3)
  expect(manifest.icons.length).toBeGreaterThan(0)
  for (const src of [...icons, ...manifest.icons.map((i) => i.src)]) {
    const icon = await page.request.get(src)
    expect(icon.ok(), src).toBe(true)
    expect(icon.headers()['content-type'], src).toMatch(/^image\//)
  }
  // Password managers find the account by the fields' names and autocomplete tokens.
  const email = page.getByLabel('Email')
  const password = page.getByLabel(/^Password/)
  await expect(email).toHaveAttribute('name', 'email')
  await expect(email).toHaveAttribute('autocomplete', 'username')
  await expect(password).toHaveAttribute('name', 'password')
  await expect(password).toHaveAttribute('autocomplete', 'current-password')
  // Keep me signed in starts ticked (staff devices are mostly their own).
  await expect(page.getByRole('checkbox', { name: /^Keep me signed in/ })).toBeChecked()
  // Sign in is never disabled, since autofill may not tell the page: it says what is missing.
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Enter your email and password.')).toBeVisible()
  // Behind Caddy, a password manager's "change password" link lands on Account.
  if (process.env['E2E_WEB_SERVER'] === 'caddy') {
    const res = await page.request.get('/.well-known/change-password', { maxRedirects: 0 })
    expect(res.status()).toBe(302)
    expect(res.headers()['location']).toBe('/account')
  }
  await email.fill(admin.email)
  await password.fill(admin.password)
  // Show password checks what was typed, and hides it again.
  const show = page.getByRole('button', { name: 'Show password' })
  await expect(password).toHaveAttribute('type', 'password')
  await show.click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue(admin.password)
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await show.click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  // An administrator starts on the Dashboard; an empty database still gives a whole one.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Nothing needs you: every order is confirmed and nothing is due.')).toBeVisible()
})

/** The refresh cookie the API set in context, if any. */
async function refreshCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === 'ppe_refresh')
}

test('the sign-in survives a reload and a new tab, kept in a cookie no script can read', async () => {
  // HttpOnly, sent only to the sign-in routes, never from another site's page; with Keep me signed in, for 30 days.
  const cookie = await refreshCookie(page.context())
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' })
  expect(cookie!.expires * 1000).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60_000)
  // No token in the page's reach: not in document.cookie, not in storage.
  expect(await page.evaluate(() => document.cookie)).toBe('')
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/eyJ/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  const tab = await page.context().newPage()
  await tab.goto('/')
  await expect(tab.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await tab.close()
})

test('Backups: an administrator sees whether the database is backed up', async () => {
  // The test database has no backup service, so System's Backups tab and the Dashboard say so.
  await openTab('System')
  await page.getByRole('navigation', { name: 'System sections' }).getByRole('link', { name: 'Backups' }).click()
  await expect(page).toHaveURL(/\/admin\/system\/backups$/)
  await expect(page.getByRole('main').getByRole('status')).toContainText('The backup service has not reported')
  await expect(page.getByText('No backups yet.')).toBeVisible()
  await openTab('Dashboard')
  const card = page.getByRole('region', { name: 'Backups' })
  await expect(card).toContainText('The backup service has not reported')
  // The card opens Backups in Administration.
  await card.getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'System', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/system\/backups$/)
  // Backups' old address leads there too.
  await page.goto('/admin/backups')
  await expect(page.getByText('No backups yet.')).toBeVisible()
})

test('Administration shares the sign-in: signed in there at once, and Sign out there signs the staff app out', async ({ browser }) => {
  const staff = await signInElsewhere(browser, admin.email, admin.password)
  await expect(staff.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  // The old addresses of its screens lead there.
  await staff.goto(webURL + '/users')
  await expect(staff).toHaveURL(/\/admin\/users$/)
  await expect(staff.getByRole('heading', { name: 'Users' })).toBeVisible()
  const nav = staff.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
  // Another tab of the staff app, then Sign out in Administration: both are signed out.
  const tab = await staff.context().newPage()
  await tab.goto(webURL + '/')
  await expect(tab.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await staff.getByRole('button', { name: 'Sign out' }).filter({ visible: true }).click()
  await expect(staff.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(tab.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await staff.context().close()
})

test("Settings: an administrator sets the supplier's WhatsApp group", async () => {
  await openTab('Settings')
  const card = page.getByRole('main')
  await expect(card.getByRole('status')).toContainText('Not set')
  const name = page.getByLabel('Group name')
  const link = page.getByLabel('Invite link')
  // A person's link is not a group's; a link needs a name.
  await name.fill('Superman Rubai Group')
  await link.fill('https://wa.me/37060000000')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('it starts with https://chat.whatsapp.com/')).toBeVisible()
  await name.fill('')
  await link.fill('https://chat.whatsapp.com/E2eSupplierGroup123?mode=ems_copy_t')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Give the group a name')).toBeVisible()
  // Saved as WhatsApp copied it; the server drops the ?mode=… suffix.
  await name.fill('Superman Rubai Group')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(card.getByRole('status')).toContainText('Saved. Copy for WhatsApp opens Superman Rubai Group.')
  await expect(link).toHaveValue('https://chat.whatsapp.com/E2eSupplierGroup123')
  await expect(card.getByRole('link', { name: 'Open the group' })).toHaveAttribute('href', 'https://chat.whatsapp.com/E2eSupplierGroup123')
})

test('Item Catalogue: items with and without a price', async () => {
  await openTab('Item Catalogue')
  await addCatalogueItem({ name: 'Safety shoes', details: 'S3 SRC', group: 'SHOES', price: '49.99', months: '12', rank: '1' })
  await addCatalogueItem({ name: 'Work jacket', details: 'Winter', group: 'CLOTHING', price: '39.99', months: '24', rank: '2' })
  await addCatalogueItem({ name: 'Protective gloves', details: 'Nitrile', group: 'NONE', price: '2.50', months: '1', rank: '4' })
  await addCatalogueItem({ name: 'Safety helmet', details: 'EN 397', group: 'NONE', rank: '5' })
  await expect(page.getByRole('row', { name: /Safety helmet/ })).toContainText('Incomplete')
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toContainText('€49.99')
  // A new item's picture follows its name: a welding helmet and an insulated jacket have their own.
  await page.getByRole('button', { name: 'Add Item' }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Item name').fill('Welding helmet')
  await expect(form.getByRole('radio', { name: 'Welding helmet' })).toBeChecked()
  await form.getByLabel('Item name').fill('Insulated jacket')
  await expect(form.getByRole('radio', { name: 'Insulated jacket' })).toBeChecked()
  await form.getByRole('button', { name: 'Cancel' }).click()
  // One status per item: the tabs count the items and show one status at a time.
  await page.getByRole('button', { name: 'Incomplete 1' }).click()
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Safety helmet/ })).toBeVisible()
  await page.getByRole('button', { name: 'All 4' }).click()

  // Deactivate is under ⋯ and asks first; dismissing keeps the item active.
  const shoes = page.getByRole('row', { name: /Safety shoes/ })
  await shoes.getByRole('button', { name: 'More actions for Safety shoes' }).click()
  page.once('dialog', (d) => void d.dismiss())
  await page.getByRole('menuitem', { name: 'Deactivate item…' }).click()
  await expect(shoes).not.toContainText('Inactive')
})

test('Item Sets: a set of item references and default quantities', async () => {
  await openTab('Item Sets')
  await page.getByRole('button', { name: 'New Item Set' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Starter kit')
  for (const item of ['Work jacket', 'Safety shoes', 'Protective gloves']) {
    await dialog.getByLabel('Item to add').selectOption({ label: item })
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  }
  await dialog.getByLabel('Default quantity for Protective gloves').fill('10')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Protective gloves × 10')).toBeVisible()
  // A set says what it comes to at today's prices (39.99 + 49.99 + 10 × 2.50), and starts an order with its items.
  await expect(page.getByText('3 items · €114.98')).toBeVisible()
  await page.getByRole('link', { name: 'Use Starter kit in a new order' }).click()
  await expect(page).toHaveURL(/\/orders\/new$/)
  await expect(page.getByRole('button', { name: 'Apply Starter kit (on this order)' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(3)
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'New order' }).click()
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
})

test('Item Catalogue: a row opens the item at its own address', async () => {
  await openTab('Item Catalogue')
  // Anywhere on the row opens it, not only the name's link.
  await page.getByRole('row', { name: /Protective gloves/ }).getByRole('cell', { name: 'Nitrile' }).click()
  await expect(page).toHaveURL(/\/catalogue\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'Protective gloves' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Item Catalogue' })).toHaveAttribute('aria-current', 'page')
  // The item's facts, not its Changes below, which hold the same values.
  const details = page.getByLabel('Item details').getByRole('definition')
  await expect(details.filter({ hasText: '€2.50' })).toBeVisible()
  await expect(details.filter({ hasText: 'No size' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Starter kit' })).toContainText('× 10')
  // The address works on its own (a bookmark or a reload).
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Protective gloves' })).toBeVisible()

  // An item missing its price says why it cannot be ordered.
  await page.getByRole('button', { name: 'Item Catalogue' }).click()
  await page.getByRole('link', { name: 'Safety helmet' }).click()
  await expect(page.getByRole('note')).toContainText('cannot be ordered')
  await expect(page.getByText('No item set holds this item.')).toBeVisible()
  await page.getByRole('button', { name: 'Item Catalogue' }).click()
  await expect(page.getByRole('heading', { name: 'Item Catalogue' })).toBeVisible()
})

test('Create Order: add a new employee from Assigned to and apply the set', async () => {
  await openTab('Create Order')
  // An item set is one tap, once the employee is chosen.
  await expect(page.getByRole('button', { name: 'Apply Starter kit' })).toBeDisabled()
  await expect(reviewButton()).toBeDisabled()

  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await page.getByRole('button', { name: '+ Add New Employee' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('First name').fill('Ona')
  await dialog.getByLabel('Last name').fill('Kazlauskienė')
  await dialog.getByLabel('Height (cm)').fill('170')
  await dialog.getByRole('button', { name: 'Save and Select Employee' }).click()
  await expect(page.getByRole('combobox', { name: 'Assigned to' })).toHaveAttribute('placeholder', 'Ona Kazlauskienė')
  // Her saved sizes explain how the lines resolve: clothing from height, no shoe size.
  await expect(page.getByLabel('Saved sizes of Ona Kazlauskienė')).toHaveText(/^170 cm\W+Clothing from height\W+No shoe size$/)
  const summary = page.getByRole('complementary', { name: 'Order summary' })
  await expect(summary).toContainText('Ona Kazlauskienė')
  await expect(summary).toContainText('No earlier orders')

  await page.getByRole('button', { name: 'Apply Starter kit' }).click()
  // A set already on the order is marked, and applying it again asks first.
  await expect(page.getByRole('button', { name: 'Apply Starter kit (on this order)' })).toBeVisible()
  page.once('dialog', (d) => void d.dismiss())
  await page.getByRole('button', { name: 'Apply Starter kit (on this order)' }).click()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')

  // Clothing: 50 suggested from 170 cm. Shoes: never inferred, so missing.
  await expect(page.getByLabel('Size of Work jacket')).toHaveValue('50')
  // Clothing sizes are picked by letter band; a pick stores the band's larger EU size.
  await expect(page.getByLabel('Size of Work jacket').locator('option:checked')).toHaveText('M (48–50)')
  await expect(page.getByLabel('Size of Work jacket').locator('option')).toHaveText([
    'Select size…',
    'S (44–46)',
    'M (48–50)',
    'L (52–54)',
    'XL (56–58)',
    '2XL (60–62)',
    '3XL (64–66)',
  ])
  await expect(page.getByText('Suggested from height')).toBeVisible()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('')
  await expect(page.getByRole('alert').filter({ hasText: 'Select a size.' })).toBeVisible()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')
  // §7: a missing size keeps the work and blocks the order.
  await expect(reviewButton()).toBeDisabled()
})

const sizeChanged = () => page.getByRole('dialog', { name: 'Different size selected. Save it to employee profile?' })

test('missing size: choose it and Save it to the employee profile', async () => {
  await page.getByLabel('Size of Safety shoes').selectOption('42')
  await expect(sizeChanged()).toBeVisible()
  await expect(sizeChanged()).toContainText('Ona Kazlauskienė has no saved shoe size.')
  await sizeChanged().getByRole('button', { name: 'Save', exact: true }).click()
  await expect(sizeChanged()).toBeHidden()
  await expect(page.getByLabel('Saved sizes of Ona Kazlauskienė')).toContainText('Shoes 42')
  await expect(reviewButton()).toBeEnabled()
})

test('a size other than the saved one asks again; Skip size update keeps it on this order only', async () => {
  await page.getByLabel('Size of Safety shoes').selectOption('43')
  await expect(sizeChanged()).toContainText('saved shoe size: 42')
  await sizeChanged().getByRole('button', { name: 'Skip size update' }).click()
  await expect(sizeChanged()).toBeHidden()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('43')
  await expect(page.getByLabel('Saved sizes of Ona Kazlauskienė')).toContainText('Shoes 42')
  // Back to the saved size: nothing to ask.
  await page.getByLabel('Size of Safety shoes').selectOption('42')
  await expect(sizeChanged()).toBeHidden()
})

test('missing catalogue price blocks Mark as Ordered', async () => {
  await addItem('helmet', /^Safety helmet/)
  await expect(page.getByRole('alert').filter({ hasText: 'No price or service period' })).toBeVisible()
  await expect(reviewButton()).toBeDisabled()
  await page.getByRole('button', { name: 'Remove Safety helmet' }).click()
  await expect(reviewButton()).toBeEnabled()
})

test('quantity below 1 or not an integer is rejected at the field', async () => {
  const qty = page.getByLabel('Quantity of Work jacket')
  for (const bad of ['0', '1.5']) {
    await qty.fill(bad)
    await expect(page.getByRole('alert').filter({ hasText: 'Quantity must be a whole number' })).toBeVisible()
    await expect(reviewButton()).toBeDisabled()
  }
  await qty.fill('1')
  await expect(reviewButton()).toBeEnabled()
  // ↑ and ↓ step the quantity from the keyboard.
  await qty.press('ArrowUp')
  await expect(qty).toHaveValue('2')
  await qty.press('ArrowDown')
  await qty.press('ArrowDown')
  await expect(qty).toHaveValue('1')
})

test('network error keeps the form and offers Retry', async () => {
  await page.route('**/api/v1/orders/resolve', (route) => route.abort('failed'))
  await addItem('nitrile', /^Protective gloves/)
  await expect(page.getByText('That did not work')).toBeVisible()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')
  await page.unroute('**/api/v1/orders/resolve')
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('11')
  await page.getByLabel('Quantity of Protective gloves').fill('10')
})

test('the draft survives a reload', async () => {
  await page.reload()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('42')
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')
})

test('the draft survives a closed tab, for the same user only', async ({ browser }) => {
  // A new tab is signed in already, and the draft stays on the device for this user.
  const tab = await page.context().newPage()
  await tab.goto('/')
  await expect(tab.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await tab.goto('/orders/new')
  await expect(tab.getByLabel('Quantity of Protective gloves')).toHaveValue('10')
  await tab.close()
  // Another browser (another device) starts empty.
  const other = await (await browser.newContext()).newPage()
  await other.goto(webURL + '/')
  await other.getByLabel('Email').fill(admin.email)
  await other.getByLabel(/^Password/).fill(admin.password)
  await other.getByRole('button', { name: 'Sign in' }).click()
  await expect(other.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await other.goto(webURL + '/orders/new')
  await expect(other.getByText('No items yet.')).toBeVisible()
  await other.context().close()
})

test('Mark as Ordered creates the ORDERED record after a review', async () => {
  // The review lists each line with its size and the total, and changes nothing until confirmed.
  await reviewButton().click()
  const review = page.getByRole('dialog', { name: 'Review order' })
  await expect(review).toContainText('Ona Kazlauskienė')
  await expect(review.getByRole('listitem').filter({ hasText: 'Safety shoes' })).toContainText('42')
  await expect(review).toContainText('€114.98') // 39.99 + 49.99 + 10 × 2.50
  // The supplier message is sent from here, not from the order panel: copied, then the supplier's
  // group (Settings) opens for it to be pasted. The confirmation link is created as well unless unticked.
  await review.getByRole('button', { name: 'Copy for WhatsApp' }).click()
  await expect(review.getByRole('link', { name: 'Open Superman Rubai Group' })).toHaveAttribute('href', 'https://chat.whatsapp.com/E2eSupplierGroup123')
  await expect(page.getByRole('complementary', { name: 'Order summary' }).getByRole('button', { name: 'Copy for WhatsApp' })).toHaveCount(0)
  // Nothing to choose about the confirmation link: every new order gets one.
  await expect(review.getByRole('checkbox')).toHaveCount(0)
  await review.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('42')

  await markAsOrdered()
  const heading = page.getByText(/Order WE-\d{6} is ordered/)
  await expect(heading).toBeVisible()
  recordNumber = /WE-\d{6}/.exec((await heading.textContent()) ?? '')![0]
  await expect(page.getByText('€114.98')).toBeVisible()
  // The next step is the employee's confirmation: the link is ready to send.
  await expect(page.getByLabel('Confirmation link')).toHaveValue(/\/confirm\/[\w-]{40,}$/)
  await expect(page.getByRole('button', { name: 'Share link via WhatsApp' })).toBeVisible()
  // The supplier message was the review's: the ordered screen has no Copy for WhatsApp.
  await expect(page.getByRole('button', { name: 'Copy for WhatsApp' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send confirmation link' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Print record' })).toBeVisible()
  await page.getByRole('button', { name: 'Start a new order' }).click()
  await expect(reviewButton()).toBeDisabled()
})

test('Orders shows it ORDERED with the ORDERED actions', async () => {
  await openTab('Orders')
  // The sidebar has no Create Order: the screen once called History has it, as Employees has Add New Employee.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Create Order/ })).toBeHidden()
  const create = page.getByRole('main').getByRole('link', { name: 'Create Order' })
  await create.click()
  await expect(page).toHaveURL(/\/orders\/new$/)
  await page.goBack()
  // The navigation counts the orders waiting for confirmation.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Orders (1 waiting for confirmation)' })).toBeVisible()
  // The status tabs count what is waiting and what was given.
  await expect(page.getByRole('button', { name: 'Awaiting 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Given 0' })).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(recordNumber) })
  await expect(row).toContainText('Ordered')
  await expect(row).toContainText('today') // days waiting for confirmation

  // The row opens the order at its own address, beside the list, with its items and ORDERED actions.
  const order = await openOrder(recordNumber)
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  await expect(order.getByRole('cell', { name: 'Safety shoes S3 SRC', exact: true })).toBeVisible()
  await expect(order.getByRole('button', { name: 'Open Employee Confirmation' })).toBeVisible()
  await expect(order.getByRole('button', { name: 'View Record' })).toHaveCount(0)
  // The supplier message is Create Order's review's, not the order's.
  await expect(order.getByRole('button', { name: 'Copy for WhatsApp' })).toHaveCount(0)
})

test('Open Employee Confirmation creates a link', async () => {
  await page.getByRole('complementary', { name: 'Order' }).getByRole('button', { name: 'Open Employee Confirmation' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Create confirmation link' }).click()
  const link = dialog.getByLabel('Confirmation link')
  await expect(link).toHaveValue(/\/confirm\/[\w-]{40,}$/)
  confirmationURL = await link.inputValue()
  await dialog.getByRole('button', { name: 'Close' }).click()
})

test('the employee confirms on the public page; a second confirmation is a no-op', async ({ browser }) => {
  // A fresh context: no staff session, as on the employee's phone.
  const ctx = await browser.newContext()
  const employee = await ctx.newPage()
  await employee.goto(confirmationURL)
  await expect(employee.getByRole('navigation')).toHaveCount(0)
  // First what is asked, in plain words, the items and the statement agreed to; the full record is one tap away.
  await expect(employee.getByRole('heading', { name: 'Ona, please confirm you received 3 items' })).toBeVisible()
  await expect(employee.getByText(/^Order WE-\d{6} · from /)).toBeVisible()
  const items = employee.getByRole('list', { name: 'Items' })
  await expect(items.getByRole('listitem')).toHaveCount(3)
  // Each line's quantity, unit price and amount, and the total, as on the record.
  await expect(items.getByRole('listitem').filter({ hasText: 'gloves' })).toContainText('10 × €2.50')
  await expect(items.getByRole('listitem').filter({ hasText: 'gloves' })).toContainText('€25.00')
  await expect(employee.getByText('Total', { exact: true })).toBeVisible()
  await expect(employee.getByText('€114.98', { exact: true })).toBeVisible()
  await expect(employee.getByText('What you confirm')).toBeVisible()
  // A new order carries the current wording (2026-09-v2).
  await expect(employee.getByText('I confirm receipt of the listed items in the stated sizes and quantities', { exact: false })).toBeVisible()
  await expect(employee.getByText('Items Given Record / Акт выдачи')).toHaveCount(0)
  await employee.getByRole('button', { name: 'View full record (EN / RU)' }).click()
  await expect(employee.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  await expect(employee.getByText('Подтверждение получения')).toBeVisible()
  await expect(employee.getByText('Confirmation of receipt')).toBeVisible()

  // EN / RU changes the interface wording; the record stays bilingual.
  await employee.getByRole('button', { name: 'Русский' }).click()
  await expect(employee.getByRole('heading', { name: 'Ona, пожалуйста, подтвердите получение 3 предметов' })).toBeVisible()
  await expect(employee.getByText('Итого', { exact: true })).toBeVisible()
  await expect(employee.getByRole('button', { name: 'Подтвердить получение' })).toBeDisabled()
  await expect(employee.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  await employee.getByRole('button', { name: 'English' }).click()

  const confirm = employee.getByRole('button', { name: 'Confirm receipt' })
  // The consent is pinned to the bottom of the screen: in reach with the whole record open.
  await expect(confirm).toBeInViewport()
  await expect(confirm).toBeDisabled()
  await employee.getByRole('checkbox').check()
  await confirm.click()
  await expect(employee.getByRole('heading', { name: 'Receipt confirmed' })).toBeVisible()
  await expect(employee.getByText(/WE-\d{6} is recorded as given on .+ at \d\d:\d\d\. You can close this page\./)).toBeVisible()

  await employee.reload()
  await expect(employee.getByRole('heading', { name: 'Receipt confirmed' })).toBeVisible()
  await expect(employee.getByRole('button', { name: 'Confirm receipt' })).toHaveCount(0)
  await employee.getByRole('button', { name: 'View record' }).click()
  await expect(employee.getByText(/Confirmed electronically by/)).toBeVisible()

  // §7: an unknown or revoked link asks for a new one.
  await employee.goto(confirmationURL.replace(/[\w-]+$/, 'not-a-valid-token'))
  await expect(employee.getByText('Please ask for a new confirmation link.', { exact: false })).toBeVisible()
  await ctx.close()
})

test('Orders shows it GIVEN with usage time and the GIVEN actions', async () => {
  // The order's address still opens it after a reload.
  await page.reload()
  let order = page.getByRole('complementary', { name: 'Order' })
  await expect(order).toContainText(recordNumber)
  await order.getByRole('button', { name: 'Close order' }).click()
  await page.getByRole('button', { name: /^Given/ }).click()
  const row = page.getByRole('row', { name: new RegExp(recordNumber) })
  await expect(row).toContainText('Given')
  await expect(row).toContainText('0.0 months')
  order = await openOrder(recordNumber)
  await expect(order).toContainText('confirmed electronically')
  await expect(order.getByRole('button', { name: 'Open Employee Confirmation' })).toHaveCount(0)
  await expect(order.getByRole('button', { name: 'View Record' })).toBeVisible()
  await expect(order.getByRole('button', { name: 'Print Record' })).toBeVisible()
  // No WhatsApp on a given order: the supplier message is Create Order's review's.
  await expect(order.getByRole('button', { name: /WhatsApp/ })).toHaveCount(0)
})

test('a later price change does not alter the stored record', async () => {
  await openTab('Item Catalogue')
  await page.getByRole('row', { name: /Safety shoes/ }).getByRole('button', { name: 'Edit' }).click()
  // Its picture was guessed from its name when it was added.
  await expect(page.getByRole('dialog').getByRole('radio', { name: 'Shoes' })).toBeChecked()
  // The purchase price is optional; the record never shows it.
  await page.getByRole('dialog').getByLabel('Purchase price (€)').fill('41.00')
  await page.getByRole('dialog').getByLabel('Price (€)', { exact: true }).fill('59.99')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toContainText('€59.99')

  await openTab('Orders')
  await (await openOrder(recordNumber)).getByRole('button', { name: 'View Record' }).click()
  await expect(page.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  await expect(page.getByRole('cell', { name: '€49.99' }).first()).toBeVisible()
  await expect(page.getByText('€59.99')).toHaveCount(0)
  await expect(page.getByText('€41.00')).toHaveCount(0)
  await expect(page.getByText(/Confirmed electronically by/)).toBeVisible()
})

test('Print Record opens the print dialog; the record prints on one A4 page', async () => {
  await page.getByRole('button', { name: 'Print Record' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: number }).__printed ?? 0)).toBeGreaterThan(0)
  // Printed from a desktop window: the hidden navigation must not leave the record in its narrow column.
  const pdf = (await page.pdf({ format: 'A4', preferCSSPageSize: true })).toString('latin1')
  expect(pdf.match(/\/Type\s*\/Page[^s]/g)?.length, 'pages printed').toBe(1)
  // On paper the name line is filled in from the record; the employee signs and dates it.
  await page.emulateMedia({ media: 'print' })
  const nameLine = page.getByText('Employee name and surname / Имя и фамилия работника').locator('..')
  await expect(nameLine).toContainText('Ona Kazlauskienė')
  await page.emulateMedia({ media: null })
})

test('paper confirmation: a second order signed on paper', async () => {
  await openTab('Create Order')
  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await page.getByRole('combobox', { name: 'Assigned to' }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  // The shoe size saved earlier is now her default.
  await addItem('shoes', /^Safety shoes/)
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('42')
  await expect(page.getByRole('complementary', { name: 'Order summary' })).toContainText(`Last order ${recordNumber}`)
  // It gets its confirmation link like every new order, though it is signed on paper below.
  await markAsOrdered()
  const heading = page.getByText(/Order WE-\d{6} is ordered/)
  paperRecord = /WE-\d{6}/.exec((await heading.textContent()) ?? '')![0]
  await expect(page.getByLabel('Confirmation link')).toHaveValue(/\/confirm\/[\w-]{40,}$/)
  await expect(page.getByRole('button', { name: 'Send confirmation link' })).toHaveCount(0)
  // The new order was placed at the new price.
  await expect(page.getByRole('cell', { name: '€59.99' }).first()).toBeVisible()

  await openTab('Orders')
  const order = await openOrder(paperRecord)
  await order.getByRole('button', { name: 'Open Employee Confirmation' }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('dialog').getByRole('button', { name: 'Record signed paper confirmation' }).click()
  await expect(order).toContainText('confirmed on paper')
  await expect(page.getByRole('button', { name: 'Awaiting 0' })).toBeVisible()
})

test('Item page: price history and the orders that hold the item', async () => {
  await openTab('Item Catalogue')
  await page.getByRole('link', { name: 'Safety shoes' }).click()
  await expect(page.getByRole('heading', { name: 'Safety shoes' })).toBeVisible()
  // The change made earlier, newest first, then the price it was added at.
  // The price is the figure on the right; a first purchase price follows the date.
  const steps = page.getByRole('list', { name: 'Price history' }).getByRole('listitem')
  await expect(steps).toHaveCount(2)
  await expect(steps.first()).toContainText('Prices changed')
  await expect(steps.first()).toContainText('purchase price €41.00')
  await expect(steps.first()).toContainText('€49.99 → €59.99')
  await expect(steps.first()).toContainText('+20%')
  await expect(steps.last()).toContainText('Added')
  await expect(steps.last()).toContainText('€49.99')
  // Each order at the price it was placed at: the paper order at the new one.
  await expect(page.getByText('2 orders: 2 given, 0 on order.')).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(paperRecord) })).toContainText('€59.99')
  await expect(page.getByRole('row', { name: new RegExp(recordNumber) })).toContainText('€49.99')
  await page.getByRole('link', { name: `Receipt ${recordNumber}` }).click()
  await expect(page).toHaveURL(new RegExp(`/orders/[^/]+/record$`))
})

test('Audit log: who changed a price, when and where; the item\'s Changes say the same', async () => {
  // The item's own page lists its changes, newest first.
  await openTab('Item Catalogue')
  await page.getByRole('link', { name: 'Safety shoes' }).click()
  const changes = page.getByRole('region', { name: 'Changes' }).getByRole('listitem')
  await expect(changes.first()).toContainText('Price changed')
  await expect(changes.first()).toContainText('€49.99 → €59.99')
  await expect(changes.first()).toContainText(admin.name)
  await expect(changes.last()).toContainText('Item added')

  // Administration's Audit log, filtered to price changes in the Item Catalogue.
  await openTab('Audit log')
  await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Area' }).selectOption({ label: 'Item Catalogue' })
  await page.getByRole('combobox', { name: 'Change' }).selectOption({ label: 'Price changed' })
  await expect(page).toHaveURL(/\/admin\/audit\?area=catalogue&event=catalogue\.price_changed$/)
  const row = page.getByRole('row', { name: /Price changed.*Safety shoes/ })
  await expect(row).toContainText(admin.name)
  await expect(row).toContainText('Workwear & Equipment')

  // It opens at its own address, with its request's reference and the fields it changed.
  await row.getByRole('link', { name: 'Price changed' }).click()
  await expect(page).toHaveURL(/\/admin\/audit\/[0-9a-f-]{36}\?area=catalogue/)
  const change = page.getByRole('article', { name: 'Change' })
  await expect(change.getByRole('heading', { name: 'Price changed' })).toBeVisible()
  await expect(change).toContainText('Workwear & Equipment')
  await expect(change).toContainText('Reference')
  await expect(change).toContainText('€49.99 → €59.99')
  await expect(change).toContainText('Purchase price')
  // A reload keeps the filters and the open change.
  await page.reload()
  await expect(page.getByRole('article', { name: 'Change' }).getByRole('heading', { name: 'Price changed' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Area' })).toHaveValue('catalogue')

  // All of that item's changes: the list narrows to the record.
  await page.getByRole('article', { name: 'Change' }).getByRole('button', { name: 'All changes to this record' }).click()
  await expect(page.getByText('Record: Safety shoes')).toBeVisible()
  await expect(page.getByRole('row', { name: /Item added/ })).toBeVisible()
  await page.getByRole('button', { name: 'All records' }).click()
  await expect(page.getByText('Record: Safety shoes')).toHaveCount(0)

  // The seals: no day has ended since the test database was emptied, so none is sealed; Verify checks anyway.
  const seals = page.getByRole('region', { name: 'Seals' })
  await expect(seals).toContainText('No day is sealed yet.')
  await seals.getByRole('button', { name: 'Verify' }).click()
  await expect(seals).toContainText(/Checked \d{4}-\d{2}-\d{2}/)

  // Export: the filtered changes as a CSV file, and the export is itself on the log.
  await page.getByRole('combobox', { name: 'Area' }).selectOption({ label: 'Item Catalogue' })
  await page.getByRole('button', { name: 'Export' }).click()
  const sheet = page.getByRole('dialog', { name: 'Export the Audit log' })
  const downloading = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Download' }).click()
  const file = await downloading
  expect(file.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = await new Response(await file.createReadStream() as unknown as ReadableStream).text()
  expect(csv.split('\n')[0]).toBe('occurred_at,event,area,entity_type,entity_id,entity_label,entity_deleted,actor_id,actor_name,source,request_id,session_id,before,after,id')
  expect(csv).toContain('catalogue.price_changed')
  expect(csv).not.toContain('employee.created')
  await page.getByRole('combobox', { name: 'Area' }).selectOption({ label: 'Audit log' })
  await expect(page.getByRole('row', { name: /Audit log exported/ })).toContainText(admin.name)
})

test('Security: a failed attempt and a sign-in elsewhere are recorded; an administrator signs that device out and reviews access', async ({ browser }) => {
  // The administrator signs in on a phone too, getting the password wrong first.
  const phone = await (
    await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    })
  ).newPage()
  await phone.goto(webURL + '/')
  await phone.getByLabel('Email').fill(admin.email)
  await phone.getByLabel(/^Password/).fill('not-the-password')
  await phone.getByRole('button', { name: 'Sign in' }).click()
  await expect(phone.getByRole('alert')).toBeVisible()
  await phone.getByLabel(/^Password/).fill(admin.password)
  await phone.getByRole('button', { name: 'Sign in' }).click()
  await expect(phone.getByRole('navigation', { name: 'Main' })).toBeVisible()

  // Sign-ins, newest first, with the device and why an attempt failed.
  await openTab('Security')
  await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible()
  const failed = page.getByRole('row', { name: /Sign-in failed/ }).first()
  await expect(failed).toContainText('Wrong password')
  await expect(failed).toContainText(admin.name)
  await expect(failed).toContainText('Safari on iPhone')
  await page.getByRole('combobox', { name: 'Event' }).selectOption({ label: 'Sign-in failed' })
  await expect(page).toHaveURL(/\/admin\/security\?kind=sign_in_failed$/)
  await expect(page.getByRole('row', { name: /Signed in/ })).toHaveCount(0)

  // Every signed-in device; this one is marked and has no Sign out of its own here.
  await page.getByRole('navigation', { name: 'Security sections' }).getByRole('link', { name: 'Signed-in devices' }).click()
  await expect(page).toHaveURL(/\/admin\/security\/devices$/)
  await expect(page.getByRole('row', { name: /This device/ }).getByRole('button')).toHaveCount(0)
  await page.getByRole('button', { name: `Sign out ${admin.name} on Safari on iPhone` }).click()
  await expect(page.getByText(`${admin.name} was signed out on that device.`)).toBeVisible()
  await expect(page.getByRole('button', { name: `Sign out ${admin.name} on Safari on iPhone` })).toHaveCount(0)
  // The phone is signed out at its next request.
  await phone.reload()
  await expect(phone.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await phone.context().close()

  // The sign-in list says how it ended and where from; no "by", as the administrator ended their own.
  await page.getByRole('navigation', { name: 'Security sections' }).getByRole('link', { name: 'Sign-ins' }).click()
  const ended = page.getByRole('row', { name: /Sign-in ended/ }).first()
  await expect(ended).toContainText('Signed out on Security')
  await expect(ended).toContainText('Administration')
  await expect(ended).not.toContainText(`by ${admin.name}`)

  // The access review: every user, their roles and last sign-in; marked as reviewed, which the Audit log records.
  await page.getByRole('navigation', { name: 'Security sections' }).getByRole('link', { name: 'Access review' }).click()
  await expect(page.getByText('Access has not been reviewed yet.')).toBeVisible()
  const me = page.getByRole('row', { name: new RegExp(admin.email) })
  await expect(me).toContainText('Administrator')
  await expect(me).toContainText('Today')
  await page.getByRole('button', { name: 'Mark as reviewed' }).click()
  await expect(page.getByText('Marked as reviewed. It is on the Audit log.')).toBeVisible()
  await expect(page.getByText(`by ${admin.name}`)).toBeVisible()
  await page.getByRole('link', { name: /^today/i }).click()
  await expect(page).toHaveURL(/\/admin\/audit\/[0-9a-f-]{36}\?area=security$/)
  const change = page.getByRole('article', { name: 'Change' })
  await expect(change.getByRole('heading', { name: 'Access reviewed' })).toBeVisible()
  await expect(change).toContainText('Administrators')
})

test('Overview and System: what needs attention, an error the app reports, and the API and database', async () => {
  // Administration opens on the Overview: no backups is critical, and links to where it is put right.
  await page.goto('/admin/')
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  const attention = page.getByRole('region', { name: 'Needs attention' })
  await expect(attention.getByRole('listitem').first()).toContainText('Backups are not running')
  await expect(page.getByRole('list', { name: 'Key figures' })).toContainText('Active users')
  // The API connects as the least-privilege role, as in production: no warning about owner rights.
  await expect(page.getByText('The API connects as the database owner')).toHaveCount(0)

  // An error in the page is reported to System's error list, with the page's path.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e: a deliberate error')
    })
  })
  await openTab('System')
  await expect(page.getByRole('heading', { name: 'System', exact: true })).toBeVisible()
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Largest tables' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Slowest routes' })).toBeVisible()
  await page.getByRole('navigation', { name: 'System sections' }).getByRole('link', { name: 'Errors' }).click()
  await expect(page).toHaveURL(/\/admin\/system\/errors$/)
  await page.getByRole('link', { name: 'Error: e2e: a deliberate error' }).click()
  await expect(page).toHaveURL(/\/admin\/system\/errors\/[0-9a-f-]{36}$/)
  const pane = page.getByRole('article', { name: 'Error' })
  await expect(pane).toContainText('In the browser')
  await expect(pane).toContainText('/admin/')
  await expect(pane).toContainText(admin.name)
  await expect(pane).toContainText('Reference')

  // The Overview now has a new kind of error to look at.
  await openTab('Overview')
  const newErrors = page.getByRole('listitem').filter({ hasText: 'New errors' })
  await expect(newErrors).toContainText('A new kind of error in the last day.')
  await newErrors.getByRole('link', { name: 'Open Errors' }).click()
  await expect(page).toHaveURL(/\/admin\/system\/errors$/)
})

test('Usage: who is active, the link the employee opened and confirmed, and the data quality sampled', async () => {
  await openTab('Usage')
  await expect(page.getByRole('heading', { name: 'Usage', exact: true })).toBeVisible()
  const figures = page.getByRole('list', { name: 'Key figures' })
  await expect(figures.getByRole('listitem').filter({ hasText: 'Active today' })).not.toContainText(/^Active today0/)
  // The employee opened the confirmation link and confirmed: the funnel follows it.
  const funnel = page.getByRole('region', { name: 'Confirmation links, last 90 days' })
  await expect(funnel).toContainText(/Sent\s*\d/)
  await expect(funnel.getByRole('listitem').filter({ hasText: 'Opened' })).toContainText(/\d+% of sent/)
  await expect(funnel.getByRole('listitem').filter({ hasText: 'Confirmed' })).not.toContainText(/^Confirmed0/)
  // The browsers in use, and the data's quality sampled when the API started.
  await expect(page.getByRole('region', { name: 'Devices, last 30 days' })).toContainText('Computer')
  await expect(page.getByRole('region', { name: 'Data quality, last 90 days' })).toContainText('Employees without sizes')
  // Opening the link is on the order's Changes too.
  await page.goto('/admin/audit?event=order.confirmation_link_opened')
  await expect(page.getByRole('row', { name: /Confirmation link opened/ }).first()).toContainText('Confirmation link')
})

test('Dashboard: the figures follow the orders', async () => {
  await openTab('Dashboard')
  await page.getByRole('button', { name: 'Refresh' }).click()
  const figures = page.getByRole('list', { name: 'Key figures' })
  // Both orders are given: €114.98 + €59.99, 13 items (1 + 1 + 10, then 1).
  await expect(figures.getByRole('listitem').filter({ hasText: 'Awaiting confirmation' })).toContainText('Every order is confirmed.')
  await expect(figures.getByRole('listitem').filter({ hasText: /^Given in/ })).toContainText('€174.97')
  await expect(figures.getByRole('listitem').filter({ hasText: /^Given in/ })).toContainText('13 items in 2 orders')
  await expect(page.getByRole('table', { name: 'Value ordered and given per month' })).toContainText('€174.97 in 2 orders')
  await expect(page.getByText('Electronic 1 (50%)')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Most given items' }).getByRole('listitem').filter({ hasText: 'Protective gloves' })).toContainText('10 · €25.00')
  // Needs you: the unpriced helmet stops ordering, with the way to fix it.
  const needs = page.getByRole('list', { name: 'Needs you' })
  await expect(needs.getByRole('listitem').filter({ hasText: '1 item without a price or service period' })).toBeVisible()
  // Safety helmet has no price, which Mark as Ordered refuses; the row leads to the catalogue.
  const catalogue = page.getByRole('link', { name: /Catalogue items/ })
  await expect(catalogue).toContainText('1 without a price or service period')
  await catalogue.click()
  await expect(page.getByRole('heading', { name: 'Item Catalogue' })).toBeVisible()
  // The Manager Dashboard is the managers' alone: an administrator gets their own.
  await page.goto('/manager')
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manager Dashboard' })).toHaveCount(0)
  // So is the Employee Dashboard.
  await page.goto('/my-orders')
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Employee Dashboard' })).toHaveCount(0)
})

test('Replacements due: the whole list at its own address, under the Dashboard tab', async () => {
  await page.goto('/replacements')
  await expect(page.getByRole('heading', { name: 'Replacements due' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('main').getByRole('button', { name: 'Dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
})

test('hand-over: the employee confirms on this device, recorded in person', async () => {
  await openTab('Create Order')
  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await page.getByRole('combobox', { name: 'Assigned to' }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  await addItem('nitrile', /^Protective gloves/)
  await markAsOrdered()
  const heading = page.getByText(/Order WE-\d{6} is ordered/)
  const handed = /WE-\d{6}/.exec((await heading.textContent()) ?? '')![0]
  await page.getByRole('button', { name: 'Start a new order' }).click()

  await openTab('Orders')
  const order = await openOrder(handed)
  await order.getByRole('button', { name: 'Hand over now' }).click()
  // The device is turned to the employee: the same summary, record and consent as their own link.
  const screen = page.getByRole('dialog', { name: 'Hand-over / Выдача' })
  await expect(screen.getByRole('heading', { name: 'Ona, please confirm you received 1 item' })).toBeVisible()
  await expect(screen.getByRole('group', { name: 'Language / Язык' })).toBeVisible()
  const confirm = screen.getByRole('button', { name: 'Confirm receipt' })
  await expect(confirm).toBeInViewport()
  await expect(confirm).toBeDisabled()
  await screen.getByRole('checkbox').check()
  await confirm.click()
  await expect(screen.getByRole('heading', { name: 'Receipt confirmed' })).toBeVisible()
  await expect(screen.getByText(/Please hand the device back\./)).toBeVisible()
  await screen.getByRole('button', { name: 'Done' }).click()

  await expect(order).toContainText('confirmed in person on a staff device')
  await order.getByRole('button', { name: 'View Record' }).click()
  await expect(page.getByText(/Confirmed in person on a staff device by Ona Kazlauskienė/)).toBeVisible()
})

test('columns sort: Orders on the server across pages, other lists in place', async () => {
  await openTab('Orders')
  const records = async () => (await page.getByRole('row').filter({ hasText: /WE-\d{6}/ }).allTextContents()).map((t) => /WE-\d{6}/.exec(t)![0])
  const byRecord = page.getByRole('columnheader', { name: 'Record' })
  await expect(page.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'descending')
  await byRecord.getByRole('button').click()
  await expect(byRecord).toHaveAttribute('aria-sort', 'ascending')
  await expect.poll(async () => (await records())[0]).toBe(recordNumber)
  const ascending = await records()
  expect(ascending).toEqual([...ascending].sort())
  await byRecord.getByRole('button').click()
  await expect(byRecord).toHaveAttribute('aria-sort', 'descending')
  await expect.poll(records).toEqual([...ascending].reverse())

  // Item Catalogue has a natural order (display order) that a third click returns to.
  await openTab('Item Catalogue')
  const names = async () => (await page.locator('tbody tr td:first-child').allTextContents()).map((t) => t.trim())
  const byItem = page.getByRole('columnheader', { name: 'Item' })
  await expect(byItem).toHaveAttribute('aria-sort', 'none')
  const displayOrder = await names()
  expect(displayOrder).toEqual(['Safety shoes', 'Work jacket', 'Protective gloves', 'Safety helmet'])
  await byItem.getByRole('button').click()
  await expect(byItem).toHaveAttribute('aria-sort', 'ascending')
  expect(await names()).toEqual(['Protective gloves', 'Safety helmet', 'Safety shoes', 'Work jacket'])
  await byItem.getByRole('button').click()
  expect(await names()).toEqual(['Work jacket', 'Safety shoes', 'Safety helmet', 'Protective gloves'])
  await byItem.getByRole('button').click()
  await expect(byItem).toHaveAttribute('aria-sort', 'none')
  expect(await names()).toEqual(displayOrder)
  // Sorted by size group, a heading starts each group.
  await page.getByRole('columnheader', { name: 'Size group' }).getByRole('button').click()
  for (const group of ['Clothing', 'No size', 'Shoes']) await expect(page.getByRole('row', { name: group, exact: true })).toBeVisible()
})

test('Employees: the Missing sizes tile\'s address opens the list filtered', async () => {
  await page.goto('/employees?missing=1')
  await expect(page.getByRole('button', { name: /^Missing a size/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Every employee has the sizes Create Order needs.')).toBeVisible()
  await page.getByRole('button', { name: /^Missing a size/ }).click()
  await expect(page.getByRole('row', { name: /Ona Kazlauskienė/ })).toBeVisible()
})

test('Employees: less frequent and destructive actions are under ⋯', async () => {
  await openTab('Employees')
  const row = page.getByRole('row', { name: /Ona Kazlauskienė/ })
  await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await row.getByRole('button', { name: 'More actions for Ona Kazlauskienė' }).click()
  await expect(page.getByRole('menuitem', { name: 'Delete employee…' })).toBeVisible()
  // A menu item acts; it does not also open the row's employee.
  await page.getByRole('menuitem', { name: 'Edit details' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveURL(/\/employees$/)
  // A note shows under her name in the list, on one line, and in full on hover.
  await page.getByRole('dialog').getByLabel('Notes').fill('Prefers Russian. Collects on Fridays.')
  // Her preferred language, from those the app speaks, each named in itself.
  const language = page.getByRole('dialog').getByLabel('Preferred language')
  await expect(language.locator('option')).toHaveText(['Not set', 'English', 'Lietuvių', 'Русский'])
  await language.selectOption('ru')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  const note = row.getByText('Prefers Russian. Collects on Fridays.').filter({ visible: true })
  await expect(note).toBeVisible()
  await expect(note).toHaveAttribute('title', 'Prefers Russian. Collects on Fridays.')
})

test('Employees: a row opens the employee at its own address, with the items given and their receipts', async () => {
  await openTab('Employees')
  // Anywhere on the row opens it, not only the name.
  await page.getByRole('row', { name: /Ona Kazlauskienė/ }).getByRole('cell').nth(2).click()
  await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/)
  const employeeURL = page.url()
  await expect(page.getByRole('heading', { name: 'Ona Kazlauskienė' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Employees' })).toHaveAttribute('aria-current', 'page')
  // Her facts at the top; her Changes further down name the field too.
  await expect(page.locator('dl').filter({ hasText: 'Preferred language' }).first()).toContainText('Русский')
  // The page holds her actions: Delete, as in the table, is under ⋯.
  await page.getByRole('button', { name: 'More actions for Ona Kazlauskienė' }).click()
  await expect(page.getByRole('menuitem', { name: 'Delete employee…' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Both her orders are GIVEN; the first was bought before the price change and still shows €49.99 on its receipt.
  const given = page.getByRole('region', { name: 'Items given' })
  await expect(given.getByRole('row', { name: /Safety shoes/ })).toHaveCount(2)
  // Each item's latest line shows when it is due for replacement; an older one is replaced.
  await expect(given.getByRole('row', { name: /Safety shoes/ }).filter({ hasText: 'Replaced' })).toHaveCount(1)
  await expect(given.getByRole('row', { name: /Safety shoes/ }).filter({ hasText: /Due \d{4}-\d{2}-\d{2}/ })).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Ordered, not yet given' })).toHaveCount(0)
  await given.getByRole('link', { name: `Receipt ${recordNumber}` }).first().click()
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\/record$/)
  await expect(page.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  await expect(page.getByRole('cell', { name: '€49.99' }).first()).toBeVisible()

  // Back returns to the employee, and the address works on its own (a bookmark or a shared link).
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(employeeURL)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ona Kazlauskienė' })).toBeVisible()
  await page.getByRole('button', { name: 'Employees' }).click()
  await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible()
})

test('a reorder link starts the order with the item at the quantity given; the stepper changes it', async () => {
  // A dashboard's Reorder carries the employee, the item and the quantity given last time in the address.
  await openTab('Employees')
  await page.getByRole('link', { name: 'Ona Kazlauskienė' }).click()
  const employeeId = /\/employees\/([0-9a-f-]{36})$/.exec(page.url())![1]
  await openTab('Item Catalogue')
  await page.getByRole('link', { name: 'Protective gloves' }).click()
  const itemId = /\/catalogue\/([0-9a-f-]{36})$/.exec(page.url())![1]

  await page.goto(`/orders/new?employee=${employeeId}&item=${itemId}:10`)
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')
  await expect(page.getByRole('combobox', { name: 'Assigned to' })).toHaveAttribute('placeholder', /Ona Kazlauskienė/)
  // The address drops the reorder, so a reload keeps the draft without adding the items again.
  await expect(page).toHaveURL(/\/orders\/new$/)
  await page.reload()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')

  await page.getByRole('button', { name: 'One more Protective gloves' }).click()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('11')
  await page.getByRole('button', { name: 'One fewer Protective gloves' }).click()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'New order' }).click()
  await expect(page.getByText('No items yet.')).toBeVisible()
})

test('Orders beside an open order: one line a row; J and K move through it, Escape closes it', async () => {
  await openTab('Orders')
  const detail = await openOrder(recordNumber)
  await expect(detail.getByRole('heading', { name: recordNumber })).toBeVisible()
  // Beside the order the list keeps its short columns, one line a row, rather than stacking.
  await expect(page.getByRole('columnheader', { name: 'Record' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Usage time' })).toHaveCount(0)
  expect((await page.getByRole('row', { name: new RegExp(recordNumber) }).boundingBox())!.height, 'an Orders row beside an order').toBeLessThan(48)
  await expect(detail.getByText('next or previous order')).toBeVisible()
  const opened = page.url()
  await page.keyboard.press('k')
  await expect(page).not.toHaveURL(opened)
  await expect(page.getByRole('row', { name: new RegExp(recordNumber) })).not.toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('j')
  await expect(page).toHaveURL(opened)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/orders$/)
  await expect(page.getByRole('columnheader', { name: 'Usage time' })).toBeVisible()
})

test('desktop power layer: relative dates, a record previewed on hover, Compact rows kept per user', async () => {
  await openTab('Orders')
  const row = page.getByRole('row', { name: new RegExp(recordNumber) })
  // This run's orders are from today (or, run across midnight, yesterday); the exact time is on hover.
  const when = row.locator('time:visible')
  await expect(when).toHaveText(/^(Today|Yesterday) \d{2}:\d{2}$/)
  await expect(when).toHaveAttribute('title', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

  // Hovering the record number shows the order without leaving the list.
  await row.getByRole('link', { name: recordNumber, exact: true }).hover()
  const preview = page.locator('[data-slot=record-preview]')
  await expect(preview).toContainText(recordNumber)
  await expect(preview).toContainText(/Total\s*€/)
  await page.getByRole('heading', { name: 'Orders', exact: true }).hover()
  await expect(preview).toBeHidden()

  const height = async () => (await row.boundingBox())!.height
  const comfortable = await height()
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('dialog', { name: 'Search or jump to' }).getByRole('combobox').fill('compact')
  await page.getByRole('option', { name: 'Compact table rows' }).click()
  await expect.poll(height, { message: 'a compact Orders row' }).toBeLessThanOrEqual(33)
  expect(comfortable).toBeGreaterThan(33)
  // Saved for this user on this device: a reload keeps it; Account switches it back.
  await page.reload()
  await expect.poll(height).toBeLessThanOrEqual(33)
  await page.goto('/account')
  const rows = page.getByRole('group', { name: 'Table rows' })
  await expect(rows.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
  await rows.getByRole('button', { name: 'Comfortable' }).click()
  await expect(rows.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true')
  await openTab('Orders')
  await expect.poll(height).toBeGreaterThan(33)
})

test('Company Assets: Add SIM Card, Change Status saved at once, a duplicate names the card', async () => {
  await openTab('Company Assets')
  await expect(page.getByRole('heading', { name: 'Company Assets', exact: true })).toBeVisible()
  await expect(page.getByText(/No SIM cards yet/)).toBeVisible()
  // One card, in the Office and Not Activated, with the next number suggested (§4).
  await page.getByRole('button', { name: 'Add SIM Card' }).click()
  const form = page.getByRole('dialog')
  await expect(form.getByLabel('Inventory No.')).toHaveValue('SIM-000001')
  await form.getByLabel('SIM No.').fill('0089370011')
  await form.getByLabel('Provider').fill('Telia')
  await form.getByLabel('Plan').fill('Biz 10 GB')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('SIM-000001 added.')).toBeVisible()
  const card = page.getByRole('row', { name: /SIM-000001/ })
  await expect(card).toContainText('0089370011')
  await expect(card.getByText('Not Activated', { exact: true })).toBeVisible()
  await expect(card).toContainText('Office')
  await expect(page.getByRole('button', { name: /^In Office\s*1/ })).toBeVisible()
  // Change Status: the three statuses on this screen, saved at once with no confirmation (§5).
  await card.getByRole('button', { name: /^Change Status of SIM-000001/ }).click()
  await expect(page.getByText(/Email your provider to activate this SIM card/)).toBeVisible()
  await page.getByRole('menuitemradio', { name: 'Active' }).click()
  await expect(page.getByText('SIM-000001: status changed to Active.')).toBeVisible()
  await expect(card.getByText('Active', { exact: true })).toBeVisible()
  await expect(card).toContainText('Office')
  // The same card again, its number typed with a space: refused, and the form opens the one registered.
  await page.getByRole('button', { name: 'Add SIM Card' }).click()
  await form.getByLabel('SIM No.').fill('0089 370011')
  await form.getByLabel('Provider').fill('Bitė')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form.getByText('This SIM number is already registered.')).toBeVisible()
  await form.getByRole('button', { name: 'Open the existing SIM card' }).click()
  await expect(page.getByLabel('Search SIM cards')).toHaveValue('SIM-000001')
  await expect(page.getByRole('row', { name: /SIM-000001/ })).toBeVisible()
  // A tile keeps the other filters: In Office with Blocked is the blocked cards in the office (§3).
  await page.getByRole('button', { name: /^In Office/ }).click()
  await page.getByRole('button', { name: 'Blocked', exact: true }).click()
  await expect(page.getByText('No SIM cards match these filters.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await expect(page.getByRole('row', { name: /SIM-000001/ })).toBeVisible()
})

test('Company Assets: give a SIM card against its printed form, mark it not returned, then register its return', async () => {
  await openTab('Company Assets')
  await page.getByRole('link', { name: 'SIM-000001', exact: true }).click()
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'SIM-000001' })).toBeVisible()
  await expect(main.getByText('No one')).toBeVisible()
  // Giving needs a phone number on the card: Edit adds it.
  await main.getByRole('button', { name: 'More actions for SIM-000001' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const edit = page.getByRole('dialog')
  await edit.getByLabel('Phone No.').fill('+370 612 40118')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('SIM-000001 saved.')).toBeVisible()

  // Give SIM Card: one form, the reason by the button until it can be given (§6).
  await main.getByRole('button', { name: 'Give SIM Card' }).click()
  const give = page.getByRole('dialog')
  await expect(give.getByText('Choose the employee.')).toBeVisible()
  await give.getByRole('combobox', { name: 'Employee' }).fill('Ona')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  await expect(give.getByText('Fill in the non-return value: the form needs it.')).toBeVisible()
  await give.getByLabel('Non-return Value').fill('25.00')
  await expect(give.getByText('Print the form, then have it signed.')).toBeVisible()
  await expect(give.getByLabel('Paper Form Signed')).toBeDisabled()
  // Print Form prints the form the API would store, in a tab of its own; printing is not giving (§8).
  await page.context().addInitScript(() => {
    window.print = () => {
      ;(window as unknown as { __printed: number }).__printed = 1
    }
  })
  const [printTab] = await Promise.all([page.waitForEvent('popup'), give.getByRole('link', { name: 'Print Form' }).click()])
  await expect(printTab.getByRole('heading', { name: /SIM Card Assignment Form/ })).toBeVisible()
  await expect(printTab.getByText('Ona Kazlauskienė')).toBeVisible()
  await expect(printTab.getByText('€25.00')).toBeVisible()
  await expect.poll(() => printTab.evaluate(() => (window as unknown as { __printed?: number }).__printed)).toBe(1)
  await printTab.close()
  await expect(give.getByText('Ask the employee to sign the printed form before handing over the SIM card.')).toBeVisible()
  await give.getByLabel('Paper Form Signed').check()
  // A change to the form after printing takes the tick away and asks for a reprint.
  const today = await give.getByLabel('Given Date').inputValue()
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  await give.getByLabel('Given Date').fill(yesterday)
  await expect(give.getByText(/The form changed after printing/)).toBeVisible()
  await expect(give.getByLabel('Paper Form Signed')).not.toBeChecked()
  await give.getByLabel('Given Date').fill(today)
  await give.getByLabel('Paper Form Signed').check()
  await give.getByRole('button', { name: 'Give SIM Card' }).click()
  await expect(page.getByText('SIM card given to Ona Kazlauskienė.')).toBeVisible()
  // One action changed the holder, the location, the form and the history (§7).
  await expect(main.getByRole('link', { name: 'Ona Kazlauskienė' }).first()).toBeVisible()
  await expect(main.getByText('With an employee')).toBeVisible()
  const assignments = main.getByRole('region', { name: 'Assignments' })
  await expect(assignments.getByText('Paper form signed')).toBeVisible()
  await expect(assignments.getByRole('link', { name: 'Print form again' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Give SIM Card' })).toHaveCount(0)

  // Mark as Not Returned, and the blocking email offered next (§13, §14).
  await main.getByRole('button', { name: 'More actions for SIM-000001' }).click()
  await page.getByRole('menuitem', { name: 'Mark as Not Returned' }).click()
  const mark = page.getByRole('dialog')
  await mark.getByLabel('Whereabouts unknown').check()
  await mark.getByLabel('Comment').fill('Left without notice')
  await mark.getByRole('button', { name: 'Mark as Not Returned' }).click()
  const email = page.getByRole('dialog')
  await expect(email.getByText('SIM-000001 marked as not returned. Next: ask the provider to block the card.')).toBeVisible()
  await expect(email.getByLabel('Subject')).toHaveValue('SIM blocking request - +370 612 40118')
  await expect(email.getByLabel('Message')).toHaveValue(/SIM number: 0089370011/)
  await email.getByRole('button', { name: 'Close' }).last().click()
  // Unknown, the last holder kept; still Active: preparing the email changes nothing.
  await expect(main.getByText('Unknown', { exact: true }).first()).toBeVisible()
  await expect(main.getByText('Not Returned').first()).toBeVisible()
  await expect(main.getByText('Active', { exact: true }).first()).toBeVisible()

  // Register SIM Return: back in the office, the status and the mark kept (§11).
  await main.getByRole('button', { name: 'Register SIM Return' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Register Return to Office' }).click()
  await expect(page.getByText('SIM-000001 is back in the office.')).toBeVisible()
  await expect(main.getByText('No one')).toBeVisible()
  await expect(assignments.getByText(/· Returned /)).toBeVisible()
  await expect(assignments.getByText('Not Returned', { exact: true })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Give SIM Card' })).toBeVisible()
  // Its Changes tell the story.
  for (const change of ['Given to an employee', 'Marked as Not Returned', 'Returned to the office']) {
    await expect(main.getByText(change, { exact: true }).first()).toBeVisible()
  }
})

test('Company Assets on the employee page, in ⌘K and on the Dashboard; a holder is not deleted', async () => {
  // Given SIM on her page: the card she held, returned (§18).
  await openTab('Employees')
  await page.getByRole('link', { name: 'Ona Kazlauskienė', exact: true }).click()
  const givenSim = page.getByRole('region', { name: 'Given SIM' })
  await expect(givenSim.getByRole('link', { name: 'SIM-000001' })).toBeVisible()
  await expect(givenSim).toContainText('Returned')
  // Give SIM Card from her page: she is already chosen; the cards in the office are listed with their status (§6).
  await givenSim.getByRole('button', { name: 'Give SIM Card' }).click()
  const give = page.getByRole('dialog')
  await expect(give.getByRole('combobox', { name: 'Employee' })).toHaveAttribute('placeholder', 'Ona Kazlauskienė')
  await expect(give.getByText('Choose a SIM card.')).toBeVisible()
  const card = give.getByRole('radio', { name: /SIM-000001/ })
  await expect(card).toContainText('Active')
  await card.click()
  await expect(card).toHaveAttribute('aria-checked', 'true')
  const [printTab] = await Promise.all([page.waitForEvent('popup'), give.getByRole('link', { name: 'Print Form' }).click()])
  await expect(printTab.getByText('Ona Kazlauskienė')).toBeVisible()
  await printTab.close()
  await give.getByLabel('Paper Form Signed').check()
  await give.getByRole('button', { name: 'Give SIM Card' }).click()
  await expect(page.getByText('SIM card given to Ona Kazlauskienė.')).toBeVisible()
  await expect(givenSim).toContainText('Not returned yet')
  // Leaving never returns a card: while she holds one she is not deleted, and the app says which (§2).
  await page.getByRole('button', { name: 'More actions for Ona Kazlauskienė' }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('menuitem', { name: 'Delete employee…' }).click()
  await expect(page.getByText(/This employee still holds SIM-000001/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ona Kazlauskienė' })).toBeVisible()

  // ⌘K finds the card by its phone number, typed with a space.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search or jump to' })
  await palette.getByRole('combobox').fill('612 40')
  const found = palette.getByRole('option', { name: /^SIM-000001 · \+370 612 40118/ })
  await expect(found).toContainText('Ona Kazlauskienė')
  await found.click()
  await expect(page).toHaveURL(/\/assets\/[0-9a-f-]{36}$/)
  // Back in the office, for the steps after this one.
  await page.getByRole('main').getByRole('button', { name: 'Register SIM Return' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Register Return to Office' }).click()
  await expect(page.getByText('SIM-000001 is back in the office.')).toBeVisible()

  // The Dashboard's Company Assets card opens the register on a tile.
  await openTab('Dashboard')
  const assetsCard = page.getByRole('region', { name: 'Company Assets' })
  await expect(assetsCard.getByRole('link', { name: /Total SIM Cards\s*1/ })).toBeVisible()
  await assetsCard.getByRole('link', { name: /In Office\s*1/ }).click()
  await expect(page).toHaveURL(/\/assets\?show=in-office$/)
  await expect(page.getByRole('button', { name: /^In Office/ })).toHaveAttribute('aria-pressed', 'true')
})

test('Equipment & Furniture: one record per item, numbered by category; a computer is given against its form, a desk without one', async () => {
  await openTab('Company Assets')
  await page.getByRole('link', { name: 'Equipment & Furniture' }).click()
  await expect(page).toHaveURL(/\/assets\?kind=equipment$/)
  await expect(page.getByText(/No equipment or furniture yet/)).toBeVisible()
  // Add Asset: the category suggests its number (§15, §16).
  const addAsset = async (name: string, category: string, number: string, value?: string) => {
    await page.getByRole('button', { name: 'Add Asset' }).click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name').fill(name)
    await form.getByLabel('Category').selectOption({ label: category })
    await expect(form.getByLabel('Inventory No.')).toHaveValue(number)
    if (value) await form.getByLabel('Non-return Value').fill(value)
    await form.getByRole('button', { name: 'Save Asset' }).click()
    await expect(page.getByText(`${number} added.`)).toBeVisible()
  }
  await addAsset('Laptop', 'Computer', 'PC-000001', '900.00')
  await addAsset('Desk', 'Furniture', 'FUR-000001')
  await page.getByRole('main').getByLabel('Category', { exact: true }).selectOption({ label: 'Furniture' })
  await expect(page.getByRole('row', { name: /FUR-000001/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /PC-000001/ })).toHaveCount(0)

  // A desk is given without a signed form (open decision 6).
  await page.getByRole('row', { name: /FUR-000001/ }).getByRole('button', { name: 'Give Asset' }).click()
  const giveDesk = page.getByRole('dialog')
  await giveDesk.getByRole('combobox', { name: 'Employee' }).fill('Ona')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  await expect(giveDesk.getByText('Furniture and other items are given without a signed form.')).toBeVisible()
  await expect(giveDesk.getByRole('link', { name: 'Print Form' })).toHaveCount(0)
  // A plan is a SIM card's: never asked for an item.
  await expect(giveDesk.getByLabel('Plan')).toHaveCount(0)
  await giveDesk.getByRole('button', { name: 'Give Asset' }).click()
  await expect(page.getByText('Asset given to Ona Kazlauskienė.')).toBeVisible()

  // The laptop from her page: chosen among the items in the office, given against its printed form.
  await openTab('Employees')
  await page.getByRole('link', { name: 'Ona Kazlauskienė', exact: true }).click()
  const equipment = page.getByRole('region', { name: 'Equipment' })
  await expect(equipment.getByRole('link', { name: 'FUR-000001' })).toBeVisible()
  await equipment.getByRole('button', { name: 'Give Asset' }).click()
  const give = page.getByRole('dialog')
  await expect(give.getByRole('radio', { name: /FUR-000001/ })).toHaveCount(0)
  await give.getByRole('radio', { name: /PC-000001/ }).click()
  await expect(give.getByText('Print the form, then have it signed.')).toBeVisible()
  const [printTab] = await Promise.all([page.waitForEvent('popup'), give.getByRole('link', { name: 'Print Form' }).click()])
  await expect(printTab.getByRole('heading', { name: /Equipment Assignment Form/ })).toBeVisible()
  await expect(printTab.getByText('€900.00')).toBeVisible()
  await printTab.close()
  await give.getByLabel('Paper Form Signed').check()
  await give.getByRole('button', { name: 'Give Asset' }).click()
  await expect(page.getByText('Asset given to Ona Kazlauskienė.')).toBeVisible()
  await expect(equipment.getByRole('link', { name: 'PC-000001' })).toBeVisible()
  await expect(equipment).toContainText('Paper form signed')
  // Kept apart from her SIM cards on the same page (§18).
  await expect(page.getByRole('region', { name: 'Given SIM' }).getByRole('link', { name: 'PC-000001' })).toHaveCount(0)

  // The desk comes back: Register Asset Return on its page; no connection status anywhere.
  await equipment.getByRole('link', { name: 'FUR-000001' }).click()
  const main = page.getByRole('main')
  await expect(main.getByText('Connection')).toHaveCount(0)
  await main.getByRole('button', { name: 'Register Asset Return' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Register Return to Office' }).click()
  await expect(page.getByText('FUR-000001 is back in the office.')).toBeVisible()
  await expect(main.getByRole('button', { name: 'Give Asset' })).toBeVisible()

  // ⌘K finds an item by its number, named as an item, among Company Assets.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search or jump to' })
  await palette.getByRole('combobox').fill('PC-000001')
  const found = palette.getByRole('option', { name: /^PC-000001 · Laptop/ })
  await expect(found).toContainText('Ona Kazlauskienė')
  await found.click()
  // From the desk's page to the laptop's: the page shows the laptop, not the desk.
  await expect(main.getByRole('heading', { name: 'PC-000001' })).toBeVisible()
  await expect(page.getByText('FUR-000001 is back in the office.')).toHaveCount(0)
})

test('⌘K finds an order by its record number, however it is typed', async () => {
  await openTab('Employees')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search or jump to' })
  // "WE-000001" typed as "we1": lower case, no dash, no leading zeros.
  const typed = recordNumber.toLowerCase().replace('-', '').replace(/we0+/, 'we')
  await palette.getByRole('combobox').fill(typed)
  const option = palette.getByRole('option', { name: new RegExp(`^${recordNumber} · Ona Kazlauskienė`) })
  await expect(option).toBeVisible()
  await expect(option).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('complementary', { name: 'Order' })).toContainText(recordNumber)
})

test('⌘K finds an employee and starts an order for them; G then H and ? work from the keyboard', async () => {
  await openTab('Employees')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search or jump to' })
  await palette.getByRole('combobox').fill('Kazlausk')
  await expect(palette.getByRole('option', { name: 'New order for Ona Kazlauskienė' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/orders\/new$/)
  await expect(page.getByRole('combobox', { name: 'Assigned to' })).toHaveAttribute('placeholder', /Ona Kazlauskienė/)

  await page.getByRole('heading', { name: 'Create Order' }).click()
  await page.keyboard.press('g')
  await page.keyboard.press('h')
  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()

  // Leave Create Order empty for the steps after.
  await openTab('Create Order')
  await page.getByRole('button', { name: 'New order' }).click()
  await expect(page.getByRole('combobox', { name: 'Assigned to' })).toHaveAttribute('placeholder', 'Search employees…')
})

test('phone and tablet: no screen scrolls sideways', async () => {
  const desktop = page.viewportSize()!
  await page.setViewportSize({ width: 375, height: 812 })
  // The phone bar puts New order in the middle, raised: Home, Orders, New order, Employees, More.
  const phoneNav = page.getByRole('navigation', { name: 'Main' })
  const newOrder = phoneNav.getByRole('link', { name: /^Create Order/ })
  await expect(newOrder).toHaveText(/New order/)
  const middle = await newOrder.boundingBox()
  expect(Math.abs(middle!.x + middle!.width / 2 - 375 / 2), 'New order is in the middle of the bar').toBeLessThan(2)
  const history = await phoneNav.getByRole('link', { name: /^Orders/ }).boundingBox()
  expect(history!.x).toBeLessThan(middle!.x)
  // Neither the page nor any table (which scrolls inside its own box) runs sideways.
  const fits = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        [...document.querySelectorAll('[data-slot=table-container]')].every((t) => t.scrollWidth <= t.clientWidth),
    )

  // Each screen is measured once its data is in: a table measured while loading always fits.
  for (const [tab, content] of [
    ['Dashboard', 'Spending by month'],
    ['Orders', recordNumber],
    ['Employees', 'Ona Kazlauskienė'],
    ['Item Catalogue', 'Protective gloves'],
    ['Item Sets', 'Starter kit'],
    ['Company Assets', 'SIM-000001'],
    ['Users', admin.email],
    ['Roles & permissions', 'Built-in'],
    ['Audit log', admin.name],
    ['Overview', 'Needs attention'],
    ['Security', admin.name],
    ['System', 'Largest tables'],
    ['Usage', 'Active people per day'],
    ['Settings', 'Invite link'],
  ] as const) {
    // The same Main navigation, now a bottom tab bar.
    await openTab(tab)
    await expect(page.getByRole('heading', { name: tab, exact: true })).toBeVisible()
    // In the screen itself: the navigation's foot names the signed-in user too.
    await expect(page.getByRole('main').getByText(content).filter({ visible: true }).first()).toBeVisible()
    expect(await fits(), `${tab} scrolls sideways`).toBe(true)
    // The bar is one row of tabs, however many sections the app shows.
    const bar = await page.getByRole('navigation', { name: 'Main' }).boundingBox()
    expect(bar!.height, `${tab}: the tab bar is more than one row`).toBeLessThan(100)
  }
  // The dashboard on a phone: compact figure tiles, one fact beside each figure, then Needs you.
  await openTab('Dashboard')
  const figures = page.getByRole('list', { name: 'Key figures' })
  await expect(figures.getByRole('listitem').first()).toBeVisible()
  expect((await figures.boundingBox())!.height, 'the key figures on a phone').toBeLessThan(200)
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
  expect((await page.getByRole('button', { name: 'Refresh' }).boundingBox())!.width, 'Refresh is an icon on a phone').toBeLessThanOrEqual(44)
  const needsYou = page.getByRole('region', { name: /^Needs you/ })
  expect((await needsYou.boundingBox())!.y, 'Needs you starts in the first screen').toBeLessThan(420)

  // Orders on a phone: one list of two-line rows under month headings; the sort order folds
  // away with the filters, so the orders start near the top.
  await openTab('Orders')
  await expect(page.getByRole('row', { name: /^[a-z]+ \d{4}$/i }).first()).toBeVisible()
  const historyRow = page.getByRole('row', { name: new RegExp(recordNumber) })
  expect((await historyRow.boundingBox())!.height, 'an Orders row on a phone').toBeLessThan(80)
  await expect(page.getByLabel('Sort by').filter({ visible: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^Filters/ }).click()
  await expect(page.getByRole('region', { name: 'Filters' }).getByLabel('Sort by')).toBeVisible()
  // No time zone note on Orders.
  await expect(page.getByText(/Dates and times are shown in/)).toHaveCount(0)
  await page.getByRole('button', { name: /^Filters/ }).click()
  // Records lists on a phone: short rows that open the record, whose page holds the actions.
  await openTab('Employees')
  const onaRow = page.getByRole('row', { name: /Ona Kazlauskienė/ })
  // Name, then code and sizes, then her note on a third line (a row without a note is two).
  await expect(onaRow.getByText('Prefers Russian. Collects on Fridays.').filter({ visible: true })).toBeVisible()
  expect((await onaRow.boundingBox())!.height, 'an Employees row with a note on a phone').toBeLessThan(96)
  await expect(onaRow.getByRole('button')).toHaveCount(0)
  await openTab('Item Catalogue')
  const helmetRow = page.getByRole('row', { name: /Safety helmet/ })
  await expect(helmetRow).toContainText('Incomplete')
  await expect(helmetRow.getByRole('button')).toHaveCount(0)
  expect((await page.getByRole('row', { name: /Safety shoes/ }).boundingBox())!.height, 'a Catalogue row on a phone').toBeLessThan(80)
  await openTab('Employees')
  await page.getByRole('link', { name: 'Ona Kazlauskienė' }).click()
  await expect(page.getByRole('link', { name: `Receipt ${recordNumber}` }).first()).toBeVisible()
  expect(await fits(), 'the employee page scrolls sideways').toBe(true)
  await openTab('Item Catalogue')
  await page.getByRole('link', { name: 'Safety shoes' }).click()
  await expect(page.getByRole('heading', { name: 'Safety shoes' })).toBeVisible()
  expect(await fits(), 'the item page scrolls sideways').toBe(true)
  await page.goto('/replacements')
  await expect(page.getByRole('heading', { name: 'Replacements due' })).toBeVisible()
  expect(await fits(), 'Replacements due scrolls sideways').toBe(true)

  // The order's actions stay in reach however long the order is.
  await openTab('Create Order')
  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await page.getByRole('combobox', { name: 'Assigned to' }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  await page.getByRole('button', { name: 'Apply Starter kit' }).click()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('42')
  await expect(reviewButton()).toBeInViewport()
  expect(await fits()).toBe(true)
  // Away from Create Order, the button says a draft is waiting, with its line count, and reopens it.
  await openTab('Orders')
  await expect(newOrder).toHaveAccessibleName(/^Create Order \(draft, \d+ lines?\)$/)
  await expect(newOrder).toHaveText(/Draft/)
  await newOrder.click()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('42')
  // Left ORDERED, so Orders has a row waiting for confirmation.
  await markAsOrdered()
  await page.getByRole('button', { name: 'Start a new order' }).click()

  // On a phone an order opens instead of the list, with the way back to it.
  await openTab('Orders')
  await openOrder(recordNumber)
  await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeHidden()
  expect(await fits(), 'an order scrolls sideways').toBe(true)
  await page.getByRole('button', { name: 'View Record' }).click()
  await expect(page.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  expect(await fits(), 'the record scrolls sideways').toBe(true)

  // Tablet and narrow-laptop widths, beside the side rail: a table either fits
  // side by side or stacks, never scrolls. 920px left Orders 8rem too narrow.
  for (const width of [768, 920, 1100, desktop.width]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [tab, content] of [
      ['Dashboard', 'Spending by month'],
      ['Create Order', 'Assigned to'],
      ['Orders', recordNumber],
      ['Employees', 'Ona Kazlauskienė'],
      ['Item Catalogue', 'Protective gloves'],
      ['Users', admin.email],
      ['Roles & permissions', 'Built-in'],
      ['Audit log', admin.name],
      ['Overview', 'Needs attention'],
      ['Security', admin.name],
      ['System', 'Largest tables'],
      ['Usage', 'Active people per day'],
      ['Settings', 'Invite link'],
    ] as const) {
      await openTab(tab)
      await expect(page.getByRole('main').getByText(content).filter({ visible: true }).first()).toBeVisible()
      expect(await fits(), `${tab} scrolls sideways at ${width}px`).toBe(true)
    }
    await openTab('Employees')
    await page.getByRole('link', { name: 'Ona Kazlauskienė' }).click()
    await expect(page.getByRole('link', { name: `Receipt ${recordNumber}` }).first()).toBeVisible()
    expect(await fits(), `the employee page scrolls sideways at ${width}px`).toBe(true)
    await openTab('Item Catalogue')
    await page.getByRole('link', { name: 'Safety shoes' }).click()
    await expect(page.getByRole('heading', { name: 'Safety shoes' })).toBeVisible()
    expect(await fits(), `the item page scrolls sideways at ${width}px`).toBe(true)
  }

  await page.setViewportSize(desktop)
})

/** Signs in as someone else in a fresh browser context (its own cookies and storage); returns its page. */
async function signInElsewhere(browser: Browser, email: string, password: string) {
  const other = await (await browser.newContext()).newPage()
  await other.goto(webURL + '/')
  await other.getByLabel('Email').fill(email)
  await other.getByLabel(/^Password/).fill(password)
  await other.getByRole('button', { name: 'Sign in' }).click()
  return other
}

test('Users: an administrator adds, edits, deactivates and resets a user', async ({ browser }) => {
  const mia = { name: 'Mia Manager', email: 'mia@example.com', password: 'mia-password-1' }
  await openTab('Users')
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(admin.name) })).toContainText('You')

  // Add User: an employee by default; made a manager instead.
  await page.getByRole('button', { name: 'Add User' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(mia.name)
  await dialog.getByLabel('Email').fill(mia.email)
  await dialog.getByRole('checkbox', { name: /^Manager/ }).check()
  await dialog.getByRole('checkbox', { name: /^Employee/ }).uncheck()
  await dialog.getByRole('textbox', { name: /^Password/ }).fill('short')
  await dialog.getByRole('button', { name: 'Add User' }).click()
  await expect(dialog.getByText('Use at least 8 characters.')).toBeVisible()
  await dialog.getByRole('textbox', { name: /^Password/ }).fill(mia.password)
  await dialog.getByLabel('Confirm password').fill(mia.password)
  await dialog.getByRole('button', { name: 'Add User' }).click()
  const row = page.getByRole('row', { name: new RegExp(mia.name) })
  await expect(row).toContainText('Manager')
  await expect(row).toContainText('Active')

  // The same email twice is refused on its field.
  await page.getByRole('button', { name: 'Add User' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Someone Else')
  await dialog.getByLabel('Email').fill(mia.email.toUpperCase())
  await dialog.getByRole('textbox', { name: /^Password/ }).fill(mia.password)
  await dialog.getByLabel('Confirm password').fill(mia.password)
  await dialog.getByRole('button', { name: 'Add User' }).click()
  await expect(dialog.getByText('Another user already has this email address.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // The own account cannot be deactivated or lose Administrator.
  await page.getByRole('button', { name: `Edit ${admin.name}` }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox', { name: /^Active/ })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: /^Administrator/ })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // A manager starts on the Manager Dashboard and has no Users tab; the
  // administrator's Dashboard address shows the manager's own.
  let other = await signInElsewhere(browser, mia.email, mia.password)
  const nav = other.getByRole('navigation', { name: 'Main' })
  await expect(other.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Item Catalogue' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)
  // No way to Administration: a manager's roles open none of its screens.
  await expect(other.getByRole('link', { name: 'Administration' })).toHaveCount(0)
  await other.goto(webURL + '/admin/')
  await expect(other.getByRole('heading', { name: 'Administration is for administrators' })).toBeVisible()
  await other.goto(webURL + '/')
  await expect(other.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible()
  // Items, prices and purchasing: the price change made earlier, the unpriced helmet,
  // the second pair of shoes not yet on order again.
  const priceChange = other.getByRole('listitem').filter({ hasText: 'Safety shoes' }).filter({ hasText: '→' })
  await expect(priceChange).toContainText('€49.99 → €59.99')
  await expect(priceChange).toContainText('+20%')
  await expect(other.getByRole('region', { name: 'Without a price or service period' })).toContainText('Safety helmet')
  await expect(other.getByText('Size 42: 1 employee')).toBeAttached()
  // A figure with a list behind it opens that list: On order opens Orders on its Awaiting tab.
  await other.getByRole('list', { name: 'Key figures' }).getByRole('button', { name: /^On order/ }).click()
  await expect(other.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible()
  await expect(other.getByRole('button', { name: /^Awaiting/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(other).toHaveURL(/\/orders\?status=ORDERED$/)
  await other.goBack()
  await other.setViewportSize({ width: 375, height: 812 })
  expect(
    await other.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        [...document.querySelectorAll('[data-slot=table-container]')].every((t) => t.scrollWidth <= t.clientWidth),
    ),
    'the Manager Dashboard scrolls sideways',
  ).toBe(true)
  await other.goto(webURL + '/dashboard')
  await expect(other.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible()
  await other.context().close()

  // Add User with the default role: the employee role starts on the Employee
  // Dashboard, covering only their own orders; the other dashboards are not theirs.
  const eli = { name: 'Eli Employee', email: 'eli@example.com', password: 'eli-password-1' }
  await page.getByRole('button', { name: 'Add User' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(eli.name)
  await dialog.getByLabel('Email').fill(eli.email)
  await dialog.getByRole('textbox', { name: /^Password/ }).fill(eli.password)
  await dialog.getByLabel('Confirm password').fill(eli.password)
  await dialog.getByRole('button', { name: 'Add User' }).click()
  await expect(page.getByRole('row', { name: new RegExp(eli.name) })).toContainText('Employee')
  other = await signInElsewhere(browser, eli.email, eli.password)
  await expect(other.getByRole('heading', { name: 'Employee Dashboard' })).toBeVisible()
  const eliNav = other.getByRole('navigation', { name: 'Main' })
  await expect(eliNav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  await expect(eliNav.getByRole('link', { name: 'Users' })).toHaveCount(0)
  await expect(other.getByText('Every order of yours is confirmed.')).toBeVisible()
  await expect(other.getByRole('region', { name: 'Needs you' }).getByRole('button', { name: /^Send link/ })).toHaveCount(0)
  await expect(other.getByRole('list', { name: 'Key figures' }).getByRole('listitem').filter({ hasText: 'Replacements due' })).toBeVisible()
  await other.setViewportSize({ width: 375, height: 812 })
  expect(
    await other.evaluate(
      () =>
        document.documentElement.scrollWidth <= window.innerWidth &&
        [...document.querySelectorAll('[data-slot=table-container]')].every((t) => t.scrollWidth <= t.clientWidth),
    ),
    'the Employee Dashboard scrolls sideways',
  ).toBe(true)
  for (const path of ['/dashboard', '/manager']) {
    await other.goto(webURL + path)
    await expect(other.getByRole('heading', { name: 'Employee Dashboard' })).toBeVisible()
  }
  await other.context().close()

  // Deactivated: signed out where she is signed in, and can no longer sign in.
  const miaPhone = await signInElsewhere(browser, mia.email, mia.password)
  await expect(miaPhone.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible()
  await page.getByRole('button', { name: `Edit ${mia.name}` }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: /^Active/ }).uncheck()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(row).toContainText('Inactive')
  await miaPhone.reload()
  await expect(miaPhone.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await miaPhone.context().close()
  other = await signInElsewhere(browser, mia.email, mia.password)
  await expect(other.getByText('Wrong email or password.')).toBeVisible()
  await other.context().close()

  // Reactivated with a password reset: only the new password works.
  await page.getByRole('button', { name: `Edit ${mia.name}` }).click()
  await page.getByRole('dialog').getByRole('checkbox', { name: /^Active/ }).check()
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(row).not.toContainText('Inactive')
  // Reset password is under ⋯, beside Edit.
  await row.getByRole('button', { name: `More actions for ${mia.name}` }).click()
  await page.getByRole('menuitem', { name: 'Reset password…' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: /^New password/ }).fill('mia-password-2')
  await dialog.getByLabel('Confirm new password').fill('mia-password-2')
  await dialog.getByRole('button', { name: 'Set password' }).click()
  await expect(dialog.getByText(`The password for ${mia.name} has been changed.`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  other = await signInElsewhere(browser, mia.email, 'mia-password-2')
  await expect(other.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible()
  await other.context().close()
})

test('Roles & permissions: a role made of permissions, given to a user, lets them do what it allows', async ({ browser }) => {
  await openTab('Roles & permissions')
  await expect(page.getByRole('heading', { name: 'Roles & permissions' })).toBeVisible()
  // Administrator is shown as it is: nothing in it can change, and it cannot be deleted.
  const adminRow = page.getByRole('row', { name: /^Administrator/ })
  await expect(adminRow.getByRole('button', { name: /^More actions/ })).toHaveCount(0)
  await adminRow.getByRole('button', { name: 'View Administrator' }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox', { name: /^Manage roles/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /^Manage roles/ })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: /^Delete orders/ })).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Close' }).last().click()
  // Manager's permissions change, its name and description (in the reader's language) do not; saving keeps them.
  await page.getByRole('button', { name: 'Edit Manager' }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Name')).toBeDisabled()
  await expect(dialog.getByLabel('Description')).toHaveValue('Manages Item Catalogue prices and Item Sets, plus everything an employee can do.')
  await expect(dialog.getByLabel('Description')).toBeDisabled()
  await expect(dialog.getByText('A built-in role keeps its name and description.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  // A permission comes with what it needs: Manage users brings See users, which it then keeps ticked.
  await page.getByRole('button', { name: 'Add Role' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Storekeeper')
  await dialog.getByRole('checkbox', { name: /^Manage users/ }).check()
  await expect(dialog.getByRole('checkbox', { name: /^See users/ })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: /^See users/ })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /^Manage users/ }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: /^See users/ })).toBeEnabled()
  await dialog.getByRole('checkbox', { name: /^See users/ }).uncheck()
  await dialog.getByRole('checkbox', { name: /^Manage Item Catalogue/ }).check()
  await dialog.getByRole('button', { name: 'Add Role' }).click()
  const storeRow = page.getByRole('row', { name: /^Storekeeper/ })
  await expect(storeRow).toContainText('Manage Item Catalogue')
  await expect(storeRow).toContainText('0 users')
  // A second role of the same name is refused on its field.
  await page.getByRole('button', { name: 'Add Role' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('storekeeper')
  await dialog.getByRole('button', { name: 'Add Role' }).click()
  await expect(dialog.getByText('Another role already has this name.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Given to a user besides the employee role: they manage the catalogue, which the employee role alone does not.
  const sam = { name: 'Sam Storekeeper', email: 'sam@example.com', password: 'sam-password-1' }
  await openTab('Users')
  await page.getByRole('button', { name: 'Add User' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(sam.name)
  await dialog.getByLabel('Email').fill(sam.email)
  await expect(dialog.getByRole('checkbox', { name: /^Employee/ })).toBeChecked()
  await dialog.getByRole('checkbox', { name: /^Storekeeper/ }).check()
  await dialog.getByRole('textbox', { name: /^Password/ }).fill(sam.password)
  await dialog.getByLabel('Confirm password').fill(sam.password)
  await dialog.getByRole('button', { name: 'Add User' }).click()
  await expect(page.getByRole('row', { name: new RegExp(sam.name) })).toContainText('Storekeeper')
  const other = await signInElsewhere(browser, sam.email, sam.password)
  await expect(other.getByRole('heading', { name: 'Employee Dashboard' })).toBeVisible()
  await other.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Item Catalogue' }).click()
  await expect(other.getByRole('button', { name: 'Add Item' })).toBeVisible()
  // Not an administrator, so no way to Administration.
  await expect(other.getByRole('link', { name: 'Administration' })).toHaveCount(0)
  await other.context().close()

  // A role someone holds is not deleted.
  await openTab('Roles & permissions')
  await expect(page.getByRole('row', { name: /^Storekeeper/ })).toContainText('1 user')
  await page.getByRole('row', { name: /^Storekeeper/ }).getByRole('button', { name: /^More actions/ }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('menuitem', { name: 'Delete role…' }).click()
  await expect(page.getByText('Users hold this role. Take it from them on Users first.')).toBeVisible()
  await expect(page.getByRole('row', { name: /^Storekeeper/ })).toBeVisible()
})

test('Orders: only a manager deletes an order, after asking; it then leaves Orders', async ({ browser }) => {
  // The administrator has no Delete order: the order pane has no ⋯ for it.
  await openTab('Orders')
  const detail = await openOrder(paperRecord)
  await expect(detail.getByRole('heading', { name: paperRecord })).toBeVisible()
  await expect(detail.getByRole('button', { name: `More actions for ${paperRecord}` })).toHaveCount(0)

  // Mia, the manager from the Users step, with the password reset there.
  const other = await signInElsewhere(browser, 'mia@example.com', 'mia-password-2')
  await expect(other.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible()
  // The old address, from bookmarks and links already sent, opens the screen at its own.
  await other.goto(webURL + '/history')
  await expect(other).toHaveURL(/\/orders$/)
  await other.getByRole('link', { name: paperRecord, exact: true }).click()
  const pane = other.getByRole('complementary', { name: 'Order' })
  const more = pane.getByRole('button', { name: `More actions for ${paperRecord}` })
  // Delete asks first, saying the order was given; declining keeps it.
  let asked = ''
  other.once('dialog', (d) => {
    asked = d.message()
    void d.dismiss()
  })
  await more.click()
  await other.getByRole('menuitem', { name: 'Delete order…' }).click()
  expect(asked).toContain(`Delete ${paperRecord}`)
  expect(asked).toContain('given and confirmed')
  await expect(pane.getByRole('heading', { name: paperRecord })).toBeVisible()

  other.once('dialog', (d) => void d.accept())
  await more.click()
  await other.getByRole('menuitem', { name: 'Delete order…' }).click()
  await expect(other).toHaveURL(/\/orders$/)
  await expect(other.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible()
  await expect(other.getByRole('link', { name: paperRecord, exact: true })).toHaveCount(0)

  // Help shows a manager what their role can do: Delete order, but not Users.
  await other.getByRole('link', { name: 'Help' }).click()
  await expect(other.getByRole('heading', { name: 'User guide' })).toBeVisible()
  await expect(other.locator('#orders')).toContainText('Delete order…')
  await expect(other.locator('#users')).toHaveCount(0)
  await other.context().close()

  // Gone for everyone: the administrator's open copy no longer loads, and the list leaves it out.
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Order' })).toContainText('order not found')
  await openTab('Orders')
  await expect(page.getByRole('link', { name: recordNumber, exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: paperRecord, exact: true })).toHaveCount(0)
})

test('Language: Lithuanian or Russian on Account; the app and every later sign-in follow it', async ({ browser }) => {
  await page.getByRole('link', { name: admin.name }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  let languages = page.getByRole('group', { name: 'Language' })
  await expect(languages.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')

  // The app switches at once: the page, the navigation and <html lang>.
  await languages.getByRole('button', { name: 'Lietuvių' }).click()
  await expect(page.getByRole('heading', { name: 'Paskyra' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'lt')
  await page.getByRole('navigation', { name: 'Pagrindinė navigacija' }).getByRole('link', { name: 'Užsakymai' }).click()
  await expect(page.getByRole('heading', { name: 'Užsakymai', exact: true })).toBeVisible()
  // The record stays English / Russian whatever the interface language.
  await openOrder(recordNumber)
  await page.getByRole('button', { name: 'Peržiūrėti įrašą' }).click()
  await expect(page.getByRole('heading', { name: 'Items Given Record / Акт выдачи' })).toBeVisible()

  // Saved on the account, so a sign-in on another device opens in Lithuanian too.
  const other = await signInElsewhere(browser, admin.email, admin.password)
  await expect(other.getByRole('heading', { name: 'Suvestinė' })).toBeVisible()
  await other.context().close()

  // Help opens the guide in the user's language; its own switch changes the guide, not the app.
  await page.getByRole('link', { name: 'Pagalba' }).click()
  await expect(page).toHaveURL(/\/help$/)
  await expect(page.getByRole('heading', { name: 'Naudotojo vadovas' })).toBeVisible()
  // An administrator's guide has Users and no Delete order, which is the manager's.
  await expect(page.locator('#users')).toBeVisible()
  await expect(page.locator('#orders')).not.toContainText('Ištrinti užsakymą')
  await page.getByRole('group', { name: 'Vadovo kalba' }).getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'User guide' })).toBeVisible()
  await expect(page.locator('#create img')).toHaveAttribute('src', /help-img\/en\/desktop\/create-order\.png$/)
  expect(await page.locator('#create img').evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth))).toBeGreaterThan(0)
  // The guide is the device's: on a desktop the keyboard's way; a phone-sized window shows the phone's
  // screenshots and words; the switch shows another device's, until the window is resized.
  const devices = page.getByRole('group', { name: 'Device' })
  await expect(devices.getByRole('button', { name: 'Desktop' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#orders')).toContainText('J and K move between orders')
  const desk = page.viewportSize()!
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(devices.getByRole('button', { name: 'Phone' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#create img')).toHaveAttribute('src', /help-img\/en\/phone\/create-order\.png$/)
  await expect(page.locator('#orders')).toContainText('Filters holds the employee and date filters')
  await expect(page.locator('#shortcuts h2')).toHaveText(/Search$/)
  await devices.getByRole('button', { name: 'Tablet' }).click()
  await expect(page.locator('#create img')).toHaveAttribute('src', /help-img\/en\/tablet\/create-order\.png$/)
  await page.setViewportSize(desk)
  await expect(devices.getByRole('button', { name: 'Tablet' })).toHaveAttribute('aria-pressed', 'true')
  await devices.getByRole('button', { name: 'Desktop' }).click()
  await expect(page.locator('#shortcuts h2')).toHaveText(/Search and shortcuts$/)
  await expect(page.getByRole('navigation', { name: 'Pagrindinė navigacija' }).getByRole('link', { name: 'Užsakymai' })).toBeVisible()

  // Longer labels wrap inside their buttons, not into the padding or past it: Create Order's panel at desktop width.
  await page.goto('/orders/new')
  await expect(page.getByRole('button', { name: 'Peržiūrėti ir pažymėti kaip užsakytą' })).toBeVisible()
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('main button')]
        .filter((b) => {
          if (!b.checkVisibility()) return false
          const style = getComputedStyle(b)
          const room = b.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          const text = document.createRange()
          text.selectNodeContents(b)
          return text.getBoundingClientRect().width > room + 1
        })
        .map((b) => b.textContent),
    ),
    'buttons whose text is wider than their content box in Lithuanian',
  ).toEqual([])

  await page.getByRole('link', { name: admin.name }).click()
  await page.getByRole('group', { name: 'Kalba' }).getByRole('button', { name: 'Русский' }).click()
  await expect(page.getByRole('heading', { name: 'Учётная запись' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')

  // Longer words must not push any screen sideways on a phone.
  const desktop = page.viewportSize()!
  await page.setViewportSize({ width: 375, height: 812 })
  for (const path of [
    '/dashboard',
    '/orders/new',
    '/orders',
    '/employees',
    '/catalogue',
    '/item-sets',
    '/replacements',
    '/help',
    '/admin/users',
    '/admin/roles',
    '/admin/audit',
    '/admin/settings',
    '/admin/backups',
    '/account',
  ]) {
    await page.goto(path)
    await expect(page.locator('main h1')).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          [...document.querySelectorAll('[data-slot=table-container]')].every((t) => t.scrollWidth <= t.clientWidth),
      ),
      `${path} scrolls sideways in Russian`,
    ).toBe(true)
  }
  await page.setViewportSize(desktop)

  // Back to English for the steps after.
  languages = page.getByRole('group', { name: 'Язык' })
  await languages.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('the confirmation page and hand-over open in the employee’s preferred language', async ({ browser }) => {
  // Ona prefers Russian (set in the Employees step); a new order for her, with its link.
  await openTab('Create Order')
  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await page.getByRole('combobox', { name: 'Assigned to' }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  await addItem('nitrile', /^Protective gloves/)
  await markAsOrdered()
  const record = /WE-\d{6}/.exec((await page.getByText(/Order WE-\d{6} is ordered/).textContent()) ?? '')![0]
  const link = await page.getByLabel('Confirmation link').inputValue()
  await page.getByRole('button', { name: 'Start a new order' }).click()

  // Her phone's browser is English, yet the page opens in Russian; EN still switches it.
  const phone = await (await browser.newContext({ locale: 'en-GB' })).newPage()
  await phone.goto(link)
  await expect(phone.getByRole('button', { name: 'Подтвердить получение' })).toBeVisible()
  const switchLang = phone.getByRole('group', { name: 'Language / Язык' })
  await expect(switchLang.getByRole('button', { name: 'Русский' })).toHaveAttribute('aria-pressed', 'true')
  await switchLang.getByRole('button', { name: 'English' }).click()
  await expect(phone.getByRole('button', { name: 'Confirm receipt' })).toBeVisible()
  await phone.context().close()

  // Hand-over on this (English) staff device opens in Russian too.
  await openTab('Orders')
  const order = await openOrder(record)
  await order.getByRole('button', { name: 'Hand over now' }).click()
  const screen = page.getByRole('dialog', { name: 'Hand-over / Выдача' })
  await expect(screen.getByRole('button', { name: 'Подтвердить получение' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(screen).toBeHidden()
})

test('Theme: light, dark or the device’s own, kept on this device through a reload and at sign-in', async ({ browser }) => {
  await page.getByRole('link', { name: admin.name }).click()
  const theme = page.getByRole('group', { name: 'Theme' })
  const scheme = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
  await expect(theme.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')

  await theme.getByRole('button', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await scheme()).toBe('dark')
  // Set before the first paint, so a reload shows no flash of light.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(theme.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  // The device's, not the account's: this browser's storage without its sign-in shows the sign-in page dark too.
  const deviceOnly = await browser.newContext({ storageState: { cookies: [], origins: (await page.context().storageState()).origins } })
  const tab = await deviceOnly.newPage()
  await tab.goto(webURL)
  await expect(tab.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(tab.locator('html')).toHaveAttribute('data-theme', 'dark')
  // In dark mode the logo is white, the brand book's variation 3 (the brand-mark token).
  expect(await tab.getByRole('img', { name: 'GAVORT' }).evaluate((e) => getComputedStyle(e).fill)).toBe('oklch(0.985 0 0)')
  await deviceOnly.close()
  // A browser that never chose follows its own setting.
  const fresh = await browser.newPage({ colorScheme: 'dark' })
  await fresh.goto(webURL)
  await expect(fresh.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(fresh.locator('html')).not.toHaveAttribute('data-theme')
  expect(await fresh.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')
  await fresh.close()

  // ⌘K offers the other themes; Light from there.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search or jump to' })
  await palette.getByRole('combobox').fill('theme')
  await expect(palette.getByRole('option', { name: /Dark theme/ })).toHaveCount(0)
  await palette.getByRole('option', { name: /Light theme/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await scheme()).toBe('light')

  await theme.getByRole('button', { name: 'System' }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
})

test('the sign-in renews itself every few minutes while the app is open', async ({ browser }) => {
  // A fake clock in this tab only: the server keeps real time, so its tokens stay valid.
  const context = await browser.newContext({ baseURL: webURL })
  const tab = await context.newPage()
  await tab.clock.install()
  await tab.goto('/')
  await tab.getByLabel('Email').fill('mia@example.com')
  await tab.getByLabel(/^Password/).fill('mia-password-2')
  const login = tab.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'))
  await tab.getByRole('button', { name: 'Sign in' }).click()
  const { access_token } = (await (await login).json()) as { access_token: string }
  await expect(tab.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible()
  const first = (await refreshCookie(context))?.value

  // Once less than 10 minutes are left (5 minutes into a 15-minute token; this server's tokens may live
  // longer), the tab gets a new token with the refresh cookie, which is replaced too, and Mia is still signed in.
  const exp = (JSON.parse(Buffer.from(access_token.split('.')[1]!, 'base64url').toString()) as { exp: number }).exp * 1000
  const left = exp - (await tab.evaluate(() => Date.now()))
  const refreshed = tab.waitForResponse((r) => r.url().endsWith('/api/v1/auth/refresh'))
  await tab.clock.fastForward(Math.round(left - 9.5 * 60_000))
  expect((await refreshed).status()).toBe(200)
  await expect.poll(async () => (await refreshCookie(context))?.value).not.toBe(first)
  await tab.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Employees' }).click()
  await expect(tab.getByRole('heading', { name: 'Employees' })).toBeVisible()
  await context.close()
})

test('Keep me signed in unticked: signed in until the browser closes, and remembered for the next sign-in', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: webURL })
  const tab = await context.newPage()
  await tab.goto('/')
  await tab.getByLabel('Email').fill('eli@example.com')
  await tab.getByLabel(/^Password/).fill('eli-password-1')
  await tab.getByRole('checkbox', { name: /^Keep me signed in/ }).uncheck()
  await tab.getByRole('button', { name: 'Sign in' }).click()
  await expect(tab.getByRole('heading', { name: 'Employee Dashboard' })).toBeVisible()
  // A browser-session cookie: no expiry of its own.
  expect((await refreshCookie(context))?.expires).toBe(-1)
  await tab.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(tab.getByRole('checkbox', { name: /^Keep me signed in/ })).not.toBeChecked()
  await context.close()
})

test('Account: signed-in devices, each but this one with Sign out', async ({ browser }) => {
  await page.getByRole('link', { name: admin.name }).click()
  const devices = page.getByRole('list', { name: 'Signed-in devices' })
  // Earlier steps signed in on other browsers: closing them did not sign them out.
  await expect(devices.getByRole('listitem').first()).toContainText('This device')
  await expect(devices.getByRole('listitem').first()).toContainText('Kept signed in')
  await page.getByRole('button', { name: 'Sign out all other devices' }).click()
  await expect(devices.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText('You are not signed in anywhere else.')).toBeVisible()

  // A laptop signs in; Account lists it with its own Sign out, which signs it out.
  const laptop = await signInElsewhere(browser, admin.email, admin.password)
  await expect(laptop.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await page.reload()
  await expect(devices.getByRole('listitem')).toHaveCount(2)
  await devices.getByRole('button', { name: /^Sign out Chrome/ }).click()
  await expect(devices.getByRole('listitem')).toHaveCount(1)
  await laptop.reload()
  await expect(laptop.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await laptop.context().close()
})

test('Account: change password, then only the new one signs in, and the other devices are signed out', async ({ browser }) => {
  const newPassword = 'e2e-new-password-456'
  const laptop = await signInElsewhere(browser, admin.email, admin.password)
  await expect(laptop.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await page.getByRole('link', { name: admin.name }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  // A hidden username field tells a password manager whose password changes.
  await expect(page.locator('input[autocomplete=username]')).toHaveValue(admin.email)

  // Wrong current password is reported on its field.
  await page.getByLabel('Current password').fill('not-the-password')
  await page.getByLabel('New password', { exact: false }).first().fill(newPassword)
  await page.getByLabel('Confirm new password').fill(newPassword)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('The current password is incorrect.')).toBeVisible()

  await page.getByLabel('Current password').fill(admin.password)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed')).toBeVisible()
  await expect(page.getByText('Your other devices have been signed out.')).toBeVisible()
  // The laptop is signed out; this device is not.
  await laptop.reload()
  await expect(laptop.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await laptop.context().close()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()

  // Sign out ends the sign-in on the server: a reload does not bring it back.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  expect(await refreshCookie(page.context())).toBeUndefined()
  await page.reload()
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel(/^Password/).fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Wrong email or password.')).toBeVisible()

  await page.getByLabel(/^Password/).fill(newPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('link', { name: admin.name })).toBeVisible()
})

test('Sign in: too many failed attempts for one account are refused for a while', async ({ browser }) => {
  // API_LOGIN_EMAIL_FAILURES (10) failures for one email within 15 minutes; an email with no account counts too.
  const other = await (await browser.newContext({ baseURL: webURL })).newPage()
  await other.goto('/')
  await other.getByLabel('Email').fill('nobody@example.com')
  for (let i = 0; i < 10; i++) {
    await other.getByLabel(/^Password/).fill(`guess-${i}`)
    await other.getByRole('button', { name: 'Sign in' }).click()
    await expect(other.getByText('Wrong email or password.')).toBeVisible()
    await other.getByLabel(/^Password/).fill('')
  }
  await other.getByLabel(/^Password/).fill('guess-10')
  await other.getByRole('button', { name: 'Sign in' }).click()
  await expect(other.getByText('Too many sign-in attempts. Wait a few minutes, then try again.')).toBeVisible()
  await other.context().close()
})

test('no screen broke the Content-Security-Policy', async () => {
  // Behind Caddy (E2E_WEB_SERVER=caddy, as in CI) every step above ran under the policy.
  if (process.env['E2E_WEB_SERVER'] === 'caddy') {
    for (const path of ['/', '/admin/', '/admin/users']) {
      const res = await page.request.get(path)
      expect(res.headers()['content-security-policy'], path).toContain("default-src 'self'")
    }
  }
  expect(cspViolations).toEqual([])
})
