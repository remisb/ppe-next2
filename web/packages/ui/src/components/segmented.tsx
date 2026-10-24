import { cn } from '../lib/utils.ts'
import { type Help, HelpTooltip } from './tooltip.tsx'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  /** Drawn after the label, plain and muted: how many the tab shows. */
  count?: number | undefined
  /** The tab's tooltip, as Orders' and the registers' status tabs have. */
  help?: Help | undefined
  /** The label's language, when it is named in itself (a language list). */
  lang?: string | undefined
  /** Pressed whatever `value` is, for a tab that stands for more than one value. */
  pressed?: boolean | undefined
}

const layouts = {
  /** Equal tabs filling a phone's row; on a wider screen as wide as the widest. */
  fill: 'grid w-full grid-flow-col auto-cols-fr sm:inline-grid sm:w-auto',
  /** Each as wide as its words, the group as wide as they are. */
  fit: 'inline-grid w-fit grid-flow-col',
  /** As fill, but on a phone each narrows to its words and the row scrolls sideways when they still do not fit. */
  scroll: 'flex w-max min-w-full sm:inline-grid sm:w-auto sm:min-w-0 sm:grid-flow-col sm:auto-cols-fr',
  /** A grid whose columns the caller's className sets, as the asset registers' do. */
  grid: 'grid',
}

/**
 * A row of mutually exclusive choices, the pressed one raised: the status tabs
 * that filter a list (with counts) and choices such as Language or Theme.
 * `busy` dims the counts while they reload.
 */
export function Segmented<V extends string>({
  label,
  options,
  value,
  onChange,
  layout = 'fill',
  busy = false,
  className,
}: {
  label?: string | undefined
  options: readonly SegmentedOption<V>[]
  value?: V | undefined
  onChange: (value: V) => void
  layout?: keyof typeof layouts
  busy?: boolean
  className?: string | undefined
}) {
  const group = (
    <div role="group" aria-label={label} className={cn('gap-1 rounded-lg bg-muted p-1', layouts[layout], layout !== 'scroll' && className)}>
      {options.map((o) => {
        const button = (
          <button
            key={o.value}
            type="button"
            lang={o.lang}
            aria-pressed={o.pressed ?? o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11',
              layout === 'scroll' && 'flex-1',
            )}
          >
            {o.label}
            {o.count === undefined ? null : <span className={cn('text-muted-foreground tabular-nums', busy && 'opacity-60')}>{o.count}</span>}
          </button>
        )
        return o.help ? (
          <HelpTooltip key={o.value} title={o.label} help={o.help}>
            {button}
          </HelpTooltip>
        ) : (
          button
        )
      })}
    </div>
  )
  if (layout !== 'scroll') return group
  return <div className={cn('max-md:-mx-4 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none]', className)}>{group}</div>
}
