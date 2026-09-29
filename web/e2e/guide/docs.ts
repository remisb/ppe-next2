import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type Block, type Guide, type Item, forReader, guides, inline, shotPath } from '../../apps/workwear/src/help/index.ts'
import { en } from '../../apps/workwear/src/i18n/en/index.ts'
import { lt } from '../../apps/workwear/src/i18n/lt/index.ts'
import { ru } from '../../apps/workwear/src/i18n/ru/index.ts'

// docs/guide, written from the app's own guide (apps/workwear/src/help) as a
// desktop reads it: every section and part, with who each role-limited part is
// for, so the Help screen and these pages never disagree. Screenshots are the
// app's public/help-img.

type Lang = 'en' | 'lt' | 'ru'

const docs = (file: string) => fileURLToPath(new URL(`../../../docs/guide/${file}`, import.meta.url))
const appName = { en: en.common.appName, lt: lt.common.appName, ru: ru.common.appName }
const page = { en: 'index.html', lt: 'lt.html', ru: 'ru.html' } as const
const markdown = { en: 'user-guide.md', lt: 'user-guide.lt.md', ru: 'user-guide.ru.md' } as const
const langNames = { en: 'English', lt: 'Lietuvių', ru: 'Русский' } as const
/** From docs/guide to the screenshots the app serves. */
const imgBase = '../../web/apps/workwear/public/'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function html(text: string): string {
  return inline(text)
    .map((s) => (s.kind === 'bold' ? `<b>${esc(s.text)}</b>` : s.kind === 'keys' ? `<kbd>${esc(s.text)}</kbd>` : esc(s.text)))
    .join('')
}

function md(text: string): string {
  return inline(text)
    .map((s) => (s.kind === 'bold' ? `**${s.text}**` : s.kind === 'keys' ? `\`${s.text}\`` : s.text))
    .join('')
}

function htmlItems(g: Guide, items: Item[], tag: 'ol' | 'ul', indent: string): string {
  const li = items.map((i) => {
    if (typeof i === 'string') return `${indent}  <li>${html(i)}</li>`
    const sub = i.items?.length ? `\n${htmlItems(g, i.items, 'ul', indent + '    ')}\n${indent}  ` : ''
    return `${indent}  <li>${html(i.text)}${sub}</li>`
  })
  return `${indent}<${tag}>\n${li.join('\n')}\n${indent}</${tag}>`
}

/** Who a part is for, when it starts a run of parts for other roles than the one before. */
function label(g: Guide, blocks: Block[], i: number): string | undefined {
  const roles = blocks[i]!.roles
  if (!roles || String(roles) === String(blocks[i - 1]?.roles ?? '')) return undefined
  return g.onlyFor(roles)
}

function htmlBlock(g: Guide, lang: Lang, b: Block, run: string | undefined): string {
  const who = run ? `    <p class="who">${esc(run)}</p>\n` : ''
  if ('p' in b) return `${who}    <p>${html(b.p)}</p>`
  if ('ol' in b) return who + htmlItems(g, b.ol, 'ol', '    ')
  if ('ul' in b) return who + htmlItems(g, b.ul, 'ul', '    ')
  if ('keys' in b) {
    const rows = b.keys.map(([k, d]) => `      <tr><td>${html(k)}</td><td>${html(d)}</td></tr>`).join('\n')
    return `${who}    <div class="table"><table>\n      <thead><tr><th>${esc(g.key)}</th><th>${esc(g.does)}</th></tr></thead>\n      <tbody>\n${rows}\n      </tbody>\n    </table></div>`
  }
  const figs = b.shots.map(
    (s) => `      <figure${s.phone ? ' class="phone"' : ''}><img src="${imgBase}${shotPath(lang, 'desktop', s)}" alt="${esc(s.alt)}" loading="lazy"></figure>`,
  )
  return `${who}    <div class="${b.shots.length > 1 ? 'pair' : 'shots'}">\n${figs.join('\n')}\n    </div>`
}

function htmlPage(lang: Lang): string {
  const g = forReader(guides[lang], { device: 'desktop' })
  const langs = (Object.keys(page) as Lang[])
    .map((l) => `<a href="${page[l]}" lang="${l}"${l === lang ? ' aria-current="page"' : ''}>${langNames[l]}</a>`)
    .join('')
  const toc = g.sections.map((s, i) => `    <li><a href="#${s.id}"><b>${i + 1}</b>${esc(s.title)}</a></li>`).join('\n')
  const sections = g.sections.map((s, i) => {
    const who = s.roles ? `  <p class="who">${esc(g.onlyFor(s.roles))}</p>\n` : ''
    const blocks = s.blocks.map((b, j) => htmlBlock(g, lang, b, label(g, s.blocks, j))).join('\n')
    return `<section id="${s.id}">\n  <h2><span class="n">${i + 1}</span>${esc(s.title)}</h2>\n${who}${blocks}\n</section>`
  })
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(`${appName[lang]} · ${g.title}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..100,600..800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
/* One reading column; each step is a short instruction above its screenshot, numbered because the sections follow an order's life. */
:root{
  --bg:#F3F4F1; --surface:#FFFFFF; --ink:#1B1F1C; --muted:#5C645E; --line:#D9DDD7;
  --hivis:#E9F23A; --hivis-ink:#1B1F1C; --key:#ECEEEA;
  --display:"Archivo", "Helvetica Neue", Arial, sans-serif;
  --body:"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono:"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){
  --bg:#131614; --surface:#1B1F1C; --ink:#E7EAE5; --muted:#9BA39D; --line:#2E3430;
  --hivis:#D9E22E; --hivis-ink:#131614; --key:#262B27; color-scheme:dark } }
:root[data-theme="dark"]{
  --bg:#131614; --surface:#1B1F1C; --ink:#E7EAE5; --muted:#9BA39D; --line:#2E3430;
  --hivis:#D9E22E; --hivis-ink:#131614; --key:#262B27; color-scheme:dark }

*{box-sizing:border-box}
body{margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 var(--body); padding-inline:16px; padding-block:40px 72px}
main{max-width:980px; margin:0 auto; display:grid; gap:56px}
header{display:grid; gap:12px; max-width:68ch}
.eyebrow{font:600 12px/1 var(--body); letter-spacing:.12em; text-transform:uppercase; color:var(--muted)}
h1{font:800 clamp(34px,6vw,54px)/1.02 var(--display); font-stretch:80%; margin:0; text-wrap:balance}
h1 span{background:var(--hivis); color:var(--hivis-ink); padding:0 .12em; box-decoration-break:clone; -webkit-box-decoration-break:clone}
.lede{margin:0; color:var(--muted); font-size:17px}
nav ol{list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:8px}
nav a{display:inline-flex; gap:6px; align-items:baseline; padding:6px 12px; border:1px solid var(--line); border-radius:999px; background:var(--surface); color:var(--ink); text-decoration:none; font-size:14px}
nav a b{font:500 12px var(--mono); color:var(--muted)}
nav a:hover, nav a:focus-visible{border-color:var(--ink); outline:none}

section{display:grid; gap:16px; scroll-margin-top:24px}
h2{font:700 26px/1.15 var(--display); font-stretch:85%; margin:0; display:flex; gap:12px; align-items:center}
h2 .n{flex:none; display:inline-grid; place-items:center; width:34px; height:34px; border-radius:8px; background:var(--hivis); color:var(--hivis-ink); font:700 16px var(--mono)}
.text, section > p, section > ol, section > ul{max-width:68ch; display:grid; gap:10px}
section > p, section > ol, section > ul{margin:0}
section > ol, section > ul, section li > ul{padding-left:1.3em; display:grid; gap:4px}
section li > ul{margin:4px 0 0}
.shots{display:grid}
.text p, .text ol, .text ul{margin:0}
.text ol, .text ul{padding-left:1.3em; display:grid; gap:4px}
.who{font-size:14px; color:var(--muted)}
figure{margin:0; min-width:0}
figure img{display:block; width:100%; height:auto; border:1px solid var(--line); border-radius:10px; background:var(--surface)}
figure.phone img{max-width:340px; border-radius:22px}
.pair{display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr)); gap:16px}
kbd, code{font:500 .86em var(--mono); background:var(--key); border:1px solid var(--line); border-radius:5px; padding:1px 5px; white-space:nowrap}
.table{overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--surface)}
table{border-collapse:collapse; width:100%; min-width:520px; font-size:15px}
th, td{text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:top}
tr:last-child td{border-bottom:0}
th{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); font-weight:600}
td:first-child{white-space:nowrap}
.langs{display:flex; gap:4px; flex-wrap:wrap}
.langs a{padding:4px 10px; border-radius:6px; color:var(--muted); text-decoration:none; font-size:14px; border:1px solid transparent}
.langs a[aria-current]{color:var(--ink); border-color:var(--line); background:var(--surface); font-weight:600}
.langs a:hover, .langs a:focus-visible{color:var(--ink); outline:none; border-color:var(--ink)}
footer{color:var(--muted); font-size:14px; max-width:68ch}
</style>
</head>
<body>
<!-- Written by \`pnpm guide\` (web/e2e/guide/docs.ts) from apps/workwear/src/help; edit the guide there. -->
<main>

<header>
  <nav class="langs" aria-label="${esc(g.language)}">${langs}</nav>
  <div class="eyebrow">workwear.gavort.nl</div>
  <h1>${esc(appName[lang])} <span>${esc(g.title)}</span></h1>
  <p class="lede">${esc(g.lede)}</p>
  <nav aria-label="${esc(g.contents)}"><ol>
${toc}
  </ol></nav>
</header>

${sections.join('\n\n')}

<footer>${esc(g.footer)}</footer>

</main>
</body>
</html>
`
}

function mdItems(g: Guide, items: Item[], ordered: boolean, indent: string): string[] {
  return items.flatMap((i, n) => {
    const mark = ordered ? `${n + 1}.` : '-'
    if (typeof i === 'string') return [`${indent}${mark} ${md(i)}`]
    return [`${indent}${mark} ${md(i.text)}`, ...mdItems(g, i.items ?? [], false, indent + '   ')]
  })
}

function mdPage(lang: Lang): string {
  const g = forReader(guides[lang], { device: 'desktop' })
  const langs = (Object.keys(markdown) as Lang[]).map((l) => (l === lang ? langNames[l] : `[${langNames[l]}](${markdown[l]})`)).join(' · ')
  const out = [`# ${appName[lang]}: ${g.title}`, langs, g.lede]
  g.sections.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`)
    if (s.roles) out.push(`*${g.onlyFor(s.roles)}.*`)
    s.blocks.forEach((b, j) => {
      const run = label(g, s.blocks, j)
      if (run) out.push(`*${run}:*`)
      if ('p' in b) out.push(md(b.p))
      else if ('ol' in b) out.push(mdItems(g, b.ol, true, '').join('\n'))
      else if ('ul' in b) out.push(mdItems(g, b.ul, false, '').join('\n'))
      else if ('keys' in b) out.push([`| ${g.key} | ${g.does} |`, '| --- | --- |', ...b.keys.map(([k, d]) => `| ${md(k)} | ${md(d)} |`)].join('\n'))
      else out.push(b.shots.map((x) => `![${x.alt}](${imgBase}${shotPath(lang, 'desktop', x)})`).join('\n'))
    })
  })
  out.push(g.footer)
  return out.join('\n\n') + '\n'
}

/** Writes this language's page and Markdown copy in docs/guide. */
export function writeDocs(lang: Lang) {
  writeFileSync(docs(page[lang]), htmlPage(lang))
  writeFileSync(docs(markdown[lang]), mdPage(lang))
}
