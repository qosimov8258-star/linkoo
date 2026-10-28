"use client"

import type { ReactNode } from "react"

import { RefCard, RefTable } from "@/components/ref/list-kit"

type TableProps<T> = Omit<React.ComponentProps<typeof RefTable<T>>, "rows" | "hideHead" | "hideBody" | "heads"> & { heads: ReactNode[] }

/**
 * The reference opens a record's detail card in place of its row: the rows above stay under the table header, the
 * card follows, and the remaining rows continue in a second card without a header.
 */
export function SplitDetailList<T>({
  rows,
  selectedKey,
  rowKey,
  detail,
  tableProps,
  toolbar,
}: {
  rows: T[]
  selectedKey: string | number | null
  rowKey: (row: T) => string | number
  detail: (row: T) => ReactNode
  tableProps: TableProps<T>
  /** Rendered inside the first card, above the table header. */
  toolbar?: ReactNode
}) {
  const index = selectedKey == null ? -1 : rows.findIndex((row) => rowKey(row) === selectedKey)
  if (index < 0) {
    return (
      <RefCard>
        {toolbar}
        <RefTable {...tableProps} rows={rows} />
      </RefCard>
    )
  }
  const before = rows.slice(0, index)
  const after = rows.slice(index + 1)
  return (
    <>
      <RefCard>
        {toolbar}
        <RefTable {...tableProps} rows={before} hideBody={before.length === 0} />
      </RefCard>
      <section className="-mx-[15px] mb-[20px] mt-[21px] bg-white shadow-[0_3px_9px_rgba(0,0,0,0.2)]">{detail(rows[index])}</section>
      {after.length > 0 && (
        <RefCard className="bg-white">
          <RefTable {...tableProps} rows={after} hideHead />
        </RefCard>
      )}
    </>
  )
}
