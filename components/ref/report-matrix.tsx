"use client"

import { Fragment, useRef, type ReactNode } from "react"

import { ScrollButtons } from "./scroll-buttons"

/**
 * Grid table of the reference app's "dynamic report" pages (visits by day, agent visits, system distribution …):
 * 46px headers on #f8f9fa with #efefef cell borders, 42px body rows, a #f4f8fb "Итого" row and a thin empty row
 * closing the table. Columns have fixed widths, so wide reports scroll sideways behind the "»" half-disc.
 */

export type MatrixHead = {
  label: ReactNode
  width: number
  sortable?: boolean
  align?: "left" | "right" | "center"
}

export type MatrixGroup = { title: ReactNode; span: number }

export type MatrixRow = {
  cells: ReactNode[]
  /** data = white row, total = "Итого" band, dark = grouped (supervisor) row, sub = indented child row */
  tone?: "data" | "total" | "dark" | "sub"
  /** Extra classes for one cell (e.g. a coloured percent). */
  cellClass?: (index: number) => string
  key?: string
  onClick?: () => void
}

const SORT_UP = "M7 14l5-5 5 5z"
const SORT_DOWN = "M7 10l5 5 5-5z"

function SortIcons({ dir }: { dir?: "asc" | "desc" }) {
  return (
    <span className="ml-[2px] inline-flex h-5 w-5 shrink-0 flex-col items-center justify-center align-middle">
      <svg viewBox="0 0 24 24" className={`-mb-[5px] h-[15px] w-[15px] ${dir === "asc" ? "fill-[#374557]" : "fill-[#c0c0c0]"}`}>
        <path d={SORT_UP} />
      </svg>
      <svg viewBox="0 0 24 24" className={`h-[15px] w-[15px] ${dir === "desc" ? "fill-[#374557]" : "fill-[#c0c0c0]"}`}>
        <path d={SORT_DOWN} />
      </svg>
    </span>
  )
}

const TONE: Record<NonNullable<MatrixRow["tone"]>, string> = {
  data: "bg-white text-[#333]",
  total: "bg-[#f4f8fb] text-[#333]",
  dark: "bg-[#505050] text-white",
  sub: "bg-white text-[#333]",
}

export function ReportMatrix({
  heads,
  groups,
  rows,
  headHeight = 46,
  headLeading = 16,
  stickyFirst = false,
  sortKey,
  sortDir,
  onSort,
  filler = true,
  className = "",
}: {
  heads: MatrixHead[]
  groups?: MatrixGroup[]
  rows: MatrixRow[]
  headHeight?: number
  /** Line height of the header titles in px (the reference wraps some reports' titles at 20px). */
  headLeading?: number
  stickyFirst?: boolean
  sortKey?: number | null
  sortDir?: "asc" | "desc"
  onSort?: (index: number) => void
  filler?: boolean
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const width = heads.reduce((sum, head) => sum + head.width, 0)
  const sticky = (index: number, z = 10) => (stickyFirst && index === 0 ? `sticky left-0 z-[${z}]` : "")

  return (
    <div className={`relative ml-px mt-[9px] ${className}`}>
      <div ref={scrollRef} className="overflow-x-auto visits-scrollbar">
        <table className="border-separate border-spacing-0 text-[13px]" style={{ width, tableLayout: "fixed" }}>
          <colgroup>
            {heads.map((head, index) => (
              <col key={index} style={{ width: head.width }} />
            ))}
          </colgroup>
          <thead>
            {groups && (
              <tr style={{ height: 46 }}>
                {groups.map((group, index) => (
                  <th
                    key={index}
                    colSpan={group.span}
                    className={`border-b border-r border-[#efefef] bg-[#f8f9fa] px-[5px] text-center align-middle font-semibold text-[#374557] ${index === 0 && stickyFirst ? "sticky left-0 z-20" : ""}`}
                  >
                    {group.title}
                  </th>
                ))}
              </tr>
            )}
            <tr style={{ height: headHeight }} className="shadow-[0_3px_6px_rgba(0,0,0,0.03)]">
              {heads.map((head, index) => (
                <th
                  key={index}
                  style={{ lineHeight: `${headLeading}px` }}
                  onClick={head.sortable && onSort ? () => onSort(index) : undefined}
                  className={`border-b border-r border-[#efefef] bg-[#f8f9fa] px-[5px] text-center align-middle font-semibold text-[#374557] ${head.sortable ? "cursor-pointer select-none" : ""} ${index === 0 && stickyFirst ? "sticky left-0 z-20" : ""}`}
                >
                  <span className="inline-flex items-center justify-center">
                    {head.label}
                    {head.sortable && <SortIcons dir={sortKey === index ? sortDir : undefined} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const tone = row.tone ?? "data"
              return (
                <tr key={row.key ?? rowIndex} style={{ height: 42 }} onClick={row.onClick} className={row.onClick ? "cursor-pointer" : undefined}>
                  {row.cells.map((cell, index) => {
                    const align = heads[index]?.align ?? (index === 0 ? "left" : "right")
                    return (
                      <td
                        key={index}
                        className={`border-b border-r border-[#efefef] px-[5px] align-middle ${TONE[tone]} ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${sticky(index)} ${row.cellClass?.(index) ?? ""}`}
                      >
                        {cell}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {filler && (
              <tr style={{ height: 22 }}>
                {heads.map((_, index) => (
                  <td key={index} className={`border-b border-r border-[#efefef] bg-white ${sticky(index)}`} />
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ScrollButtons targetRef={scrollRef} watch={rows.length} inside={headHeight * (groups ? 2 : 1) + 60} />
    </div>
  )
}

/** Small helper: the reference prints plain numbers with a no-break thin space as the thousands separator. */
export function matrixNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value)
}

export { Fragment as MatrixFragment }
