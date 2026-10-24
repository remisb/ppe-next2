import { Info } from 'lucide-react'

import { uiText } from '../text.ts'
import { buttonVariants } from './button.tsx'
import { HelpPopover } from './tooltip.tsx'

/**
 * An ⓘ beside a section's heading, holding what the section is, out of the
 * way: pointing at it, a click, a tap or Enter opens it (HelpPopover).
 * DisclosureSection draws it from its description; section names the button,
 * "About Orders", kept out of the heading so the heading's name stays its own.
 */
export function InfoTip({ section, describedBy, children }: { section: string; describedBy?: string | undefined; children: string }) {
  return (
    <HelpPopover
      help={{ body: children }}
      label={uiText().aboutSection(section)}
      describedBy={describedBy}
      className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'rounded-full text-muted-foreground data-[popup-open]:bg-muted' })}
    >
      <Info aria-hidden className="size-4" />
    </HelpPopover>
  )
}
