import "server-only"

import * as XLSX from "xlsx"

import { ensureClientReturnsSchema, returnOwnPaymentType } from "@/lib/client-returns-repo"
import { getDb } from "@/lib/db"
import { parseAnyDate } from "@/lib/finance/dates"

// «Скачать» → «Скачать для 1C» of the returns list (the reference's sales/order_return/download_for_onec/?ids=…):
// OrderReturnOnec.xlsx, one sheet «Sheet1», one row per line of every chosen return (cancelled ones included), with the
// reference's 18 columns, its header style (white 16 pt Calibri on black, centred), centred values and 25.71 wide
// columns. The reference fills no bank, contract, payment or «в сервисе» data for returns; neither does this file.

export const ONEC_FILE_NAME = "OrderReturnOnec.xlsx"

const HEADERS = [
  "Номер возврата",
  "Дата возврата",
  "Дата оплаты",
  "Дата принятия",
  "ИНН клиента",
  "Наименование клиента",
  "Код клиента",
  "МФО банка клиента",
  "Банк клиента",
  "Расчетный счет клиента",
  "Номер договора",
  "Дата договора",
  "Оплата наличными",
  "Код номенклатуры",
  "Количество",
  "Сумма",
  "Номер в сервисе",
  "Дата в сервисе",
] as const

/** Columns the reference leaves out of a data row entirely when they are empty (H…L); the others are written empty. */
const OMITTED_WHEN_EMPTY = new Set([7, 8, 9, 10, 11])

type Cell = string | number | null

type LineRow = {
  return_id: number
  return_date: string | null
  created_at: string | null
  accepted_at: string | null
  status: string
  payment_type: string | null
  linko_payment_type: string | null
  client_name: string | null
  return_client: string | null
  client_code: string | null
  client_inn: string | null
  article: string | null
  quantity: number | string | null
  price: number | string | null
}

const text = (value: unknown) => {
  const result = String(value ?? "").trim()
  return result && !/^не установлен/i.test(result) ? result : ""
}

/** A stored local day/time ("2026-01-11 19:47:43", "2026-01-11") → "2026-01-11"; a return made here without a time
 * in its date keeps its day. */
function localDay(returnDate: string | null, createdAt: string | null): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(returnDate ?? "")
  if (match) return match[0]
  return (parseAnyDate(createdAt, true) ?? "").slice(0, 10)
}

/** The return's lines as the 1C rows, ordered by return number, then line (the reference writes them in its database's
 * own unspecified order). */
export async function onecRows(ids: number[]): Promise<Cell[][]> {
  await ensureClientReturnsSchema()
  const db = getDb()
  const lines = (await db
    .prepare(
      `SELECT r.id AS return_id, r.return_date, r.created_at, r.accepted_at, r.status, r.payment_type, r.linko_payment_type,
              c.name AS client_name, r.client AS return_client, to_jsonb(c) ->> 'code' AS client_code, to_jsonb(c) ->> 'inn' AS client_inn,
              to_jsonb(p) ->> 'article' AS article, i.quantity, i.price
         FROM client_returns r
         JOIN client_return_items i ON i.return_id = r.id
         LEFT JOIN clients c ON c.id = r.client_id
         LEFT JOIN products p ON p.id = i.product_id
        WHERE r.id = ANY(?::int[])
        ORDER BY r.id, i.id`,
    )
    .all(ids)) as LineRow[]
  return lines.map((line) => {
    const quantity = Number(line.quantity) || 0
    const sum = Number((quantity * (Number(line.price) || 0)).toFixed(9))
    // The acceptance day is a local day of the accepted (UTC) moment; a pending or cancelled return has none.
    const accepted = line.status === "accepted" ? (parseAnyDate(line.accepted_at, true) ?? "").slice(0, 10) : ""
    return [
      Number(line.return_id),
      localDay(line.return_date, line.created_at),
      "",
      accepted,
      text(line.client_inn),
      text(line.client_name) || text(line.return_client),
      text(line.client_code),
      null,
      null,
      null,
      null,
      null,
      // The reference's «Оплата наличными»: TRUE unless the return's own payment type is transfer.
      returnOwnPaymentType(line) === "bank" ? "FALSE" : "TRUE",
      text(line.article),
      quantity,
      sum,
      "",
      "",
    ]
  })
}

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const columnName = (index: number) => XLSX.utils.encode_col(index)

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF000000"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="240" yWindow="15" windowWidth="16095" windowHeight="9660"/></bookViews><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`

/** The workbook: written by hand (the bundled SheetJS build writes no fills or fonts), zipped with its CFB module. */
export function onecWorkbook(rows: Cell[][]): Buffer {
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
  const width = HEADERS.length
  const sheetRows: string[] = []
  const header = HEADERS.map((title, column) => `<c r="${columnName(column)}1" s="1" t="s"><v>${shared(title)}</v></c>`).join("")
  sheetRows.push(`<row r="1" spans="1:${width}">${header}</row>`)
  rows.forEach((row, index) => {
    const r = index + 2
    const cells = row
      .map((value, column) => {
        const ref = `${columnName(column)}${r}`
        if (value === null || value === "") return OMITTED_WHEN_EMPTY.has(column) ? "" : `<c r="${ref}" s="2"/>`
        if (typeof value === "number") return `<c r="${ref}" s="2"><v>${Number.isFinite(value) ? value : 0}</v></c>`
        return `<c r="${ref}" s="2" t="s"><v>${shared(value)}</v></c>`
      })
      .join("")
    sheetRows.push(`<row r="${r}" spans="1:${width}">${cells}</row>`)
  })
  const lastRef = `${columnName(width - 1)}${rows.length + 1}`
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastRef}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="${width}" width="25.7109375" customWidth="1"/></cols><sheetData>${sheetRows.join("")}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${stringCount}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join("")}</sst>`

  const CFB = XLSX.CFB as {
    utils: { cfb_new: () => unknown; cfb_add: (container: unknown, path: string, content: Buffer) => void }
    write: (container: unknown, options: { fileType: "zip"; type: "buffer"; compression: boolean }) => Buffer
  }
  const zip = CFB.utils.cfb_new()
  const parts: Array<[string, string]> = [
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", ROOT_RELS],
    ["xl/workbook.xml", WORKBOOK],
    ["xl/_rels/workbook.xml.rels", WORKBOOK_RELS],
    ["xl/styles.xml", STYLES],
    ["xl/sharedStrings.xml", sharedStrings],
    ["xl/worksheets/sheet1.xml", sheet],
  ]
  for (const [path, content] of parts) CFB.utils.cfb_add(zip, path, Buffer.from(content, "utf8"))
  return CFB.write(zip, { fileType: "zip", type: "buffer", compression: true })
}
