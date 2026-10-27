import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { supplyCostLines, type Incoming, type IncomingExpense, type IncomingItem, type IncomingLog } from "@/components/analytics/supplier-incomings-data"
import type { SupplyPaymentsResult } from "@/components/analytics/supplier-payments-data"
import { listSupplyPayments, paidBySupply } from "@/lib/cash/supplier-payments"
import { ensureCashSchema } from "@/lib/cash/schema"
import { nowLocalIso, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import {
  catalogIndex,
  findShortages,
  lockWarehouseStock,
  resolveLine,
  shortageMessage,
  warehouseStock,
  type CatalogIndex,
} from "@/lib/internal-transfers-stock"
import { claimInvoiceForIncoming, ensureInvoiceIncomingsSchema } from "@/lib/invoice-incomings-link"
import { ensureRepricingsSchema } from "@/lib/repricings-read"
import { availableByKey } from "@/lib/repricings-items"
import { createRepricingTx } from "@/lib/repricings-repo"
import { getItemCosts } from "@/lib/stock/costs"
import type { SupplierIncomingBody, IncomingExpenseBody } from "@/lib/supplier-incomings-api"
import {
  currencyRates,
  ensureProcurementFunctions,
  fieldError,
  findBranch,
  findCurrency,
  findOrganization,
  findSupplier,
  findWarehouse,
  isPlaceholder,
  MAX_MONEY,
  MAX_QTY,
  nameKey,
  ProcurementError,
  rateToBase,
  tableColumns,
} from "@/lib/supplier-refs"

// Supplier incomings ("Приход от поставщиков"). A supply is created
// "ожидает", is accepted onto the warehouse ("принят") or cancelled
// ("отменен"); acceptance can be undone while the warehouse still holds the
// goods. Accepted supplies drive stock and the products' net cost.
//
// Documents reference the catalog by name: supplier, warehouse, branch,
// organization, currency and every product must exist (canonical spelling is
// stored); dates are stored as YYYY-MM-DD. On acceptance the supply currency's
// rate is frozen in rate_to_base (contract 2); every additional expense keeps the
// rate of its own currency at its creation. products.cost / Формирование цен read
// the one cost of goods (lib/stock/costs.ts, contract 1).

declare global {
  // V3: + rate_to_base, money columns DOUBLE PRECISION, ISO dates.
  var __linkoIncomingsSchemaReadyV3: Promise<void> | undefined
  var __linkoProductCostsResyncV1: Promise<void> | undefined
}

const ISO_DAY_RE = "'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'"

async function installSchema(): Promise<void> {
  // fin_ts() / fin_key() for the date migration below.
  await ensureProcurementFunctions(getDb())
  await withTransaction(async (tx) => {
    // Several dev-server workers may race on the DDL; the lock serialises them.
    await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:supplier_incomings:schema'))")
    await tx.exec(`
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SUM';
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS invoice_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS accepted_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS accepted_by TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS invoice_id INTEGER;
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS rate_to_base DOUBLE PRECISION;
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS ref_items TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS initial_cost DOUBLE PRECISION;

      CREATE TABLE IF NOT EXISTS supplier_incoming_expenses (
        id SERIAL PRIMARY KEY,
        incoming_id INTEGER NOT NULL REFERENCES supplier_incomings(id) ON DELETE CASCADE,
        date TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'SUM',
        payment_type TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        rate_to_base DOUBLE PRECISION,
        transaction_id INTEGER
      );
      ALTER TABLE supplier_incoming_expenses ADD COLUMN IF NOT EXISTS rate_to_base DOUBLE PRECISION;
      -- Link to the cash entry that paid the expense (the cash core also adds it before writing).
      ALTER TABLE supplier_incoming_expenses ADD COLUMN IF NOT EXISTS transaction_id INTEGER;

      CREATE TABLE IF NOT EXISTS supplier_incoming_logs (
        id SERIAL PRIMARY KEY,
        incoming_id INTEGER NOT NULL REFERENCES supplier_incomings(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );

      -- Money columns were REAL (float4, ~7 significant digits): widen them once;
      -- the supply amount is recomputed from its lines (the float4 copy was rounded).
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT c.table_name, c.column_name FROM information_schema.columns c
                 WHERE c.table_schema = current_schema() AND c.data_type = 'real'
                   AND (c.table_name, c.column_name) IN (('supplier_incomings', 'amount'), ('supplier_incomings', 'paid'),
                                                         ('supplier_incoming_expenses', 'amount'), ('products', 'initial_cost'))
        LOOP
          EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE double precision', r.table_name, r.column_name);
          IF r.table_name = 'supplier_incomings' AND r.column_name = 'amount' THEN
            UPDATE supplier_incomings i SET amount = t.total
              FROM (SELECT x.id, SUM(CASE WHEN jsonb_typeof(e -> 'qty') = 'number' AND jsonb_typeof(e -> 'cost') = 'number'
                                          THEN (e ->> 'qty')::double precision * (e ->> 'cost')::double precision END) AS total
                      FROM supplier_incomings x
                      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN pg_input_is_valid(x.items, 'jsonb')
                        THEN CASE WHEN jsonb_typeof(x.items::jsonb) = 'array' THEN x.items::jsonb END END) e
                     GROUP BY x.id
                    HAVING bool_and(jsonb_typeof(e -> 'qty') = 'number' AND jsonb_typeof(e -> 'cost') = 'number')) t
             WHERE t.id = i.id AND abs(i.amount - t.total) <= greatest(1, abs(t.total) * 1e-6);
          END IF;
        END LOOP;
      END $$;

      -- Dates were free text ("19 октября 2026"): store YYYY-MM-DD.
      UPDATE supplier_incomings SET date = to_char(fin_ts(date), 'YYYY-MM-DD')
       WHERE date !~ ${ISO_DAY_RE} AND fin_ts(date) IS NOT NULL;
      UPDATE supplier_incomings SET invoice_date = to_char(fin_ts(invoice_date), 'YYYY-MM-DD')
       WHERE invoice_date <> '' AND invoice_date !~ ${ISO_DAY_RE} AND fin_ts(invoice_date) IS NOT NULL;
      UPDATE supplier_incoming_expenses SET date = to_char(fin_ts(date), 'YYYY-MM-DD')
       WHERE date !~ ${ISO_DAY_RE} AND fin_ts(date) IS NOT NULL;
    `)
  })
}

async function ensureSchema() {
  if (!globalThis.__linkoIncomingsSchemaReadyV3) {
    globalThis.__linkoIncomingsSchemaReadyV3 = installSchema().catch((error) => {
      globalThis.__linkoIncomingsSchemaReadyV3 = undefined
      throw error
    })
  }
  await globalThis.__linkoIncomingsSchemaReadyV3
}

/** For other modules reading the incoming tables (invoices, production stock). Call before any transaction. */
export async function ensureIncomingsSchema() {
  await ensureSchema()
}

async function incomingsDb(): Promise<PgDb> {
  const db = getDb()
  await ensureSchema()
  // "Оплачено" reads supplier_payments (cash core columns); installing that schema
  // here, before any transaction below, keeps its DDL out of locked sections.
  await ensureCashSchema(db)
  // products.cost was a currency-mixing average of supplies: bring every product to
  // the one cost of goods once per process (afterwards each event refreshes it).
  if (!globalThis.__linkoProductCostsResyncV1) {
    globalThis.__linkoProductCostsResyncV1 = refreshProductCosts(null).catch((error) => {
      console.error("[supplier-incomings] products.cost resync failed", error)
    })
  }
  await globalThis.__linkoProductCostsResyncV1
  return db
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type Row = {
  id: number
  supplier: string
  warehouse: string
  date: string
  payment_type: string
  contract_number: string
  amount: number
  status: string
  invoice_number: string
  organization: string
  branch: string
  phone: string
  email: string
  initiator: string
  paid: number
  time: string
  comment: string
  items: string
  /** Lines of the reference's own supplies, shown in the detail card only: the stock ledger reads `items`, and the reference stock is already in its balance rows. */
  ref_items?: string
  currency: string
  invoice_date: string
  accepted_at: string
  accepted_by: string
  rate_to_base: number | null
}

type ExpenseSum = { incoming_id: number; currency: string; rate_to_base: number | null; amount: number }

type Rates = Awaited<ReturnType<typeof currencyRates>>

function parseItems(value: string): IncomingItem[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as IncomingItem[]) : []
  } catch {
    return []
  }
}

const positive = (value: unknown): number | null => {
  const number = Number(value)
  return value !== null && value !== undefined && Number.isFinite(number) && number > 0 ? number : null
}

/** Base units per 1 unit of the supply currency: the acceptance snapshot, else the
 * live rate, else 1 (the stock ledger's rule for an unknown rate). */
function supplyRate(row: Pick<Row, "rate_to_base" | "currency">, rates: Rates): number {
  return positive(row.rate_to_base) ?? rates.rateOf(row.currency) ?? 1
}

function rowToIncoming(row: Row, expenses: ExpenseSum[], rates: Rates): Incoming {
  const rate = supplyRate(row, rates)
  // Each expense at its own snapshot (else live) rate, as the stock ledger values it.
  const expensesBase = expenses.reduce((sum, expense) => {
    const expenseRate = positive(expense.rate_to_base) ?? rates.rateOf(expense.currency?.trim() ? expense.currency : row.currency) ?? 1
    return sum + (Number(expense.amount) || 0) * expenseRate
  }, 0)
  return {
    id: row.id,
    supplier: row.supplier,
    warehouse: row.warehouse,
    date: row.date,
    // Older demo rows say "Наличные"; the reference prints "Наличный" (uz "Naqd") for every cash delivery.
    paymentType: (/^нал/i.test(row.payment_type) ? "Наличный" : row.payment_type) as Incoming["paymentType"],
    contractNumber: row.contract_number,
    amount: Number(row.amount) || 0,
    status: row.status as Incoming["status"],
    invoiceNumber: row.invoice_number,
    organization: row.organization,
    branch: row.branch,
    phone: row.phone,
    email: row.email,
    initiator: row.initiator,
    paid: Number(row.paid) || 0,
    time: row.time,
    comment: row.comment,
    items: parseItems(row.items).length ? parseItems(row.items) : parseItems(row.ref_items ?? "[]"),
    currency: row.currency || "SUM",
    invoiceDate: row.invoice_date,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    expensesTotal: round6(expensesBase / rate),
    expensesBase: round6(expensesBase),
    rateToBase: positive(row.rate_to_base),
  }
}

function round6(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Supplies matching `where` (SQL over alias i, named params), with their expenses converted. */
async function loadIncomings(db: PgDb, where: string, params: Record<string, unknown>, order = "ORDER BY i.id DESC"): Promise<Incoming[]> {
  // The db shim binds a lone object argument even without @names, so pass none then.
  const statement = db.prepare(`SELECT i.* FROM supplier_incomings i ${where} ${order}`)
  const rows = (await (Object.keys(params).length ? statement.all(params) : statement.all())) as Row[]
  if (!rows.length) return []
  const sums = (await db
    .prepare(
      `SELECT incoming_id, currency, rate_to_base, SUM(amount)::float8 AS amount
         FROM supplier_incoming_expenses WHERE incoming_id = ANY(@ids::int[]) GROUP BY 1, 2, 3`,
    )
    .all({ ids: rows.map((row) => row.id) })) as ExpenseSum[]
  const byIncoming = new Map<number, ExpenseSum[]>()
  for (const sum of sums) byIncoming.set(sum.incoming_id, [...(byIncoming.get(sum.incoming_id) ?? []), sum])
  const rates = await currencyRates(db)
  return rows.map((row) => rowToIncoming(row, byIncoming.get(row.id) ?? [], rates))
}

async function addLog(db: PgDb, incomingId: number, action: string, userName: string, details = "") {
  await db
    .prepare("INSERT INTO supplier_incoming_logs (incoming_id, action, details, user_name, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(incomingId, action, details, userName, new Date().toISOString())
}

/** "Оплачено" = live verified supplier payments linked to the supply (cash page «Расход»
 * with a supply), in the supply currency; the legacy `paid` column is not read. */
function withPaid(incoming: Incoming, paid: Map<number, number>): Incoming {
  return { ...incoming, paid: paid.get(incoming.id) ?? 0 }
}

export async function listIncomings(): Promise<Incoming[]> {
  const db = await incomingsDb()
  const branch = await selectedBranchName()
  // Demo receipts that exist only to keep the stock consistent are not part of the list (reference shows the real ones).
  const hasRegistry = ((await db.prepare("SELECT to_regclass('demo_seed_rows') AS t").get()) as { t: string | null }).t
  const hideDemo = hasRegistry ? ` AND NOT EXISTS (SELECT 1 FROM demo_seed_rows d WHERE d.table_name = 'supplier_incomings' AND d.row_id = i.id::text)` : ""
  const rows = await loadIncomings(db, `WHERE (@branch::text = '' OR i.branch = @branch::text)${hideDemo}`, { branch })
  const paid = await paidBySupply(null, db)
  return rows.map((row) => withPaid(row, paid))
}

export async function getIncoming(id: number, db?: PgDb): Promise<Incoming | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return null
  const executor = db ?? (await incomingsDb())
  const [row] = await loadIncomings(executor, "WHERE i.id = @id", { id })
  return row ? withPaid(row, await paidBySupply([id], executor)) : null
}

async function incomingExists(db: PgDb, id: number): Promise<boolean> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return false
  return Boolean(await db.prepare("SELECT 1 AS hit FROM supplier_incomings WHERE id = ?").get(id))
}

/** "Список оплат по поставке №N" (supply card «Оплачено» link); null = no such supply. */
export async function listIncomingPayments(id: number): Promise<SupplyPaymentsResult | null> {
  const db = await incomingsDb()
  return listSupplyPayments(id, db)
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type IncomingInput = {
  supplier: string
  warehouse: string
  branch: string
  organization: string
  paymentType: Incoming["paymentType"]
  currency: string
  /** As entered; normalised to YYYY-MM-DD on write. */
  date: string
  contractNumber: string
  invoiceNumber: string
  invoiceDate: string
  comment: string
  items: Array<IncomingItem & { key?: string }>
  /** Incoming e-invoice the supply is created from ("Создать приход"); create only. */
  invoiceId: number | null
}

/** The validated body (supplierIncomingSchema) as a document draft; the references are
 * resolved against the catalog on write (resolveIncoming). */
export function parseIncomingInput(body: SupplierIncomingBody): IncomingInput {
  return {
    supplier: body.supplier.trim(),
    warehouse: body.warehouse.trim(),
    branch: body.branch?.trim() ?? "",
    organization: body.organization?.trim() ?? "",
    paymentType: body.paymentType ?? "Банковский счет",
    currency: body.currency?.trim() ?? "",
    date: body.date?.trim() ?? "",
    contractNumber: body.contractNumber?.trim() ?? "",
    invoiceNumber: body.invoiceNumber?.trim() ?? "",
    invoiceDate: body.invoiceDate?.trim() ?? "",
    comment: body.comment ?? "",
    invoiceId: body.invoiceId ?? null,
    items: body.items.map((item, index) => {
      const id = Number(item.id)
      return {
        id: Number.isInteger(id) && id > 0 ? id : index + 1,
        key: item.key?.trim() || undefined,
        product: item.product.trim(),
        expiry: item.expiry ?? "",
        qty: item.qty,
        block: item.block ?? 0,
        kg: item.kg ?? 0,
        netWeight: item.netWeight ?? 0,
        cost: item.cost,
        total: round6(item.qty * item.cost),
      }
    }),
  }
}

type Resolved = { input: IncomingInput; supplierId: number }

/** Resolves every reference of the draft (canonical names, ISO dates); throws a 400
 * ProcurementError with all field errors when something is unknown. */
async function resolveIncoming(tx: PgDb, input: IncomingInput, index: CatalogIndex): Promise<Resolved> {
  const fields: Record<string, string> = {}
  const supplier = await findSupplier(tx, input.supplier)
  if (!supplier) fields.supplier = "Поставщик не найден"
  const warehouse = await findWarehouse(tx, input.warehouse)
  if (!warehouse) fields.warehouse = "Склад не найден"
  let branch = input.branch
  if (!isPlaceholder(branch)) {
    const found = await findBranch(tx, branch)
    if (found) branch = found.name
    else fields.branch = "Филиал не найден"
  }
  let organization = input.organization
  if (!isPlaceholder(organization)) {
    const found = await findOrganization(tx, organization)
    if (found) organization = found.name
    else fields.organization = "Организация не найдена"
  }
  const currency = await findCurrency(tx, input.currency || null)
  if (!currency) fields.currency = "Неизвестная валюта"
  const date = input.date ? parseAnyDay(input.date) : todayIso()
  if (!date) fields.date = "Неверная дата"
  const invoiceDate = input.invoiceDate ? parseAnyDay(input.invoiceDate) : ""
  if (invoiceDate === null) fields.invoiceDate = "Неверная дата"
  const items = input.items.map((item, position) => {
    const line = resolveLine(index, { key: item.key, product: item.product })
    if (!line.item) fields[`items.${position}.product`] = "Товар не найден в каталоге"
    const rest = { ...item }
    delete rest.key
    return { ...rest, product: line.item ? line.item.name : item.product }
  })
  const messages = Object.values(fields)
  if (messages.length) throw new ProcurementError(messages[0], 400, fields)
  return {
    supplierId: supplier!.id,
    input: {
      ...input,
      supplier: supplier!.name,
      warehouse: warehouse!.name,
      branch,
      organization,
      currency: currency!.code,
      date: date!,
      invoiceDate: invoiceDate ?? "",
      items,
    },
  }
}

function amountOf(input: IncomingInput) {
  return round6(input.items.reduce((sum, item) => sum + item.qty * item.cost, 0))
}

/** Phone / e-mail shown on the supply come from the supplier's first contact. */
async function supplierContact(db: PgDb, supplierId: number) {
  const row = (await db.prepare("SELECT contacts FROM suppliers WHERE id = ?").get(supplierId)) as { contacts: string } | undefined
  try {
    const contact = (JSON.parse(row?.contacts ?? "[]") as Array<{ phone?: string; email?: string }>)[0]
    return { phone: contact?.phone?.trim() || "Не указан", email: contact?.email?.trim() || "Не указан" }
  } catch {
    return { phone: "Не указан", email: "Не указан" }
  }
}

/** "2026-10-19 14:05": the supply day with the local (Asia/Tashkent) clock time. */
const timeLabel = (day: string) => `${day} ${nowLocalIso().slice(11, 16)}`

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Throws InvoiceLinkError when `input.invoiceId` is not an accepted invoice without a supply,
 * ProcurementError (400) for unknown references. */
export async function createIncoming(draft: IncomingInput, userName: string): Promise<Incoming> {
  await incomingsDb()
  if (draft.invoiceId) await ensureInvoiceIncomingsSchema()
  return withTransaction(async (tx) => {
    // Same lock as the warehouse rename / stock documents: the name cannot change under us.
    await lockWarehouseStock(tx, [draft.warehouse])
    const { input, supplierId } = await resolveIncoming(tx, draft, await catalogIndex(tx))
    const contact = await supplierContact(tx, supplierId)
    const invoice = input.invoiceId ? await claimInvoiceForIncoming(tx, input.invoiceId) : null
    const result = await tx
      .prepare(
        `INSERT INTO supplier_incomings (
          supplier, warehouse, date, payment_type, contract_number, amount, status, invoice_number,
          organization, branch, phone, email, initiator, paid, time, comment, items, currency, invoice_date, invoice_id, updated_at
        ) VALUES (
          @supplier, @warehouse, @date, @paymentType, @contractNumber, @amount, 'ожидает', @invoiceNumber,
          @organization, @branch, @phone, @email, @initiator, 0, @time, @comment, @items, @currency, @invoiceDate, @invoiceId, datetime('now')
        )`,
      )
      .run({
        supplier: input.supplier,
        warehouse: input.warehouse,
        date: input.date,
        paymentType: input.paymentType,
        contractNumber: input.contractNumber,
        amount: amountOf(input),
        invoiceNumber: input.invoiceNumber,
        organization: input.organization,
        branch: input.branch,
        phone: contact.phone,
        email: contact.email,
        initiator: userName,
        time: timeLabel(input.date),
        comment: input.comment,
        items: JSON.stringify(input.items),
        currency: input.currency,
        invoiceDate: input.invoiceDate,
        invoiceId: invoice?.id ?? null,
      })
    await addLog(tx, result.lastInsertRowid, "created", userName, invoice ? `Счет-фактура № ${invoice.number}` : "")
    return (await getIncoming(result.lastInsertRowid, tx))!
  })
}

export type IncomingChange = Incoming | "not_found" | "locked"

async function lockIncoming(db: PgDb, id: number): Promise<Incoming | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return null
  const row = (await db.prepare("SELECT id FROM supplier_incomings WHERE id = ? FOR UPDATE").get(id)) as { id: number } | undefined
  return row ? getIncoming(id, db) : null
}

/** Only a supply that hasn't reached the warehouse yet can be edited. */
export async function updateIncoming(id: number, draft: IncomingInput, userName: string): Promise<IncomingChange> {
  await incomingsDb()
  return withTransaction(async (tx) => {
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.status !== "ожидает") return "locked"
    await lockWarehouseStock(tx, [draft.warehouse])
    const { input, supplierId } = await resolveIncoming(tx, draft, await catalogIndex(tx))
    const contact = await supplierContact(tx, supplierId)
    await tx
      .prepare(
        `UPDATE supplier_incomings SET
           supplier = @supplier, warehouse = @warehouse, date = @date, payment_type = @paymentType,
           contract_number = @contractNumber, amount = @amount, invoice_number = @invoiceNumber,
           organization = @organization, branch = @branch, phone = @phone, email = @email, comment = @comment,
           items = @items, currency = @currency, invoice_date = @invoiceDate, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        supplier: input.supplier,
        warehouse: input.warehouse,
        date: input.date,
        paymentType: input.paymentType,
        contractNumber: input.contractNumber,
        amount: amountOf(input),
        invoiceNumber: input.invoiceNumber,
        organization: input.organization,
        branch: input.branch,
        phone: contact.phone,
        email: contact.email,
        comment: input.comment,
        items: JSON.stringify(input.items),
        currency: input.currency,
        invoiceDate: input.invoiceDate,
      })
    await addLog(tx, id, "updated", userName)
    return (await getIncoming(id, tx))!
  })
}

/** Hard delete of a supply that never reached the warehouse. Locked (FOR UPDATE) so a
 * concurrent acceptance either wins (→ "locked") or waits for the delete. A supply that
 * live payments point at is refused ("has_payments"). */
export async function deleteIncoming(id: number): Promise<"ok" | "not_found" | "locked" | "has_payments"> {
  await incomingsDb()
  return withTransaction(async (tx) => {
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.status === "принят") return "locked"
    const payments = (await tx
      .prepare("SELECT COUNT(*) AS n FROM supplier_payments WHERE supply_id = @id AND COALESCE(is_deleted, 0) = 0")
      .get({ id })) as { n: string | number } | undefined
    if (Number(payments?.n ?? 0) > 0) return "has_payments"
    await tx.prepare("DELETE FROM supplier_incomings WHERE id = ?").run(id)
    return "ok"
  })
}

export type StatusAction = "accept" | "unaccept" | "cancel"

const TRANSITIONS: Record<StatusAction, { from: Incoming["status"]; to: Incoming["status"] }> = {
  accept: { from: "ожидает", to: "принят" },
  unaccept: { from: "принят", to: "ожидает" },
  cancel: { from: "ожидает", to: "отменен" },
}

/** A supply may only reach the warehouse with sane lines of catalog items. */
async function assertAcceptable(tx: PgDb, current: Incoming, index: CatalogIndex) {
  const fields: Record<string, string> = {}
  if (!(await findSupplier(tx, current.supplier))) fields.supplier = "Поставщик не найден"
  if (!(await findWarehouse(tx, current.warehouse))) fields.warehouse = "Склад не найден"
  if (!current.items.length) fields.items = "Добавьте товары"
  current.items.forEach((item, position) => {
    const qty = Number(item.qty)
    const cost = Number(item.cost)
    if (!(Number.isFinite(qty) && qty > 0 && qty <= MAX_QTY)) fields[`items.${position}.qty`] = "Количество должно быть больше 0"
    if (!(Number.isFinite(cost) && cost >= 0 && cost <= MAX_MONEY)) fields[`items.${position}.cost`] = "Цена не может быть отрицательной"
    if (!resolveLine(index, { product: item.product }).item) fields[`items.${position}.product`] = "Товар не найден в каталоге"
  })
  const messages = Object.values(fields)
  if (messages.length) throw new ProcurementError(messages[0], 409, fields)
}

/** "Принять на склад" / "Отменить приемку" / "Отменить". Accepting puts the goods on the
 * warehouse at the supply currency's current rate (frozen in rate_to_base); undoing it is
 * refused while the warehouse no longer holds the goods (returned, moved, used, sold). */
export async function changeIncomingStatus(id: number, action: StatusAction, userName: string, acceptDate?: string): Promise<IncomingChange> {
  await incomingsDb()
  const transition = TRANSITIONS[action]
  let products: string[] = []
  const result = await withTransaction(async (tx): Promise<IncomingChange> => {
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.status !== transition.from) return "locked"
    if (action === "accept") {
      await lockWarehouseStock(tx, [current.warehouse])
      await assertAcceptable(tx, current, await catalogIndex(tx))
      const rate = await rateToBase(tx, current.currency)
      // The reference's "ПРИЕМКА ТОВАРА" dialog picks the acceptance day; the time of day is the current one.
      const acceptedAt = acceptDate && /^\d{4}-\d{2}-\d{2}$/.test(acceptDate) ? `${acceptDate}T${new Date().toISOString().slice(11)}` : new Date().toISOString()
      await tx
        .prepare("UPDATE supplier_incomings SET status = 'принят', accepted_at = @at, accepted_by = @by, rate_to_base = @rate, updated_at = datetime('now') WHERE id = @id")
        .run({ id, at: acceptedAt, by: userName, rate })
    } else if (action === "unaccept") {
      // The goods leave the warehouse again: it must still have them.
      await lockWarehouseStock(tx, [current.warehouse])
      const index = await catalogIndex(tx)
      // The stock core books the receipt on the earlier of the supply date and the acceptance.
      const days = [parseAnyDay(current.date), parseAnyDay(current.acceptedAt)].filter((value): value is string => Boolean(value)).sort()
      const day = days[0]
      const stock = await warehouseStock(current.warehouse, day, tx)
      const shortages = findShortages(
        current.items.map((item) => ({ product: item.product, quantity: Number(item.qty) || 0 })),
        index,
        stock,
      )
      if (shortages.length) throw new ProcurementError(`Не возможно отменить. ${shortageMessage(current.warehouse, shortages)}`, 409, undefined, { shortages })
      // A confirmed inventory counted the warehouse with the receipt: undoing it would break the count.
      if (day && (await countedByInventory(tx, current.warehouse, day, parseAnyDate(current.acceptedAt) ?? `${day}T00:00:00`))) {
        throw new ProcurementError("Отменение невозможно из-за связи с другими данными", 409, undefined, { reason: "inventory" })
      }
      await tx
        .prepare("UPDATE supplier_incomings SET status = 'ожидает', accepted_at = '', accepted_by = '', rate_to_base = NULL, updated_at = datetime('now') WHERE id = @id")
        .run({ id })
    } else {
      await tx.prepare("UPDATE supplier_incomings SET status = 'отменен', updated_at = datetime('now') WHERE id = @id").run({ id })
    }
    await addLog(tx, id, action === "accept" ? "accepted" : action === "unaccept" ? "unaccepted" : "cancelled", userName)
    products = current.items.map((item) => item.product)
    return (await getIncoming(id, tx))!
  })
  if (typeof result !== "string" && action !== "cancel") await refreshProductCostsByName(products)
  return result
}

/** A confirmed inventory of `warehouse` counted the stock WITH the receipt: confirmed at or
 * after the acceptance (local moment "YYYY-MM-DDTHH:mm:ss") and dated after the day the
 * receipt is booked on (or an end-of-day count of that day). Undoing the receipt would then
 * make the stock differ from the count. A count confirmed before the acceptance never saw
 * the goods, so it does not block the undo. Missing lazy columns are tolerated. */
async function countedByInventory(tx: PgDb, warehouse: string, day: string, moment: string): Promise<boolean> {
  const columns = (await tableColumns(tx, ["stock_inventories"])).get("stock_inventories")
  if (!columns?.has("inv_date") || !columns.has("status") || !columns.has("warehouse")) return false
  const sameDay = columns.has("for_day_end") ? " OR (fin_ts(inv_date)::date = @day::date AND COALESCE(for_day_end, 0) = 1)" : ""
  const stamps = [
    columns.has("confirmed_at") ? "fin_ts(NULLIF(btrim(confirmed_at), ''), true)" : null,
    columns.has("created_at") ? "fin_ts(created_at, true)" : null,
  ].filter(Boolean)
  // No usable timestamp: assume the count came after the receipt (refuse rather than corrupt).
  const confirmed = `COALESCE(${[...stamps, "'infinity'::timestamp"].join(", ")})`
  const row = await tx
    .prepare(
      `SELECT 1 AS hit FROM stock_inventories
        WHERE status = 'confirmed' AND fin_key(warehouse) = fin_key(@warehouse)
          AND (fin_ts(inv_date)::date > @day::date${sameDay})
          AND ${confirmed} >= fin_ts(@moment)
        LIMIT 1`,
    )
    .get({ warehouse, day, moment })
  return Boolean(row)
}

// ---------------------------------------------------------------------------
// Additional costs
// ---------------------------------------------------------------------------

type ExpenseRow = {
  id: number
  incoming_id: number
  date: string
  description: string
  amount: number
  currency: string
  payment_type: string
  created_by: string
  created_at: string
  rate_to_base: number | null
}

const toExpense = (row: ExpenseRow): IncomingExpense => ({
  id: row.id,
  incomingId: row.incoming_id,
  date: row.date,
  description: row.description,
  amount: Number(row.amount) || 0,
  currency: row.currency,
  paymentType: row.payment_type,
  createdBy: row.created_by,
  createdAt: row.created_at,
  rateToBase: positive(row.rate_to_base),
})

/** null = no such supply. */
export async function listIncomingExpenses(incomingId: number): Promise<IncomingExpense[] | null> {
  const db = await incomingsDb()
  if (!(await incomingExists(db, incomingId))) return null
  return ((await db.prepare("SELECT * FROM supplier_incoming_expenses WHERE incoming_id = ? ORDER BY id").all(incomingId)) as ExpenseRow[]).map(toExpense)
}

export type ExpenseInput = IncomingExpenseBody

/** "Добавить расход": the expense keeps the rate of its currency at creation (rate_to_base). */
export async function addIncomingExpense(incomingId: number, input: ExpenseInput, userName: string): Promise<IncomingChange> {
  await incomingsDb()
  let products: string[] = []
  const result = await withTransaction(async (tx): Promise<IncomingChange> => {
    const current = await lockIncoming(tx, incomingId)
    if (!current) return "not_found"
    if (current.status === "отменен") return "locked"
    const currency = await findCurrency(tx, input.currency || current.currency)
    if (!currency) throw fieldError("currency", "Неизвестная валюта")
    const rate = await rateToBase(tx, currency.code)
    const date = input.date ? parseAnyDay(input.date) : todayIso()
    if (!date) throw fieldError("date", "Неверная дата")
    const description = input.description.trim()
    await tx
      .prepare(
        `INSERT INTO supplier_incoming_expenses (incoming_id, date, description, amount, currency, payment_type, created_by, created_at, rate_to_base)
         VALUES (@incomingId, @date, @description, @amount, @currency, @paymentType, @createdBy, @createdAt, @rate)`,
      )
      .run({
        incomingId,
        date,
        description,
        amount: input.amount,
        currency: currency.code,
        paymentType: input.paymentType?.trim() ?? "",
        createdBy: userName,
        createdAt: new Date().toISOString(),
        rate,
      })
    await addLog(tx, incomingId, "expense_added", userName, `${description}: ${input.amount} ${currency.code}`)
    if (current.status === "принят") products = current.items.map((item) => item.product)
    return (await getIncoming(incomingId, tx))!
  })
  if (products.length) await refreshProductCostsByName(products)
  return result
}

export async function deleteIncomingExpense(incomingId: number, expenseId: number, userName: string): Promise<IncomingChange> {
  await incomingsDb()
  let products: string[] = []
  const result = await withTransaction(async (tx): Promise<IncomingChange> => {
    const current = await lockIncoming(tx, incomingId)
    if (!current) return "not_found"
    if (!Number.isInteger(expenseId) || expenseId <= 0 || expenseId > 2_147_483_647) return "not_found"
    const expense = (await tx.prepare("SELECT * FROM supplier_incoming_expenses WHERE id = ? AND incoming_id = ?").get(expenseId, incomingId)) as
      | ExpenseRow
      | undefined
    if (!expense) return "not_found"
    await tx.prepare("DELETE FROM supplier_incoming_expenses WHERE id = ?").run(expenseId)
    await addLog(tx, incomingId, "expense_deleted", userName, `${expense.description}: ${expense.amount} ${expense.currency}`)
    if (current.status === "принят") products = current.items.map((item) => item.product)
    return (await getIncoming(incomingId, tx))!
  })
  if (products.length) await refreshProductCostsByName(products)
  return result
}

// ---------------------------------------------------------------------------
// Net cost (contract 1: lib/stock/costs.ts is the one cost of goods)
// ---------------------------------------------------------------------------

/** Brings products.cost to the cost of goods (base currency, today) inside `tx`:
 * the initial ("по умолчанию") cost is frozen first, and the cost is reset to it so an
 * item never received falls back to it instead of a stale average. */
async function refreshProductCostsIn(tx: PgDb, ids: number[] | null): Promise<void> {
  const rows = (await (ids === null
    ? tx.prepare("SELECT id FROM products WHERE COALESCE(deleted, 0) = 0 ORDER BY id FOR UPDATE").all()
    : tx.prepare("SELECT id FROM products WHERE id = ANY(@ids::int[]) ORDER BY id FOR UPDATE").all({ ids }))) as Array<{ id: number }>
  const productIds = rows.map((row) => Number(row.id))
  if (!productIds.length) return
  await tx
    .prepare("UPDATE products SET initial_cost = COALESCE(initial_cost, cost), cost = COALESCE(initial_cost, cost) WHERE id = ANY(@ids::int[])")
    .run({ ids: productIds })
  const costs = await getItemCosts({}, tx)
  const values: number[] = []
  const targets: number[] = []
  for (const id of productIds) {
    const cost = costs.get(`product:${id}`)
    if (cost === undefined || !Number.isFinite(cost)) continue
    targets.push(id)
    values.push(round6(cost))
  }
  if (!targets.length) return
  await tx
    .prepare(
      `UPDATE products p SET cost = v.cost
         FROM unnest(@ids::int[], @costs::double precision[]) AS v(id, cost)
        WHERE p.id = v.id AND p.cost IS DISTINCT FROM v.cost`,
    )
    .run({ ids: targets, costs: values })
}

/** null = every live product (once-per-process resync). */
async function refreshProductCosts(ids: number[] | null): Promise<void> {
  if (ids !== null && !ids.length) return
  await withTransaction((tx) => refreshProductCostsIn(tx, ids))
}

/** After a supply's acceptance / expenses changed (committed): refresh its products.
 * products.cost is a cache of the cost of goods, so a failure is logged, not raised. */
async function refreshProductCostsByName(names: string[]): Promise<void> {
  try {
    const unique = Array.from(new Set(names.map((name) => String(name ?? "").trim()).filter((name) => nameKey(name))))
    if (!unique.length) return
    // The live product owning each name (fin_key), lowest id — the stock core's rule.
    const rows = (await getDb()
      .prepare(
        `SELECT DISTINCT ON (fin_key(name)) id FROM products
          WHERE fin_key(name) IN (SELECT fin_key(x) FROM unnest(@names::text[]) AS x) AND COALESCE(deleted, 0) = 0
          ORDER BY fin_key(name), id`,
      )
      .all({ names: unique })) as Array<{ id: number }>
    await refreshProductCosts(rows.map((row) => Number(row.id)))
  } catch (error) {
    console.error("[supplier-incomings] products.cost refresh failed", error)
  }
}

export type SupplyHistoryLine = { incomingId: number; date: string; acceptedAt: string; qty: number; unitCost: number; averageCost: number }

/** Accepted supplies of one product, oldest first, in the BASE currency (each supply at its
 * acceptance rate, each expense at its own rate, spread like the stock ledger does), with the
 * running quantity-weighted average after each of them. */
export async function productSupplyHistory(productName: string, db?: PgDb): Promise<SupplyHistoryLine[]> {
  const executor = db ?? (await incomingsDb())
  const lines = `COALESCE(CASE WHEN pg_input_is_valid(i.items, 'jsonb') THEN CASE WHEN jsonb_typeof(i.items::jsonb) = 'array' THEN i.items::jsonb END END, '[]'::jsonb)`
  const incomings = await loadIncomings(
    executor,
    `WHERE i.status = 'принят' AND EXISTS (SELECT 1 FROM jsonb_array_elements(${lines}) e WHERE fin_key(e ->> 'product') = fin_key(@name))`,
    { name: productName },
    "ORDER BY i.accepted_at, i.id",
  )
  const rates = await currencyRates(executor)
  const key = nameKey(productName)
  const history: SupplyHistoryLine[] = []
  let qty = 0
  let value = 0
  for (const incoming of incomings) {
    const rate = positive(incoming.rateToBase) ?? rates.rateOf(incoming.currency) ?? 1
    for (const line of supplyCostLines(incoming)) {
      if (nameKey(line.product) !== key || !(line.qty > 0)) continue
      const unitCost = line.unitCost * rate
      qty += line.qty
      value += line.qty * unitCost
      history.push({ incomingId: incoming.id, date: incoming.date, acceptedAt: incoming.acceptedAt, qty: line.qty, unitCost: round6(unitCost), averageCost: round6(value / qty) })
    }
  }
  return history
}

/** Running average cost per product (lower-cased name) over every accepted supply: the reference's "Себестоимость". */
export async function supplyAverageCosts(): Promise<Record<string, number>> {
  const db = await incomingsDb()
  const incomings = await loadIncomings(db, "WHERE i.status = 'принят'", {}, "ORDER BY i.accepted_at, i.id")
  const rates = await currencyRates(db)
  const totals = new Map<string, { qty: number; value: number }>()
  for (const incoming of incomings) {
    const rate = positive(incoming.rateToBase) ?? rates.rateOf(incoming.currency) ?? 1
    for (const line of supplyCostLines(incoming)) {
      if (!(line.qty > 0)) continue
      const key = line.product.trim().toLocaleLowerCase("ru")
      const current = totals.get(key) ?? { qty: 0, value: 0 }
      current.qty += line.qty
      current.value += line.qty * line.unitCost * rate
      totals.set(key, current)
    }
  }
  // A product that has the reference's own net cost (product_reference_prices) never falls back to the supply average.
  const hasReference = ((await db.prepare("SELECT to_regclass('product_reference_prices') AS t").get()) as { t: string | null }).t
  if (hasReference) {
    const referenced = (await db.prepare("SELECT lower(btrim(p.name)) AS k FROM products p JOIN product_reference_prices r ON r.product_id = p.id").all()) as { k: string }[]
    for (const { k } of referenced) totals.delete(k)
  }
  return Object.fromEntries([...totals].map(([key, total]) => [key, Math.round((total.value / total.qty) * 1e6) / 1e6]))
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

/** null = no such supply. */
export async function listIncomingLogs(incomingId: number): Promise<IncomingLog[] | null> {
  const db = await incomingsDb()
  if (!(await incomingExists(db, incomingId))) return null
  const rows = (await db.prepare("SELECT * FROM supplier_incoming_logs WHERE incoming_id = ? ORDER BY id DESC").all(incomingId)) as Array<{
    id: number
    action: string
    details: string
    user_name: string
    created_at: string
  }>
  return rows.map((row) => ({ id: row.id, action: row.action, details: row.details, userName: row.user_name, createdAt: row.created_at }))
}

// ---------------------------------------------------------------------------
// Наценка (repricing from a supply)
// ---------------------------------------------------------------------------

export type RepriceInput = { priceListId: number; currency: string; comment: string; prices: Array<{ product: string; price: number }> }

/** Writes the calculated selling prices into the chosen price list as one
 * finished repricing (Переоценка) document, so it can be viewed and cancelled
 * there like any other repricing. */
export async function repriceFromIncoming(incomingId: number, input: RepriceInput, userName: string): Promise<{ updated: number; missing: string[] } | "not_found" | "price_list_not_found"> {
  await incomingsDb()
  await ensureRepricingsSchema()
  const available = await availableByKey()
  return withTransaction(async (tx) => {
    const incoming = await lockIncoming(tx, incomingId)
    if (!incoming) return "not_found"
    const priceList = (await tx.prepare("SELECT id, name FROM price_lists WHERE id = ?").get(input.priceListId)) as { id: number; name: string } | undefined
    if (!priceList) return "price_list_not_found"
    const missing: string[] = []
    const products: Array<{ kind: "product"; id: number; price: number }> = []
    for (const line of input.prices) {
      if (!(line.price >= 0)) continue
      const product = (await tx.prepare("SELECT id FROM products WHERE fin_key(name) = fin_key(?) AND COALESCE(deleted, 0) = 0 ORDER BY id LIMIT 1").get(line.product)) as { id: number } | undefined
      if (product) products.push({ kind: "product", id: product.id, price: line.price })
      else missing.push(line.product)
    }
    if (products.length) {
      await createRepricingTx(tx, { priceListId: priceList.id, currency: input.currency, comment: input.comment, products, connected: false }, userName, available, "supplier_incoming")
    }
    await addLog(tx, incomingId, "repriced", userName, `${priceList.name}: ${products.length}${input.comment ? ` — ${input.comment}` : ""}`)
    return { updated: products.length, missing }
  })
}

// ---------------------------------------------------------------------------
// Формирование цен: a product's net cost
// ---------------------------------------------------------------------------

/** One supply line of the product detail ("Поставки"): accepted ones carry the running average cost. */
export type ProductSupplyLine = { incomingId: number; date: string; qty: number; onStock: number; unitCost: number; averageCost: number | null; accepted: boolean }

export type ProductCostInfo = { initialCost: number; currentCost: number; history: SupplyHistoryLine[]; lines: ProductSupplyLine[]; baseCurrency: string }

/** Every supply (accepted or waiting) that carries the product, newest first, like the reference panel. */
async function productSupplyLines(productName: string, db: PgDb, history: SupplyHistoryLine[]): Promise<ProductSupplyLine[]> {
  const incomings = await loadIncomings(
    db,
    "WHERE i.status IN ('принят', 'ожидает') AND i.items LIKE @pattern",
    { pattern: `%${JSON.stringify(productName).slice(1, -1)}%` },
    "ORDER BY i.id",
  )
  const rates = await currencyRates(db)
  const key = nameKey(productName)
  const onHand = (await availableByKey(db)).get(key) ?? 0
  const lines: ProductSupplyLine[] = []
  for (const incoming of incomings) {
    const rate = positive(incoming.rateToBase) ?? rates.rateOf(incoming.currency) ?? 1
    for (const line of supplyCostLines(incoming)) {
      if (nameKey(line.product) !== key || !(line.qty > 0)) continue
      const accepted = incoming.status === "принят"
      const average = accepted ? history.find((item) => item.incomingId === incoming.id)?.averageCost ?? null : null
      lines.push({ incomingId: incoming.id, date: accepted ? incoming.date : "", qty: line.qty, onStock: 0, unitCost: accepted ? round6(line.unitCost * rate) : 0, averageCost: average, accepted })
    }
  }
  // The stock on hand sits on the latest accepted supply (FIFO remainder), earlier batches are used up.
  const lastAccepted = [...lines].reverse().find((line) => line.accepted)
  if (lastAccepted) lastAccepted.onStock = onHand
  return lines.reverse()
}

/** Initial cost, accepted supplies (base currency) and the current cost of goods (contract 1). */
export async function getProductCostInfo(productId: number): Promise<ProductCostInfo | null> {
  if (!Number.isInteger(productId) || productId <= 0 || productId > 2_147_483_647) return null
  const db = await incomingsDb()
  const product = (await db.prepare("SELECT name, cost, initial_cost FROM products WHERE id = ?").get(productId)) as
    | { name: string; cost: number; initial_cost: number | null }
    | undefined
  if (!product) return null
  const [history, costs, rates] = await Promise.all([productSupplyHistory(product.name, db), getItemCosts({}, db), currencyRates(db)])
  const lines = await productSupplyLines(product.name, db, history)
  const current = costs.get(`product:${productId}`)
  return {
    initialCost: Number(product.initial_cost ?? product.cost) || 0,
    currentCost: round6(current !== undefined && Number.isFinite(current) ? current : Number(product.cost) || 0),
    history,
    lines,
    baseCurrency: rates.base,
  }
}

/** "Себестоимость по умолчанию": the cost used until the item is first received; the
 * current cost of goods is recalculated with it. */
export async function setProductInitialCost(productId: number, initialCost: number): Promise<ProductCostInfo | null> {
  if (!Number.isInteger(productId) || productId <= 0 || productId > 2_147_483_647) return null
  if (!(Number.isFinite(initialCost) && initialCost >= 0 && initialCost <= MAX_MONEY)) throw fieldError("initialCost", "Слишком большая цена")
  await incomingsDb()
  const found = await withTransaction(async (tx) => {
    const product = await tx.prepare("SELECT id FROM products WHERE id = ? FOR UPDATE").get(productId)
    if (!product) return false
    await tx.prepare("UPDATE products SET initial_cost = ? WHERE id = ?").run(initialCost, productId)
    await refreshProductCostsIn(tx, [productId])
    return true
  })
  return found ? getProductCostInfo(productId) : null
}

/** Cost of goods (contract 1, base currency, today) of every live product, for the
 * Формирование цен list. */
export async function listProductCosts(): Promise<{ baseCurrency: string; costs: Record<number, number> }> {
  const db = await incomingsDb()
  const [rows, costs, rates] = await Promise.all([
    db.prepare("SELECT id, cost FROM products WHERE COALESCE(deleted, 0) = 0").all() as Promise<Array<{ id: number; cost: number | null }>>,
    getItemCosts({}, db),
    currencyRates(db),
  ])
  const out: Record<number, number> = {}
  for (const row of rows) {
    const cost = costs.get(`product:${row.id}`)
    out[Number(row.id)] = round6(cost !== undefined && Number.isFinite(cost) ? cost : Number(row.cost) || 0)
  }
  return { baseCurrency: rates.base, costs: out }
}
