import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Browser, type Page, expect, test } from '@playwright/test'

import { type ShotName, shotPath } from '../../apps/workwear/src/help/index.ts'
import { admin, repoRoot } from '../env.ts'
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
  // Print Form opens the print dialog, which would wait for a person; printing is ended with afterprint instead.
  await page.addInitScript(() => {
    window.print = () => {}
  })
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
  // An administrator lands on App Launcher (ADR 0006); the guide goes on in Workwear.
  await page.waitForURL(/\/apps\/$/)
  await expect(page.getByRole('searchbox')).toBeVisible()
  await shot('launcher')
  await page.goto('/')
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
  await expect(order().getByRole('button', { name: T.history.createLink })).toBeVisible()
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
  await order().getByRole('button', { name: T.history.viewOrder }).click()
  await expect(page.getByText(/Items Given Record/i).first()).toBeVisible()
  await shot('record')

  // A date field's calendar, on From in the Orders Custom range panel (on a phone, under Filters).
  await page.goto('/orders')
  if (device === 'phone') await page.getByRole('button', { name: new RegExp(`^${T.history.filters}`) }).click()
  const filters = page.getByRole('region', { name: T.history.filters })
  await filters.getByRole('combobox', { name: T.history.period }).click()
  await page.getByRole('listbox', { name: T.history.period }).getByRole('option', { name: T.history.periods.custom }).click()
  await page.getByRole('dialog', { name: T.history.customRange }).locator('[data-slot=popover-trigger]').first().click()
  await expect(page.locator('[data-slot=calendar]')).toBeVisible()
  await shot('date-picker')
  await page.keyboard.press('Escape')
})

test('employees, catalogue, item sets, users, roles, settings, backups', async () => {
  await openTab(T.shell.employees)
  await expect(page.getByRole('row', { name: /Rasa Stankevičiūtė/ })).toBeVisible()
  await shot('employees')
  await page.getByRole('link', { name: 'Jonas Petraitis' }).click()
  await expect(page.getByRole('heading', { name: 'Jonas Petraitis' })).toBeVisible()
  // Items given is closed at first; the shot shows it open.
  await page.getByRole('button', { name: new RegExp(`^${T.employees.itemsGiven}`) }).click()
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
  // Its own Save: the default Non-return Value has another.
  const chat = page.getByRole('region', { name: A.settings.supplierChat })
  await chat.getByRole('button', { name: A.settings.save, exact: true }).click()
  await expect(chat.getByRole('status')).toContainText('Superman Rubai Group')
  await shot('settings')
  // The SIM providers the demo lists (cmd/api/seed-demo.go), Telia the default.
  const providers = page.getByRole('region', { name: A.settings.simProviders })
  await providers.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await expect(providers.getByRole('radio', { name: 'Telia' })).toBeChecked()
  await shot('sim-providers')
  // The backup history guide/setup.ts inserted.
  await page.goto('/admin/backups')
  await expect(page.getByRole('heading', { name: A.backups.recent })).toBeVisible()
  await shot('backups')
})

test('company assets: the SIMs, a card, giving one', async () => {
  // The demo's cards (cmd/api/seed-demo.go): SIM-000003 is not returned, SIM-000005 is Active in the office.
  // A SIM's row links from its phone number, which leads its link on every device.
  const sim = (phone: string) => page.getByRole('link', { name: new RegExp(`^${phone.replace('+', '\\+')}`) }).filter({ visible: true }).first()
  const [sim1, sim3, sim5] = ['+370 612 40118', '+370 655 21987', '+370 612 40120']
  // Assignments is closed at first (and then as this device left it); the shots show it open.
  const openAssignments = async () => {
    const section = page.getByRole('region', { name: T.assets.assignmentsTitle })
    const toggle = section.getByRole('button', { name: new RegExp(`^${T.assets.assignmentsTitle}`) })
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    return section
  }
  await page.goto('/assets')
  await expect(sim(sim3)).toBeVisible()
  await shot('assets')

  await sim(sim3).click()
  await expect(page.getByRole('heading', { name: sim3 })).toBeVisible()
  await openAssignments()
  await shot('asset')

  // A signed copy uploaded: SIM-000001's, scanned the day after it was given (cmd/api/seed-demo.go).
  await page.goto('/assets')
  await sim(sim1).click()
  const assignments = await openAssignments()
  await expect(assignments.getByText(T.assets.signedCopyUploaded)).toBeVisible()
  await assignments.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await shot('signed-copy')

  // Give SIM up to the signed paper, and no further: the demo keeps the card in the office.
  await page.goto('/assets')
  await sim(sim5).click()
  await page.getByRole('main').getByRole('button', { name: T.assets.giveSimCard }).click()
  const give = page.getByRole('dialog')
  await give.getByRole('combobox', { name: T.assets.employee }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  // Print Form prints in place, with no tab of its own; the print dialog closing ends it.
  await give.getByRole('button', { name: T.assets.printForm }).click()
  await expect(page.locator('#print-in-place')).toBeAttached()
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(give.getByRole('button', { name: T.assets.printAgain })).toBeVisible()
  await give.getByLabel(T.assets.paperFormSigned).check()
  await expect(give.getByText(T.assets.readyToGive)).toBeVisible()
  // Taller than a phone, the sheet shows all three steps, the first folded, down to the button.
  if (device === 'desktop') await page.setViewportSize({ width: 1280, height: 1000 })
  // A phone's sheet scrolls: from the first step down, all three fit above the button.
  if (device === 'phone') await give.getByRole('region', { name: T.assets.stepDetails }).evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await shot('give-asset')
  if (device === 'desktop') await page.setViewportSize(deviceWindow.viewport)
  await give.getByRole('button', { name: T.common.cancel }).click()
  await expect(give).toBeHidden()
})

test('Scan SIMs and Manage apps', async () => {
  // Scan SIMs, the trial: two made-up cards (fixtures/sim-cards/make.ts) read from photos and checked, not added.
  await page.goto('/apps/sim-scan/')
  const photos = ['card-1-front.png', 'card-1-back.png', 'card-2-front.png', 'card-2-back.png'].map((f) => join(repoRoot, 'web/e2e/fixtures/sim-cards', f))
  await page.locator('input[type=file][multiple]').setInputFiles(photos)
  await expect(page.getByText('8937099000000000056').first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('status').filter({ hasText: /\d+ \S+ \d+$/ })).toHaveCount(0, { timeout: 60_000 })
  // Taller on a desktop, so the list shows under what every SIM shares; narrower, the list itself.
  if (device === 'desktop') await page.setViewportSize({ width: 1280, height: 1150 })
  else await page.locator('#cards').evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await shot('sim-scan')
  if (device === 'desktop') await page.setViewportSize(deviceWindow.viewport)
  // Cleared, so leaving does not ask first.
  await page.getByRole('button', { name: /^(Clear List|Išvalyti sąrašą|Очистить список)$/ }).click()

  // Scan SIMs' versions and channels, as guide/setup.ts published them.
  await page.goto('/admin/apps/sim-scan')
  const pane = page.getByRole('article', { name: /Scan SIMs|Skenuoti SIM|Сканировать SIM/ })
  const releases = pane.getByRole('button', { name: new RegExp(`^${A.apps.releases}`) })
  await expect(releases).toBeVisible()
  if ((await releases.getAttribute('aria-expanded')) !== 'true') await releases.click()
  await expect(pane.getByRole('row', { name: /a5e143a0b2d1/ })).toBeVisible()
  // Its heading just below the pane's sticky header.
  await releases.evaluate((e) => {
    e.scrollIntoView({ block: 'start' })
    let box = e.parentElement
    while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement
    ;(box ?? document.scrollingElement)?.scrollBy(0, -96)
  })
  await shot('manage-apps')
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
  await other.waitForURL(/\/apps\/$/)
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

// Last, so every other screenshot shows the demo data as it was: the record added here is merged away again.
test('possible duplicates: Add New Employee warns, Merge Employees makes one record', async () => {
  await page.goto('/employees')
  await page.getByRole('button', { name: T.employees.addNew }).click()
  const add = page.getByRole('dialog', { name: T.employees.addNew })
  await add.getByLabel(T.employees.firstName).fill('PETRAITIS')
  await add.getByLabel(T.employees.lastName).fill('JONAS')
  await expect(add.getByRole('status').filter({ hasText: T.employees.duplicates.mayExist })).toContainText('Jonas Petraitis')
  await shot('duplicate-warning')
  await add.getByRole('button', { name: T.employees.duplicates.addAsNew }).click()
  await expect(add).toBeHidden()

  // From Jonas Petraitis's page: ⋯, Merge with…, the record with a name like his.
  await page.goto('/employees')
  await page.getByRole('link', { name: 'Jonas Petraitis' }).click()
  await expect(page.getByRole('heading', { name: 'Jonas Petraitis' })).toBeVisible()
  // Beside the list (desktop) the row has one too; either opens the same Merge with….
  await page.getByRole('button', { name: T.common.moreActions('Jonas Petraitis') }).filter({ visible: true }).first().click()
  await page.getByRole('menuitem', { name: T.employees.merge.action }).click()
  const merge = page.getByRole('dialog', { name: T.employees.merge.title })
  await merge.getByRole('listitem').filter({ hasText: 'PETRAITIS JONAS' }).getByRole('button', { name: T.employees.merge.pickOther }).click()
  await expect(merge.getByText(T.employees.merge.movesTo('Jonas Petraitis'))).toBeVisible()
  await shot('merge-employees')
  page.once('dialog', (d) => void d.accept())
  await merge.getByRole('button', { name: T.employees.merge.submit }).click()
  await expect(merge).toBeHidden()
})

test('docs/guide: the page and Markdown copy in this language, from the Help screen text', () => {
  test.skip(device !== 'desktop', 'docs/guide is the desktop guide')
  writeDocs(lang)
})
