import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * `stack`: when the table has under 48rem of room (the `stacked:` variant, a
 * container query; never print) each body row becomes a card and each cell a
 * line, labelled by its `label` prop, so no table scrolls sideways. `"grid"`
 * also puts the cards two to a row where they have the room (`stacked-wide:`).
 * It is one DOM at every width: the table keeps its semantics and nothing is
 * rendered twice. Cells restyle further with `stacked:` classes, which `cn`
 * merges over the defaults below. `stackBelow="lg"` moves the threshold to
 * 60rem, for a table whose columns need more than 48rem side by side.
 * `sortControl` (a SortControl) shows above the cards only while stacked,
 * standing in for the sortable headers the stacked table hides.
 */
const StackContext = React.createContext<boolean | "grid">(false)

function Table({
  className,
  stack = false,
  stackBelow = "md",
  sortControl,
  ...props
}: React.ComponentProps<"table"> & { stack?: boolean | "grid"; stackBelow?: "md" | "lg"; sortControl?: React.ReactNode }) {
  return (
    <StackContext value={stack}>
      <div
        data-slot="table-container"
        className={cn("relative w-full overflow-x-auto", stack && (stackBelow === "lg" ? "@container/table-lg" : "@container/table"))}
      >
        {stack && sortControl ? <div className="mb-3 hidden stacked:block">{sortControl}</div> : null}
        <table
          data-slot="table"
          className={cn("w-full caption-bottom text-sm", stack && "stacked:block", className)}
          {...props}
        />
      </div>
    </StackContext>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  const stack = React.use(StackContext)
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", stack && "stacked:hidden", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  const stack = React.use(StackContext)
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "[&_tr:last-child]:border-0",
        stack && "stacked:flex stacked:flex-col stacked:gap-3",
        stack === "grid" && "stacked-wide:grid stacked-wide:grid-cols-2",
        className
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  const stack = React.use(StackContext)
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        stack && "stacked:mt-3 stacked:block stacked:border-t-0 stacked:bg-transparent",
        className
      )}
      {...props}
    />
  )
}

/** A phone card: cells wrap in a row, most taking the full width. */
const stackedRow =
  "stacked:flex stacked:flex-wrap stacked:items-center stacked:gap-x-4 stacked:gap-y-1 stacked:rounded-lg stacked:border stacked:bg-card stacked:px-4 stacked:py-3 stacked:hover:bg-card"

/**
 * A line break inside a stacked row: cells ordered before `order-2` (the row's
 * `::after`, a full-width flex item) share the first line, the rest wrap below
 * it however short the first line is. Put it on the TableRow.
 */
const stackedBreak = "stacked:after:order-2 stacked:after:basis-full stacked:after:content-['']"

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const stack = React.use(StackContext)
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        stack && stackedRow,
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * In a stacked table a cell with a `label` is a "label … value" line; one
 * without is a full-width block (a card's title, actions). The label is the
 * column header's stand-in, so it is hidden wherever the header shows.
 */
function TableCell({
  className,
  label,
  children,
  ...props
}: React.ComponentProps<"td"> & { label?: string | undefined }) {
  const stack = React.use(StackContext)
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        stack && "stacked:block stacked:w-full stacked:px-0 stacked:py-0.5 stacked:whitespace-normal",
        stack && label && "stacked:flex stacked:items-baseline stacked:justify-between stacked:gap-4 stacked:text-right",
        className
      )}
      {...props}
    >
      {stack && label ? (
        <>
          <span className="hidden shrink-0 text-left text-[0.8125rem] font-normal text-muted-foreground stacked:inline">{label}</span>
          <div className="min-w-0">{children}</div>
        </>
      ) : (
        children
      )}
    </td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  stackedBreak,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
