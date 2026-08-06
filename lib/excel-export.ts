type ExcelCell = string | number | null | undefined

function escapeHtml(value: ExcelCell) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Downloads a UTF-8 Excel-compatible workbook without requiring a server. */
export function downloadExcelTable(fileName: string, rows: ExcelCell[][]) {
  const table = rows
    .map((row, rowIndex) => {
      const tag = rowIndex === 0 ? "th" : "td"
      return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`
    })
    .join("")
  const workbookHtml = `<!doctype html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><style>table{border-collapse:collapse;font-family:Arial,sans-serif}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left}th{background:#5470e8;color:#fff;font-weight:700}</style></head><body><table>${table}</table></body></html>`
  const blob = new Blob([`\uFEFF${workbookHtml}`], { type: "application/vnd.ms-excel;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName.endsWith(".xls") ? fileName : `${fileName}.xls`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
