"use client"

import { useEffect } from "react"
import { compareText } from "@/components/ref/list-kit"

/** True when the element has its own React click handler. */
function hasReactClick(node: Element): boolean {
  const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"))
  const props = key ? (node as unknown as Record<string, { onClick?: unknown } | undefined>)[key] : undefined
  return typeof props?.onClick === "function"
}

/** A table whose header sorts in React — a button or a click handler anywhere in its header cells (P&L's arrows sit
 * next to the label, a transfer's header button leaves padding around it) — is never sorted here as well. */
function sortsItself(table: HTMLTableElement): boolean {
  const head = table.tHead
  if (!head) return false
  if (head.querySelector("button, [role=button]")) return true
  return [head, ...Array.from(head.querySelectorAll("*"))].some(hasReactClick)
}

/** A totals row («Итого» in any of the app's languages) stays under the rows it adds up. */
const TOTAL_LABELS = new Set(["итого", "jami", "jemi", "total"])
const isTotalRow = (row: HTMLTableRowElement) =>
  row.dataset.sortFixed !== undefined || TOTAL_LABELS.has((row.cells[0]?.innerText ?? "").trim().toLowerCase().replace(/:$/, ""))

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
      if (!table || !body || table.dataset.noSort !== undefined || sortsItself(table)) return
      const all = Array.from(body.rows)
      const colIndex = th.cellIndex
      if (all.length < 2 || all.some((row) => row.cells.length !== th.parentElement?.children.length)) return
      const fixed = all.filter(isTotalRow)
      const rows = all.filter((row) => !isTotalRow(row))
      // The rows' own order, kept for the third click. Rows the page rendered since the last sort (a search, another
      // page) start it again from the order they are in now, so no stale position is mixed in.
      const changed = rows.some((row) => row.dataset.sortOrigin === undefined)
      if (changed) {
        rows.forEach((row, index) => {
          row.dataset.sortOrigin = String(index)
        })
      }
      const current = changed ? undefined : th.dataset.sort
      table.querySelectorAll<HTMLElement>("thead th").forEach((cell) => {
        delete cell.dataset.sort
        cell.querySelector("[data-sort-mark]")?.remove()
      })
      const next = current === undefined ? "asc" : current === "asc" ? "desc" : undefined
      if (!next) {
        rows.sort((a, b) => Number(a.dataset.sortOrigin) - Number(b.dataset.sortOrigin)).forEach((row) => body.appendChild(row))
        fixed.forEach((row) => body.appendChild(row))
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
      fixed.forEach((row) => body.appendChild(row))
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])
  return null
}
