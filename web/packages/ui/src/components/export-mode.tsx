import { Download } from 'lucide-react'
import { useState } from 'react'

import type { ExportColumn } from '../lib/table-export.ts'
import type { Selection } from '../lib/use-selection.ts'
import { uiText } from '../text.ts'
import { Button } from './button.tsx'
import { ExportSheet } from './export-sheet.tsx'
import { SelectModeBar } from './selection-bar.tsx'

/** The select mode's key for Export, as `selection.start(EXPORT_MODE)`. */
export const EXPORT_MODE = 'export'

/**
 * Export in select mode (WARE-45). The screen's Export calls
 * `selection.start(EXPORT_MODE)`; this draws the mode's bar ("Export
 * Employees · 3 selected", Export 3…, Export all…, Cancel) and the Export
 * sheet with the rows chosen there. A finished export ends the mode.
 * `matching`: a list loaded page by page, whose "all" is every page matching
 * its filters (ExportSheet).
 */
export function ExportMode<T>({
  selection,
  list,
  columns,
  shown,
  matching,
}: {
  selection: Selection & { rows: readonly T[] }
  list: string
  columns: readonly ExportColumn<T>[]
  shown: readonly T[]
  matching?: { count: number; load: () => Promise<readonly T[]> } | undefined
}) {
  const t = uiText()
  const [scope, setScope] = useState<'selected' | 'all' | null>(null)
  const inMode = selection.mode === EXPORT_MODE
  const all = matching ? matching.count : shown.length
  return (
    <>
      {inMode ? (
        <SelectModeBar selection={selection} title={t.exportModeTitle(list)} hint={`${t.exportModeHint} ${t.selectModeHint}`}>
          <Button size="sm" disabled={selection.count === 0} onClick={() => setScope('selected')}>
            <Download aria-hidden />
            {t.exportPicked(selection.count)}
          </Button>
          <Button size="sm" variant="outline" disabled={all === 0} onClick={() => setScope('all')}>
            <span className="max-md:hidden">{matching ? t.exportAllMatchingButton(all) : t.exportAllButton(all)}</span>
            <span className="md:hidden">{t.exportAllShort(all)}</span>
          </Button>
        </SelectModeBar>
      ) : null}
      <ExportSheet
        open={scope !== null}
        onClose={() => setScope(null)}
        list={list}
        columns={columns}
        shown={shown}
        selected={selection.rows}
        matching={matching}
        scope={scope ?? undefined}
        onChangeRows={() => setScope(null)}
        onExported={selection.end}
      />
    </>
  )
}
