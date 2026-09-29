import { fileURLToPath } from 'node:url'

import { type Page, expect, test } from '@playwright/test'

import { admin } from '../env.ts'

// Screenshots for the user guide (docs/guide), taken from the demo data in
// order: each step leaves the app where the next one starts.
test.describe.configure({ mode: 'serial' })

const img = (name: string) => fileURLToPath(new URL(`../../../docs/guide/img/${name}.png`, import.meta.url))

let page: Page
let confirmationURL = ''

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
})

/** Settles the page (no hover, no pending requests, finished transitions) and saves it. */
async function shot(name: string, target: Page = page) {
  await target.mouse.move(0, 0)
  await target.waitForLoadState('networkidle')
  await target.waitForTimeout(400)
  await target.screenshot({ path: img(name) })
}

async function openTab(name: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click()
}

test('sign in and the dashboard', async () => {
  await page.goto('/')
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel(/^Password/).fill(admin.password)
  await shot('sign-in')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await shot('dashboard')
})

test('create an order, review it, mark it as ordered', async () => {
  await openTab('Create Order')
  await page.getByRole('combobox', { name: 'Assigned to' }).fill('Kazlausk')
  await page.getByRole('option', { name: /Ona Kazlauskienė/ }).click()
  await page.getByRole('button', { name: 'Apply Warehouse starter kit' }).click()
  await expect(page.getByLabel('Quantity of Protective gloves')).toHaveValue('10')
  await shot('create-order')

  await page.getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByRole('dialog', { name: 'Review order' })).toBeVisible()
  await shot('review')
  await page.getByRole('dialog', { name: 'Review order' }).getByRole('button', { name: 'Mark as Ordered' }).click()
  await expect(page.getByText(/Order WE-\d{6} is ordered/)).toBeVisible()
  confirmationURL = await page.getByLabel('Confirmation link').inputValue()
  await shot('ordered')
})

test('the employee confirms on their phone', async ({ browser }) => {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await phone.goto(confirmationURL)
  await expect(phone.getByRole('heading', { name: /please confirm you received/ })).toBeVisible()
  await shot('confirm-phone', phone)
  await phone.close()
})

test('history, an order and its record', async () => {
  await page.getByRole('button', { name: 'Start a new order' }).click()
  await openTab('History')
  await page.getByRole('link', { name: /^WE-\d{6}$/ }).first().click()
  await expect(page.getByRole('complementary', { name: 'Order' }).getByRole('button', { name: 'Open Employee Confirmation' })).toBeVisible()
  // Taller, so the order's actions show below its lines.
  await page.setViewportSize({ width: 1280, height: 1120 })
  await shot('history')
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.getByRole('complementary', { name: 'Order' }).getByRole('button', { name: 'Close order' }).click()
  await page.getByRole('button', { name: /^Given/ }).click()
  await page.getByRole('link', { name: /^WE-\d{6}$/ }).first().click()
  const order = page.getByRole('complementary', { name: 'Order' })
  await order.getByRole('button', { name: 'View Record' }).click()
  await expect(page.getByText(/Items Given Record/i).first()).toBeVisible()
  await shot('record')
})

test('employees, catalogue, item sets, users', async () => {
  await openTab('Employees')
  await expect(page.getByRole('row', { name: /Rasa Stankevičiūtė/ })).toBeVisible()
  await shot('employees')
  await page.getByRole('link', { name: 'Jonas Petraitis' }).click()
  await expect(page.getByRole('heading', { name: 'Jonas Petraitis' })).toBeVisible()
  await shot('employee')

  await openTab('Item Catalogue')
  await expect(page.getByRole('row', { name: /Safety shoes/ })).toBeVisible()
  await shot('catalogue')
  await openTab('Item Sets')
  await expect(page.getByText('Warehouse starter kit').first()).toBeVisible()
  await shot('item-sets')
  await openTab('Users')
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  await shot('users')
})

test('account and the command palette', async () => {
  await page.goto('/account')
  await expect(page.getByRole('group', { name: 'Table rows' })).toBeVisible()
  await shot('account')
  await openTab('History')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('dialog', { name: 'Search or jump to' }).getByRole('combobox').fill('ona')
  await expect(page.getByRole('option', { name: 'New order for Ona Kazlauskienė' })).toBeVisible()
  await shot('palette')
})
