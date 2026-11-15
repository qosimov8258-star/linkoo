"use client"

import { useEffect } from "react"
import { compareText } from "@/components/ref/list-kit"

/** True when the element (or one between it and `stop`) has its own React click handler. */
function hasOwnClick(element: HTMLElement | null, stop: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"))
    const props = key ? (node as unknown as Record<string, { onClick?: unknown } | undefined>)[key] : undefined
    if (typeof props?.onClick === "function") return true
    if (node === stop) break
  }
  return false
}

/**
 * Makes the header cells of plain <table> lists clickable, like the reference app: a click sorts the rows
 * ascending (▲), the next one descending (▼), the third one puts them back in their own order.
 * Only simple tables are touched: every body row must be a direct <tr> with one cell per column. Tables that
 * sort themselves (a header with its own click handler, a button inside it, or data-no-sort on the table) are
 * left alone, so their React sorting is never mixed with this one.
 */
export function TableSorter() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const th = target?.closest("thead th") as HTMLTableCellElement | null
      if (!th || target?.closest("button, input, a, select")) return
      const table = th.closest("table")
      const body = table?.tBodies[0]
      if (!table || !body || table.dataset.noSort !== undefined || hasOwnClick(target, th)) return
      const rows = Array.from(body.rows)
      const colIndex = th.cellIndex
      if (rows.length < 2 || rows.some((row) => row.cells.length !== th.parentElement?.children.length)) return
      // The rows' own order, kept for the third click.
      rows.forEach((row, index) => {
        if (row.dataset.sortOrigin === undefined) row.dataset.sortOrigin = String(index)
      })
      const current = th.dataset.sort
      table.querySelectorAll<HTMLElement>("thead th").forEach((cell) => {
        delete cell.dataset.sort
        cell.querySelector("[data-sort-mark]")?.remove()
      })
      const next = current === undefined ? "asc" : current === "asc" ? "desc" : undefined
      if (!next) {
        rows.sort((a, b) => Number(a.dataset.sortOrigin) - Number(b.dataset.sortOrigin)).forEach((row) => body.appendChild(row))
        return
      }
      th.dataset.sort = next
      const mark = document.createElement("span")
      mark.dataset.sortMark = "1"
      mark.textContent = next === "desc" ? " ▼" : " ▲"
      mark.style.fontSize = "10px"
      th.appendChild(mark)
      const text = (row: HTMLTableRowElement) => row.cells[colIndex]?.innerText.trim() ?? ""
      rows.sort((a, b) => (next === "desc" ? -1 : 1) * compareText(text(a), text(b))).forEach((row) => body.appendChild(row))
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])
  return null
}
