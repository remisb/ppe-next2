/**
 * Draws the specimen documents (specimens.ts) as flat images, 10 pixels a
 * millimetre, for the docs-import e2e steps (pnpm documents): a passport's
 * data page as <id>.jpg, a card as <id>-front.jpg and <id>-back.jpg; and, for
 * Scan Document, the Lithuanian passport's page photographed at a slant and
 * sideways on a patterned table (passport-lt-slanted.jpg). The images are
 * committed; run this again only to change them.
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
  // A photo taken at a slant and sideways: the page turned a quarter, tilted away at its top and to one side.
  const lt = specimenDocuments.find((d) => d.id === 'passport-lt')!
  await page.setContent(
    `<style>${styles}
      .table { width: 190mm; height: 170mm; display: flex; align-items: center; justify-content: center; perspective: 260mm;
        background: repeating-linear-gradient(35deg, #62676e 0 2.5mm, #575b62 2.5mm 5mm); }
      .table .doc { transform: rotateZ(90deg) rotateX(16deg) rotateY(-14deg); box-shadow: 0 1mm 3mm rgba(0, 0, 0, .35); }
    </style><body style="margin:0"><div class="table">${sideHtml(lt, 'page')}</div></body>`,
  )
  await page.evaluate(() => document.fonts.ready)
  await writeFile(out('passport-lt-slanted.jpg'), await page.locator('.table').screenshot({ type: 'jpeg', quality: 90 }))
  await browser.close()
}
