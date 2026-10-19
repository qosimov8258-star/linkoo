"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { REF_TABLE_COLUMNS } from "@/lib/ref-table-columns"

/** Applies the column widths measured from the reference app to the first plain <table> of a page. */
export function TableFitter() {
  const pathname = usePathname()
  useEffect(() => {
    const spec = REF_TABLE_COLUMNS[pathname]
    if (!spec) return
    let tries = 0
    const apply = () => {
      const table = document.querySelector("main table, table") as HTMLTableElement | null
      const ths = table ? Array.from(table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > th")) : []
      if (!table || ths.length !== spec.n) {
        if (++tries < 10) window.setTimeout(apply, 300)
        return
      }
      table.style.tableLayout = "fixed"
      table.style.width = "100%"
      ths.forEach((th, index) => {
        const w = spec.w[index]
        if (w) th.style.width = `${w}px`
      })
    }
    apply()
  }, [pathname])
  return null
}
