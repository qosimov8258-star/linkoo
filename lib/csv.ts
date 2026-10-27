// CSV export helpers shared by every "Экспорт CSV" button. Names typed by users
// (clients, accounts, agents, categories…) may start with "=", "+", "-" or "@":
// a spreadsheet would run such a cell as a formula (=HYPERLINK(…), =cmd|…), so
// those texts get an apostrophe prefix, and every cell is quoted (a ";", a quote
// or a line break inside a value never splits it into new cells or rows).

/** Starts of a text that Excel / LibreOffice / Google Sheets evaluate as a formula. */
const FORMULA_START = /^[=+\-@\t\r\n]/
/** A plain number text ("-12", "3.5", "-0,25", a formatted "-12 500,50") stays a number, not a text. */
const PLAIN_NUMBER = /^-?\d[\d \u00a0\u202f]*([.,]\d+)?$/

/** One CSV cell: quoted (inner quotes doubled); a formula-like text is prefixed with an apostrophe. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value)
  if (typeof value !== "number" && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** Rows → CSV text: every cell through csvCell, cells joined with `separator`, rows with `newline`. */
export function csvText(rows: readonly (readonly unknown[])[], separator = ";", newline = "\n"): string {
  return rows.map((row) => row.map(csvCell).join(separator)).join(newline)
}

/**
 * CSV text → rows of cells, the reverse of csvText: quoted cells (with ";", doubled quotes or
 * line breaks inside) are read back, a leading BOM is skipped, and the apostrophe csvCell put
 * before a formula-like text is removed, so an exported file can be imported again unchanged.
 */
export function parseCsv(text: string, separator = ";"): string[][] {
  const source = text.replace(/^﻿/, "")
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  let inQuotes = false
  const endCell = () => {
    row.push(quoted && /^'[=+\-@\t\r\n]/.test(cell) ? cell.slice(1) : cell)
    cell = ""
    quoted = false
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (inQuotes) {
      if (char !== '"') cell += char
      else if (source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else inQuotes = false
    } else if (char === '"' && !cell && !quoted) {
      inQuotes = true
      quoted = true
    } else if (char === separator) {
      endCell()
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1
      endCell()
      rows.push(row)
      row = []
    } else {
      cell += char
    }
  }
  if (cell || quoted || row.length) {
    endCell()
    rows.push(row)
  }
  return rows
}
