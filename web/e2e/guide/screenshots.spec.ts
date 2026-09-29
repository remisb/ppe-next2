import { fileURLToPath } from 'node:url'

import { type Page, expect, test } from '@playwright/test'

import { admin } from '../env.ts'
import { T, lang, locale } from './lang.ts'

// Screenshots for the user guide (docs/guide), taken from the demo data in
// order: each step leaves the app where the next one starts. GUIDE_LANG picks
// the language; controls are found by the app's own text in it.
test.describe.configure({ mode: 'serial' })
test.use({ locale })

const img = (name: string) => fileURLToPath(new URL(`../../../docs/guide/img/${lang}/${name}.png`, import.meta.url))

let page: Page
let confirmationURL = ''

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ locale })
})

/** Settles the page (no hover, no pending requests, finished transitions) and saves it. */
async function shot(name: string, target: Page = page) {
  await target.mouse.move(0, 0)
  await target.waitForLoadState('networkidle')
  await target.waitForTimeout(400)
  await target.screenshot({ path: img(name) })
}

async function openTab(name: string) {
  await page.getByRole('navigation', { name: T.shell.mainNav }).getByRole('link', { name }).click()
}

const order = () => page.getByRole('complementary', { name: T.history.order, exact: true })

test('sign in and the dashboard', async () => {
  await page.goto('/')
  await page.getByLabel(T.shell.email).fill(admin.email)
  await page.getByLabel(new RegExp(`^${T.shell.password}`)).fill(admin.password)
  await shot('sign-in')
  await page.getByRole('button', { name: T.shell.signIn }).click()
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

  await page.getByRole('button', { name: T.order.reviewAndMark }).click()
  const review = page.getByRole('dialog', { name: T.order.reviewOrder })
  await expect(review).toBeVisible()
  await shot('review')
  await review.getByRole('button', { name: T.order.markAsOrdered }).click()
  await expect(page.getByText(T.order.orderIsOrdered('WE-000007'))).toBeVisible()
  confirmationURL = await page.getByLabel(T.history.confirmationLink).inputValue()
  await shot('ordered')
})

test('the employee confirms on their phone', async ({ browser }) => {
  // The page offers English or Russian and starts in the browser's, so Lithuanian shows English.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale })
  await phone.goto(confirmationURL)
  await expect(phone.getByRole('heading', { name: /^Ona/ })).toBeVisible()
  await shot('confirm-phone', phone)
  await phone.close()
})

test('history, an order and its record', async () => {
  await page.getByRole('button', { name: T.order.startNewOrder }).click()
  await openTab(T.shell.history)
  await page.getByRole('link', { name: /^WE-\d{6}$/ }).first().click()
  await expect(order().getByRole('button', { name: T.history.openConfirmation })).toBeVisible()
  // Taller, so the order's actions show below its lines.
  await page.setViewportSize({ width: 1280, height: 1200 })
  await shot('history')
  await page.setViewportSize({ width: 1280, height: 800 })

  await order().getByRole('button', { name: T.history.closeOrder }).click()
  await page.getByRole('button', { name: new RegExp(`^${T.common.given}`) }).click()
  await page.getByRole('link', { name: /^WE-\d{6}$/ }).first().click()
  await order().getByRole('button', { name: T.history.viewRecord }).click()
  await expect(page.getByText(/Items Given Record/i).first()).toBeVisible()
  await shot('record')
})

test('employees, catalogue, item sets, users', async () => {
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
  await openTab(T.shell.users)
  await expect(page.getByRole('heading', { name: T.users.title })).toBeVisible()
  await shot('users')
})

test('account and the command palette', async () => {
  await page.goto('/account')
  await expect(page.getByRole('group', { name: T.account.tableRows })).toBeVisible()
  await shot('account')
  await openTab(T.shell.history)
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('dialog', { name: T.shell.searchOrJump }).getByRole('combobox').fill('ona')
  await expect(page.getByRole('option', { name: T.shell.newOrderFor('Ona Kazlauskienė') })).toBeVisible()
  await shot('palette')
})
