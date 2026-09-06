import * as XLSX from "xlsx"

type ExcelCell = string | number | null | undefined

/** Downloads a genuine .xlsx workbook (no server round-trip required). */
export function downloadExcelTable(fileName: string, rows: ExcelCell[][]) {
  const data = rows.map((row) => row.map((cell) => cell ?? ""))
  const worksheet = XLSX.utils.aoa_to_sheet(data)
  worksheet["!cols"] = columnWidths(data)
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
