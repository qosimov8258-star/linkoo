import * as XLSX from "xlsx"

// The returns list's Excel files as the reference's Excel button writes them (ExcelJS): «Скачать Excel» (the page's
// rows, «Возвраты.xlsx») and «Продажа товаров» → «Выбранные возвраты» (the ticked rows, «Выбранные возвраты
// Excel.xlsx»). One sheet named like the file, a bold header row, data rows aligned left and centred vertically, and
// every column 1.5 × its longest text: the header's length, a text's length, 3 for a number or an empty text.

export type ListExcelCell = string | number

/** The reference's file names (the same in every language). */
export const RETURNS_EXCEL_NAME = "Возвраты"
export const SELECTED_RETURNS_EXCEL_NAME = "Выбранные возвраты Excel"

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><color theme="1"/><family val="2"/><scheme val="minor"/><sz val="11"/><name val="Calibri"/></font><font><b/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`

/** Column widths as the reference computes them. */
export function listExcelWidths(headers: string[], rows: ListExcelCell[][]): number[] {
  return headers.map((header, column) => 1.5 * Math.max(header.length, ...rows.map((row) => (typeof row[column] === "string" && row[column] ? String(row[column]).length : 3))))
}

/** The workbook's bytes (an .xlsx zip). */
export function listExcelBytes(name: string, headers: string[], rows: ListExcelCell[][]): Uint8Array {
  const strings: string[] = []
  const stringIndex = new Map<string, number>()
  let stringCount = 0
  const shared = (value: string) => {
    stringCount += 1
    let index = stringIndex.get(value)
    if (index === undefined) {
      index = strings.length
      strings.push(value)
      stringIndex.set(value, index)
    }
    return index
  }
  const cell = (value: ListExcelCell, ref: string, style: number) =>
    typeof value === "number" ? `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>` : `<c r="${ref}" s="${style}" t="s"><v>${shared(value)}</v></c>`
  const width = headers.length
  const sheetRows = [headers, ...rows].map((row, index) => {
    const style = index === 0 ? 1 : 2
    const cells = row.map((value, column) => cell(value, `${XLSX.utils.encode_col(column)}${index + 1}`, style)).join("")
    return `<row r="${index + 1}" spans="1:${width}" s="${style}" customFormat="1">${cells}</row>`
  })
  const cols = listExcelWidths(headers, rows)
    .map((value, column) => `<col min="${column + 1}" max="${column + 1}" width="${value}" customWidth="1"/>`)
    .join("")
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${XLSX.utils.encode_col(Math.max(0, width - 1))}${rows.length + 1}"/><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${sheetRows.join("")}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${stringCount}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join("")}</sst>`
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet sheetId="1" name="${escapeXml(name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31))}" state="visible" r:id="rId1"/></sheets></workbook>`

  const CFB = XLSX.CFB as unknown as {
    utils: { cfb_new: () => unknown; cfb_add: (container: unknown, path: string, content: Uint8Array) => void }
    write: (container: unknown, options: { fileType: "zip"; type: "array"; compression: boolean }) => ArrayLike<number>
  }
  const encoder = new TextEncoder()
  const zip = CFB.utils.cfb_new()
  const parts: Array<[string, string]> = [
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", ROOT_RELS],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", WORKBOOK_RELS],
    ["xl/styles.xml", STYLES],
    ["xl/sharedStrings.xml", sharedStrings],
    ["xl/worksheets/sheet1.xml", sheet],
  ]
  for (const [path, content] of parts) CFB.utils.cfb_add(zip, path, encoder.encode(content))
  return Uint8Array.from(CFB.write(zip, { fileType: "zip", type: "array", compression: true }))
}

/** Saves `<name>.xlsx`. */
export function downloadListExcel(name: string, headers: string[], rows: ListExcelCell[][]) {
  const bytes = listExcelBytes(name, headers, rows)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `${name}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
