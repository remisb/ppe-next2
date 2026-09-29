import { Fragment, useEffect, useState } from 'react'

import { PageHeader } from '@/components/states'
import { type Block, type Item, forRoles, guides, inline, shotPath } from '@/help'
import { type Lang, languages } from '@/i18n'
import { useSession } from '@/lib/api'
import { cn } from '@/lib/utils'

/** A row of mutually exclusive choices, the pressed one raised, as on Account. */
const choice =
  'flex h-9 cursor-pointer items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11'

/**
 * Help (/help): the user guide, with only what the user's roles can do. It
 * opens in the user's language; the switch changes the guide's language only,
 * not the app's. Each section has its own address, /help#history.
 */
export function Help() {
  const session = useSession()
  const [lang, setLang] = useState<Lang>(session.language)
  const guide = forRoles(guides[lang], session.roles)

  // An address with a section (/help#history) opens there once the guide is drawn.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  return (
    <div lang={lang} className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <PageHeader
          title={guide.title}
          description={guide.lede}
          actions={
            // Each language is named in itself, so it can be found whatever is showing now.
            <div role="group" aria-label={guide.language} className="inline-grid w-fit grid-flow-col gap-1 rounded-lg bg-muted p-1">
              {languages.map((l) => (
                <button key={l.value} type="button" lang={l.value} aria-pressed={lang === l.value} onClick={() => setLang(l.value)} className={choice}>
                  {l.label}
                </button>
              ))}
            </div>
          }
        />
        <nav aria-label={guide.contents}>
          <ol className="flex flex-wrap gap-2">
            {guide.sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11"
                >
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      {guide.sections.map((s, i) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="flex scroll-mt-20 flex-col gap-4 md:scroll-mt-6">
          <h2 id={`${s.id}-title`} className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-muted font-mono text-sm tabular-nums">
              {i + 1}
            </span>
            {s.title}
          </h2>
          {s.blocks.map((b, j) => (
            <GuideBlock key={j} block={b} lang={lang} keyLabel={guide.key} doesLabel={guide.does} />
          ))}
        </section>
      ))}

      <p className="max-w-prose text-sm text-muted-foreground">{guide.footer}</p>
    </div>
  )
}

function GuideBlock({ block: b, lang, keyLabel, doesLabel }: { block: Block; lang: Lang; keyLabel: string; doesLabel: string }) {
  if ('p' in b)
    return (
      <p className="max-w-prose text-sm leading-relaxed">
        <Rich text={b.p} />
      </p>
    )
  if ('ol' in b) return <List items={b.ol} ordered />
  if ('ul' in b) return <List items={b.ul} />
  if ('keys' in b)
    return (
      <dl aria-label={`${keyLabel} · ${doesLabel}`} className="grid max-w-3xl gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        {b.keys.map(([keys, does]) => (
          <div key={keys} className="contents">
            <dt className="flex flex-wrap items-center gap-1">
              <Rich text={keys} />
            </dt>
            <dd className="text-muted-foreground max-sm:mb-2">
              <Rich text={does} />
            </dd>
          </div>
        ))}
      </dl>
    )
  return (
    <div className={cn('grid gap-4', b.shots.length > 1 && 'lg:grid-cols-2')}>
      {b.shots.map((shot) => (
        <figure key={shot.name} className="min-w-0">
          <img
            src={import.meta.env.BASE_URL + shotPath(lang, shot.name)}
            alt={shot.alt}
            loading="lazy"
            className={cn('h-auto w-full rounded-lg border border-border bg-muted', shot.phone && 'max-w-72 rounded-3xl')}
          />
        </figure>
      ))}
    </div>
  )
}

function List({ items, ordered = false }: { items: Item[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={cn('flex max-w-prose flex-col gap-1.5 pl-5 text-sm leading-relaxed', ordered ? 'list-decimal' : 'list-disc')}>
      {items.map((item, i) =>
        typeof item === 'string' ? (
          <li key={i}>
            <Rich text={item} />
          </li>
        ) : (
          <li key={i}>
            <Rich text={item.text} />
            {item.items && item.items.length > 0 ? (
              <div className="mt-1.5">
                <List items={item.items} />
              </div>
            ) : null}
          </li>
        ),
      )}
    </Tag>
  )
}

/** A guide text with its **names** in bold and its `keys` as keys. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {inline(text).map((span, i) =>
        span.kind === 'bold' ? (
          <b key={i} className="font-semibold">
            {span.text}
          </b>
        ) : span.kind === 'keys' ? (
          <kbd key={i} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">
            {span.text}
          </kbd>
        ) : (
          <Fragment key={i}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}
