import * as XLSX from "xlsx"

/**
 * Reads the first sheet of an uploaded .xlsx/.xls/.csv file into rows of
 * trimmed string cells. Uses the xlsx library so real (binary) Excel files
 * parse correctly — reading them as plain text (FileReader.readAsText)
 * only works for .csv and produces garbage for actual .xlsx/.xls uploads.
 */
export function readExcelRows(file: File): Promise<string[][]> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array" })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = sheet
          ? (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false }) as unknown[][])
          : []
        resolve(rows.map((row) => row.map((cell) => String(cell ?? "").trim())))
      } catch {
        resolve([])
      }
    }
    reader.onerror = () => resolve([])
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Maps flexible spreadsheet header text (Russian/Uzbek/English, with or
 * without notes like "(обязательно)") to canonical field keys, so imports
 * work regardless of column order or which template produced the file.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/['"`ʻʼ]/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Given a header row and an alias map (normalized header text -> field
 * key), returns the column index for each recognized field. Falls back to
 * treating the file as headerless (no entries) if nothing matches.
 *
 * Matching is exact first, then falls back to "alias appears as a whole
 * word in the header" (longest alias wins) — real spreadsheets rarely use
 * the bare word alone (e.g. "Наименование продукта", "Product Name"), so
 * requiring exact equality missed most real-world files.
 */
export function mapHeaderColumns(headerRow: string[], aliases: Record<string, string>): Map<number, string> {
  const fieldByIndex = new Map<number, string>()
  const sortedAliases = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length)
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell)
    if (!normalized) return
    if (aliases[normalized]) {
      fieldByIndex.set(index, aliases[normalized])
      return
    }
    for (const [alias, field] of sortedAliases) {
      const wholeWord = new RegExp(`(^|\\s)${escapeRegExp(alias)}(\\s|$)`)
      if (wholeWord.test(normalized)) {
        fieldByIndex.set(index, field)
        return
      }
    }
  })
  return fieldByIndex
}

export const IS_HEADER_LABEL = /^(наименование|название|name|товар|product)$/i
