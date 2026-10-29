/**
 * Draws the SIM card carriers the e2e step "Scan SIMs" reads (pnpm sim-cards):
 * the front, with the SIM No. as a Code 128 barcode and the product code as an
 * EAN-13 one, as Bitė's are, and the back, with the PIN, the PUK and the
 * customer service number. Every number is made up; real cards' photos are
 * never committed, as their PIN and PUK are secrets. The images are committed;
 * run this again only to change them.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { writeBarcode } from 'zxing-wasm/writer'

/** The made-up cards: Luhn-valid SIM numbers from 89, no real card's. */
export const fixtureCards = [
  { simNo: '8937099000000000049', pin: '4826', puk: '31597264' },
  { simNo: '8937099000000000056', pin: '7051', puk: '68203915' },
] as const

const out = (name: string) => fileURLToPath(new URL(name, import.meta.url))

/** The barcode as an <img>, the writer's own PNG at its own size (its SVG has no viewBox, so it would not scale). */
async function barcode(text: string, format: 'Code128' | 'EAN13'): Promise<string> {
  const { image, error } = await writeBarcode(text, { format, scale: 3, addHRT: false, addQuietZones: true })
  if (error || !image) throw new Error(error || 'no image')
  return `<img alt="" src="data:image/png;base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}">`
}

const card = (body: string) => `
  <style>img { display: block; width: fit-content }</style>
  <div class="card" style="width:620px;height:740px;padding:40px;box-sizing:border-box;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#222;display:flex;flex-direction:column;justify-content:flex-end;gap:16px;border-radius:24px">
    ${body}
  </div>`

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const [i, c] of fixtureCards.entries()) {
    const sides = {
      front: card(`
        <div>${await barcode(c.simNo, 'Code128')}</div>
        <div style="font-size:22px;letter-spacing:2px">${c.simNo}</div>
        <div>${await barcode('4770192200828', 'EAN13')}</div>`),
      back: card(`
        <div style="font-size:30px;display:grid;grid-template-columns:120px auto;row-gap:28px;margin-bottom:60px">
          <b>PIN</b><span>${c.pin}</span><b>PUK</b><span>${c.puk}</span>
        </div>
        <div style="font-size:26px"><b>1501</b> Klientų aptarnavimo numeris</div>`),
    }
    for (const [side, html] of Object.entries(sides)) {
      await page.setContent(`<body style="margin:0"><div id="photo" style="display:inline-block;padding:30px;background:#e8e8e4">${html}</div></body>`)
      await writeFile(out(`card-${i + 1}-${side}.png`), await page.locator('#photo').screenshot({ type: 'png' }))
    }
  }
  await browser.close()
}
