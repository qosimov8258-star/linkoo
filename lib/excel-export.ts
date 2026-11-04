import * as XLSX from "xlsx"

import { appCurrencyText } from "@/lib/app-currency-text"
import { showCurrencyNames } from "@/lib/finance/currency"

type ExcelCell = string | number | null | undefined | { formula: string; value: number }

type ExcelOptions = {
  /** Merged ranges in A1 notation ("A1:A2"). */
  merges?: string[]
  /** Column widths in characters, one entry per column from the first (shorter lists leave the rest at the default). */
  widths?: number[]
}

/** Downloads a genuine .xlsx workbook (no server round-trip required). Texts print currencies
 * by their shown names (SOM, USD, ЕВРО), like the screen, and their amounts in the app currency
 * when one is chosen (Настройки → Валюта приложения, lib/app-currency-text.ts). */
export function downloadExcelTable(fileName: string, rows: ExcelCell[][], options: ExcelOptions = {}) {
  const data = rows.map((row) => row.map((cell) => (cell !== null && typeof cell === "object" ? cell.value : typeof cell === "string" ? appCurrencyText(showCurrencyNames(cell)) : (cell ?? ""))))
  const worksheet = XLSX.utils.aoa_to_sheet(data)
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell !== null && typeof cell === "object") worksheet[XLSX.utils.encode_cell({ r, c })] = { t: "n", v: cell.value, f: cell.formula }
    }),
  )
  worksheet["!cols"] = options.widths ? options.widths.map((wch) => ({ wch })) : columnWidths(data)
  if (options.merges) worksheet["!merges"] = options.merges.map((range) => XLSX.utils.decode_range(range))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")
  const baseName = fileName.replace(/\.(xlsx|xls)$/i, "")
  XLSX.writeFile(workbook, `${baseName}.xlsx`, { bookType: "xlsx" })
}

function columnWidths(data: ExcelCell[][]) {
  const columnCount = data.reduce((max, row) => Math.max(max, row.length), 0)
  return Array.from({ length: columnCount }, (_, columnIndex) => ({
    wch: Math.min(60, Math.max(10, ...data.map((row) => String(row[columnIndex] ?? "").length + 2))),
  }))
}
