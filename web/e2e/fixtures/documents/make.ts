/**
 * Draws the specimen documents (specimens.ts) as flat images, 10 pixels a
 * millimetre, for the docs-import e2e steps (pnpm documents): a passport's
 * data page as <id>.jpg, a card as <id>-front.jpg and <id>-back.jpg. The
 * images are committed; run this again only to change them.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { sideHtml, sidesOf, specimenDocuments, styles } from './specimens.ts'

/** Pixels a millimetre; CSS has 96 / 25.4 of them a millimetre at scale 1. */
const PX_PER_MM = 10

const out = (name: string) => fileURLToPath(new URL(name, import.meta.url))

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: PX_PER_MM / (96 / 25.4) })
  for (const doc of specimenDocuments) {
    for (const side of sidesOf(doc)) {
      await page.setContent(`<style>${styles}</style><body style="margin:0">${sideHtml(doc, side)}</body>`)
      await page.evaluate(() => document.fonts.ready)
      const name = side === 'page' ? `${doc.id}.jpg` : `${doc.id}-${side}.jpg`
      await writeFile(out(name), await page.locator('.doc').screenshot({ type: 'jpeg', quality: 90 }))
    }
  }
  await browser.close()
}
