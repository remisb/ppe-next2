import { useSession } from '@ppe/app-shell'
import { PageHeader } from '@ppe/ui/components/states'
import { cn } from '@ppe/ui/lib/utils'
import { Kbd } from '@ppe/ui/components/kbd'
import { DropdownMenuGroup, DropdownMenuGroupLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@ppe/ui/components/dropdown-menu'
import { MenuButton } from '@ppe/ui/components/page-header'
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'

import { type Block, type Device, type Item, deviceFor, deviceOrder, forReader, guides, helpAudiences, inline, shotPath } from '@/help'
import { type Lang, languages } from '@/i18n'

/** The device class of this window (phone, tablet, desktop), following resizes. */
function useDevice(): Device {
  return useSyncExternalStore(
    (changed) => {
      window.addEventListener('resize', changed)
      return () => window.removeEventListener('resize', changed)
    },
    () => deviceFor(window.innerWidth),
  )
}

/**
 * Help (/help): the user guide, with only what the user's roles can do, as it
 * looks on the device in use: its screenshots and, where the screens differ,
 * its words. It opens in the user's language and on this window's device;
 * the switches change the guide only, not the app. Each section has its own
 * address, /help#orders.
 */
export function Help() {
  const session = useSession()
  const [lang, setLang] = useState<Lang>(session.language)
  const current = useDevice()
  // The window's device until the reader picks another one to read about.
  const [chosen, setChosen] = useState<Device>()
  const device = chosen ?? current
  const guide = forReader(guides[lang], { roles: helpAudiences(session), device })

  // An address with a section (/help#orders) opens there once the guide is drawn.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  return (
    <div lang={lang}>
      <PageHeader
        title={guide.title}
        subtitle={guide.lede}
        menu={
          <>
            {/* Each language is named in itself, so it can be found whatever is showing now; its code alone on a phone. */}
            <MenuButton
              aria-label={`${guide.language}: ${languages.find((l) => l.value === lang)?.label ?? lang}`}
              label={
                <>
                  <span className="max-sm:hidden">{languages.find((l) => l.value === lang)?.label}</span>
                  <span className="uppercase sm:hidden">{lang}</span>
                </>
              }
            >
              <DropdownMenuGroup>
                <DropdownMenuGroupLabel>{guide.language}</DropdownMenuGroupLabel>
                <DropdownMenuRadioGroup value={lang} onValueChange={(v: Lang) => setLang(v)}>
                  {languages.map((l) => (
                    <DropdownMenuRadioItem key={l.value} value={l.value} lang={l.value}>
                      {l.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </MenuButton>
            <MenuButton aria-label={`${guide.device}: ${guide.devices[device]}`} label={guide.devices[device]}>
              <DropdownMenuGroup>
                <DropdownMenuGroupLabel>{guide.device}</DropdownMenuGroupLabel>
                <DropdownMenuRadioGroup value={device} onValueChange={(d: Device) => setChosen(d === current ? undefined : d)}>
                  {deviceOrder.map((d) => (
                    <DropdownMenuRadioItem key={d} value={d}>
                      {guide.devices[d]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </MenuButton>
          </>
        }
      />
      <div className="flex flex-col gap-10">
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

      {guide.sections.map((s, i) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="flex flex-col gap-4">
          <h2 id={`${s.id}-title`} className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-muted font-mono text-sm tabular-nums">
              {i + 1}
            </span>
            {s.title}
          </h2>
          {s.blocks.map((b, j) => (
            <GuideBlock key={j} block={b} lang={lang} device={device} keyLabel={guide.key} doesLabel={guide.does} />
          ))}
        </section>
      ))}

      <p className="max-w-prose text-sm text-muted-foreground">{guide.footer}</p>
      </div>
    </div>
  )
}

function GuideBlock({ block: b, lang, device, keyLabel, doesLabel }: { block: Block; lang: Lang; device: Device; keyLabel: string; doesLabel: string }) {
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
    // Phone screens are narrow and tall: side by side, and never wider than a phone.
    <div className={cn('grid gap-4', b.shots.length > 1 && (device === 'desktop' ? 'lg:grid-cols-2' : 'sm:grid-cols-2'))}>
      {b.shots.map((shot) => {
        const phone = shot.phone || device === 'phone'
        return (
          <figure key={shot.name} className="min-w-0">
            <img
              src={import.meta.env.BASE_URL + shotPath(lang, device, shot)}
              alt={shot.alt}
              loading="lazy"
              className={cn('h-auto w-full rounded-lg border border-border bg-muted', phone && 'max-w-72 rounded-3xl', device === 'tablet' && !phone && 'max-w-md')}
            />
          </figure>
        )
      })}
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
          <Kbd key={i} size="chip">
            {span.text}
          </Kbd>
        ) : (
          <Fragment key={i}>{span.text}</Fragment>
        ),
      )}
    </>
  )
}
