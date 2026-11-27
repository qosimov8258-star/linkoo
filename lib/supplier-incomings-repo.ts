import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { INCOMING_STATUS_CODE, supplyCostLines, type Incoming, type IncomingExpense, type IncomingItem, type IncomingLog } from "@/components/analytics/supplier-incomings-data"
import type { SupplyPaymentsResult } from "@/components/analytics/supplier-payments-data"
import { listSupplyPayments, paidBySupply } from "@/lib/cash/supplier-payments"
import { lockSupplyPayments } from "@/lib/cash/common"
import { ensureCashSchema } from "@/lib/cash/schema"
import { parseDocDay, type DocDate } from "@/lib/document-dates"
import { formatMoney } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import {
  catalogIndex,
  countedByInventory,
  documentKeys,
  findShortages,
  findWarehouse,
  lockNamedWarehouse,
  lockWarehousesOf,
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
import { getItemCosts, latestScopeCosts, loadCostLedger, refreshProductCostCache } from "@/lib/stock/costs"
import { loadStockCatalog } from "@/lib/stock/catalog"
import { ensureStockSchema } from "@/lib/stock/schema"
import { notifySafely } from "@/lib/notify-event"
import type { SupplierIncomingBody, IncomingExpenseBody } from "@/lib/supplier-incomings-api"
import { ensureUserNotificationsSchema, notifyTemplate } from "@/lib/user-notifications-repo"
import {
  currencyRates,
  ensureProcurementFunctions,
  fieldError,
  findBranch,
  findCurrency,
  findOrganization,
  findSupplier,
  isPlaceholder,
  MAX_MONEY,
  MAX_QTY,
  nameKey,
  ProcurementError,
  rateToBase,
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
  // V3: + rate_to_base, money columns DOUBLE PRECISION, ISO dates. V4: + invoice comment, expected dates,
  // inventory / confirmed flags, log status and event day. V5: + linko_paid, expense distribution type / supplier flag.
  var __linkoIncomingsSchemaReadyV5: Promise<void> | undefined
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
      -- Copied from Linko (scripts/linko-sync/import-supplies.mjs) and kept on a fresh database too.
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS is_inventory INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS is_confirmed INTEGER NOT NULL DEFAULT 1;
      -- «Изменить детали счет фактуры» (invoice_number / invoice_date above) and the expected dates of the form.
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS invoice_comment TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS will_be_sent_out_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS will_come_to_post_date TEXT NOT NULL DEFAULT '';
      -- Linko's «Оплачено» of a supply copied from it (its total_paid, from Linko's own debt allocation); NULL for a
      -- supply entered here.
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS linko_paid DOUBLE PRECISION;
      -- Of a supply copied from Linko (scripts/linko-sync/import-supply-refs.mjs): the supplier's contact person, which
      -- the list's search matches, and the ids of its warehouse, branch and organization, which the list's filter and
      -- search use as Linko's do (names may repeat). An edit that changes the name drops the id.
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS contact_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS warehouse_id INTEGER;
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS branch_id INTEGER;
      ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS organization_id INTEGER;
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
      -- «Тип распределения» (Linko's distribute_type: cost / weight / capacity / manual) and «Привязан к поставщику».
      ALTER TABLE supplier_incoming_expenses ADD COLUMN IF NOT EXISTS distribute_type TEXT NOT NULL DEFAULT 'cost';
      ALTER TABLE supplier_incoming_expenses ADD COLUMN IF NOT EXISTS bind_to_provider INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS supplier_incoming_logs (
        id SERIAL PRIMARY KEY,
        incoming_id INTEGER NOT NULL REFERENCES supplier_incomings(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
      -- The supply's status code when the entry was written (INCOMING_STATUS_CODE) and the day of a
      -- «Добавить лог» event (sent_out / come_to_post).
      ALTER TABLE supplier_incoming_logs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_incoming_logs ADD COLUMN IF NOT EXISTS event_date TEXT NOT NULL DEFAULT '';

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
  if (!globalThis.__linkoIncomingsSchemaReadyV5) {
    globalThis.__linkoIncomingsSchemaReadyV5 = outsideTransaction(installSchema).catch((error) => {
      globalThis.__linkoIncomingsSchemaReadyV5 = undefined
      throw error
    })
  }
  await globalThis.__linkoIncomingsSchemaReadyV5
}

/** For other modules reading the incoming tables (invoices, production stock). Call before any transaction. */
export async function ensureIncomingsSchema() {
  await ensureSchema()
}

async function incomingsDb(): Promise<PgDb> {
  const db = getDb()
  await ensureSchema()
  // "Оплачено" reads supplier_payments (cash core columns); installing that schema
  // here, before any transaction below, keeps its DDL out of locked sections — and so
  // for the stock core's (read by the unaccept check).
  await ensureCashSchema(db)
  await ensureStockSchema()
  // products.cost was a currency-mixing average of supplies: bring every product to
  // the one cost of goods once per process (afterwards each event refreshes it).
  if (!globalThis.__linkoProductCostsResyncV1) {
    globalThis.__linkoProductCostsResyncV1 = outsideTransaction(() => refreshProductCosts(null)).catch((error) => {
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
  currency: string
  invoice_date: string
  accepted_at: string
  accepted_by: string
  rate_to_base: number | null
  is_inventory?: number | null
  is_confirmed?: number | null
  linko_paid?: number | null
  invoice_comment?: string | null
  will_be_sent_out_date?: string | null
  will_come_to_post_date?: string | null
  supplier_id?: number | null
  contact_name?: string | null
  warehouse_id?: number | null
  branch_id?: number | null
  organization_id?: number | null
  created_at?: string | null
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

function rowToIncoming(row: Row, expenses: ExpenseSum[], rates: Rates, createdDay = ""): Incoming {
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
    // Older rows say "Наличные"; the reference prints "Наличный" (uz "Naqd") for every cash delivery.
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
    items: parseItems(row.items),
    currency: row.currency || "SUM",
    invoiceDate: row.invoice_date,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    expensesTotal: round6(expensesBase / rate),
    expensesBase: round6(expensesBase),
    rateToBase: positive(row.rate_to_base),
    isInventory: Number(row.is_inventory) === 1,
    isConfirmed: row.is_confirmed == null || Number(row.is_confirmed) !== 0,
    invoiceComment: row.invoice_comment ?? "",
    expectedFactoryExit: row.will_be_sent_out_date ?? "",
    expectedCustomsArrival: row.will_come_to_post_date ?? "",
    supplierId: row.supplier_id ?? null,
    createdDay: createdDay || parseAnyDay(row.created_at) || parseAnyDay(row.date) || "",
    contactName: row.contact_name ?? "",
    warehouseId: row.warehouse_id ?? null,
    branchId: row.branch_id ?? null,
    organizationId: row.organization_id ?? null,
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
  // Linko's «Дата создания» filter (begin_date / end_date) compares the day of the last «Изменить», else the day the
  // supply was created: status changes, expenses and «Добавить лог» do not move it.
  const stamps = (await db
    .prepare(
      `SELECT incoming_id, MAX(created_at) FILTER (WHERE action = 'updated') AS updated, MIN(created_at) FILTER (WHERE action = 'created') AS created
         FROM supplier_incoming_logs WHERE incoming_id = ANY(@ids::int[]) GROUP BY 1`,
    )
    .all({ ids: rows.map((row) => row.id) })) as Array<{ incoming_id: number; updated: string | null; created: string | null }>
  const createdDays = new Map(stamps.map((stamp) => [stamp.incoming_id, parseAnyDay(stamp.updated) || parseAnyDay(stamp.created) || ""]))
  const rates = await currencyRates(db)
  return rows.map((row) => rowToIncoming(row, byIncoming.get(row.id) ?? [], rates, createdDays.get(row.id)))
}

/** A history entry (Логи). `status` is the supply's status when it was written — before the change for a status
 * action, as Linko records it ("arrived" carries «Ожидает»). */
async function addLog(db: PgDb, incomingId: number, action: string, userName: string, details = "", status: Incoming["status"] | "" = "", eventDate = "") {
  await db
    .prepare("INSERT INTO supplier_incoming_logs (incoming_id, action, details, user_name, created_at, status, event_date) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(incomingId, action, details, userName, new Date().toISOString(), status ? INCOMING_STATUS_CODE[status] : "", eventDate)
}

/** Supplier payments copied from Linko (registered by scripts/linko-sync); none on a database without the registry. */
async function linkoCopiedPayments(db: PgDb): Promise<number[]> {
  const registry = (await db.prepare("SELECT to_regclass('linko_sync_rows') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!registry?.ok) return []
  const rows = (await db
    .prepare(
      `SELECT DISTINCT r.row_id::int AS id FROM linko_sync_rows r
        WHERE r.table_name = 'supplier_payments' AND r.action IN ('insert', 'update') AND r.row_id ~ '^[0-9]+$'`,
    )
    .all()) as Array<{ id: number }>
  return rows.map((row) => row.id)
}

/** "Оплачено": live verified supplier payments linked to the supply (cash page «Расход» with a supply), in the supply
 * currency. A supply copied from Linko starts from Linko's own figure (linko_paid: Linko allocates payments over a
 * supplier's debts, so a payment naming the supply may pay another one) and adds only the payments entered here since. */
async function paidFor(db: PgDb, rows: Incoming[], linkoPaid: Map<number, number>, ids: number[] | null): Promise<Incoming[]> {
  const all = await paidBySupply(ids, db)
  const copied = rows.some((row) => linkoPaid.has(row.id)) ? await linkoCopiedPayments(db) : []
  const since = copied.length ? await paidBySupply(ids, db, copied) : all
  return rows.map((row) => {
    const base = linkoPaid.get(row.id)
    return { ...row, paid: base === undefined ? (all.get(row.id) ?? 0) : round6(base + (since.get(row.id) ?? 0)) }
  })
}

async function linkoPaidOf(db: PgDb, ids: number[] | null): Promise<Map<number, number>> {
  const rows = (await db
    .prepare("SELECT id, linko_paid FROM supplier_incomings WHERE linko_paid IS NOT NULL AND (@all::boolean OR id = ANY(@ids::int[]))")
    .all({ all: ids === null, ids: ids ?? [] })) as Array<{ id: number; linko_paid: number }>
  return new Map(rows.map((row) => [Number(row.id), Number(row.linko_paid) || 0]))
}

export async function listIncomings(): Promise<Incoming[]> {
  const db = await incomingsDb()
  const branch = await selectedBranchName()
  // Every supply of the selected branch (all of them without one): only what this company entered.
  const rows = await loadIncomings(db, "WHERE (@branch::text = '' OR i.branch = @branch::text)", { branch })
  return paidFor(db, rows, await linkoPaidOf(db, null), null)
}

export async function getIncoming(id: number, db?: PgDb): Promise<Incoming | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return null
  const executor = db ?? (await incomingsDb())
  const [row] = await loadIncomings(executor, "WHERE i.id = @id", { id })
  return row ? (await paidFor(executor, [row], await linkoPaidOf(executor, [id]), [id]))[0] : null
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
  /** «Ожидаемый выход с завода» / «Ожидаемое прибытие в таможню»: as entered, YYYY-MM-DD on write. */
  expectedFactoryExit: string
  expectedCustomsArrival: string
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
    expectedFactoryExit: body.expectedFactoryExit?.trim() ?? "",
    expectedCustomsArrival: body.expectedCustomsArrival?.trim() ?? "",
    comment: body.comment ?? "",
    invoiceId: body.invoiceId ?? null,
    items: body.items.map((item, index) => {
      const id = Number(item.id)
      return {
        id: Number.isInteger(id) && id > 0 ? id : index + 1,
        key: item.key?.trim() || undefined,
        product: item.product.trim(),
        expiry: item.expiry ?? "",
        ...(item.series?.trim() ? { series: item.series.trim() } : {}),
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
 * ProcurementError with all field errors when something is unknown. The warehouse must be active
 * (an inactive one is closed to new receipts), except the one an edited supply already has
 * (`keepWarehouse`): accepting it is refused until the warehouse is active again. */
async function resolveIncoming(tx: PgDb, input: IncomingInput, index: CatalogIndex, keepWarehouse?: string, keepDate?: string): Promise<Resolved> {
  const fields: Record<string, string> = {}
  const supplier = await findSupplier(tx, input.supplier)
  if (!supplier) fields.supplier = "Поставщик не найден"
  const warehouse = await findWarehouse(tx, input.warehouse)
  if (!warehouse) fields.warehouse = "Склад не найден"
  else if (!warehouse.active && !(keepWarehouse !== undefined && nameKey(keepWarehouse) === nameKey(warehouse.name))) fields.warehouse = "Склад неактивен"
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
  // A supply document: year 2000..2100 and never after today (an edit may keep its own day);
  // the supplier's invoice date only needs a sane year (lib/document-dates.ts). Both are
  // stored as canonical "YYYY-MM-DD".
  const supplyDay: DocDate = input.date ? parseDocDay(input.date, { current: keepDate }) : { ok: true, date: todayIso() }
  if (!supplyDay.ok) fields.date = supplyDay.error
  const date = supplyDay.ok ? supplyDay.date : null
  const invoiceDay: DocDate = input.invoiceDate ? parseDocDay(input.invoiceDate, { allowFuture: true }) : { ok: true, date: "" }
  if (!invoiceDay.ok) fields.invoiceDate = invoiceDay.error
  const invoiceDate = invoiceDay.ok ? invoiceDay.date : null
  // The expected days of the goods' journey may lie ahead.
  const expected = (field: "expectedFactoryExit" | "expectedCustomsArrival") => {
    if (!input[field]) return ""
    const day = parseDocDay(input[field], { allowFuture: true })
    if (day.ok) return day.date
    fields[field] = day.error
    return ""
  }
  const expectedFactoryExit = expected("expectedFactoryExit")
  const expectedCustomsArrival = expected("expectedCustomsArrival")
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
      expectedFactoryExit,
      expectedCustomsArrival,
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
  // The warehouse as the request found it, read again under its lock below (rename race).
  const seen = await findWarehouse(getDb(), draft.warehouse)
  return withTransaction(async (tx) => {
    // Same lock as the warehouse rename / stock documents: the name cannot change under us, and a
    // rename that committed since `seen` resolves to the new name (lockNamedWarehouse).
    const warehouse = await lockNamedWarehouse(tx, draft.warehouse, seen)
    const { input, supplierId } = await resolveIncoming(tx, { ...draft, warehouse }, await catalogIndex(tx))
    const contact = await supplierContact(tx, supplierId)
    const invoice = input.invoiceId ? await claimInvoiceForIncoming(tx, input.invoiceId) : null
    const result = await tx
      .prepare(
        `INSERT INTO supplier_incomings (
          supplier, warehouse, date, payment_type, contract_number, amount, status, invoice_number,
          organization, branch, phone, email, initiator, paid, time, comment, items, currency, invoice_date, invoice_id, updated_at,
          will_be_sent_out_date, will_come_to_post_date, supplier_id
        ) VALUES (
          @supplier, @warehouse, @date, @paymentType, @contractNumber, @amount, 'ожидает', @invoiceNumber,
          @organization, @branch, @phone, @email, @initiator, 0, @time, @comment, @items, @currency, @invoiceDate, @invoiceId, datetime('now'),
          @expectedFactoryExit, @expectedCustomsArrival, @supplierId
        )`,
      )
      .run({
        supplier: input.supplier,
        supplierId,
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
        expectedFactoryExit: input.expectedFactoryExit,
        expectedCustomsArrival: input.expectedCustomsArrival,
      })
    await addLog(tx, result.lastInsertRowid, "created", userName, invoice ? `Счет-фактура № ${invoice.number}` : "", "ожидает")
    return (await getIncoming(result.lastInsertRowid, tx))!
  })
}

export type IncomingChange = Incoming | "not_found" | "locked"

async function lockIncoming(db: PgDb, id: number): Promise<Incoming | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return null
  const row = (await db.prepare("SELECT id FROM supplier_incomings WHERE id = ? FOR UPDATE").get(id)) as { id: number } | undefined
  return row ? getIncoming(id, db) : null
}

/** The day the stock ledger books an accepted supply on: the earlier of its date and its acceptance. */
function bookingDay(date: string, acceptedAt: string): string | undefined {
  return [parseAnyDay(date), parseAnyDay(acceptedAt)].filter((value): value is string => Boolean(value)).sort()[0]
}

/** Goods of an accepted supply leave the warehouse's history from `day` on (undoing the acceptance, removing a line,
 * moving the supply later): the warehouse must still hold them, and no confirmed inventory may have counted them since
 * (dated after that day, or an end-of-day count of that day; a count confirmed before the acceptance never saw them,
 * counts of other items do not matter). Call under the warehouse's stock lock. */
async function assertCanTakeBack(tx: PgDb, current: Incoming, lines: IncomingItem[], index: CatalogIndex, day: string | undefined, refusal: string) {
  const stock = await warehouseStock(current.warehouse, day, tx)
  const shortages = findShortages(
    lines.map((item) => ({ product: item.product, quantity: Number(item.qty) || 0, key: item.key })),
    index,
    stock,
  )
  if (shortages.length) throw new ProcurementError(`${refusal} ${shortageMessage(current.warehouse, shortages)}`, 409, undefined, { shortages })
  const accepted = parseAnyDate(current.acceptedAt) ?? (day ? `${day}T00:00:00` : "")
  const keys = documentKeys(index, lines)
  if (day && (await countedByInventory(tx, current.warehouse, day, accepted, keys, { registeredAt: accepted }))) {
    throw new ProcurementError("Отменение невозможно из-за связи с другими данными", 409, undefined, { reason: "inventory" })
  }
}

/** A line with its series number set (or dropped when empty). */
function withSeries<T extends { series?: string }>(line: T, series: string | undefined): T {
  const next = { ...line }
  delete next.series
  return series?.trim() ? { ...next, series: series.trim() } : next
}

/** What the form does not edit stays with a line it keeps: the catalog key, Linko's line id, received amount and
 * marking data, and the line's weights (Linko's PUT sends none; a new quantity scales them). */
function carried(line: IncomingItem, qty: number): Partial<IncomingItem> {
  const kept: Partial<IncomingItem> = {}
  if (line.key) kept.key = line.key
  if (line.linkoId !== undefined) kept.linkoId = line.linkoId
  if (line.posted !== undefined) kept.posted = line.posted
  if (line.useMark !== undefined) kept.useMark = line.useMark
  if (line.markStat !== undefined) kept.markStat = line.markStat
  const before = Number(line.qty) || 0
  const scale = before > 0 ? qty / before : 1
  for (const field of ["kg", "netWeight", "block"] as const) {
    const value = Number(line[field]) || 0
    if (value) kept[field] = round6(value * scale)
  }
  return kept
}

/** The form's line over the stored one: the weights it does not send (0) stay the stored line's. */
function keptLine(line: IncomingItem, item: IncomingItem): IncomingItem {
  const kept = carried(line, Number(item.qty) || 0)
  const next: IncomingItem = { ...kept, ...item, key: line.key ?? item.key }
  for (const field of ["kg", "netWeight", "block"] as const) if (!(Number(item[field]) > 0) && kept[field]) next[field] = kept[field]
  return next
}

const ACCEPTED_LINES = "У принятой поставки можно изменить только цену, серию и срок годности"

/** «Изменить детали» (Linko's PUT stock/supply/<id>/). A waiting supply changes freely. An accepted one keeps its
 * warehouse and its quantities: the header, the unit costs and a line's series / expiry change (its goods are revalued),
 * and a line may go — or the supply move to a later day — only while the warehouse can give those goods back (as for
 * undoing the acceptance). A cancelled supply ("locked") and an inventory surplus are not edited. The invoice number
 * and day are changed by «Изменить детали счет фактуры» (changeIncomingInvoice) only, so they are kept here. */
export async function updateIncoming(id: number, draft: IncomingInput, userName: string): Promise<IncomingChange> {
  await incomingsDb()
  const seen = await findWarehouse(getDb(), draft.warehouse)
  let products: string[] = []
  const result = await withTransaction(async (tx): Promise<IncomingChange> => {
    // Lock order (C1): the stock locks before the row lock (rename race: see createIncoming); an accepted supply moves
    // the stock of its own warehouse.
    const warehouse = await lockNamedWarehouse(tx, draft.warehouse, seen)
    await lockWarehousesOf(tx, "SELECT warehouse FROM supplier_incomings WHERE id = @id", { id })
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.status === "отменен") return "locked"
    if (current.isInventory) throw new ProcurementError("Инвентаризацию изменить нельзя", 409)
    const accepted = current.status === "принят"
    const index = await catalogIndex(tx)
    const { input, supplierId } = await resolveIncoming(tx, { ...draft, warehouse }, index, current.warehouse, current.date)
    const before = new Map(current.items.map((item) => [Number(item.id), item]))
    let items: IncomingItem[]
    let rate: number | null = current.rateToBase
    if (accepted) {
      if (nameKey(input.warehouse) !== nameKey(current.warehouse)) throw fieldError("warehouse", "Склад принятой поставки изменить нельзя", 409)
      const seenIds = new Set<number>()
      items = input.items.map((item) => {
        const line = before.get(Number(item.id))
        if (!line || seenIds.has(Number(item.id)) || nameKey(line.product) !== nameKey(item.product) || Math.abs((Number(line.qty) || 0) - item.qty) > 1e-9) {
          throw new ProcurementError(ACCEPTED_LINES, 409)
        }
        seenIds.add(Number(item.id))
        return withSeries({ ...line, expiry: item.expiry, cost: item.cost, total: round6((Number(line.qty) || 0) * item.cost) }, item.series)
      })
      const removed = current.items.filter((line) => !seenIds.has(Number(line.id)))
      const oldDay = bookingDay(current.date, current.acceptedAt)
      const newDay = bookingDay(input.date, current.acceptedAt)
      // A later day takes every line out of the days in between; a removed line goes for good.
      const leaving = oldDay && newDay && newDay > oldDay ? current.items : removed
      if (leaving.length) await assertCanTakeBack(tx, current, leaving, index, oldDay, "Не возможно изменить.")
      // The goods were booked at the supply currency's rate: another currency takes its current rate.
      if (input.currency !== current.currency) rate = await rateToBase(tx, input.currency)
      products = current.items.map((item) => item.product)
    } else {
      items = input.items.map((item) => {
        const line = before.get(Number(item.id))
        return line && nameKey(line.product) === nameKey(item.product) ? keptLine(line, item) : item
      })
    }
    const contact = await supplierContact(tx, supplierId)
    await tx
      .prepare(
        `UPDATE supplier_incomings SET
           -- The same supplier name keeps its id (Linko suppliers may share a name).
           supplier = @supplier, supplier_id = CASE WHEN supplier = @supplier AND supplier_id IS NOT NULL THEN supplier_id ELSE @supplierId END,
           warehouse = @warehouse, date = @date, payment_type = @paymentType,
           contract_number = @contractNumber, amount = @amount,
           organization = @organization, branch = @branch, phone = @phone, email = @email, comment = @comment,
           warehouse_id = CASE WHEN warehouse = @warehouse THEN warehouse_id END,
           branch_id = CASE WHEN branch = @branch THEN branch_id END,
           organization_id = CASE WHEN organization = @organization THEN organization_id END,
           items = @items, currency = @currency, rate_to_base = @rate,
           will_be_sent_out_date = @expectedFactoryExit, will_come_to_post_date = @expectedCustomsArrival, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        supplier: input.supplier,
        supplierId,
        warehouse: input.warehouse,
        date: input.date,
        paymentType: input.paymentType,
        contractNumber: input.contractNumber,
        amount: round6(items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.cost) || 0), 0)),
        organization: input.organization,
        branch: input.branch,
        phone: contact.phone,
        email: contact.email,
        comment: input.comment,
        items: JSON.stringify(items),
        currency: input.currency,
        rate,
        expectedFactoryExit: input.expectedFactoryExit,
        expectedCustomsArrival: input.expectedCustomsArrival,
      })
    await addLog(tx, id, "updated", userName, "", current.status)
    return (await getIncoming(id, tx))!
  })
  if (typeof result !== "string" && products.length) await refreshProductCostsByName(products)
  return result
}

/** «Изменить детали счет фактуры» (Linko's POST stock/supply/<id>/change_invoice/): the supplier's invoice number,
 * day and comment, for a supply in any status; logged as change_invoice with the comment. The day is required. */
export async function changeIncomingInvoice(id: number, body: { invoiceNumber: string; invoiceDate: string; invoiceComment: string }, userName: string): Promise<IncomingChange> {
  if (!body.invoiceDate.trim()) throw fieldError("invoiceDate", "Укажите дату счет фактуры")
  const day = parseDocDay(body.invoiceDate, { allowFuture: true })
  if (!day.ok) throw fieldError("invoiceDate", day.error)
  await incomingsDb()
  return withTransaction(async (tx) => {
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    const comment = body.invoiceComment.trim()
    await tx
      .prepare("UPDATE supplier_incomings SET invoice_number = @number, invoice_date = @date, invoice_comment = @comment, updated_at = datetime('now') WHERE id = @id")
      .run({ id, number: body.invoiceNumber.trim(), date: day.date, comment })
    await addLog(tx, id, "change_invoice", userName, comment, current.status)
    return (await getIncoming(id, tx))!
  })
}

/** «Добавить лог» actions (Linko's SUPPLY_STATUS of supply_log/update_status/). */
export const INCOMING_EVENT_ACTIONS = ["sent_out", "come_to_post"] as const
export type IncomingEventAction = (typeof INCOMING_EVENT_ACTIONS)[number]

/** «Добавить лог»: «Вышел с завода» / «Прибыл в таможню» on a day (today when none is picked) with a comment, for a
 * supply in any status except an inventory surplus (Linko offers it for those only). */
export async function addIncomingEventLog(id: number, body: { action: IncomingEventAction; date: string; comment: string }, userName: string): Promise<IncomingChange> {
  const day: DocDate = body.date.trim() ? parseDocDay(body.date, { allowFuture: true }) : { ok: true, date: todayIso() }
  if (!day.ok) throw fieldError("date", day.error)
  await incomingsDb()
  return withTransaction(async (tx) => {
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.isInventory) return "locked"
    await addLog(tx, id, body.action, userName, body.comment.trim(), current.status, day.date)
    return (await getIncoming(id, tx))!
  })
}

/** Whether live money points at the supply: supplier payments linked to it, or cash entries paying
 * one of its additional expenses. Run under lockSupplyPayments (a supply payment being recorded is
 * waited for); the expense rows are locked too, so an expense payment being recorded (which holds
 * its expense row) is waited for as well. */
async function supplyHasPayments(tx: PgDb, id: number): Promise<boolean> {
  const payments = (await tx
    .prepare("SELECT COUNT(*) AS n FROM supplier_payments WHERE supply_id = @id AND COALESCE(is_deleted, 0) = 0")
    .get({ id })) as { n: string | number } | undefined
  if (Number(payments?.n ?? 0) > 0) return true
  const expenses = (await tx.prepare("SELECT id FROM supplier_incoming_expenses WHERE incoming_id = @id ORDER BY id FOR UPDATE").all({ id })) as Array<{ id: number }>
  return (await expensePayments(tx, expenses.map((row) => Number(row.id)))) > 0
}

/** Hard delete of a supply that never reached the warehouse. Locked (FOR UPDATE) so a
 * concurrent acceptance either wins (→ "locked") or waits for the delete. A supply that
 * live payments point at is refused ("has_payments"); paid additional expenses count as
 * payments too (their rows go with the supply). */
export async function deleteIncoming(id: number): Promise<"ok" | "not_found" | "locked" | "has_payments"> {
  await incomingsDb()
  return withTransaction(async (tx) => {
    // The payments' lock before the row lock (lib/cash/common.ts lockSupplyPayments).
    await lockSupplyPayments(tx, id)
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.status === "принят") return "locked"
    if (await supplyHasPayments(tx, id)) return "has_payments"
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

/** A supply may only reach an active warehouse, with sane lines of catalog items. */
async function assertAcceptable(tx: PgDb, current: Incoming, index: CatalogIndex) {
  const warehouse = await findWarehouse(tx, current.warehouse)
  // An inactive warehouse is closed to new movements (as for write-offs and transfers).
  if (warehouse && !warehouse.active) throw fieldError("warehouse", "Склад неактивен", 400)
  const fields: Record<string, string> = {}
  if (!(await findSupplier(tx, current.supplier))) fields.supplier = "Поставщик не найден"
  if (!warehouse) fields.warehouse = "Склад не найден"
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

/** The moment an acceptance is booked at (`at`) and its local day (`day`): now, or the day picked in
 * the «ПРИЕМКА ТОВАРА» dialog at the current local time of day. That day is a supply document date
 * (lib/document-dates.ts): a year 2000..2100 and never after today (Asia/Tashkent) — else a 400 field
 * error. (Not before the supply's own date either: checked once the supply is locked.) */
function acceptanceMoment(acceptDate: string | undefined): { at: string; day: string } {
  const now = new Date()
  const today = todayIso(now)
  if (acceptDate === undefined || !acceptDate.trim()) return { at: now.toISOString(), day: today }
  const day = parseDocDay(acceptDate)
  if (!day.ok) throw fieldError("date", day.error)
  // Whole days back from today: the same local clock time on the picked day (a UTC time-of-day glued
  // to the local day could land on the next local day, i.e. in the future).
  const daysBack = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day.date}T00:00:00Z`)) / 86_400_000)
  return { at: new Date(now.getTime() - daysBack * 86_400_000).toISOString(), day: day.date }
}

/** "Принять на склад" / "Отменить приемку" / "Отменить". Accepting puts the goods on the
 * warehouse at the supply currency's current rate (frozen in rate_to_base); undoing it is
 * refused while the warehouse no longer holds the goods (returned, moved, used, sold). */
export async function changeIncomingStatus(id: number, action: StatusAction, userName: string, acceptDate?: string): Promise<IncomingChange> {
  // Checked before anything is locked: a bad date is a 400, whatever the supply's state.
  // (Only an accept reads the date; the other actions ignore whatever was sent.)
  const acceptance = acceptanceMoment(action === "accept" ? acceptDate : undefined)
  await incomingsDb()
  // The supply_accepted notification is written inside the status transaction.
  if (action === "accept") await ensureUserNotificationsSchema()
  const transition = TRANSITIONS[action]
  let products: string[] = []
  const result = await withTransaction(async (tx): Promise<IncomingChange> => {
    // A cancel depends on the supply's payments: their lock before the row lock (lib/cash/common.ts lockSupplyPayments).
    if (action === "cancel") await lockSupplyPayments(tx, id)
    // Lock order (C1): accepting / unaccepting moves stock — the warehouse's stock lock before the row lock.
    else await lockWarehousesOf(tx, "SELECT warehouse FROM supplier_incomings WHERE id = @id", { id })
    const current = await lockIncoming(tx, id)
    if (!current) return "not_found"
    if (current.status !== transition.from) return "locked"
    if (action === "accept") {
      // The stock core books the receipt on the earlier of the supply date and the acceptance: an
      // acceptance before the supply's own date would put the goods on the warehouse before the
      // supply exists (internal transfers refuse the same: lib/internal-transfers-repo.ts).
      const supplyDay = parseAnyDay(current.date)
      if (supplyDay && acceptance.day < supplyDay) throw fieldError("date", "Дата приемки не может быть раньше даты поставки")
      await lockWarehouseStock(tx, [current.warehouse])
      await assertAcceptable(tx, current, await catalogIndex(tx))
      const rate = await rateToBase(tx, current.currency)
      await tx
        .prepare("UPDATE supplier_incomings SET status = 'принят', accepted_at = @at, accepted_by = @by, rate_to_base = @rate, updated_at = datetime('now') WHERE id = @id")
        .run({ id, at: acceptance.at, by: userName, rate })
    } else if (action === "unaccept") {
      // The goods leave the warehouse again: it must still have them.
      await lockWarehouseStock(tx, [current.warehouse])
      // The stock core books the receipt on the earlier of the supply date and the acceptance.
      await assertCanTakeBack(tx, current, current.items, await catalogIndex(tx), bookingDay(current.date, current.acceptedAt), "Не возможно отменить.")
      await tx
        .prepare("UPDATE supplier_incomings SET status = 'ожидает', accepted_at = '', accepted_by = '', rate_to_base = NULL, updated_at = datetime('now') WHERE id = @id")
        .run({ id })
    } else {
      // As for a delete: the payments would stay on a supply that never comes (the supplier's
      // balance keeps them as paid for it). Delete or move them first.
      if (await supplyHasPayments(tx, id)) throw new ProcurementError("По поставке есть оплаты — отменить нельзя", 409, undefined, { reason: "has_payments" })
      await tx.prepare("UPDATE supplier_incomings SET status = 'отменен', updated_at = datetime('now') WHERE id = @id").run({ id })
    }
    await addLog(tx, id, action === "accept" ? "accepted" : action === "unaccept" ? "unaccepted" : "cancelled", userName, "", current.status)
    if (action === "accept") {
      // Настройки → Уведомления "supply_accepted": the administrators and the subscribers (in this
      // transaction: a rolled-back acceptance notifies nobody; a failed notification never undoes it).
      await notifySafely("supply_accepted", () =>
        notifyTemplate(
          "supply_accepted",
          { id, stock_name: current.warehouse, accepted_by: userName, provider_name: current.supplier },
          { objectId: id, link: "/analytics/supplier-incomings" },
        ),
      )
    }
    products = current.items.map((item) => item.product)
    return (await getIncoming(id, tx))!
  })
  if (typeof result !== "string" && action !== "cancel") await refreshProductCostsByName(products)
  return result
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
  distribute_type?: string | null
  bind_to_provider?: number | null
  paid?: number | null
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
  distributeType: row.distribute_type || "cost",
  bindToProvider: Number(row.bind_to_provider) === 1,
  paid: round6(Math.abs(Number(row.paid) || 0)),
})

/** null = no such supply. */
export async function listIncomingExpenses(incomingId: number): Promise<IncomingExpense[] | null> {
  const db = await incomingsDb()
  if (!(await incomingExists(db, incomingId))) return null
  // «Оплачено»: the live cash entries paying the expense (Linko's total_paid is their sum; expense payments are negative).
  const rows = (await db
    .prepare(
      `SELECT e.*, COALESCE((SELECT SUM(c.amount) FROM cash_management_entries c
                              WHERE COALESCE(c.is_deleted, 0) = 0 AND (c.supply_expense_id = e.id OR c.id = e.transaction_id)), 0)::float8 AS paid
         FROM supplier_incoming_expenses e WHERE e.incoming_id = ? ORDER BY e.id`,
    )
    .all(incomingId)) as ExpenseRow[]
  return rows.map(toExpense)
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
    // A money document: year 2000..2100 and never after today (lib/document-dates.ts).
    const day: DocDate = input.date ? parseDocDay(input.date) : { ok: true, date: todayIso() }
    if (!day.ok) throw fieldError("date", day.error)
    const date = day.date
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
    // The amount as the page shows money ("250 000 SUM", up to 3 decimals like the supply view).
    await addLog(tx, incomingId, "expense_added", userName, `${description}: ${formatMoney(input.amount, 3)} ${currency.code}`, current.status)
    if (current.status === "принят") products = current.items.map((item) => item.product)
    return (await getIncoming(incomingId, tx))!
  })
  if (products.length) await refreshProductCostsByName(products)
  return result
}

/** Live cash entries («Доп. расход на поставку») paying any of these additional expenses:
 * linked by cash_management_entries.supply_expense_id, or the expense's transaction_id. */
async function expensePayments(tx: PgDb, expenseIds: number[]): Promise<number> {
  if (!expenseIds.length) return 0
  const row = (await tx
    .prepare(
      `SELECT COUNT(*) AS n FROM cash_management_entries c
       WHERE COALESCE(c.is_deleted, 0) = 0
         AND (c.supply_expense_id = ANY(@ids::int[])
              OR c.id IN (SELECT e.transaction_id FROM supplier_incoming_expenses e WHERE e.id = ANY(@ids::int[]) AND e.transaction_id IS NOT NULL))`,
    )
    .get({ ids: expenseIds })) as { n: string | number } | undefined
  return Number(row?.n ?? 0)
}

/** "Удалить расход". Refused ("has_payments") while a live cash entry pays the expense: the
 * payment would point at a deleted expense and the supply cost would drop under it. */
export async function deleteIncomingExpense(incomingId: number, expenseId: number, userName: string): Promise<IncomingChange | "has_payments"> {
  await incomingsDb()
  let products: string[] = []
  const result = await withTransaction(async (tx): Promise<IncomingChange | "has_payments"> => {
    const current = await lockIncoming(tx, incomingId)
    if (!current) return "not_found"
    if (!Number.isInteger(expenseId) || expenseId <= 0 || expenseId > 2_147_483_647) return "not_found"
    // Row-locked, so a cash payment being recorded for it (which stamps transaction_id) is seen.
    const expense = (await tx.prepare("SELECT * FROM supplier_incoming_expenses WHERE id = ? AND incoming_id = ? FOR UPDATE").get(expenseId, incomingId)) as
      | ExpenseRow
      | undefined
    if (!expense) return "not_found"
    if ((await expensePayments(tx, [expenseId])) > 0) return "has_payments"
    await tx.prepare("DELETE FROM supplier_incoming_expenses WHERE id = ?").run(expenseId)
    await addLog(tx, incomingId, "expense_deleted", userName, `${expense.description}: ${formatMoney(Number(expense.amount), 3)} ${expense.currency}`, current.status)
    if (current.status === "принят") products = current.items.map((item) => item.product)
    return (await getIncoming(incomingId, tx))!
  })
  if (products.length) await refreshProductCostsByName(products)
  return result
}

// ---------------------------------------------------------------------------
// Net cost (contract 1: lib/stock/costs.ts is the one cost of goods)
// ---------------------------------------------------------------------------

/** Brings products.cost to the cost of goods (base currency, today) inside `tx`
 * (refreshProductCostCache: the initial ("по умолчанию") cost is frozen where still
 * NULL; an item never received falls back to it instead of a stale average).
 * null = every live product. */
async function refreshProductCostsIn(tx: PgDb, ids: number[] | null): Promise<void> {
  const productIds =
    ids ?? ((await tx.prepare("SELECT id FROM products WHERE COALESCE(deleted, 0) = 0 ORDER BY id").all()) as Array<{ id: number }>).map((row) => Number(row.id))
  await refreshProductCostCache(tx, productIds)
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

/** The product a supply line is looked up for: its catalog key ("product:12", what a line copied from Linko or picked
 * from the catalog carries) and its name (for a line without a key). */
type SupplyProduct = { key: string; name: string }

/** The supply lines' JSON array of `i`, [] for a broken value. */
const SUPPLY_LINES_SQL = `COALESCE(CASE WHEN pg_input_is_valid(i.items, 'jsonb') THEN CASE WHEN jsonb_typeof(i.items::jsonb) = 'array' THEN i.items::jsonb END END, '[]'::jsonb)`

/** A supply holds a line of the product (@key / @name): by the line's catalog key, by the name only for a line without
 * one, so two products of the same name never share their supplies. */
const SUPPLY_HAS_PRODUCT_SQL = `EXISTS (SELECT 1 FROM jsonb_array_elements(${SUPPLY_LINES_SQL}) e
  WHERE e ->> 'key' = @key OR (COALESCE(e ->> 'key', '') = '' AND fin_key(e ->> 'product') = fin_key(@name)))`

/** The cost lines (supplyCostLines) of `incoming` that are the product's, each with its supply line. */
function productCostLines(incoming: Incoming, product: SupplyProduct) {
  const name = nameKey(product.name)
  const items = incoming.items
  return supplyCostLines(incoming)
    .map((line, index) => ({ line, item: items[index] }))
    .filter(({ line, item }) => line.qty > 0 && (item?.key ? item.key === product.key : nameKey(line.product) === name))
    .map(({ line }) => line)
}

/** Accepted supplies of one product, oldest first, in the BASE currency (each supply at its
 * acceptance rate, each expense at its own rate, spread like the stock ledger does), with the
 * running quantity-weighted average after each of them. */
export async function productSupplyHistory(product: SupplyProduct, db?: PgDb): Promise<SupplyHistoryLine[]> {
  const executor = db ?? (await incomingsDb())
  const incomings = await loadIncomings(executor, `WHERE i.status = 'принят' AND ${SUPPLY_HAS_PRODUCT_SQL}`, { key: product.key, name: product.name }, "ORDER BY i.accepted_at, i.id")
  const rates = await currencyRates(executor)
  const history: SupplyHistoryLine[] = []
  let qty = 0
  let value = 0
  for (const incoming of incomings) {
    const rate = positive(incoming.rateToBase) ?? rates.rateOf(incoming.currency) ?? 1
    for (const line of productCostLines(incoming, product)) {
      const unitCost = line.unitCost * rate
      qty += line.qty
      value += line.qty * unitCost
      history.push({ incomingId: incoming.id, date: incoming.date, acceptedAt: incoming.acceptedAt, qty: line.qty, unitCost: round6(unitCost), averageCost: round6(value / qty) })
    }
  }
  return history
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
    status: string | null
    event_date: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    details: row.details,
    userName: row.user_name,
    createdAt: row.created_at,
    status: row.status ?? "",
    eventDate: row.event_date ?? "",
  }))
}

// ---------------------------------------------------------------------------
// Наценка (repricing from a supply)
// ---------------------------------------------------------------------------

/** A line of the «Наценка» sheet: the supply line's catalog key («product:12», «raw_material:3») and its name (older
 * clients send only the name). */
export type RepriceInput = { priceListId: number; currency: string; comment: string; prices: Array<{ product: string; key?: string; price: number }> }

/** Writes the calculated selling prices into the chosen price list as one
 * finished repricing (Переоценка) document, so it can be viewed and cancelled
 * there like any other repricing. */
export async function repriceFromIncoming(
  incomingId: number,
  input: RepriceInput,
  userName: string,
): Promise<{ updated: number; missing: string[]; repricingId: number | null } | "not_found" | "price_list_not_found"> {
  await incomingsDb()
  await ensureRepricingsSchema()
  const available = await availableByKey()
  return withTransaction(async (tx) => {
    const incoming = await lockIncoming(tx, incomingId)
    if (!incoming) return "not_found"
    const priceList = (await tx.prepare("SELECT id, name FROM price_lists WHERE id = ?").get(input.priceListId)) as { id: number; name: string } | undefined
    if (!priceList) return "price_list_not_found"
    const missing: string[] = []
    const products: Array<{ kind: "product" | "raw_material"; id: number; price: number }> = []
    // Live catalog items (products and raw materials) by key: a supply line can be either, like Linko's product id.
    const live = new Map((await loadStockCatalog(tx)).map((item) => [item.key as string, item]))
    for (const line of input.prices) {
      if (!(line.price >= 0)) continue
      const item = line.key ? live.get(line.key) : undefined
      if (item) {
        products.push({ kind: item.kind, id: Number(item.key.slice(item.key.indexOf(":") + 1)), price: line.price })
        continue
      }
      const product = (await tx.prepare("SELECT id FROM products WHERE fin_key(name) = fin_key(?) AND COALESCE(deleted, 0) = 0 ORDER BY id LIMIT 1").get(line.product)) as { id: number } | undefined
      if (product) products.push({ kind: "product", id: product.id, price: line.price })
      else missing.push(line.product)
    }
    let repricingId: number | null = null
    if (products.length) {
      repricingId = (await createRepricingTx(tx, { priceListId: priceList.id, currency: input.currency, comment: input.comment, products, connected: false }, userName, available, "supplier_incoming")).id
    }
    await addLog(tx, incomingId, "repriced", userName, `${priceList.name}: ${products.length}${input.comment ? ` — ${input.comment}` : ""}`, incoming.status)
    // The new Переоценка document: the card opens it after saving, as Linko does.
    return { updated: products.length, missing, repricingId }
  })
}

// ---------------------------------------------------------------------------
// Формирование цен: a product's net cost
// ---------------------------------------------------------------------------

/** One supply line of the product detail ("Поставки"): accepted ones carry the running average cost. */
export type ProductSupplyLine = { incomingId: number; date: string; qty: number; onStock: number; unitCost: number; averageCost: number | null; accepted: boolean }

export type ProductCostInfo = { initialCost: number; currentCost: number; history: SupplyHistoryLine[]; lines: ProductSupplyLine[]; baseCurrency: string }

/** Every supply (accepted or waiting) that carries the product, newest first, like the reference panel. */
async function productSupplyLines(product: SupplyProduct, db: PgDb, history: SupplyHistoryLine[]): Promise<ProductSupplyLine[]> {
  const incomings = await loadIncomings(
    db,
    // Linko's stock/supply_product_history leaves out the supplies an inventory booked (provider «Инвенторизация»).
    `WHERE i.status IN ('принят', 'ожидает') AND COALESCE(i.is_inventory, 0) = 0 AND ${SUPPLY_HAS_PRODUCT_SQL}`,
    { key: product.key, name: product.name },
    "ORDER BY i.id",
  )
  const rates = await currencyRates(db)
  // Доступно is keyed by the stock ledger's item key ("product:12").
  const onHand = (await availableByKey(db)).get(product.key) ?? 0
  const lines: ProductSupplyLine[] = []
  for (const incoming of incomings) {
    const rate = positive(incoming.rateToBase) ?? rates.rateOf(incoming.currency) ?? 1
    for (const line of productCostLines(incoming, product)) {
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
  const supplied = { key: `product:${productId}`, name: product.name }
  const [history, costs, rates] = await Promise.all([productSupplyHistory(supplied, db), getItemCosts({}, db), currencyRates(db)])
  const lines = await productSupplyLines(supplied, db, history)
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

/** Cost of goods (base currency, today) of every live product, for the Формирование цен list: like Linko's
 * (stock/products_net_costs), the cost of the scope that changed last — the common average, or the average of a
 * warehouse that keeps its own cost when that one was booked later (lib/stock/costs.ts latestScopeCosts). */
export async function listProductCosts(): Promise<{ baseCurrency: string; costs: Record<number, number>; unset: number[] }> {
  const db = await incomingsDb()
  const [rows, costs, ledger, rates] = await Promise.all([
    db.prepare("SELECT id, cost FROM products WHERE COALESCE(deleted, 0) = 0").all() as Promise<Array<{ id: number; cost: number | null }>>,
    getItemCosts({}, db),
    loadCostLedger(db),
    currencyRates(db),
  ])
  const latest = latestScopeCosts(ledger)
  const out: Record<number, number> = {}
  // Products the ledger never valued (no cost receipt, no entry, no default cost): «Не установлена», like Linko.
  const unset: number[] = []
  for (const row of rows) {
    const key = `product:${row.id}` as const
    const cost = latest.get(key) ?? costs.get(key)
    if (!latest.has(key) && !(ledger.fallback.get(key) ?? 0) && !(cost ?? 0)) unset.push(Number(row.id))
    out[Number(row.id)] = round6(cost !== undefined && Number.isFinite(cost) ? cost : Number(row.cost) || 0)
  }
  return { baseCurrency: rates.base, costs: out, unset }
}
