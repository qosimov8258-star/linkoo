"use client"

import { Fragment, type ReactNode } from "react"

/**
 * Grid table of the reference's list pages with explicit column geometry: 50 px header bar
 * (#5d6474), 50 px rows with the dotted separator, `inset` px at both sides and `cellPad` px
 * inside every cell. Unlike RefTable it never sorts by itself (heads are rendered as given)
 * and takes its columns only from `cols`.
 */
export function ListBTable<T>({
  cols,
  heads,
  rows,
  rowKey,
  render,
  onRowClick,
  rowClass,
  empty,
  minWidth = 1100,
  inset = 30,
  cellPad = 8,
  expanded,
  rowMinHeight = 50,
  replaceRow,
}: {
  cols: string
  heads: ReactNode[]
  rows: T[]
  rowKey: (row: T) => string | number
  render: (row: T) => ReactNode[]
  onRowClick?: (row: T) => void
  rowClass?: (row: T) => string
  empty?: ReactNode
  minWidth?: number
  inset?: number
  cellPad?: number
  expanded?: (row: T) => ReactNode
  rowMinHeight?: number
  /** When it returns true the row is replaced by its expanded panel (the reference hides the clicked row). */
  replaceRow?: (row: T) => boolean
}) {
  const pad = { paddingLeft: inset, paddingRight: inset }
  const cell = { paddingLeft: cellPad, paddingRight: cellPad }
  return (
    <div className={expanded ? "bg-white" : "overflow-x-auto bg-white"}>
      <div style={{ minWidth }}>
        <div className="grid h-[50px] items-center bg-[#5d6474] font-semibold text-white" style={{ gridTemplateColumns: cols, ...pad }}>
          {heads.map((head, index) => (
            <div key={index} className="leading-[16px]" style={cell}>
              {head}
            </div>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center text-[#666]">{empty}</div>
        ) : (
          rows.map((row) => (
            <Fragment key={rowKey(row)}>
              {!(replaceRow?.(row) && expanded?.(row)) && (
              <div
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`group relative grid items-center bg-white py-[7px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8] ${onRowClick ? "cursor-pointer" : ""} ${rowClass?.(row) ?? ""}`}
                style={{ gridTemplateColumns: cols, minHeight: rowMinHeight, ...pad }}
              >
                {render(row).map((value, index) => (
                  <div key={index} className="leading-[16.25px]" style={cell}>
                    {value}
                  </div>
                ))}
              </div>
              )}
              {expanded?.(row)}
            </Fragment>
          ))
        )}
      </div>
    </div>
  )
}
