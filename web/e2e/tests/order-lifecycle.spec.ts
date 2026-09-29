import { type Browser, type Page, expect, test } from '@playwright/test'

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

test.beforeAll(async ({ browser }) => {
  // Its own context, so a step can open a second tab in it (a tab closed and reopened shares localStorage).
  page = await (await browser.newContext({ baseURL: webURL })).newPage()
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

/** Opens a section from the Main navigation; on a phone the fifth and later are under More. */
async function openTab(name: string) {
  const nav = page.getByRole('navigation', { name: 'Main' })
  const link = nav.getByRole('link', { name })
  if (!(await link.isVisible())) await nav.getByRole('button', { name: 'More' }).click()
  await link.click()
}

/** Add Item is a search: type part of the name, then choose the item. */
async function addItem(search: string, name: RegExp) {
  await page.getByRole('combobox', { name: 'Add Item' }).fill(search)
  await page.getByRole('option', { name }).click()
}

/** Opens an order from the History list; its detail and actions show beside the list (or instead of it on a phone). */
async function openOrder(record: string) {
  await page.getByRole('link', { name: record, exact: true }).click()
  return page.getByRole('complementary', { name: 'Order' })
}

/** Create Order's way on to the review: "Review · 3 lines · €…" in the bar, or "Review and mark as ordered" in the panel. */
function reviewButton() {
  return page.getByRole('button', { name: /^Review/ })
}

/** Mark as Ordered asks for a review first; confirm it there, with or without the confirmation link (remembered on the device). */
async function markAsOrdered({ link }: { link?: boolean } = {}) {
  await reviewButton().click()
  const review = page.getByRole('dialog', { name: 'Review order' })
  if (link !== undefined) await review.getByRole('checkbox', { name: /Create the confirmation link as well/ }).setChecked(link)
  await review.getByRole('button', { name: 'Mark as Ordered' }).click()
}

async function addCatalogueItem(item: { name: string; details: string; group: string; price?: string; months?: string; rank: string }) {
  await page.getByRole('button', { name: 'Add Item' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Item name').fill(item.name)
  await dialog.getByLabel('Manufacturer / model').fill(item.details)
  await dialog.getByLabel('Size group').selectOption(item.group)
  if (item.price) await dialog.getByLabel('Unit price (€)').fill(item.price)
  if (item.months) await dialog.getByLabel('Service period (months)').fill(item.months)
  await dialog.getByLabel('Display order').fill(item.rank)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: new RegExp(item.name) })).toBeVisible()
}

test('sign in', async () => {
  await page.goto('/')
  await page.getByLabel('Email').fill(admin.email)
  const password = page.getByLabel(/^Password/)
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
  // One status per item: the chips count the items and show one status at a time.
  await page.getByRole('button', { name: 'Incomplete · 1' }).click()
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toHaveCount(0)
  await expect(page.getByRole('row', { name: /Safety helmet/ })).toBeVisible()
  await page.getByRole('button', { name: 'All · 4' }).click()

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
  const details = page.getByRole('definition')
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

test('missing size: choose it and Save as Employee Default', async () => {
  await page.getByLabel('Size of Safety shoes').selectOption('42')
  await expect(page.getByText('Save as Employee Default?')).toBeVisible()
  await page.getByRole('button', { name: 'Save as Employee Default' }).click()
  await expect(page.getByText('Save as Employee Default?')).toBeHidden()
  await expect(page.getByLabel('Saved sizes of Ona Kazlauskienė')).toContainText('Shoes 42')
  await expect(reviewButton()).toBeEnabled()
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
  // A new tab has no session (it lives in the tab), but the draft stays on the device for this user.
  const tab = await page.context().newPage()
  await tab.goto('/')
  await tab.getByLabel('Email').fill(admin.email)
  await tab.getByLabel(/^Password/).fill(admin.password)
  await tab.getByRole('button', { name: 'Sign in' }).click()
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
  // The supplier message is sent from here; the confirmation link is created as well unless unticked.
  await expect(review.getByRole('button', { name: 'Copy for WhatsApp' })).toBeEnabled()
  await expect(review.getByRole('checkbox', { name: /Create the confirmation link as well/ })).toBeChecked()
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
  await expect(page.getByRole('button', { name: 'Send confirmation link' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Print record' })).toBeVisible()
  await page.getByRole('button', { name: 'Start a new order' }).click()
  await expect(reviewButton()).toBeDisabled()
})

test('History shows it ORDERED with the ORDERED actions', async () => {
  await openTab('History')
  // The navigation counts the orders waiting for confirmation.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History (1 waiting for confirmation)' })).toBeVisible()
  // The status tabs count what is waiting and what was given.
  await expect(page.getByRole('button', { name: 'Awaiting 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Given 0' })).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(recordNumber) })
  await expect(row).toContainText('Ordered')
  await expect(row).toContainText('today') // days waiting for confirmation

  // The row opens the order at its own address, beside the list, with its items and ORDERED actions.
  const order = await openOrder(recordNumber)
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/)
  await expect(order.getByRole('cell', { name: 'Safety shoes S3 SRC', exact: true })).toBeVisible()
  await expect(order.getByRole('button', { name: 'Open Employee Confirmation' })).toBeVisible()
  await expect(order.getByRole('button', { name: 'View Record' })).toHaveCount(0)
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
  await expect(employee.getByRole('list', { name: 'Items' }).getByRole('listitem')).toHaveCount(3)
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

test('History shows it GIVEN with usage time and the GIVEN actions', async () => {
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
})

test('a later price change does not alter the stored record', async () => {
  await openTab('Item Catalogue')
  await page.getByRole('row', { name: /Safety shoes/ }).getByRole('button', { name: 'Edit' }).click()
  // Its picture was guessed from its name when it was added.
  await expect(page.getByRole('dialog').getByRole('radio', { name: 'Shoes' })).toBeChecked()
  await page.getByRole('dialog').getByLabel('Unit price (€)').fill('59.99')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toContainText('€59.99')

  await openTab('History')
  await (await openOrder(recordNumber)).getByRole('button', { name: 'View Record' }).click()
  await expect(page.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  await expect(page.getByRole('cell', { name: '€49.99' }).first()).toBeVisible()
  await expect(page.getByText('€59.99')).toHaveCount(0)
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
  // Signed on paper, so no link this time; the success screen still offers one.
  await markAsOrdered({ link: false })
  const heading = page.getByText(/Order WE-\d{6} is ordered/)
  paperRecord = /WE-\d{6}/.exec((await heading.textContent()) ?? '')![0]
  await expect(page.getByRole('button', { name: 'Send confirmation link' })).toBeVisible()
  // The new order was placed at the new price.
  await expect(page.getByRole('cell', { name: '€59.99' }).first()).toBeVisible()

  await openTab('History')
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
  const steps = page.getByRole('list', { name: 'Price history' }).getByRole('listitem')
  await expect(steps).toHaveCount(2)
  await expect(steps.first()).toContainText('Price changed')
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

  await openTab('History')
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

test('columns sort: History on the server across pages, other lists in place', async () => {
  await openTab('History')
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
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
})

test('Employees: a row opens the employee at its own address, with the items given and their receipts', async () => {
  await openTab('Employees')
  // Anywhere on the row opens it, not only the name.
  await page.getByRole('row', { name: /Ona Kazlauskienė/ }).getByRole('cell').nth(2).click()
  await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/)
  const employeeURL = page.url()
  await expect(page.getByRole('heading', { name: 'Ona Kazlauskienė' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Employees' })).toHaveAttribute('aria-current', 'page')
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

test('History beside an open order: one line a row; J and K move through it, Escape closes it', async () => {
  await openTab('History')
  const detail = await openOrder(recordNumber)
  await expect(detail.getByRole('heading', { name: recordNumber })).toBeVisible()
  // Beside the order the list keeps its short columns, one line a row, rather than stacking.
  await expect(page.getByRole('columnheader', { name: 'Record' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Usage time' })).toHaveCount(0)
  expect((await page.getByRole('row', { name: new RegExp(recordNumber) }).boundingBox())!.height, 'a History row beside an order').toBeLessThan(48)
  await expect(detail.getByText('next or previous order')).toBeVisible()
  const opened = page.url()
  await page.keyboard.press('k')
  await expect(page).not.toHaveURL(opened)
  await expect(page.getByRole('row', { name: new RegExp(recordNumber) })).not.toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('j')
  await expect(page).toHaveURL(opened)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.getByRole('columnheader', { name: 'Usage time' })).toBeVisible()
})

test('desktop power layer: relative dates, a record previewed on hover, Compact rows kept per user', async () => {
  await openTab('History')
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
  await page.getByRole('heading', { name: 'History' }).hover()
  await expect(preview).toBeHidden()

  const height = async () => (await row.boundingBox())!.height
  const comfortable = await height()
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('dialog', { name: 'Search or jump to' }).getByRole('combobox').fill('compact')
  await page.getByRole('option', { name: 'Compact table rows' }).click()
  await expect.poll(height, { message: 'a Compact History row' }).toBeLessThanOrEqual(33)
  expect(comfortable).toBeGreaterThan(33)
  // Saved for this user on this device: a reload keeps it; Account switches it back.
  await page.reload()
  await expect.poll(height).toBeLessThanOrEqual(33)
  await page.goto('/account')
  const rows = page.getByRole('group', { name: 'Table rows' })
  await expect(rows.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
  await rows.getByRole('button', { name: 'Comfortable' }).click()
  await expect(rows.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true')
  await openTab('History')
  await expect.poll(height).toBeGreaterThan(33)
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
  await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/)
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
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
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
  // The phone bar puts New order in the middle, raised: Home, History, New order, Employees, More.
  const phoneNav = page.getByRole('navigation', { name: 'Main' })
  const newOrder = phoneNav.getByRole('link', { name: /^Create Order/ })
  await expect(newOrder).toHaveText(/New order/)
  const middle = await newOrder.boundingBox()
  expect(Math.abs(middle!.x + middle!.width / 2 - 375 / 2), 'New order is in the middle of the bar').toBeLessThan(2)
  const history = await phoneNav.getByRole('link', { name: /^History/ }).boundingBox()
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
    ['History', recordNumber],
    ['Employees', 'Ona Kazlauskienė'],
    ['Item Catalogue', 'Protective gloves'],
    ['Item Sets', 'Starter kit'],
    ['Users', admin.email],
  ] as const) {
    // The same Main navigation, now a bottom tab bar.
    await openTab(tab)
    await expect(page.getByRole('heading', { name: tab })).toBeVisible()
    await expect(page.getByText(content).first()).toBeVisible()
    expect(await fits(), `${tab} scrolls sideways`).toBe(true)
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

  // History on a phone: one list of two-line rows under month headings; the sort order and the
  // time zone note fold away with the filters, so the orders start near the top.
  await openTab('History')
  await expect(page.getByRole('row', { name: /^[a-z]+ \d{4}$/i }).first()).toBeVisible()
  const historyRow = page.getByRole('row', { name: new RegExp(recordNumber) })
  expect((await historyRow.boundingBox())!.height, 'a History row on a phone').toBeLessThan(80)
  await expect(page.getByLabel('Sort by').filter({ visible: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^Filters/ }).click()
  await expect(page.getByRole('region', { name: 'Filters' }).getByLabel('Sort by')).toBeVisible()
  await expect(page.getByText(/Dates and times are shown in/)).toBeVisible()
  await page.getByRole('button', { name: /^Filters/ }).click()
  // Records lists on a phone: short rows that open the record, whose page holds the actions.
  await openTab('Employees')
  const onaRow = page.getByRole('row', { name: /Ona Kazlauskienė/ })
  expect((await onaRow.boundingBox())!.height, 'an Employees row on a phone').toBeLessThan(80)
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
  await openTab('History')
  await expect(newOrder).toHaveAccessibleName(/^Create Order \(draft, \d+ lines?\)$/)
  await expect(newOrder).toHaveText(/Draft/)
  await newOrder.click()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('42')
  // Left ORDERED, so History has a row waiting for confirmation.
  await markAsOrdered()
  await page.getByRole('button', { name: 'Start a new order' }).click()

  // On a phone an order opens instead of the list, with the way back to it.
  await openTab('History')
  await openOrder(recordNumber)
  await expect(page.getByRole('heading', { name: 'History' })).toBeHidden()
  expect(await fits(), 'an order scrolls sideways').toBe(true)
  await page.getByRole('button', { name: 'View Record' }).click()
  await expect(page.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  expect(await fits(), 'the record scrolls sideways').toBe(true)

  // Tablet and narrow-laptop widths, beside the side rail: a table either fits
  // side by side or stacks, never scrolls. 920px left History 8rem too narrow.
  for (const width of [768, 920, 1100, desktop.width]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [tab, content] of [
      ['Dashboard', 'Spending by month'],
      ['Create Order', 'Assigned to'],
      ['History', recordNumber],
      ['Employees', 'Ona Kazlauskienė'],
      ['Item Catalogue', 'Protective gloves'],
      ['Users', admin.email],
    ] as const) {
      await openTab(tab)
      await expect(page.getByText(content).first()).toBeVisible()
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

/** Signs in as someone else in a fresh browser context (its own sessionStorage); returns its page. */
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
  // Items, prices and purchasing: the price change made earlier, the unpriced helmet,
  // the second pair of shoes not yet on order again.
  const priceChange = other.getByRole('listitem').filter({ hasText: 'Safety shoes' }).filter({ hasText: '→' })
  await expect(priceChange).toContainText('€49.99 → €59.99')
  await expect(priceChange).toContainText('+20%')
  await expect(other.getByRole('region', { name: 'Without a price or service period' })).toContainText('Safety helmet')
  await expect(other.getByText('Size 42: 1 employee')).toBeAttached()
  // A figure with a list behind it opens that list: On order opens History on its Awaiting tab.
  await other.getByRole('list', { name: 'Key figures' }).getByRole('button', { name: /^On order/ }).click()
  await expect(other.getByRole('heading', { name: 'History' })).toBeVisible()
  await expect(other.getByRole('button', { name: /^Awaiting/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(other).toHaveURL(/\/history\?status=ORDERED$/)
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

  // Deactivated: can no longer sign in.
  await page.getByRole('button', { name: `Edit ${mia.name}` }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox', { name: /^Active/ }).uncheck()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(row).toContainText('Inactive')
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

test('History: only a manager deletes an order, after asking; it then leaves History', async ({ browser }) => {
  // The administrator has no Delete order: the order pane has no ⋯ for it.
  await openTab('History')
  const detail = await openOrder(paperRecord)
  await expect(detail.getByRole('heading', { name: paperRecord })).toBeVisible()
  await expect(detail.getByRole('button', { name: `More actions for ${paperRecord}` })).toHaveCount(0)

  // Mia, the manager from the Users step, with the password reset there.
  const other = await signInElsewhere(browser, 'mia@example.com', 'mia-password-2')
  await expect(other.getByRole('heading', { name: 'Manager Dashboard' })).toBeVisible()
  await other.goto(webURL + '/history')
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
  await expect(other).toHaveURL(/\/history$/)
  await expect(other.getByRole('heading', { name: 'History' })).toBeVisible()
  await expect(other.getByRole('link', { name: paperRecord, exact: true })).toHaveCount(0)
  await other.context().close()

  // Gone for everyone: the administrator's open copy no longer loads, and the list leaves it out.
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Order' })).toContainText('order not found')
  await openTab('History')
  await expect(page.getByRole('link', { name: recordNumber, exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: paperRecord, exact: true })).toHaveCount(0)
})

test('Account: change password, then only the new one signs in', async () => {
  const newPassword = 'e2e-new-password-456'
  await page.getByRole('link', { name: admin.name }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()

  // Wrong current password is reported on its field.
  await page.getByLabel('Current password').fill('not-the-password')
  await page.getByLabel('New password', { exact: false }).first().fill(newPassword)
  await page.getByLabel('Confirm new password').fill(newPassword)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('The current password is incorrect.')).toBeVisible()

  await page.getByLabel('Current password').fill(admin.password)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed')).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel(/^Password/).fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Wrong email or password.')).toBeVisible()

  await page.getByLabel(/^Password/).fill(newPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('link', { name: admin.name })).toBeVisible()
})
