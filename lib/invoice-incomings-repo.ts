import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { docYearOk, parseDocInput } from "@/lib/document-dates"
import { loadCurrencyContext, type CurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { isIsoDay, parseAnyDate } from "@/lib/finance/dates"
import { ensureInvoiceIncomingsSchema, INVOICE_STATUS_SQL } from "@/lib/invoice-incomings-schema"
import {
  calcInvoiceLine,
  IKPU_PATTERN,
  INN_PATTERN,
  INVOICE_TABS,
  parseVatRate,
  roundTo,
  sumInvoiceLines,
  type InvoiceCurrencyTotal,
  type InvoiceDetail,
  type InvoiceImportIssue,
  type InvoiceImportPreviewInvoice,
  type InvoiceImportPreviewLine,
  type InvoiceImportResult,
  type InvoiceImportRow,
  type InvoiceInput,
  type InvoiceLine,
  type InvoiceLineInput,
  type InvoiceListQuery,
  type InvoiceListResult,
  type InvoiceMatch,
  type InvoiceRow,
  type InvoiceStatus,
  type InvoiceStatusAction,
  type InvoiceSupplyDraft,
  type InvoiceTab,
} from "@/lib/invoice-incomings-types"
import { ensureIncomingsSchema } from "@/lib/supplier-incomings-repo"
import { MAX_MONEY, MAX_QTY } from "@/lib/supplier-refs"

// "Входящие счет фактуры" — incoming e-invoices (ЭСФ) from suppliers, EDO-style
// (spec: scratchpad extra/spec-invoice-incomings.md; storage: lib/invoice-incomings-schema.ts).
// Demo: the menu item opens the separate Linko EDO product; here the list lives in-app,
// without any tax-service (Didox / soliq.uz) integration:
//   * pending ("Ожидает") → accept ("Принятые") or reject with a reason ("Отклоненные");
//     both can be returned to pending while no supply is linked;
//   * only a pending invoice can be edited; deleting is refused once a supply exists;
//   * an accepted invoice becomes a "Приход от поставщика" (supplier_incomings.invoice_id).

export class InvoiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
  ) {
    super(message)
  }
}

async function invoiceDb(): Promise<PgDb> {
  await ensureInvoiceIncomingsSchema()
  // supplier_incomings.invoice_id (the supply link) belongs to the supplier incomings schema.
  await ensureIncomingsSchema()
  return getDb()
}

// --- reading --------------------------------------------------------------------------------

type HeaderRow = {
  id: number
  document_number: string
  date: string
  contract_number: string
  contract_date: string
  supplier_id: number | null
  supplier: string
  supplier_inn: string
  supplier_catalog_name: string | null
  organization_id: number | null
  buyer_name: string
  buyer_inn: string
  organization_name: string | null
  currency: string
  amount_without_vat: number | null
  vat_amount: number | null
  total: number | null
  status: InvoiceStatus
  reject_reason: string
  status_changed_at: string
  status_changed_by: string
  note: string
  created_by: string
  created_at: string
  lines_count: string | number
  incoming_id: number | null
  incoming_status: string | null
}

const FROM_SQL = `FROM invoice_incomings i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN organizations o ON o.id = i.organization_id`

const TOTAL_SQL = "COALESCE(i.total_amount, i.amount)"
const VAT_SQL = "COALESCE(i.vat_amount, 0)"
const WITHOUT_VAT_SQL = `COALESCE(i.amount_without_vat, ${TOTAL_SQL} - ${VAT_SQL})`

const SELECT_SQL = `SELECT i.id, i.document_number, i.date, i.contract_number, i.contract_date,
    i.supplier_id, i.supplier, i.supplier_inn, s.name AS supplier_catalog_name,
    i.organization_id, i.buyer_name, i.buyer_inn, o.name AS organization_name, i.currency,
    ${WITHOUT_VAT_SQL} AS amount_without_vat, ${VAT_SQL} AS vat_amount, ${TOTAL_SQL} AS total,
    ${INVOICE_STATUS_SQL} AS status, i.reject_reason, i.status_changed_at, i.status_changed_by,
    i.note, i.created_by, i.created_at,
    (SELECT COUNT(*) FROM invoice_incoming_items it WHERE it.invoice_id = i.id) AS lines_count,
    si.id AS incoming_id, si.status AS incoming_status
  ${FROM_SQL}
  LEFT JOIN LATERAL (SELECT x.id, x.status FROM supplier_incomings x WHERE x.invoice_id = i.id ORDER BY x.id DESC LIMIT 1) si ON TRUE`

/** created_at / status_changed_at are datetime('now') UTC text → local ISO. */
const localStamp = (value: string) => (value ? (parseAnyDate(value, true) ?? value) : "")

function toRow(row: HeaderRow): InvoiceRow {
  return {
    id: row.id,
    number: row.document_number,
    date: row.date,
    contractNumber: row.contract_number,
    contractDate: row.contract_date,
    supplierId: row.supplier_id,
    supplierName: row.supplier,
    supplierInn: row.supplier_inn,
    supplierCatalogName: row.supplier_catalog_name ?? "",
    organizationId: row.organization_id,
    buyerName: row.buyer_name,
    buyerInn: row.buyer_inn,
    organizationName: row.organization_name ?? "",
    currency: normCurrency(row.currency),
    amountWithoutVat: roundTo(Number(row.amount_without_vat) || 0),
    vatAmount: roundTo(Number(row.vat_amount) || 0),
    total: roundTo(Number(row.total) || 0),
    status: row.status,
    rejectReason: row.reject_reason,
    statusChangedAt: localStamp(row.status_changed_at),
    statusChangedBy: row.status_changed_by,
    comment: row.note,
    createdBy: row.created_by,
    createdAt: localStamp(row.created_at),
    linesCount: Number(row.lines_count) || 0,
    incoming: row.incoming_id ? { id: row.incoming_id, status: row.incoming_status ?? "" } : null,
  }
}

type LineRow = {
  id: number
  position: number
  name: string
  ikpu: string
  unit: string
  quantity: number
  price: number
  amount: number
  vat_rate: number | null
  vat_amount: number
  total: number
  product_id: number | null
  raw_material_id: number | null
  product_name: string | null
  raw_material_name: string | null
}

function toLine(row: LineRow): InvoiceLine {
  let match: InvoiceMatch | null = null
  if (row.product_id && row.product_name !== null) match = { kind: "product", id: row.product_id, name: row.product_name }
  else if (row.raw_material_id && row.raw_material_name !== null) match = { kind: "raw_material", id: row.raw_material_id, name: row.raw_material_name }
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    ikpu: row.ikpu,
    unit: row.unit,
    quantity: Number(row.quantity) || 0,
    price: Number(row.price) || 0,
    amount: Number(row.amount) || 0,
    vatRate: row.vat_rate === null ? null : Number(row.vat_rate),
    vatAmount: Number(row.vat_amount) || 0,
    total: Number(row.total) || 0,
    match,
  }
}

async function readLines(db: PgDb, invoiceId: number): Promise<InvoiceLine[]> {
  const rows = (await db
    .prepare(
      `SELECT it.*, p.name AS product_name, r.name AS raw_material_name
       FROM invoice_incoming_items it
       LEFT JOIN products p ON p.id = it.product_id
       LEFT JOIN raw_materials r ON r.id = it.raw_material_id
       WHERE it.invoice_id = ? ORDER BY it.position, it.id`,
    )
    .all(invoiceId)) as LineRow[]
  return rows.map(toLine)
}

async function readInvoice(db: PgDb, id: number): Promise<InvoiceDetail | null> {
  const row = (await db.prepare(`${SELECT_SQL} WHERE i.id = ?`).get(id)) as HeaderRow | undefined
  if (!row) return null
  return { ...toRow(row), lines: await readLines(db, id) }
}

export async function getInvoice(id: number): Promise<InvoiceDetail | null> {
  return readInvoice(await invoiceDb(), id)
}

function likeTerm(value: string) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/** WHERE of the list; `withTab` = false for the per-tab counters. */
function listWhere(query: InvoiceListQuery, withTab: boolean): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (withTab && query.tab !== "all") {
    clauses.push(`${INVOICE_STATUS_SQL} = ?`)
    params.push(query.tab)
  }
  if (query.search) {
    const term = likeTerm(query.search)
    clauses.push("(i.document_number ILIKE ? OR i.supplier ILIKE ? OR i.supplier_inn ILIKE ? OR s.name ILIKE ? OR i.contract_number ILIKE ? OR i.buyer_inn ILIKE ?)")
    params.push(term, term, term, term, term, term)
  }
  if (query.fromDate) {
    clauses.push("i.date >= ?")
    params.push(query.fromDate)
  }
  if (query.toDate) {
    clauses.push("i.date <= ?")
    params.push(query.toDate)
  }
  if (query.supplierIds.length) {
    clauses.push("i.supplier_id = ANY(?::int[])")
    params.push(query.supplierIds)
  }
  if (query.organizationIds.length) {
    clauses.push("i.organization_id = ANY(?::int[])")
    params.push(query.organizationIds)
  }
  if (query.currencies.length) {
    clauses.push("upper(i.currency) = ANY(?::text[])")
    params.push(query.currencies.map((code) => normCurrency(code)))
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params }
}

export async function listInvoices(query: InvoiceListQuery): Promise<InvoiceListResult> {
  const db = await invoiceDb()
  const where = listWhere(query, true)
  const paging = query.pageSize > 0 ? ` LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}` : ""
  const rows = (await db.prepare(`${SELECT_SQL} ${where.sql} ORDER BY i.date DESC, i.id DESC${paging}`).all(...where.params)) as HeaderRow[]

  const totalRows = (await db
    .prepare(
      `SELECT upper(i.currency) AS currency, COUNT(*) AS count, SUM(${WITHOUT_VAT_SQL}) AS amount_without_vat,
         SUM(${VAT_SQL}) AS vat_amount, SUM(${TOTAL_SQL}) AS total
       ${FROM_SQL} ${where.sql} GROUP BY upper(i.currency) ORDER BY 2 DESC`,
    )
    .all(...where.params)) as Array<{ currency: string; count: string; amount_without_vat: number; vat_amount: number; total: number }>
  const merged = new Map<string, InvoiceCurrencyTotal>()
  for (const row of totalRows) {
    const code = normCurrency(row.currency)
    const current = merged.get(code) ?? { currency: code, count: 0, amountWithoutVat: 0, vatAmount: 0, total: 0 }
    current.count += Number(row.count) || 0
    current.amountWithoutVat = roundTo(current.amountWithoutVat + (Number(row.amount_without_vat) || 0))
    current.vatAmount = roundTo(current.vatAmount + (Number(row.vat_amount) || 0))
    current.total = roundTo(current.total + (Number(row.total) || 0))
    merged.set(code, current)
  }

  const tabWhere = listWhere(query, false)
  const tabRows = (await db.prepare(`SELECT ${INVOICE_STATUS_SQL} AS status, COUNT(*) AS count ${FROM_SQL} ${tabWhere.sql} GROUP BY 1`).all(...tabWhere.params)) as Array<{
    status: InvoiceStatus
    count: string
  }>
  const tabCounts = Object.fromEntries(INVOICE_TABS.map((tab) => [tab, 0])) as Record<InvoiceTab, number>
  for (const row of tabRows) {
    tabCounts[row.status] += Number(row.count) || 0
    tabCounts.all += Number(row.count) || 0
  }

  const totals = [...merged.values()]
  return {
    results: rows.map(toRow),
    count: totals.reduce((sum, total) => sum + total.count, 0),
    page: query.page,
    pageSize: query.pageSize,
    totals,
    tabCounts,
  }
}

// --- validation -----------------------------------------------------------------------------

type CleanLine = InvoiceLineInput & { amount: number; vatAmount: number; total: number }
type CleanInvoice = Omit<InvoiceInput, "lines"> & { lines: CleanLine[]; amountWithoutVat: number; vatAmount: number; total: number }

async function catalogExists(db: PgDb, match: { kind: string; id: number }): Promise<boolean> {
  const table = match.kind === "raw_material" ? "raw_materials" : "products"
  return Boolean(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(match.id))
}

/** The invoice currency: a code of Валюты (the supply made from the invoice — "Создать приход" —
 * accepts only those, lib/supplier-refs.ts findCurrency); empty = the base currency. An edit may
 * keep the code the invoice already has. null = not a configured currency. */
async function invoiceCurrency(db: PgDb, value: string, context: CurrencyContext, excludeId: number | null = null): Promise<string | null> {
  const code = normCurrency(value, context.base)
  if (context.currencies.some((item) => item.code === code)) return code
  if (!excludeId) return null
  const own = (await db.prepare("SELECT currency FROM invoice_incomings WHERE id = ?").get(excludeId)) as { currency: string | null } | undefined
  return own && normCurrency(own.currency, context.base) === code ? code : null
}

/** Normalises and validates a manual / imported invoice (throws InvoiceError with the field). */
async function cleanInvoice(db: PgDb, input: InvoiceInput, excludeId: number | null): Promise<CleanInvoice> {
  const number = input.number.trim()
  if (!number) throw new InvoiceError("Укажите номер счет-фактуры", 400, "number")
  if (!isIsoDay(input.date)) throw new InvoiceError("Укажите дату счет-фактуры", 400, "date")
  // Every document date has a year within 2000..2100 (lib/document-dates.ts).
  if (!docYearOk(input.date)) throw new InvoiceError("Неверная дата счет-фактуры", 400, "date")
  const contractDate = input.contractDate.trim()
  if (contractDate && !(isIsoDay(contractDate) && docYearOk(contractDate))) throw new InvoiceError("Неверная дата договора", 400, "contractDate")

  let supplierName = input.supplierName.trim()
  if (input.supplierId) {
    const supplier = (await db.prepare("SELECT name FROM suppliers WHERE id = ?").get(input.supplierId)) as { name: string } | undefined
    if (!supplier) throw new InvoiceError("Поставщик не найден", 400, "supplierId")
    supplierName ||= supplier.name
  }
  if (!supplierName) throw new InvoiceError("Укажите поставщика", 400, "supplierName")
  const supplierInn = input.supplierInn.trim()
  if (supplierInn && !INN_PATTERN.test(supplierInn)) throw new InvoiceError("ИНН должен содержать 9 или 14 цифр", 400, "supplierInn")

  let buyerName = input.buyerName.trim()
  if (input.organizationId) {
    const organization = (await db.prepare("SELECT name FROM organizations WHERE id = ?").get(input.organizationId)) as { name: string } | undefined
    if (!organization) throw new InvoiceError("Организация не найдена", 400, "organizationId")
    buyerName ||= organization.name
  }
  const buyerInn = input.buyerInn.trim()
  if (buyerInn && !INN_PATTERN.test(buyerInn)) throw new InvoiceError("ИНН должен содержать 9 или 14 цифр", 400, "buyerInn")

  const currency = await invoiceCurrency(db, input.currency, await loadCurrencyContext(db), excludeId)
  if (!currency) throw new InvoiceError("Неверная валюта", 400, "currency")

  if (!input.lines.length) throw new InvoiceError("Добавьте хотя бы одну строку", 400, "lines")
  const lines: CleanLine[] = []
  for (const [index, line] of input.lines.entries()) {
    const field = `lines.${index}`
    const name = line.name.trim()
    if (!name) throw new InvoiceError("Укажите наименование товара", 400, `${field}.name`)
    const ikpu = line.ikpu.trim()
    if (ikpu && !IKPU_PATTERN.test(ikpu)) throw new InvoiceError("ИКПУ должен содержать 17 цифр", 400, `${field}.ikpu`)
    if (!(line.quantity > 0)) throw new InvoiceError("Количество должно быть больше нуля", 400, `${field}.quantity`)
    if (!(line.quantity <= MAX_QTY)) throw new InvoiceError("Слишком большое количество", 400, `${field}.quantity`)
    if (!(line.price >= 0)) throw new InvoiceError("Неверная цена", 400, `${field}.price`)
    if (!(line.price <= MAX_MONEY && line.quantity * line.price <= MAX_MONEY)) throw new InvoiceError("Слишком большая цена", 400, `${field}.price`)
    if (line.vatRate !== null && !(line.vatRate >= 0 && line.vatRate <= 100)) throw new InvoiceError("Неверная ставка НДС", 400, `${field}.vatRate`)
    if (line.match && !(await catalogExists(db, line.match))) throw new InvoiceError("Товар из каталога не найден", 400, `${field}.match`)
    lines.push({ ...line, name, ikpu, unit: line.unit.trim(), ...calcInvoiceLine(line.quantity, line.price, line.vatRate) })
  }

  const duplicate = (await db
    .prepare(
      `SELECT id FROM invoice_incomings
       WHERE lower(trim(document_number)) = lower(?) AND date = ?
         AND (CASE WHEN ? <> '' THEN supplier_inn = ? ELSE lower(trim(supplier)) = lower(?) END)
         AND id <> ? LIMIT 1`,
    )
    .get(number, input.date, supplierInn, supplierInn, supplierName, excludeId ?? 0)) as { id: number } | undefined
  if (duplicate) throw new InvoiceError("Счет-фактура с таким номером и датой от этого поставщика уже есть", 409, "number")

  return {
    ...input,
    number,
    contractNumber: input.contractNumber.trim(),
    contractDate,
    supplierName,
    supplierInn,
    buyerName,
    buyerInn,
    currency,
    comment: input.comment.trim(),
    lines,
    ...sumInvoiceLines(lines),
  }
}

// --- writing --------------------------------------------------------------------------------

async function writeLines(tx: PgDb, invoiceId: number, lines: CleanLine[]) {
  await tx.prepare("DELETE FROM invoice_incoming_items WHERE invoice_id = ?").run(invoiceId)
  for (const [index, line] of lines.entries()) {
    await tx
      .prepare(
        `INSERT INTO invoice_incoming_items (invoice_id, position, name, ikpu, unit, quantity, price, amount, vat_rate, vat_amount, total, product_id, raw_material_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        invoiceId,
        index + 1,
        line.name,
        line.ikpu,
        line.unit,
        line.quantity,
        line.price,
        line.amount,
        line.vatRate,
        line.vatAmount,
        line.total,
        line.match?.kind === "product" ? line.match.id : null,
        line.match?.kind === "raw_material" ? line.match.id : null,
      )
  }
}

function headerValues(invoice: CleanInvoice) {
  return [
    invoice.number,
    invoice.date,
    invoice.contractNumber,
    invoice.contractDate,
    invoice.supplierId,
    invoice.supplierName,
    invoice.supplierInn,
    invoice.organizationId,
    invoice.buyerName,
    invoice.buyerInn,
    invoice.currency,
    invoice.amountWithoutVat,
    invoice.vatAmount,
    invoice.total,
    invoice.total,
    invoice.comment,
  ]
}

async function insertInvoice(tx: PgDb, invoice: CleanInvoice, userName: string): Promise<number> {
  const result = await tx
    .prepare(
      `INSERT INTO invoice_incomings (document_number, date, contract_number, contract_date, supplier_id, supplier, supplier_inn,
         organization_id, buyer_name, buyer_inn, currency, amount_without_vat, vat_amount, total_amount, amount, note, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(...headerValues(invoice), userName)
  await writeLines(tx, result.lastInsertRowid, invoice.lines)
  return result.lastInsertRowid
}

export async function createInvoice(input: InvoiceInput, userName: string): Promise<InvoiceDetail> {
  const db = await invoiceDb()
  const id = await withTransaction(async (tx) => insertInvoice(tx, await cleanInvoice(tx, input, null), userName))
  return (await readInvoice(db, id))!
}

type LockedInvoice = { id: number; status: InvoiceStatus; incomingId: number | null }

async function lockInvoice(tx: PgDb, id: number): Promise<LockedInvoice | null> {
  const row = (await tx.prepare(`SELECT i.id, ${INVOICE_STATUS_SQL} AS status FROM invoice_incomings i WHERE i.id = ? FOR UPDATE`).get(id)) as
    | { id: number; status: InvoiceStatus }
    | undefined
  if (!row) return null
  const linked = (await tx.prepare("SELECT id FROM supplier_incomings WHERE invoice_id = ? ORDER BY id DESC LIMIT 1").get(id)) as { id: number } | undefined
  return { id: row.id, status: row.status, incomingId: linked?.id ?? null }
}

export async function updateInvoice(id: number, input: InvoiceInput): Promise<InvoiceDetail> {
  const db = await invoiceDb()
  await withTransaction(async (tx) => {
    const current = await lockInvoice(tx, id)
    if (!current) throw new InvoiceError("Счет-фактура не найдена", 404)
    if (current.status !== "pending") throw new InvoiceError("Изменить можно только счет-фактуру в статусе «Ожидает»", 409)
    const invoice = await cleanInvoice(tx, input, id)
    await tx
      .prepare(
        `UPDATE invoice_incomings SET document_number = ?, date = ?, contract_number = ?, contract_date = ?, supplier_id = ?, supplier = ?,
           supplier_inn = ?, organization_id = ?, buyer_name = ?, buyer_inn = ?, currency = ?, amount_without_vat = ?, vat_amount = ?,
           total_amount = ?, amount = ?, note = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(...headerValues(invoice), id)
    await writeLines(tx, id, invoice.lines)
  })
  return (await readInvoice(db, id))!
}

export async function deleteInvoice(id: number): Promise<void> {
  await invoiceDb()
  await withTransaction(async (tx) => {
    const current = await lockInvoice(tx, id)
    if (!current) throw new InvoiceError("Счет-фактура не найдена", 404)
    if (current.incomingId) throw new InvoiceError("Нельзя удалить счет-фактуру: по ней создан приход", 409)
    await tx.prepare("DELETE FROM invoice_incoming_items WHERE invoice_id = ?").run(id)
    await tx.prepare("DELETE FROM invoice_incomings WHERE id = ?").run(id)
  })
}

const TRANSITIONS: Record<InvoiceStatusAction, { from: InvoiceStatus[]; to: InvoiceStatus }> = {
  accept: { from: ["pending"], to: "accepted" },
  reject: { from: ["pending"], to: "rejected" },
  reset: { from: ["accepted", "rejected"], to: "pending" },
}

/** "Принять" / "Отклонить" (reason required) / "Вернуть в ожидание". */
export async function changeInvoiceStatus(id: number, action: InvoiceStatusAction, reason: string, userName: string): Promise<InvoiceDetail> {
  const db = await invoiceDb()
  const transition = TRANSITIONS[action]
  await withTransaction(async (tx) => {
    const current = await lockInvoice(tx, id)
    if (!current) throw new InvoiceError("Счет-фактура не найдена", 404)
    if (!transition.from.includes(current.status)) throw new InvoiceError("Статус счет-фактуры уже изменен", 409)
    if (current.incomingId) throw new InvoiceError("По счет-фактуре создан приход — статус изменить нельзя", 409)
    const rejectReason = action === "reject" ? reason.trim() : ""
    if (action === "reject" && !rejectReason) throw new InvoiceError("Укажите причину отклонения", 400, "reason")
    await tx
      .prepare(
        `UPDATE invoice_incomings SET status = ?, reject_reason = ?, status_changed_at = datetime('now'), status_changed_by = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(transition.to, rejectReason, action === "reset" ? "" : userName, id)
  })
  return (await readInvoice(db, id))!
}

// --- matching -------------------------------------------------------------------------------

type CatalogItem = { kind: "product" | "raw_material"; id: number; name: string; ikpu: string }

async function loadCatalog(db: PgDb): Promise<{ byIkpu: Map<string, CatalogItem>; byName: Map<string, CatalogItem> }> {
  const products = (await db.prepare("SELECT id, name, ikpu FROM products WHERE COALESCE(deleted, 0) = 0 ORDER BY id").all()) as Array<{ id: number; name: string; ikpu: string | null }>
  const raw = (await db.prepare("SELECT id, name, ikpu FROM raw_materials r WHERE COALESCE(to_jsonb(r)->>'deleted', '0') = '0' ORDER BY id").all()) as Array<{ id: number; name: string; ikpu: string | null }>
  const items: CatalogItem[] = [
    ...products.map((row) => ({ kind: "product" as const, id: row.id, name: row.name, ikpu: (row.ikpu ?? "").trim() })),
    ...raw.map((row) => ({ kind: "raw_material" as const, id: row.id, name: row.name, ikpu: (row.ikpu ?? "").trim() })),
  ]
  const byIkpu = new Map<string, CatalogItem>()
  const byName = new Map<string, CatalogItem>()
  for (const item of items) {
    if (item.ikpu && !byIkpu.has(item.ikpu)) byIkpu.set(item.ikpu, item)
    const key = nameKey(item.name)
    if (key && !byName.has(key)) byName.set(key, item)
  }
  return { byIkpu, byName }
}

function nameKey(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ")
}

/** Supplier / organization of an imported invoice: by INN from earlier invoices, else by name. */
async function matchParty(db: PgDb, kind: "supplier" | "organization", inn: string, name: string): Promise<{ id: number; name: string } | null> {
  const table = kind === "supplier" ? "suppliers" : "organizations"
  const innColumn = kind === "supplier" ? "supplier_inn" : "buyer_inn"
  const idColumn = kind === "supplier" ? "supplier_id" : "organization_id"
  if (inn) {
    const row = (await db
      .prepare(`SELECT t.id, t.name FROM invoice_incomings i JOIN ${table} t ON t.id = i.${idColumn} WHERE i.${innColumn} = ? ORDER BY i.id DESC LIMIT 1`)
      .get(inn)) as { id: number; name: string } | undefined
    if (row) return row
  }
  if (name) {
    const row = (await db.prepare(`SELECT id, name FROM ${table} WHERE lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1`).get(name)) as
      | { id: number; name: string }
      | undefined
    if (row) return row
  }
  return null
}

// --- Excel import ---------------------------------------------------------------------------

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

/** "2026-10-13", "13.10.2026", "13/10/2026" or an Excel serial day (46308) → ISO day. */
function parseImportDay(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const date = new Date(EXCEL_EPOCH + Math.floor(Number(text)) * 86_400_000)
    return date.toISOString().slice(0, 10)
  }
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text)
  if (slash) {
    const iso = `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`
    return isIsoDay(iso) ? iso : null
  }
  return parseDocInput(text)?.slice(0, 10) ?? null
}

function parseImportNumber(value: string | undefined): number | null {
  const text = String(value ?? "").replace(/[\s ]/g, "").replace(",", ".")
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

const HEADER_FIELDS = ["number", "date", "contractNumber", "contractDate", "supplierInn", "supplierName", "buyerInn", "buyerName", "currency", "comment"] as const

/** Groups the rows into invoices (a new one starts at a new number or supplier; blank
 * header cells repeat the invoice above), validates and matches everything; creates the
 * invoices only when `commit` and nothing has an error. */
export async function importInvoices(rows: Array<InvoiceImportRow & { row: number }>, commit: boolean, userName: string): Promise<InvoiceImportResult> {
  const db = await invoiceDb()
  const catalog = await loadCatalog(db)
  type Group = { row: number; header: Record<(typeof HEADER_FIELDS)[number], string>; lines: Array<InvoiceImportRow & { row: number }> }
  const groups: Group[] = []
  for (const source of rows) {
    const value = (field: keyof InvoiceImportRow) => String(source[field] ?? "").trim()
    const hasLine = ["name", "ikpu", "quantity", "price"].some((field) => value(field as keyof InvoiceImportRow))
    const hasHeader = HEADER_FIELDS.some((field) => value(field))
    if (!hasLine && !hasHeader) continue
    const current = groups[groups.length - 1]
    const startsNew =
      !current ||
      (value("number") && value("number") !== current.header.number) ||
      (value("supplierInn") && value("supplierInn") !== current.header.supplierInn) ||
      (!value("supplierInn") && value("supplierName") && !current.header.supplierInn && value("supplierName") !== current.header.supplierName)
    const group: Group = startsNew
      ? { row: source.row, header: Object.fromEntries(HEADER_FIELDS.map((field) => [field, ""])) as Group["header"], lines: [] }
      : current
    if (startsNew) groups.push(group)
    for (const field of HEADER_FIELDS) if (value(field) && !group.header[field]) group.header[field] = value(field)
    if (hasLine) group.lines.push(source)
  }

  const invoices: InvoiceImportPreviewInvoice[] = []
  const seen = new Set<string>()
  const currencies = await loadCurrencyContext(db)
  for (const group of groups) {
    const header = group.header
    const errors: InvoiceImportIssue[] = []
    const issue = (field: string, error: string, row = group.row) => errors.push({ row, field, error })
    const parsedDate = parseImportDay(header.date)
    // Every document date has a year within 2000..2100 (lib/document-dates.ts).
    const date = parsedDate && docYearOk(parsedDate) ? parsedDate : null
    if (!header.number) issue("number", "Укажите номер счет-фактуры")
    if (!date) issue("date", header.date ? "Неверная дата счет-фактуры" : "Укажите дату счет-фактуры")
    const parsedContractDate = header.contractDate ? parseImportDay(header.contractDate) : ""
    const contractDate = parsedContractDate && !docYearOk(parsedContractDate) ? null : parsedContractDate
    if (contractDate === null) issue("contractDate", "Неверная дата договора")
    if (!header.supplierName && !header.supplierInn) issue("supplierName", "Укажите поставщика")
    if (header.supplierInn && !INN_PATTERN.test(header.supplierInn)) issue("supplierInn", "ИНН должен содержать 9 или 14 цифр")
    if (header.buyerInn && !INN_PATTERN.test(header.buyerInn)) issue("buyerInn", "ИНН должен содержать 9 или 14 цифр")
    const known = await invoiceCurrency(db, header.currency, currencies)
    if (!known) issue("currency", "Неизвестная валюта")
    const currency = known ?? normCurrency(header.currency, currencies.base)
    const supplierMatch = await matchParty(db, "supplier", header.supplierInn, header.supplierName)
    const organizationMatch = await matchParty(db, "organization", header.buyerInn, header.buyerName)
    const supplierName = header.supplierName || supplierMatch?.name || ""
    if (!supplierName && header.supplierInn) issue("supplierName", "Укажите поставщика")

    if (header.number && date) {
      const key = `${header.number.toLowerCase()}|${date}|${header.supplierInn || supplierName.toLowerCase()}`
      if (seen.has(key)) issue("number", "Счет-фактура повторяется в файле")
      seen.add(key)
      const duplicate = await db
        .prepare(
          `SELECT id FROM invoice_incomings WHERE lower(trim(document_number)) = lower(?) AND date = ?
             AND (CASE WHEN ? <> '' THEN supplier_inn = ? ELSE lower(trim(supplier)) = lower(?) END) LIMIT 1`,
        )
        .get(header.number, date, header.supplierInn, header.supplierInn, supplierName)
      if (duplicate) issue("number", "Счет-фактура с таким номером и датой от этого поставщика уже есть")
    }

    const lines: InvoiceImportPreviewLine[] = group.lines.map((source) => {
      const lineErrors: InvoiceImportIssue[] = []
      const lineIssue = (field: string, error: string) => lineErrors.push({ row: source.row, field, error })
      const name = String(source.name ?? "").trim()
      const ikpu = String(source.ikpu ?? "").replace(/\s/g, "")
      const quantity = parseImportNumber(source.quantity)
      const price = parseImportNumber(source.price)
      const vatRate = parseVatRate(source.vatRate ?? "")
      if (!name) lineIssue("name", "Укажите наименование товара")
      if (ikpu && !IKPU_PATTERN.test(ikpu)) lineIssue("ikpu", "ИКПУ должен содержать 17 цифр")
      if (quantity === null || !(quantity > 0)) lineIssue("quantity", "Количество должно быть больше нуля")
      else if (!(quantity <= MAX_QTY)) lineIssue("quantity", "Слишком большое количество")
      if (price === null || !(price >= 0)) lineIssue("price", "Неверная цена")
      else if (!(price <= MAX_MONEY && (quantity ?? 0) * price <= MAX_MONEY)) lineIssue("price", "Слишком большая цена")
      if (vatRate === undefined) lineIssue("vatRate", "Неверная ставка НДС")
      const rate = vatRate === undefined ? null : vatRate
      const item = (ikpu && catalog.byIkpu.get(ikpu)) || (name ? catalog.byName.get(nameKey(name)) : undefined)
      return {
        row: source.row,
        name,
        ikpu,
        unit: String(source.unit ?? "").trim(),
        quantity: quantity ?? 0,
        price: price ?? 0,
        vatRate: rate,
        ...calcInvoiceLine(quantity ?? 0, price ?? 0, rate),
        match: item ? { kind: item.kind, id: item.id, name: item.name } : null,
        errors: lineErrors,
      }
    })
    if (!lines.length) issue("lines", "Нет строк с товарами")

    invoices.push({
      row: group.row,
      number: header.number,
      date: date ?? header.date,
      contractNumber: header.contractNumber,
      contractDate: contractDate || header.contractDate,
      supplierName,
      supplierInn: header.supplierInn,
      supplierMatch,
      buyerName: header.buyerName || organizationMatch?.name || "",
      buyerInn: header.buyerInn,
      organizationMatch,
      currency,
      comment: header.comment,
      ...sumInvoiceLines(lines),
      lines,
      errors,
    })
  }

  const errorsCount = invoices.reduce((sum, invoice) => sum + invoice.errors.length + invoice.lines.reduce((count, line) => count + line.errors.length, 0), 0)
  const created: number[] = []
  if (commit && invoices.length && !errorsCount) {
    await withTransaction(async (tx) => {
      for (const invoice of invoices) {
        const input: InvoiceInput = {
          number: invoice.number,
          date: invoice.date,
          contractNumber: invoice.contractNumber,
          contractDate: invoice.contractDate,
          supplierId: invoice.supplierMatch?.id ?? null,
          supplierName: invoice.supplierName,
          supplierInn: invoice.supplierInn,
          organizationId: invoice.organizationMatch?.id ?? null,
          buyerName: invoice.buyerName,
          buyerInn: invoice.buyerInn,
          currency: invoice.currency,
          comment: invoice.comment,
          lines: invoice.lines.map((line) => ({
            name: line.name,
            ikpu: line.ikpu,
            unit: line.unit,
            quantity: line.quantity,
            price: line.price,
            vatRate: line.vatRate,
            match: line.match ? { kind: line.match.kind, id: line.match.id } : null,
          })),
        }
        created.push(await insertInvoice(tx, await cleanInvoice(tx, input, null), userName))
      }
    })
  }
  return { invoices, errorsCount, created }
}

// --- "Создать приход" --------------------------------------------------------------------------

/** Prefill of the supplier incoming created from an accepted invoice. */
export async function getSupplyDraft(id: number): Promise<InvoiceSupplyDraft> {
  const db = await invoiceDb()
  const invoice = await readInvoice(db, id)
  if (!invoice) throw new InvoiceError("Счет-фактура не найдена", 404)
  if (invoice.status !== "accepted") throw new InvoiceError("Приход можно создать только из принятой счет-фактуры", 409)
  if (invoice.incoming) throw new InvoiceError("По этой счет-фактуре уже создан приход", 409)
  return {
    invoiceId: invoice.id,
    number: invoice.number,
    date: invoice.date,
    contractNumber: invoice.contractNumber,
    supplier: invoice.supplierCatalogName || invoice.supplierName,
    supplierMatched: Boolean(invoice.supplierCatalogName),
    organization: invoice.organizationName || invoice.buyerName,
    organizationMatched: Boolean(invoice.organizationName),
    currency: invoice.currency,
    total: invoice.total,
    lines: invoice.lines.map((line) => ({
      position: line.position,
      name: line.name,
      ikpu: line.ikpu,
      unit: line.unit,
      quantity: line.quantity,
      cost: line.quantity > 0 ? roundTo(line.total / line.quantity, 6) : 0,
      product: line.match?.name ?? "",
    })),
  }
}
