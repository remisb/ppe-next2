import { type Browser, type Page, expect, test } from '@playwright/test'

import { admin, webURL } from '../env.ts'

// One ordered story, run in sequence: each step builds on the data the
// previous one created. It covers the manual's §7 validation rows and every
// status transition through the real UI, API and database.
test.describe.configure({ mode: 'serial' })

let page: Page
let recordNumber = ''
let confirmationURL = ''

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  // Print Record opens the print dialog; record the call instead.
  await page.addInitScript(() => {
    window.print = () => {
      ;(window as unknown as { __printed: number }).__printed = ((window as unknown as { __printed?: number }).__printed ?? 0) + 1
    }
  })
})

test.afterAll(async () => {
  await page.close()
})

async function openTab(name: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()
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
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // An administrator starts on the Dashboard; an empty database still gives a whole one.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('No order is waiting for confirmation.')).toBeVisible()
})

test('Item Catalogue: items with and without a price', async () => {
  await openTab('Item Catalogue')
  await addCatalogueItem({ name: 'Safety shoes', details: 'S3 SRC', group: 'SHOES', price: '49.99', months: '12', rank: '1' })
  await addCatalogueItem({ name: 'Work jacket', details: 'Winter', group: 'CLOTHING', price: '39.99', months: '24', rank: '2' })
  await addCatalogueItem({ name: 'Protective gloves', details: 'Nitrile', group: 'NONE', price: '2.50', months: '1', rank: '4' })
  await addCatalogueItem({ name: 'Safety helmet', details: 'EN 397', group: 'NONE', rank: '5' })
  await expect(page.getByRole('row', { name: /Safety helmet/ })).toContainText('Incomplete')
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toContainText('€49.99')
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
})

test('Create Order: add a new employee from Assigned to and apply the set', async () => {
  await openTab('Create Order')
  await expect(page.getByRole('button', { name: 'Apply Item Set' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeDisabled()

  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await page.getByRole('button', { name: '+ Add New Employee' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('First name').fill('Ona')
  await dialog.getByLabel('Last name').fill('Kazlauskienė')
  await dialog.getByLabel('Height (cm)').fill('170')
  await dialog.getByRole('button', { name: 'Save and Select Employee' }).click()
  await expect(page.getByRole('combobox', { name: 'Assigned to' })).toHaveAttribute('placeholder', 'Ona Kazlauskienė')

  await page.getByLabel('Item Set').selectOption({ label: 'Starter kit' })
  await page.getByRole('button', { name: 'Apply Item Set' }).click()

  // Clothing: suggested from 170 cm. Shoes: never inferred, so missing.
  await expect(page.getByLabel('Size of Work jacket')).toHaveValue('M')
  await expect(page.getByText('Suggested from height')).toBeVisible()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('')
  await expect(page.getByRole('alert').filter({ hasText: 'Select a size.' })).toBeVisible()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')
  // §7: a missing size keeps the work and blocks the order.
  await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeDisabled()
})

test('missing size: choose it and Save as Employee Default', async () => {
  await page.getByLabel('Size of Safety shoes').selectOption('42')
  await expect(page.getByText('Save as Employee Default?')).toBeVisible()
  await page.getByRole('button', { name: 'Save as Employee Default' }).click()
  await expect(page.getByText('Save as Employee Default?')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeEnabled()
})

test('missing catalogue price blocks Mark as Ordered', async () => {
  await page.getByLabel('Add Item').selectOption({ label: 'Safety helmet — EN 397' })
  await expect(page.getByRole('alert').filter({ hasText: 'No price or service period' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeDisabled()
  await page.getByRole('button', { name: 'Remove Safety helmet' }).click()
  await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeEnabled()
})

test('quantity below 1 or not an integer is rejected at the field', async () => {
  const qty = page.getByLabel('Quantity of Work jacket')
  for (const bad of ['0', '1.5']) {
    await qty.fill(bad)
    await expect(page.getByRole('alert').filter({ hasText: 'Quantity must be a whole number' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeDisabled()
  }
  await qty.fill('1')
  await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeEnabled()
})

test('network error keeps the form and offers Retry', async () => {
  await page.route('**/api/v1/orders/resolve', (route) => route.abort('failed'))
  await page.getByLabel('Add Item').selectOption({ label: 'Protective gloves — Nitrile' })
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

test('Mark as Ordered creates the ORDERED record', async () => {
  await page.getByRole('button', { name: 'Mark as Ordered' }).click()
  const heading = page.getByText(/Order WE-\d{6} is ordered/)
  await expect(heading).toBeVisible()
  recordNumber = /WE-\d{6}/.exec((await heading.textContent()) ?? '')![0]
  await expect(page.getByText('€114.98')).toBeVisible() // 39.99 + 49.99 + 10 × 2.50
  await page.getByRole('button', { name: 'Start a new order' }).click()
  await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeDisabled()
})

test('History shows it ORDERED with the ORDERED actions', async () => {
  await openTab('History')
  const row = page.getByRole('row', { name: new RegExp(recordNumber) })
  await expect(row).toContainText('Ordered')
  await expect(row.getByRole('button', { name: 'Open Employee Confirmation' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'View Record' })).toHaveCount(0)
  await row.getByRole('button', { name: 'View Items' }).click()
  await expect(page.getByRole('cell', { name: 'Safety shoes S3 SRC', exact: true })).toBeVisible()
  await row.getByRole('button', { name: 'Hide Items' }).click()
})

test('Open Employee Confirmation creates a link', async () => {
  const row = page.getByRole('row', { name: new RegExp(recordNumber) })
  await row.getByRole('button', { name: 'Open Employee Confirmation' }).click()
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
  await expect(employee.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  await expect(employee.getByText('Подтверждение получения')).toBeVisible()
  await expect(employee.getByText('Confirmation of receipt')).toBeVisible()

  const confirm = employee.getByRole('button', { name: 'Confirm Receipt / Подтвердить' })
  await expect(confirm).toBeDisabled()
  await employee.getByRole('checkbox').check()
  await confirm.click()
  await expect(employee.getByText('Receipt confirmed / Получение подтверждено')).toBeVisible()

  await employee.reload()
  await expect(employee.getByText('Receipt confirmed / Получение подтверждено')).toBeVisible()
  await expect(employee.getByRole('button', { name: 'Confirm Receipt / Подтвердить' })).toHaveCount(0)

  // §7: an unknown or revoked link asks for a new one.
  await employee.goto(confirmationURL.replace(/[\w-]+$/, 'not-a-valid-token'))
  await expect(employee.getByText('Please ask for a new confirmation link.', { exact: false })).toBeVisible()
  await ctx.close()
})

test('History shows it GIVEN with usage time and the GIVEN actions', async () => {
  await page.reload()
  await page.getByLabel('Status').selectOption('GIVEN')
  const row = page.getByRole('row', { name: new RegExp(recordNumber) })
  await expect(row).toContainText('Given')
  await expect(row).toContainText('0.0 months')
  await expect(row.getByRole('button', { name: 'Open Employee Confirmation' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'View Record' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Print Record' })).toBeVisible()
})

test('a later price change does not alter the stored record', async () => {
  await openTab('Item Catalogue')
  await page.getByRole('row', { name: /Safety shoes/ }).getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByLabel('Unit price (€)').fill('59.99')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toContainText('€59.99')

  await openTab('History')
  await page.getByRole('row', { name: new RegExp(recordNumber) }).getByRole('button', { name: 'View Record' }).click()
  await expect(page.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  await expect(page.getByRole('cell', { name: '€49.99' }).first()).toBeVisible()
  await expect(page.getByText('€59.99')).toHaveCount(0)
  await expect(page.getByText(/Confirmed electronically by/)).toBeVisible()
})

test('Print Record opens the print dialog', async () => {
  await page.getByRole('button', { name: 'Print Record' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: number }).__printed ?? 0)).toBeGreaterThan(0)
})

test('paper confirmation: a second order signed on paper', async () => {
  await openTab('Create Order')
  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await page.getByRole('combobox', { name: 'Assigned to' }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  // The shoe size saved earlier is now her default.
  await page.getByLabel('Add Item').selectOption({ label: 'Safety shoes — S3 SRC' })
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('42')
  await page.getByRole('button', { name: 'Mark as Ordered' }).click()
  const heading = page.getByText(/Order WE-\d{6} is ordered/)
  const paperRecord = /WE-\d{6}/.exec((await heading.textContent()) ?? '')![0]
  // The new order was placed at the new price.
  await expect(page.getByRole('cell', { name: '€59.99' }).first()).toBeVisible()

  await openTab('History')
  await page.getByRole('row', { name: new RegExp(paperRecord) }).getByRole('button', { name: 'Open Employee Confirmation' }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('dialog').getByRole('button', { name: 'Record signed paper confirmation' }).click()
  await expect(page.getByRole('row', { name: new RegExp(paperRecord) })).toContainText('Given')
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
  await expect(page.getByRole('listitem').filter({ hasText: 'Protective gloves' })).toContainText('10 · €25.00')
  // Safety helmet has no price, which Mark as Ordered refuses; the row leads to the catalogue.
  const catalogue = page.getByRole('link', { name: /Catalogue items/ })
  await expect(catalogue).toContainText('1 without a price or service period')
  await catalogue.click()
  await expect(page.getByRole('heading', { name: 'Item Catalogue' })).toBeVisible()
  // The Manager Dashboard is the managers' alone: an administrator gets their own.
  await page.goto('/manager')
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manager Dashboard' })).toHaveCount(0)
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
})

test('Employees: a row opens the employee at its own address, with the items given and their receipts', async () => {
  await openTab('Employees')
  // Anywhere on the row opens it, not only the name.
  await page.getByRole('row', { name: /Ona Kazlauskienė/ }).getByRole('cell').nth(2).click()
  await expect(page).toHaveURL(/\/employees\/[0-9a-f-]{36}$/)
  const employeeURL = page.url()
  await expect(page.getByRole('heading', { name: 'Ona Kazlauskienė' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Employees' })).toHaveAttribute('aria-current', 'page')

  // Both her orders are GIVEN; the first was bought before the price change and still shows €49.99 on its receipt.
  const given = page.getByRole('region', { name: 'Items given' })
  await expect(given.getByRole('row', { name: /Safety shoes/ })).toHaveCount(2)
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

test('phone and tablet: no screen scrolls sideways', async () => {
  const desktop = page.viewportSize()!
  await page.setViewportSize({ width: 375, height: 812 })
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
  await openTab('Employees')
  await page.getByRole('link', { name: 'Ona Kazlauskienė' }).click()
  await expect(page.getByRole('link', { name: `Receipt ${recordNumber}` }).first()).toBeVisible()
  expect(await fits(), 'the employee page scrolls sideways').toBe(true)

  // The order's actions stay in reach however long the order is.
  await openTab('Create Order')
  await page.getByRole('combobox', { name: 'Assigned to' }).click()
  await page.getByRole('combobox', { name: 'Assigned to' }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  await page.getByLabel('Item Set').selectOption({ label: 'Starter kit' })
  await page.getByRole('button', { name: 'Apply Item Set' }).click()
  await expect(page.getByLabel('Size of Safety shoes')).toHaveValue('42')
  await expect(page.getByRole('button', { name: 'Mark as Ordered' })).toBeInViewport()
  expect(await fits()).toBe(true)
  // Left ORDERED, so History has a row with the widest action, Open Employee Confirmation.
  await page.getByRole('button', { name: 'Mark as Ordered' }).click()
  await page.getByRole('button', { name: 'Start a new order' }).click()

  await openTab('History')
  await page.getByRole('button', { name: 'View Record' }).first().click()
  await expect(page.getByText('Items Given Record / Акт выдачи')).toBeVisible()
  expect(await fits(), 'the record scrolls sideways').toBe(true)

  // Tablet and narrow-laptop widths, beside the side rail: a table either fits
  // side by side or stacks, never scrolls. 920px left History 8rem too narrow.
  for (const width of [768, 920, 1100, desktop.width]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [tab, content] of [
      ['Dashboard', 'Spending by month'],
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
  }

  await page.setViewportSize(desktop)
})

/** Signs in as someone else in a fresh browser context (its own sessionStorage); returns its page. */
async function signInElsewhere(browser: Browser, email: string, password: string) {
  const other = await (await browser.newContext()).newPage()
  await other.goto(webURL + '/')
  await other.getByLabel('Email').fill(email)
  await other.getByLabel('Password').fill(password)
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
  await page.getByRole('button', { name: `Reset password for ${mia.name}` }).click()
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
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Wrong email or password.')).toBeVisible()

  await page.getByLabel('Password').fill(newPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('link', { name: admin.name })).toBeVisible()
})
