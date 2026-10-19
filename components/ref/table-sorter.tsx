"use client"

import { useEffect } from "react"
import { compareText } from "@/components/ref/list-kit"

/**
 * Makes the header cells of plain <table> lists clickable (▲/▼), like the reference app.
 * Only simple tables are touched: every body row must be a direct <tr> with one cell per column.
 */
export function TableSorter() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const th = target?.closest("thead th") as HTMLTableCellElement | null
      if (!th || target?.closest("button, input, a, select")) return
      const table = th.closest("table")
      const body = table?.tBodies[0]
      if (!table || !body || table.dataset.noSort !== undefined) return
      const rows = Array.from(body.rows)
      const colIndex = th.cellIndex
      if (rows.length < 2 || rows.some((row) => row.cells.length !== th.parentElement?.children.length)) return
      const current = th.dataset.sort
      table.querySelectorAll<HTMLElement>("thead th").forEach((cell) => {
        delete cell.dataset.sort
        cell.querySelector("[data-sort-mark]")?.remove()
      })
      const desc = current === "asc"
      th.dataset.sort = desc ? "desc" : "asc"
      const mark = document.createElement("span")
      mark.dataset.sortMark = "1"
      mark.textContent = desc ? " ▼" : " ▲"
      mark.style.fontSize = "10px"
      th.appendChild(mark)
      const text = (row: HTMLTableRowElement) => row.cells[colIndex]?.innerText.trim() ?? ""
      rows.sort((a, b) => (desc ? -1 : 1) * compareText(text(a), text(b))).forEach((row) => body.appendChild(row))
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])
  return null
}
