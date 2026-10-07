import { fileURLToPath } from 'node:url'

import { type Browser, type Page, expect, test } from '@playwright/test'

import { type ShotName, shotPath } from '../../apps/workwear/src/help/index.ts'
import { admin } from '../env.ts'
import { writeDocs } from './docs.ts'
import { A, S, T, agents, device, deviceWindow, lang, locale } from './lang.ts'

// Screenshots for the Help screen, taken from the demo data in order: each
// step leaves the app where the next one starts. GUIDE_LANG and GUIDE_DEVICE
// pick the language and the device; controls are found by the app's own text
// in that language, the way that device shows them.
test.describe.configure({ mode: 'serial' })
test.use({ locale })

// The app serves them on its Help screen (public/help-img), and docs/guide shows the desktop ones.
const img = (name: ShotName, phone = false) =>
  fileURLToPath(new URL(`../../apps/workwear/public/${shotPath(lang, device, { name, phone })}`, import.meta.url))
const touch = device !== 'desktop'

let page: Page
let confirmationURL = ''

test.beforeAll(async ({ browser }) => {
  // Behind the e2e API's trusted proxy, so Signed-in devices shows an address from the documentation range.
  page = await browser.newPage({ ...deviceWindow, locale, extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.24' } })
})

/** Settles the page (no hover, no pending requests, finished transitions) and saves it. */
async function shot(name: ShotName, { target = page, phone = false }: { target?: Page; phone?: boolean } = {}) {
  if (!touch) await target.mouse.move(0, 0)
  await target.waitForLoadState('networkidle')
  await target.waitForTimeout(400)
  await target.screenshot({ path: img(name, phone) })
}

/** Opens a section from the Main navigation; on a phone the fifth and later are under More. */
async function openTab(name: string) {
  const nav = page.getByRole('navigation', { name: T.shell.mainNav })
  const link = nav.getByRole('link', { name })
  // The rail and sidebar have no Create Order: it is Orders' Create Order button there.
  if (name === T.shell.createOrder && !(await link.isVisible())) {
    await openTab(T.shell.history)
    await page.getByRole('main').getByRole('link', { name: T.shell.createOrder }).click()
    return
  }
  if (!(await link.isVisible())) await nav.getByRole('button', { name: T.shell.more }).click()
  await link.click()
}

/** The order, beside the list on a desktop, the whole screen below lg. */
const order = () => page.getByRole('complementary', { name: T.history.order, exact: true })

/** A phone, as an employee opening their link would hold it. */
const phoneOf = (browser: Browser) => browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale })

test('sign in and the dashboard', async () => {
  await page.goto('/')
  await page.getByLabel(S.email).fill(admin.email)
  await page.getByLabel(new RegExp(`^${S.password}`)).fill(admin.password)
  // Sign-in is the phone's on every device: wider, the form is a small card in an empty page.
  if (device === 'phone') {
    await shot('sign-in', { phone: true })
    // The same screen with the Dark theme: the device's choice, as Theme is System until signed in.
    await page.emulateMedia({ colorScheme: 'dark' })
    await shot('sign-in-dark', { phone: true })
    await page.emulateMedia({ colorScheme: 'light' })
  }
  await page.getByRole('button', { name: S.signIn }).click()
  await expect(page.getByRole('heading', { name: T.dashboard.title })).toBeVisible()
  await shot('dashboard')
})

test('create an order, review it, mark it as ordered', async () => {
  await openTab(T.shell.createOrder)
  await page.getByRole('combobox', { name: T.order.assignedTo }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  await page.getByRole('button', { name: /Warehouse starter kit/ }).click()
  await expect(page.getByLabel(T.order.quantityOf('Protective gloves'))).toHaveValue('10')
  await shot('create-order')

  // The panel's button on a desktop; the bar's, with the lines and total, on a phone or tablet.
  await page
    .getByRole('button', { name: touch ? new RegExp(`^${T.order.review}\\s`) : T.order.reviewAndMark })
    .filter({ visible: true })
    .first()
    .click()
  const review = page.getByRole('dialog', { name: T.order.reviewOrder })
  await expect(review).toBeVisible()
  await shot('review')
  await review.getByRole('button', { name: T.order.markAsOrdered }).click()
  await expect(page.getByText(T.order.orderIsOrdered('WE-000007'))).toBeVisible()
  const link = page.getByLabel(T.history.confirmationLink)
  confirmationURL = await link.inputValue()
  // Narrower, the link and its buttons are below the lines: show them.
  if (touch) await page.getByRole('button', { name: T.history.shareLinkWhatsApp }).scrollIntoViewIfNeeded()
  await shot('ordered')
})

test('the employee confirms on their phone', async ({ browser }) => {
  // Always the phone's; the page offers English or Russian and starts in the browser's, so Lithuanian shows English.
  test.skip(device !== 'phone', 'one confirmation screenshot, the phone’s')
  const phone = await phoneOf(browser)
  await phone.goto(confirmationURL)
  await expect(phone.getByRole('heading', { name: /^Ona/ })).toBeVisible()
  await shot('confirm-phone', { target: phone, phone: true })
  await phone.close()
})

test('orders, an order and its record', async () => {
  await page.getByRole('button', { name: T.order.startNewOrder }).click()
  await openTab(T.shell.history)
  await page.getByRole('link', { name: /^WE-\d{6}$/ }).filter({ visible: true }).first().click()
  await expect(order().getByRole('button', { name: T.history.openConfirmation })).toBeVisible()
  if (device === 'desktop') {
    // Taller, so the order's actions show below its lines.
    await page.setViewportSize({ width: 1280, height: 1200 })
    await shot('history')
    await page.setViewportSize(deviceWindow.viewport)
  } else {
    // The order is the whole screen: its foot, where the actions are, above the phone's bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await shot('history')
  }

  await page.goto('/orders?status=GIVEN')
  await page.getByRole('link', { name: /^WE-\d{6}$/ }).filter({ visible: true }).first().click()
  await order().getByRole('button', { name: T.history.viewRecord }).click()
  await expect(page.getByText(/Items Given Record/i).first()).toBeVisible()
  await shot('record')
})

test('employees, catalogue, item sets, users, roles, settings, backups', async () => {
  await openTab(T.shell.employees)
  await expect(page.getByRole('row', { name: /Rasa Stankevičiūtė/ })).toBeVisible()
  await shot('employees')
  await page.getByRole('link', { name: 'Jonas Petraitis' }).click()
  await expect(page.getByRole('heading', { name: 'Jonas Petraitis' })).toBeVisible()
  await shot('employee')

  await openTab(T.shell.catalogue)
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toBeVisible()
  await shot('catalogue')
  await openTab(T.shell.itemSets)
  await expect(page.getByText('Warehouse starter kit').first()).toBeVisible()
  await shot('item-sets')
  // Users, Settings and Backups are Administration's, at /admin.
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: A.users.title })).toBeVisible()
  await shot('users')
  await page.goto('/admin/roles')
  await expect(page.getByRole('heading', { name: A.roles.title })).toBeVisible()
  await shot('roles')
  // A role's permissions, as Manager's form shows them (the demo data has no other role to edit),
  // from Workwear & Equipment's: the description above them is the role's own, stored in English.
  await page.getByRole('button', { name: A.roles.editRoleLabel(A.users.manager) }).click()
  const form = page.getByRole('dialog', { name: A.roles.editRole(A.users.manager) })
  const workwear = form.getByRole('group', { name: A.roles.groups.workwear })
  await expect(workwear).toBeVisible()
  await workwear.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await shot('role')
  await form.getByRole('button', { name: A.common.cancel }).click()
  await expect(form).toBeHidden()
  // The supplier's group, as an administrator sets it (the link is a made-up one).
  await page.goto('/admin/settings')
  await page.getByLabel(A.settings.groupName).fill('Superman Rubai Group')
  await page.getByLabel(A.settings.inviteLink).fill('https://chat.whatsapp.com/DemoSupplierGroup01')
  await page.getByRole('button', { name: A.settings.save }).click()
  await expect(page.getByRole('main').getByRole('status')).toContainText('Superman Rubai Group')
  await shot('settings')
  // The backup history guide/setup.ts inserted.
  await page.goto('/admin/backups')
  await expect(page.getByRole('heading', { name: A.backups.recent })).toBeVisible()
  await shot('backups')
})

test('account and the search', async ({ browser }) => {
  // Signed in on a second device too: a phone, or a laptop when the guide is a phone's or tablet's.
  const other = await browser.newPage({
    locale,
    userAgent: device === 'desktop' ? agents.iphone : agents.windows,
    extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.7' },
  })
  await other.goto('/')
  await other.getByLabel(S.email).fill(admin.email)
  await other.getByLabel(new RegExp(`^${S.password}`)).fill(admin.password)
  await other.getByRole('button', { name: S.signIn }).click()
  await expect(other.getByRole('heading', { name: T.dashboard.title })).toBeVisible()
  await other.close()

  await page.goto('/account')
  await expect(page.getByRole('heading', { name: T.account.title })).toBeVisible()
  await shot('account')
  const devices = page.getByRole('list', { name: T.account.devices })
  await expect(devices.getByRole('listitem')).toHaveCount(2)
  await devices.scrollIntoViewIfNeeded()
  await page.getByText(T.account.devicesHint).evaluate((e) => e.closest('[data-slot=card]')?.scrollIntoView({ block: 'center' }))
  await shot('devices')
  await openTab(T.shell.history)
  // Search as each device reaches it: ⌘K on a desktop, the rail's Search on a tablet, More's on a phone.
  if (device === 'desktop') await page.keyboard.press('ControlOrMeta+k')
  else {
    if (device === 'phone') await page.getByRole('navigation', { name: T.shell.mainNav }).getByRole('button', { name: T.shell.more }).click()
    await page.getByRole('button', { name: T.common.search, exact: true }).filter({ visible: true }).click()
  }
  await page.getByRole('dialog', { name: T.shell.searchOrJump }).getByRole('combobox').fill('ona')
  await expect(page.getByRole('option', { name: T.shell.newOrderFor('Ona Kazlauskienė') })).toBeVisible()
  await shot('palette')
})

test('overview, the audit log, security, system and usage', async () => {
  // The demo's month of use (guide/setup.ts) leaves something on each: an access review never done, two errors.
  await page.goto('/admin/')
  await expect(page.getByRole('heading', { name: A.overview.title })).toBeVisible()
  await expect(page.getByText(A.overview.items.review_overdue.title)).toBeVisible()
  await shot('overview')

  // Verified now: the API checked the seals when it started, before setup's upkeep sealed the demo's days.
  await page.goto('/admin/audit')
  const verified = page.waitForResponse((r) => r.url().endsWith('/audit-events/verify') && r.ok())
  await page.getByRole('button', { name: A.audit.verify }).click()
  await verified
  // The latest change open (the supplier's group, set above): beside the list on a desktop, the whole screen below lg.
  await page.getByRole('main').getByRole('table').getByRole('link').filter({ visible: true }).first().click()
  await expect(page.getByRole('article', { name: A.audit.change })).toBeVisible()
  await shot('audit-log')

  await page.goto('/admin/security')
  await expect(page.getByRole('heading', { name: A.security.title })).toBeVisible()
  await expect(page.getByRole('main').getByRole('table')).toBeVisible()
  await shot('security')
  await page.goto('/admin/security/review')
  await expect(page.getByRole('button', { name: A.security.markReviewed })).toBeVisible()
  await shot('access-review')

  await page.goto('/admin/system')
  await expect(page.getByRole('heading', { name: A.system.database, exact: true })).toBeVisible()
  await shot('system')
  // The server error open, with the reference a person quotes.
  await page.goto('/admin/system/errors')
  await page.getByRole('main').getByRole('table').getByRole('link').filter({ visible: true }).first().click()
  await expect(page.getByRole('article', { name: A.system.error })).toBeVisible()
  await shot('errors')

  await page.goto('/admin/usage')
  await expect(page.getByRole('heading', { name: A.usage.activePeople })).toBeVisible()
  await shot('usage')
})

test('docs/guide: the page and Markdown copy in this language, from the Help screen text', () => {
  test.skip(device !== 'desktop', 'docs/guide is the desktop guide')
  writeDocs(lang)
})
