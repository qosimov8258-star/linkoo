import "server-only"

import { ensureClientReturnLogsSchema, logClientReturn } from "@/lib/client-return-logs-repo"
import { AmountSum, amountDigits, roundToDigits } from "@/lib/amount-precision"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { DOC_DATE_INVALID, docDateError, docYearOk } from "@/lib/document-dates"
import { localToUtcText, nowLocalIso, todayIso } from "@/lib/finance/dates"
import { placeName } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { ownAgentSql } from "@/lib/finance/sources"
import { catalogIndex, countedByInventory, ledgerKey, lockWarehousesOf, lockWarehouseStock, round6, shortageMessage, warehouseStock } from "@/lib/internal-transfers-stock"
import type { StockShortage } from "@/lib/internal-transfers-types"
import { keySql, nameKey } from "@/lib/platform-refs"
import {
  MAX_MONEY,
  MAX_QTY,
  OrderError,
  baseCurrency,
  ensureOrdersSchema,
  formatMoney,
  lineTotal,
  parseMoneyText,
  resolveClient,
  resolveCurrency,
  resolveEmployee,
  resolveOrderOrganization,
  resolveWarehouse,
} from "@/lib/orders-repo"
import { notifySafely } from "@/lib/notify-event"
import { ensureStockSchema } from "@/lib/stock/schema"
import { ensureUserNotificationsSchema, notifyTemplate } from "@/lib/user-notifications-repo"
import { RELEASED_STATUSES } from "@/components/orders/orders-data"

// Client returns (Продажи → Возвраты), contract 5.
//
// client_returns(id, client_id, client, warehouse, order_id, return_date,
// status 'pending' | 'accepted' | 'cancelled', currency, amount, comment,
// created_by, created_at, accepted_at, accepted_by, …) and
// client_return_items(id, return_id → client_returns ON DELETE CASCADE,
// product_id, product_name, quantity, price, …).
//
// Only an ACCEPTED return has effects, both read by other modules:
// - stock (lib/stock/sources.ts): + quantity at `warehouse` on the accepted day;
// - client ledger (lib/finance/sources.ts): the client is credited `amount`
//   (in `currency`) on the accepted day.
// accepted_at is an ISO UTC moment with "Z", so both read the same local day.
// An accepted return can be undone ("Отменить приемку" → pending, or cancelled
// right away): the goods leave the warehouse again, so they must still be there
// on every day from the acceptance day on (business rule 8, warehouseStock) and
// must not have been counted by a later confirmed inventory; the client credit
// goes with the status. unaccepted_at / unaccepted_by keep the last undo.
// A return of an order (order_id) is limited to the shipped quantities of that
// order minus what earlier (not cancelled) returns took back, at the order's
// net line price and currency by default.
// organization: the order's organization for a return of an order, else the
// chosen one or the order fallbacks (resolveOrderOrganization), so a return
// without an order stays under the finance organization filter.

export type ClientReturnStatus = "pending" | "accepted" | "cancelled"
export const CLIENT_RETURN_STATUSES: ClientReturnStatus[] = ["pending", "accepted", "cancelled"]

export type ClientReturnItem = {
  id: number
  productId: number | null
  productName: string
  unit: string
  quantity: number
  price: number
  total: number
  orderItemId: number | null
  /** The order of the line (its order line's order, else the return's own order). */
  orderId?: number | null
  /** That order's creation moment (orders.created_at, UTC text) for «Заказ: N от …». */
  orderCreatedAt?: string | null
  /** The product's box (Блок column: «0,833 block (+10 шт)»); 0 / "" when the product has none. */
  boxAmount?: number
  boxUnit?: string
  /** The order line id of «Заказ: N от … (id)»: Linko's of a copied line (null when Linko has none), else orderItemId. */
  orderLineId?: number | null
  /** A bonus line (green «(бонус)»): Linko's flag of a copied line, else its order line's. */
  isBonus?: boolean
  /** «Акция: <name>» of a copied line ('' = none). */
  promotion?: string
}

export type ClientReturn = {
  id: number
  clientId: number | null
  client: string
  zone: string
  warehouse: string
  orderId: number | null
  returnDate: string
  status: ClientReturnStatus
  currency: string
  amount: number
  comment: string
  deliverer: string
  agent: string
  organization: string
  createdBy: string
  createdAt: string
  acceptedAt: string | null
  acceptedBy: string
  /** Last "Отменить приемку" (ISO UTC) and who did it; null / "" when never undone. */
  unacceptedAt: string | null
  unacceptedBy: string
  cancelledAt: string | null
  cancelledBy: string
  /** The shop's branch (Филиал), client type (Тип клиента) and client account (Финансовый счет). */
  branch: string
  clientType: string
  account: string
  /** The client account's id (the list filter «Финансовый счет», Linko's ?client=); null when none is known. */
  accountId: number | null
  /** The shop's own branch: the list filter «Филиалы» falls back to it when the return has no branch of its own. */
  shopBranch: string
  /** The lines' marking codes (the list filter «Код»). */
  markCodes: string[]
  /** cash | bank (Linko's payment type of the return), the reason and «Вид возврата» (при доставке / с полки);
   * stored only for returns copied from Linko (the columns exist once scripts/linko-sync ran). */
  paymentType: string
  /** «Тип оплаты» as Linko names it on a copied return (its custom payment type: «Наличные», «cash»); '' = none or no
   * longer the return's payment type. */
  paymentTypeName: string
  /** cash | bank: the return's own payment type (returnOwnPaymentType: the list's payment icon and payment filters, the
   * 1C file's «Оплата наличными»). */
  returnPaymentType: string
  /** «Прайс лист» of a return without an order ('' = none). */
  priceList: string
  reason: string
  onDelivery: boolean
  /** Products and brands of the lines (the list filters «Продукт» / «Бренд»). */
  productIds: number[]
  brands: string[]
  /** A return of order lines (Linko's «С заказа»), else of the catalog («Со старый базе»). */
  fromOrder: boolean
  items?: ClientReturnItem[]
  itemCount?: number
}

/** `id`: the edited return's own line it stands for (Linko's from_client_update sends it): that line is updated in
 * place, even when another line of the return names the same order line. */
export type ClientReturnLineInput = { id?: number; orderItemId?: number; productId?: number; productName?: string; quantity: number; price?: number }

export type ClientReturnInput = {
  clientId?: number
  client?: string
  warehouse?: string
  /** null (edit only): the return names no order any more. */
  orderId?: number | null
  /** «Прайс лист» by name ('' = none). */
  priceList?: string
  returnDate?: string
  currency?: string
  comment?: string
  deliverer?: string
  agent?: string
  /** A known organization; without one, the order's (return of an order) or the order fallbacks. */
  organization?: string
  /** cash | bank («Тип оплаты» of a return without an order). */
  paymentType?: "cash" | "bank"
  items?: ClientReturnLineInput[]
  /** With orderId and no items: return everything still returnable of the order. */
  full?: boolean
  /** Accept into the warehouse right away. */
  accept?: boolean
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const RETURN_COLUMNS: Array<[string, string]> = [
  ["client_id", "INTEGER"],
  ["client", "TEXT NOT NULL DEFAULT ''"],
  ["warehouse", "TEXT NOT NULL DEFAULT ''"],
  ["order_id", "INTEGER"],
  ["return_date", "TEXT NOT NULL DEFAULT ''"],
  ["status", "TEXT NOT NULL DEFAULT 'pending'"],
  ["currency", "TEXT NOT NULL DEFAULT ''"],
  ["amount", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["comment", "TEXT NOT NULL DEFAULT ''"],
  ["created_by", "TEXT NOT NULL DEFAULT ''"],
  ["created_at", "TEXT NOT NULL DEFAULT (datetime('now'))"],
  ["accepted_at", "TEXT"],
  ["accepted_by", "TEXT NOT NULL DEFAULT ''"],
  ["deliverer", "TEXT NOT NULL DEFAULT ''"],
  ["agent", "TEXT NOT NULL DEFAULT ''"],
  ["organization", "TEXT NOT NULL DEFAULT ''"],
  ["cancelled_at", "TEXT"],
  ["cancelled_by", "TEXT NOT NULL DEFAULT ''"],
  ["updated_at", "TEXT NOT NULL DEFAULT (datetime('now'))"],
  ["unaccepted_at", "TEXT"],
  ["unaccepted_by", "TEXT NOT NULL DEFAULT ''"],
  // cash | bank of a return without an order («Возврат по старой базе»: «Тип оплаты»); '' = the order's (the client
  // ledger reads it, lib/finance/sources.ts). Same column as scripts/linko-sync/import-returns.mjs adds.
  ["payment_type", "TEXT NOT NULL DEFAULT ''"],
  // «Прайс лист» of a return without an order (Linko's price_list, by name); '' = none. Filled for copied returns by
  // scripts/linko-sync/import-return-price-lists.mjs.
  ["price_list", "TEXT NOT NULL DEFAULT ''"],
  // The card facts of a return copied from Linko, as its card shows them (scripts/linko-sync/import-returns.mjs):
  // its own branch («Филиал»; NULL = made here, the shop's branch; '' = none), its custom payment type
  // ({"name","key"} JSON, «Тип оплаты») and its financial account ({"id","name","market"} JSON, «Финансовый счет»,
  // shown while the return still names that shop).
  ["linko_branch", "TEXT"],
  ["linko_payment_type", "TEXT NOT NULL DEFAULT ''"],
  ["linko_account", "TEXT NOT NULL DEFAULT ''"],
]

const ITEM_COLUMNS: Array<[string, string]> = [
  ["product_id", "INTEGER"],
  ["product_name", "TEXT NOT NULL DEFAULT ''"],
  ["unit", "TEXT NOT NULL DEFAULT ''"],
  ["quantity", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["price", "DOUBLE PRECISION NOT NULL DEFAULT 0"],
  ["order_item_id", "INTEGER"],
  // A copied line's Linko order line id, bonus flag and promotion name. is_bonus is 0/1 on every copied line and NULL on
  // a line made here (which takes its order line's flag and shows its own order line id).
  ["linko_order_product_id", "INTEGER"],
  ["is_bonus", "INTEGER"],
  ["promotion", "TEXT NOT NULL DEFAULT ''"],
]

const DDL = `
CREATE TABLE IF NOT EXISTS client_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ${RETURN_COLUMNS.map(([name, type]) => `${name} ${type}`).join(",\n  ")}
);
${RETURN_COLUMNS.map(([name, type]) => `ALTER TABLE client_returns ADD COLUMN IF NOT EXISTS ${name} ${type};`).join("\n")}
CREATE INDEX IF NOT EXISTS client_returns_client_idx ON client_returns (client_id);
CREATE INDEX IF NOT EXISTS client_returns_order_idx ON client_returns (order_id);
CREATE INDEX IF NOT EXISTS client_returns_status_idx ON client_returns (status);
CREATE TABLE IF NOT EXISTS client_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES client_returns(id) ON DELETE CASCADE,
  ${ITEM_COLUMNS.map(([name, type]) => `${name} ${type}`).join(",\n  ")}
);
${ITEM_COLUMNS.map(([name, type]) => `ALTER TABLE client_return_items ADD COLUMN IF NOT EXISTS ${name} ${type};`).join("\n")}
CREATE INDEX IF NOT EXISTS client_return_items_return_idx ON client_return_items (return_id);
-- Linko's id of a copied order line («Заказ: N от … (id)» of the return form's picker and lines); NULL = made here.
-- Filled by scripts/linko-sync/import-return-order-lines.mjs.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS linko_order_product_id INTEGER;
`

const SCHEMA_VERSION = 7

declare global {
  var __linkoClientReturnsSchema: { version: number; ready: Promise<void> } | undefined
}

/** Fills EMPTY client_returns.organization only (idempotent, deterministic): a return of an
 * order takes the order's organization; a return without one (or of an order without one)
 * takes resolveOrderOrganization(client, agent, warehouse) when that gives a name. A set
 * organization is never changed. A failure only logs a warning. */
async function backfillReturnOrganizations(): Promise<void> {
  try {
    await withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(72120933)")
      await tx.exec(`UPDATE client_returns r SET organization = btrim(o.organization)
        FROM orders o
        WHERE o.id = r.order_id AND fin_place(r.organization) = '' AND fin_place(o.organization) <> ''`)
      const rows = (await tx
        .prepare(
          `SELECT r.id, r.client_id, COALESCE(NULLIF(btrim(r.agent), ''), c.agent, '') AS agent, r.warehouse
             FROM client_returns r LEFT JOIN clients c ON c.id = r.client_id
            WHERE fin_place(r.organization) = '' ORDER BY r.id`,
        )
        .all()) as Array<{ id: number; client_id: number | null; agent: string; warehouse: string }>
      for (const row of rows) {
        const organization = await resolveOrderOrganization(tx, "", { clientId: row.client_id, agent: row.agent, warehouse: row.warehouse }).catch(() => "")
        if (!placeName(organization)) continue
        await tx
          .prepare("UPDATE client_returns SET organization = @organization WHERE id = @id AND fin_place(organization) = ''")
          .run({ id: row.id, organization })
      }
    })
  } catch (error) {
    console.warn("[client-returns] organization backfill skipped:", (error as Error).message)
  }
}

export function ensureClientReturnsSchema(): Promise<void> {
  if (globalThis.__linkoClientReturnsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(async () => {
      // ensureOrdersSchema also installs the fin_* helpers (ensureFinanceSchema) the backfill uses.
      await ensureOrdersSchema()
      await withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(72120933)")
        await tx.exec(DDL)
      })
      await backfillReturnOrganizations()
    }).catch((error) => {
      globalThis.__linkoClientReturnsSchema = undefined
      throw error
    })
    globalThis.__linkoClientReturnsSchema = { version: SCHEMA_VERSION, ready }
  }
  // The returns' «Логи» table (lib/client-return-logs-repo.ts) needs client_returns.
  return globalThis.__linkoClientReturnsSchema!.ready.then(ensureClientReturnLogsSchema)
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type ReturnRow = {
  id: number
  client_id: number | null
  client: string
  warehouse: string
  order_id: number | null
  return_date: string
  status: string
  currency: string
  amount: number
  comment: string
  deliverer: string
  agent: string
  organization?: string | null
  created_by: string
  created_at: string
  accepted_at: string | null
  accepted_by: string
  unaccepted_at?: string | null
  unaccepted_by?: string | null
  cancelled_at?: string | null
  cancelled_by?: string | null
  payment_type?: string | null
  price_list?: string | null
  linko_payment_type?: string | null
  client_credit?: number | string | null
  reason?: string | null
  on_delivery?: number | string | null
  c_zone?: string | null
  c_branch?: string | null
  c_shop_branch?: string | null
  c_type?: string | null
  x_account?: string | null
  x_account_id?: number | string | null
  x_codes?: string | null
  x_products?: string | null
  x_brands?: string | null
  x_from_order?: boolean | null
  item_count?: number | string | null
}

type ItemRow = {
  id: number
  return_id: number
  product_id: number | null
  product_name: string
  unit: string
  quantity: number
  price: number
  order_item_id: number | null
  x_order_id?: number | null
  x_order_created?: string | null
  x_box_amount?: string | number | null
  x_box_unit?: string | null
  linko_order_product_id?: number | null
  is_bonus?: number | string | null
  promotion?: string | null
  x_order_bonus?: number | string | null
  x_order_line_linko?: number | string | null
}

/** Linko's name of a copied return's payment type while the return still has that payment type ('' otherwise). */
/** The return's own payment type. payment_type is the ledger's (how the client was credited); a copied return whose
 * Linko payment type differs from it (Linko's cash return credited by transfer, or with no credit) keeps Linko's as
 * `own` in linko_payment_type, valid while the return still has the payment type it was copied with. */
export function returnOwnPaymentType(row: { payment_type?: string | null; linko_payment_type?: string | null }): string {
  const current = row.payment_type ?? ""
  try {
    const stored = row.linko_payment_type ? (JSON.parse(row.linko_payment_type) as { key?: unknown; own?: unknown }) : null
    if (stored && stored.key === current && (stored.own === "cash" || stored.own === "bank")) return stored.own
  } catch {
    // Not Linko's JSON: the stored payment type.
  }
  return current
}

function linkoPaymentTypeName(row: ReturnRow): string {
  try {
    const stored = row.linko_payment_type ? (JSON.parse(row.linko_payment_type) as { name?: unknown; key?: unknown }) : null
    if (!stored || typeof stored.name !== "string") return ""
    // key: the payment type the return had when it was copied; an edit to another one shows that one instead.
    return (row.payment_type ?? "") === stored.key ? stored.name : ""
  } catch {
    return ""
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100
const roundQty = (value: number) => Math.round(value * 1e6) / 1e6
/** Money as Linko keeps it (0.12345 USD, 0.123456789 USD): only the float noise of a product or a sum is dropped. */
const roundMoney = (value: number) => (Number.isFinite(value) ? Number(value.toPrecision(15)) : 0)

function rowToReturn(row: ReturnRow): ClientReturn {
  const status = (CLIENT_RETURN_STATUSES as string[]).includes(row.status) ? (row.status as ClientReturnStatus) : "pending"
  return {
    id: row.id,
    clientId: row.client_id,
    client: row.client,
    zone: row.c_zone ?? "",
    warehouse: row.warehouse,
    orderId: row.order_id,
    returnDate: row.return_date,
    status,
    currency: row.currency,
    amount: Number(row.amount) || 0,
    comment: row.comment,
    deliverer: row.deliverer,
    agent: row.agent,
    organization: row.organization ?? "",
    createdBy: row.created_by,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at || null,
    acceptedBy: row.accepted_by,
    unacceptedAt: row.unaccepted_at || null,
    unacceptedBy: row.unaccepted_by ?? "",
    cancelledAt: row.cancelled_at || null,
    cancelledBy: row.cancelled_by ?? "",
    branch: row.c_branch ?? "",
    clientType: row.c_type ?? "",
    account: row.x_account ?? "",
    accountId: row.x_account_id === undefined || row.x_account_id === null ? null : Number(row.x_account_id),
    shopBranch: row.c_shop_branch ?? "",
    markCodes: (row.x_codes ?? "").split("\n").filter(Boolean),
    paymentType: row.payment_type ?? "",
    paymentTypeName: linkoPaymentTypeName(row),
    returnPaymentType: returnOwnPaymentType(row),
    priceList: row.price_list ?? "",
    reason: row.reason ?? "",
    onDelivery: String(row.on_delivery ?? "") === "1" || String(row.on_delivery ?? "") === "true",
    productIds: (row.x_products ?? "").split(",").filter(Boolean).map(Number),
    brands: (row.x_brands ?? "").split("\n").filter(Boolean),
    fromOrder: Boolean(row.x_from_order),
    itemCount: row.item_count === undefined || row.item_count === null ? undefined : Number(row.item_count),
  }
}

function rowToItem(row: ItemRow): ClientReturnItem {
  const quantity = Number(row.quantity) || 0
  const price = Number(row.price) || 0
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    quantity,
    price,
    // Linko's sum of a line keeps its decimals (1 × 0.123456789 USD = 0,12346 on the card).
    total: roundMoney(quantity * price),
    orderItemId: row.order_item_id,
    orderId: row.x_order_id ?? null,
    orderCreatedAt: row.x_order_created ?? null,
    boxAmount: Number(row.x_box_amount) || 0,
    boxUnit: row.x_box_unit ?? "",
    // A line made here shows its order line's Linko id when that line was copied from Linko.
    orderLineId: row.is_bonus === null || row.is_bonus === undefined ? Number(row.x_order_line_linko) || row.order_item_id : (row.linko_order_product_id ?? null),
    isBonus: Number(row.is_bonus ?? row.x_order_bonus) === 1,
    promotion: row.promotion ?? "",
  }
}

/** The returns read with what the list and the card show: the shop's zone, branch and type, the client account the
 * return is booked on (its own, else the shop's — Linko's «Финансовый счет»), the lines' products and brands.
 * The account tables exist once Клиенты → Финансовые счета was opened (lib/financial-accounts-repo.ts). */
async function selectSql(db: PgDb): Promise<string> {
  const accounts = (await db.prepare("SELECT to_regclass('financial_accounts') IS NOT NULL AND to_regclass('financial_account_markets') IS NOT NULL AS ok").get()) as { ok: boolean }
  const account = accounts.ok
    ? `(SELECT fa.name FROM financial_accounts fa WHERE fa.id = COALESCE(NULLIF(to_jsonb(r) ->> 'financial_account_id', '')::int,
         (SELECT fm.financial_account_id FROM financial_account_markets fm WHERE fm.client_id = r.client_id), NULLIF(to_jsonb(c) ->> 'financial_account_id', '')::int))`
    : "NULL::text"
  // A copied return shows the account Linko's card names while it still belongs to the same shop (an edit that moves
  // it to another shop falls back to that shop's account).
  const linkoAccount = `NULLIF(to_jsonb(r) ->> 'linko_account', '')::jsonb`
  const ownAccount = `CASE WHEN (${linkoAccount} ->> 'market')::int = r.client_id THEN ${
    accounts.ok ? `COALESCE((SELECT fa.name FROM financial_accounts fa WHERE fa.id = (${linkoAccount} ->> 'id')::int), ${linkoAccount} ->> 'name')` : `${linkoAccount} ->> 'name'`
  } END`
  // The same account's id (the list filter «Финансовый счет» matches by it, like Linko's ?client=<id>).
  const ownAccountId = `CASE WHEN (${linkoAccount} ->> 'market')::int = r.client_id THEN (${linkoAccount} ->> 'id')::int END`
  const accountId = accounts.ok
    ? `COALESCE(NULLIF(to_jsonb(r) ->> 'financial_account_id', '')::int,
         (SELECT fm.financial_account_id FROM financial_account_markets fm WHERE fm.client_id = r.client_id), NULLIF(to_jsonb(c) ->> 'financial_account_id', '')::int)`
    : "NULL::int"
  // The lines' marking codes (the list filter «Код»); the table exists once a return's marks were read or imported.
  const marks = (await db.prepare("SELECT to_regclass('client_return_item_marks') IS NOT NULL AS ok").get()) as { ok: boolean }
  const codes = marks.ok ? `(SELECT string_agg(DISTINCT m.code, E'\\n') FROM client_return_item_marks m WHERE m.return_id = r.id AND m.code <> '')` : "NULL::text"
  return `SELECT r.*, c.zone AS c_zone, COALESCE(to_jsonb(r) ->> 'linko_branch', to_jsonb(c) ->> 'branch') AS c_branch,
    to_jsonb(c) ->> 'branch' AS c_shop_branch, to_jsonb(c) ->> 'type' AS c_type,
    COALESCE(${ownAccount}, ${account}) AS x_account,
    COALESCE(${ownAccountId}, ${accountId}) AS x_account_id,
    ${codes} AS x_codes,
    (SELECT COUNT(*) FROM client_return_items i WHERE i.return_id = r.id) AS item_count,
    (SELECT string_agg(DISTINCT i.product_id::text, ',') FROM client_return_items i WHERE i.return_id = r.id AND i.product_id IS NOT NULL) AS x_products,
    (r.order_id IS NOT NULL OR EXISTS (SELECT 1 FROM client_return_items i WHERE i.return_id = r.id AND i.order_item_id IS NOT NULL)) AS x_from_order,
    (SELECT string_agg(DISTINCT btrim(to_jsonb(p) ->> 'brand'), E'\\n') FROM client_return_items i JOIN products p ON p.id = i.product_id
      WHERE i.return_id = r.id AND btrim(COALESCE(to_jsonb(p) ->> 'brand', '')) <> '') AS x_brands
  FROM client_returns r LEFT JOIN clients c ON c.id = r.client_id`
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type ClientReturnQuery = {
  tab?: "pending" | "accepted" | "cancelled" | "all"
  search?: string
  warehouse?: string
  clientId?: number
  orderId?: number
  from?: string
  to?: string
}

export type ClientReturnList = { rows: ClientReturn[]; totals: Array<{ currency: string; amount: number }> }

export async function listClientReturns(query: ClientReturnQuery = {}): Promise<ClientReturnList> {
  await ensureClientReturnsSchema()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (query.tab && query.tab !== "all") {
    where.push("r.status = @status")
    params.status = query.tab
  }
  if (query.search?.trim()) {
    where.push(`(r.id::text = @searchId OR ${keySql("r.client")} LIKE '%' || ${keySql("@search::text")} || '%' OR r.order_id::text = @searchId)`)
    params.search = query.search.trim()
    params.searchId = query.search.trim()
  }
  if (query.warehouse?.trim()) {
    where.push(`${keySql("r.warehouse")} = ${keySql("@warehouse::text")}`)
    params.warehouse = query.warehouse.trim()
  }
  if (query.clientId) {
    where.push("r.client_id = @clientId")
    params.clientId = query.clientId
  }
  if (query.orderId) {
    where.push("r.order_id = @orderId")
    params.orderId = query.orderId
  }
  if (query.from) {
    where.push("r.return_date >= @from")
    params.from = query.from
  }
  if (query.to) {
    where.push("r.return_date <= @to")
    params.to = query.to
  }
  const db = getDb()
  const sql = `${await selectSql(db)} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.id DESC LIMIT 5000`
  const statement = db.prepare(sql)
  const rows = ((Object.keys(params).length ? await statement.all(params) : await statement.all()) as ReturnRow[]).map(rowToReturn)
  const totals = new Map<string, AmountSum>()
  // Summed unrounded (exact decimals) and rounded once to the decimals of Настройки → Округление сумм, like the
  // reference's band.
  for (const row of rows) if (row.status !== "cancelled") totals.set(row.currency, (totals.get(row.currency) ?? new AmountSum()).add(row.amount))
  return { rows, totals: [...totals].map(([currency, amount]) => ({ currency, amount: roundToDigits(amount.value(), amountDigits()) })) }
}

async function loadReturn(db: PgDb, id: number, lock = false): Promise<ReturnRow | undefined> {
  return (await db.prepare(`SELECT * FROM client_returns WHERE id = ?${lock ? " FOR UPDATE" : ""}`).get(id)) as ReturnRow | undefined
}

export async function getClientReturn(id: number): Promise<ClientReturn | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureClientReturnsSchema()
  const db = getDb()
  const row = (await db.prepare(`${await selectSql(db)} WHERE r.id = ?`).get(id)) as ReturnRow | undefined
  if (!row) return null
  // Each line with its order (the order line's order, else the return's own) and the product's box.
  const items = (await db
    .prepare(
      `SELECT i.*, o.id AS x_order_id, o.created_at AS x_order_created, to_jsonb(p) ->> 'box_amount' AS x_box_amount, to_jsonb(p) ->> 'box_unit' AS x_box_unit,
              to_jsonb(oi) ->> 'is_bonus' AS x_order_bonus, to_jsonb(oi) ->> 'linko_order_product_id' AS x_order_line_linko
         FROM client_return_items i
         LEFT JOIN order_items oi ON oi.id = i.order_item_id
         LEFT JOIN orders o ON o.id = COALESCE(oi.order_id, (SELECT r.order_id FROM client_returns r WHERE r.id = i.return_id))
         LEFT JOIN products p ON p.id = i.product_id
        WHERE i.return_id = ? ORDER BY i.id`,
    )
    .all(id)) as ItemRow[]
  const result = rowToReturn(row)
  // Linko clears the order line id (order_product) of a return's lines when it cancels the return: none is shown then.
  return { ...result, items: items.map(rowToItem).map((item) => (result.status === "cancelled" ? { ...item, orderLineId: null } : item)) }
}

export type ReturnableLine = {
  orderItemId: number
  orderId: number
  /** The order's creation moment (orders.created_at, UTC text). */
  orderCreatedAt: string
  productId: number | null
  productName: string
  unit: string
  ordered: number
  returned: number
  available: number
  price: number
  currency: string
  /** A bonus line of the order (Linko's «Бонус»). */
  isBonus?: boolean
  /** The «(N)» of «Заказ: N (N)»: Linko's id of a copied order line, else orderItemId. */
  orderLineId?: number
}

/** What can still be returned of an order: per order line, the shipped quantity
 * minus the quantities of its other (not cancelled) returns. */
export async function returnableOfOrder(orderId: number, exceptReturnId = 0, db: PgDb = getDb()): Promise<ReturnableLine[]> {
  return returnableOfOrders([orderId], exceptReturnId, db)
}

/** returnableOfOrder for several orders at once (lines by order id, then line id). A returned line counts against
 * its own order line whatever order the return names (a return of a client over several orders, like Linko's, has
 * lines of many orders); a line recorded by product only counts against the lines of that product of the return's
 * own order. */
export async function returnableOfOrders(orderIds: number[], exceptReturnId = 0, db: PgDb = getDb()): Promise<ReturnableLine[]> {
  await ensureClientReturnsSchema()
  const ids = [...new Set(orderIds)].filter((id) => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) return []
  const lines = (await db
    .prepare("SELECT oi.*, o.created_at AS x_order_created FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.order_id = ANY(@ids::int[]) ORDER BY oi.order_id, oi.id")
    .all({ ids })) as Array<{
    id: number
    order_id: number
    x_order_created: string | null
    product_id: number | null
    product_name: string
    unit: string
    quantity: number
    unit_price: number
    discount_percent: number
    currency: string
    is_bonus?: number | null
    linko_order_product_id?: number | null
  }>
  const returned = (await db
    .prepare(
      `SELECT r.order_id, i.order_item_id, i.product_id, SUM(i.quantity) AS qty FROM client_return_items i JOIN client_returns r ON r.id = i.return_id
        WHERE r.status <> 'cancelled' AND r.id <> @except
          AND (r.order_id = ANY(@ids::int[]) OR i.order_item_id IN (SELECT oi.id FROM order_items oi WHERE oi.order_id = ANY(@ids::int[])))
        GROUP BY 1, 2, 3`,
    )
    .all({ ids, except: exceptReturnId })) as Array<{ order_id: number | null; order_item_id: number | null; product_id: number | null; qty: number }>
  const byLine = new Map<number, number>()
  const byProduct = new Map<string, number>()
  for (const row of returned) {
    if (row.order_item_id) byLine.set(row.order_item_id, (byLine.get(row.order_item_id) ?? 0) + Number(row.qty))
    else if (row.product_id && row.order_id) {
      const key = `${row.order_id}:${row.product_id}`
      byProduct.set(key, (byProduct.get(key) ?? 0) + Number(row.qty))
    }
  }
  return lines.map((line) => {
    let done = byLine.get(line.id) ?? 0
    // Returns recorded by product only take from the order's lines of that product in order.
    const key = `${line.order_id}:${line.product_id}`
    if (line.product_id && byProduct.get(key)) {
      const take = Math.min(Number(line.quantity) - done, byProduct.get(key)!)
      done += take
      byProduct.set(key, byProduct.get(key)! - take)
    }
    const ordered = Number(line.quantity)
    return {
      orderItemId: line.id,
      orderId: line.order_id,
      orderCreatedAt: line.x_order_created ?? "",
      productId: line.product_id,
      productName: line.product_name,
      unit: line.unit,
      ordered,
      returned: roundQty(done),
      available: roundQty(Math.max(0, ordered - done)),
      price: roundMoney(lineTotal(line) / (ordered || 1)),
      currency: line.currency,
      isBonus: Number(line.is_bonus) === 1,
      orderLineId: Number(line.linko_order_product_id) || line.id,
    }
  })
}

/** The shipped orders (В пути / Доставлено) of a client: by client id, or by name for an order without one (as
 * prepareReturn checks them), newest first. */
async function releasedOrdersOf(db: PgDb, clientId: number): Promise<number[]> {
  const rows = (await db
    .prepare(
      `SELECT o.id FROM orders o JOIN clients c ON c.id = @clientId
        WHERE (o.client_id = c.id OR (o.client_id IS NULL AND ${keySql("o.client")} = ${keySql("c.name")})) AND o.status = ANY(@statuses::text[])
        ORDER BY o.id DESC`,
    )
    .all({ clientId, statuses: [...RELEASED_STATUSES] })) as Array<{ id: number }>
  return rows.map((row) => Number(row.id))
}

/** Every line of a client's shipped orders that can still be returned (Linko's sales/order_product/for_return/?market=),
 * newest order first. `exceptReturnId`: the edited return's own lines do not count. */
export async function returnableOfClient(clientId: number, exceptReturnId = 0, db: PgDb = getDb()): Promise<ReturnableLine[]> {
  await ensureClientReturnsSchema()
  const orders = await releasedOrdersOf(db, clientId)
  const lines = await returnableOfOrders(orders, exceptReturnId, db)
  const rank = new Map(orders.map((id, index) => [id, index]))
  return lines.filter((line) => line.available > 0).sort((a, b) => (rank.get(a.orderId) ?? 0) - (rank.get(b.orderId) ?? 0) || a.orderItemId - b.orderItemId)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export class ClientReturnError extends OrderError {}

function assertIsoDay(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ClientReturnError("Дата: формат YYYY-MM-DD", 400, { field })
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ClientReturnError("Несуществующая дата", 400, { field })
  // Every document date has a year within 2000..2100 (lib/document-dates.ts).
  if (!docYearOk(value)) throw new ClientReturnError(DOC_DATE_INVALID, 400, { field })
}

/** `returnLineId`: the edited return's line it stands for (ClientReturnLineInput.id). */
type ResolvedReturnLine = { productId: number | null; productName: string; unit: string; quantity: number; price: number; orderItemId: number | null; returnLineId?: number }

async function resolveProductForReturn(db: PgDb, input: { productId?: number; productName?: string }): Promise<{ id: number; name: string; unit: string }> {
  let row: { id: number; name: string; unit: string; deleted: number } | undefined
  if (input.productId) {
    row = (await db.prepare("SELECT id, name, unit, deleted FROM products WHERE id = ?").get(input.productId)) as typeof row
  } else if (input.productName?.trim()) {
    row = (await db
      .prepare(`SELECT id, name, unit, deleted FROM products WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY deleted, id LIMIT 1`)
      .get({ name: input.productName.trim() })) as typeof row
  } else {
    throw new ClientReturnError("Укажите товар", 400, { field: "productId" })
  }
  if (!row) throw new ClientReturnError("Товар не найден в каталоге", 400, { field: "productId" })
  if (row.deleted === 1) throw new ClientReturnError(`Товар «${row.name}» удален`, 400, { field: "productId" })
  return { id: row.id, name: row.name, unit: row.unit || "шт." }
}

type OrderInfo = { id: number; client_id: number | null; client: string; status: string; warehouse: string; currency: string; amount: string; organization: string | null }

/** A known price list by name ('' = none); 400 when there is no such list. */
async function resolveReturnPriceList(db: PgDb, name: string | undefined): Promise<string> {
  const wanted = name?.trim() ?? ""
  if (!wanted) return ""
  const table = (await db.prepare("SELECT to_regclass('price_lists') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!table.ok) throw new ClientReturnError("Прайс-лист не найден", 400, { field: "priceList" })
  const row = (await db.prepare(`SELECT name FROM price_lists WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`).get({ name: wanted })) as
    | { name: string }
    | undefined
  if (!row) throw new ClientReturnError("Прайс-лист не найден", 400, { field: "priceList" })
  return row.name
}

/** `currentDate` = the edited return's own return_date: an edit may keep it (even a future one).
 * `keepNoOrder`: lines of one order do not make it a return of that order (an edited client return without one). */
async function prepareReturn(db: PgDb, input: ClientReturnInput, exceptReturnId: number, currentDate?: string | null, options: { keepNoOrder?: boolean } = {}) {
  const client = await resolveClient(db, { clientId: input.clientId, client: input.client })
  const warehouse = input.warehouse?.trim() ? await resolveWarehouse(db, input.warehouse) : ""
  const returnDate = input.returnDate?.trim() || todayIso()
  assertIsoDay(returnDate, "returnDate")
  // A money and stock document: never dated after today (Asia/Tashkent), like write-offs and payments.
  const dateError = docDateError(returnDate, { current: currentDate ?? undefined })
  if (dateError) throw new ClientReturnError(dateError, 400, { field: "returnDate" })
  const deliverer = input.deliverer?.trim() ? await resolveEmployee(db, input.deliverer, "deliverer", "Доставщик") : ""
  const agent = input.agent?.trim() ? await resolveEmployee(db, input.agent, "agent", "Ответственный агент") : ""

  let order: OrderInfo | undefined
  if (input.orderId) {
    order = (await db.prepare("SELECT id, client_id, client, status, warehouse, currency, amount, organization FROM orders WHERE id = ?").get(input.orderId)) as OrderInfo | undefined
    if (!order) throw new ClientReturnError("Заказ не найден", 400, { field: "orderId" })
    const sameClient = order.client_id ? order.client_id === client.id : nameKey(order.client) === nameKey(client.name)
    if (!sameClient) throw new ClientReturnError("Заказ принадлежит другому клиенту", 400, { field: "orderId" })
    if (!RELEASED_STATUSES.includes(order.status)) throw new ClientReturnError("Возврат возможен только по отгруженному заказу (В пути / Доставлено)", 409, { field: "orderId" })
  }

  // A return of a client over several orders (Linko's «Возврат по конкретному клиенту» without one order and
  // «Возврат по всем заказам»): every line names its order line, each limited like a return of its order. Lines of
  // one order only make it a return of that order.
  let multi: OrderInfo[] | undefined
  const lineIds = (input.items ?? []).map((raw) => raw.orderItemId).filter((value): value is number => Boolean(value))
  if (!order && lineIds.length) {
    if (lineIds.length !== (input.items ?? []).length) throw new ClientReturnError("Позиция не входит в заказ", 400, { field: "orderItemId" })
    const owners = (await db.prepare("SELECT id, order_id FROM order_items WHERE id = ANY(@ids::int[])").all({ ids: lineIds })) as Array<{ id: number; order_id: number }>
    if (owners.length !== new Set(lineIds).size) throw new ClientReturnError("Позиция не входит в заказ", 400, { field: "orderItemId" })
    const found = (await db
      .prepare("SELECT id, client_id, client, status, warehouse, currency, amount, organization FROM orders WHERE id = ANY(@ids::int[]) ORDER BY id")
      .all({ ids: [...new Set(owners.map((row) => Number(row.order_id)))] })) as OrderInfo[]
    for (const row of found) {
      const sameClient = row.client_id ? row.client_id === client.id : nameKey(row.client) === nameKey(client.name)
      if (!sameClient) throw new ClientReturnError("Заказ принадлежит другому клиенту", 400, { field: "orderItemId" })
      if (!RELEASED_STATUSES.includes(row.status)) throw new ClientReturnError("Возврат возможен только по отгруженному заказу (В пути / Доставлено)", 409, { field: "orderItemId" })
    }
    if (found.length === 1 && !options.keepNoOrder) order = found[0]
    else multi = found
  }

  let currency: string
  if (multi) {
    // One return is one amount in one currency: orders of different currencies are returned separately.
    const base = await baseCurrency(db)
    const codes = [...new Set(multi.map((row) => (row.currency || parseMoneyText(row.amount)?.currency || base).toUpperCase()))]
    if (codes.length > 1) throw new ClientReturnError("Товары из заказов в разных валютах: оформите отдельные возвраты", 400, { field: "items" })
    currency = multi[0].currency || parseMoneyText(multi[0].amount)?.currency || base
    if (input.currency?.trim() && input.currency.trim().toUpperCase() !== currency.toUpperCase()) {
      throw new ClientReturnError(`Валюта возврата должна совпадать с валютой заказа (${currency})`, 400, { field: "currency" })
    }
  } else if (order) {
    currency = order.currency || parseMoneyText(order.amount)?.currency || (await baseCurrency(db))
    if (input.currency?.trim() && input.currency.trim().toUpperCase() !== currency.toUpperCase()) {
      throw new ClientReturnError(`Валюта возврата должна совпадать с валютой заказа (${currency})`, 400, { field: "currency" })
    }
  } else {
    currency = input.currency?.trim() ? await resolveCurrency(db, input.currency) : await baseCurrency(db)
  }

  const lines: ResolvedReturnLine[] = []
  const returnable = order ? await returnableOfOrder(order.id, exceptReturnId, db) : multi ? await returnableOfOrders(multi.map((row) => row.id), exceptReturnId, db) : []
  const left = new Map(returnable.map((line) => [line.orderItemId, line.available]))
  let inputs = input.items ?? []
  if (!inputs.length && input.full && order) {
    inputs = returnable.filter((line) => line.available > 0).map((line) => ({ orderItemId: line.orderItemId, quantity: line.available }))
    if (!inputs.length) throw new ClientReturnError("По этому заказу нечего возвращать", 409, { field: "items" })
  }
  if (!inputs.length) throw new ClientReturnError("Добавьте товары возврата", 400, { field: "items" })
  for (const raw of inputs) {
    const quantity = Number(raw.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QTY) throw new ClientReturnError("Количество должно быть больше 0", 400, { field: "quantity" })
    if (raw.price !== undefined && (!Number.isFinite(Number(raw.price)) || Number(raw.price) < 0 || Number(raw.price) > MAX_MONEY)) {
      throw new ClientReturnError("Цена должна быть от 0 до 10 000 000 000 000", 400, { field: "price" })
    }
    if (order || multi) {
      let line = raw.orderItemId ? returnable.find((entry) => entry.orderItemId === raw.orderItemId) : undefined
      if (raw.orderItemId && !line) throw new ClientReturnError("Позиция не входит в заказ", 400, { field: "orderItemId" })
      if (!line && order) {
        const product = await resolveProductForReturn(db, raw)
        line = returnable.find((entry) => entry.productId === product.id && (left.get(entry.orderItemId) ?? 0) > 0) ?? returnable.find((entry) => entry.productId === product.id)
        if (!line) throw new ClientReturnError(`Товар «${product.name}» не входит в заказ №${order.id}`, 400, { field: "productId" })
      }
      if (!line) throw new ClientReturnError("Позиция не входит в заказ", 400, { field: "orderItemId" })
      const available = left.get(line.orderItemId) ?? 0
      if (quantity > available + 1e-9) {
        throw new ClientReturnError(`Количество возврата больше доступного: ${line.productName} — доступно ${available}`, 409, { field: "quantity", available })
      }
      left.set(line.orderItemId, roundQty(available - quantity))
      lines.push({
        productId: line.productId,
        productName: line.productName,
        unit: line.unit,
        quantity,
        price: raw.price !== undefined ? Number(raw.price) : line.price,
        orderItemId: line.orderItemId,
        returnLineId: raw.id,
      })
    } else {
      const product = await resolveProductForReturn(db, raw)
      if (raw.price === undefined) throw new ClientReturnError(`Укажите цену возврата для «${product.name}»`, 400, { field: "price" })
      lines.push({ productId: product.id, productName: product.name, unit: product.unit, quantity, price: Number(raw.price), orderItemId: null, returnLineId: raw.id })
    }
  }
  const amount = roundMoney(lines.reduce((sum, line) => sum + line.quantity * line.price, 0))
  if (amount > MAX_MONEY) throw new ClientReturnError("Сумма возврата слишком большая", 400, { field: "items" })
  const priceList = await resolveReturnPriceList(db, input.priceList)
  // A return of an order belongs to the order's organization; otherwise the chosen one
  // (must be known, 400) or the order fallbacks (contracts → agent → warehouse manager → the only one).
  // Several orders: theirs when they share one.
  const multiOrganizations = multi ? [...new Set(multi.map((row) => placeName(row.organization)))] : []
  const organization =
    order && placeName(order.organization)
      ? String(order.organization).trim()
      : multi && multiOrganizations.length === 1 && multiOrganizations[0]
        ? String(multi[0].organization).trim()
        : await resolveOrderOrganization(db, input.organization, { clientId: client.id, agent: agent || client.agent || "", warehouse })
  return { client, warehouse, returnDate, deliverer, agent, order, currency, lines, amount, organization, priceList }
}

async function writeLines(db: PgDb, returnId: number, lines: ResolvedReturnLine[]) {
  await db.prepare("DELETE FROM client_return_items WHERE return_id = ?").run(returnId)
  for (const line of lines) {
    await db
      .prepare(
        `INSERT INTO client_return_items (return_id, product_id, product_name, unit, quantity, price, order_item_id)
         VALUES (@returnId, @productId, @productName, @unit, @quantity, @price, @orderItemId)`,
      )
      .run({ returnId, ...line })
  }
}

async function lockReturns(db: PgDb) {
  await db.exec("SELECT pg_advisory_xact_lock(72120934)")
}

/** `at`: the acceptance moment (ISO UTC); default now. */
async function acceptRow(db: PgDb, row: ReturnRow, user: string, at = new Date().toISOString()) {
  if (row.status !== "pending") throw new ClientReturnError(row.status === "accepted" ? "Возврат уже принят" : "Отмененный возврат нельзя принять", 409, { id: row.id })
  if (!row.warehouse.trim()) throw new ClientReturnError("Укажите склад возврата", 400, { field: "warehouse", id: row.id })
  await resolveWarehouse(db, row.warehouse)
  const items = (await db.prepare("SELECT COUNT(*)::int AS n FROM client_return_items WHERE return_id = ?").get(row.id)) as { n: number }
  if (!items.n) throw new ClientReturnError("В возврате нет товаров", 400, { id: row.id })
  await db
    .prepare("UPDATE client_returns SET status = 'accepted', accepted_at = @at, accepted_by = @user, updated_at = datetime('now') WHERE id = @id")
    .run({ id: row.id, at, user })
  await logClientReturn(db, row.id, "accepted_to_stock", user)
}

/** The acceptance moment of «Принять на склад» with a chosen day (Linko's «Дата»): that local day at the current local
 * time (Linko's accepted time), now for today; no day = now. 400 for a day after today. */
function acceptMomentOn(day?: string): string {
  if (!day) return new Date().toISOString()
  assertIsoDay(day, "date")
  const dateError = docDateError(day)
  if (dateError) throw new ClientReturnError(dateError, 400, { field: "date" })
  if (day === todayIso()) return new Date().toISOString()
  const utc = localToUtcText(`${day}T${nowLocalIso().slice(11, 19)}`)
  return utc ? `${utc.replace(" ", "T")}.000Z` : new Date().toISOString()
}

/** A return created already accepted reaches the warehouse on its own return day: today = now,
 * an earlier day = the end of that local day (after the day's other movements, as transfers do). */
function acceptMomentOf(returnDate: string): string {
  if (!returnDate || returnDate >= todayIso()) return new Date().toISOString()
  const utc = localToUtcText(`${returnDate}T23:59:59`)
  return utc ? `${utc.replace(" ", "T")}.000Z` : new Date().toISOString()
}

export async function createClientReturn(input: ClientReturnInput, user: { displayName: string }): Promise<ClientReturn> {
  await ensureClientReturnsSchema()
  // The added_return_order notification is written inside the return transaction.
  await ensureUserNotificationsSchema()
  const id = await withTransaction(async (tx) => {
    await lockReturns(tx)
    // orderId null: a client return without an order stays one even when its lines are of one order (Linko).
    const prepared = await prepareReturn(tx, input, 0, undefined, { keepNoOrder: input.orderId === null })
    if (input.accept && !prepared.warehouse) throw new ClientReturnError("Укажите склад возврата", 400, { field: "warehouse" })
    const inserted = await tx
      .prepare(
        `INSERT INTO client_returns (client_id, client, warehouse, order_id, return_date, status, currency, amount, comment, created_by, deliverer, agent, organization, payment_type, price_list)
         VALUES (@clientId, @client, @warehouse, @orderId, @returnDate, 'pending', @currency, @amount, @comment, @createdBy, @deliverer, @agent, @organization, @paymentType, @priceList)`,
      )
      .run({
        clientId: prepared.client.id,
        client: prepared.client.name,
        warehouse: prepared.warehouse,
        orderId: prepared.order?.id ?? null,
        returnDate: prepared.returnDate,
        currency: prepared.currency,
        amount: prepared.amount,
        comment: input.comment?.trim() ?? "",
        createdBy: user.displayName,
        deliverer: prepared.deliverer,
        agent: prepared.agent,
        organization: prepared.organization,
        paymentType: input.paymentType ?? "",
        priceList: prepared.priceList,
      })
    const returnId = Number(inserted.lastInsertRowid)
    await writeLines(tx, returnId, prepared.lines)
    await logClientReturn(tx, returnId, "created", user.displayName)
    if (input.accept) await acceptRow(tx, (await loadReturn(tx, returnId, true))!, user.displayName, acceptMomentOf(prepared.returnDate))
    // Настройки → Уведомления "added_return_order": the administrators, the subscribers and the client's agent (in
    // this transaction: a rolled-back return notifies nobody; a failed notification never undoes it).
    await notifySafely("added_return_order", () =>
      notifyTemplate(
        "added_return_order",
        { total_price: prepared.amount.toFixed(2), currency: prepared.currency, client_name: prepared.client.name, created_by: user.displayName },
        { objectId: returnId, link: "/analytics/returns", employeeNames: [prepared.client.agent ?? ""] },
      ),
    )
    return returnId
  })
  return (await getClientReturn(id))!
}

/** Linko's can_change_completed_return_product_price (here: an administrator). Without it only a pending return of
 * order lines is edited; with it also an accepted one (Linko's editOnlyCost: quantities, prices and the return's own
 * data, never its warehouse, client, order, currency or set of lines), a cancelled one and one without an order
 * («Со старой базы»). */
export type ClientReturnUpdateOptions = { canChangeCompleted?: boolean }

/** A line of «Подтверждение возврата» (Linko's client_return_preview answer). */
export type ClientReturnPreviewLine = { productName: string; unit: string; orderId: number | null; quantity: number; price: number; currency: string; total: number }

type PreparedReturn = Awaited<ReturnType<typeof prepareReturn>>
type LinePair = { item: ItemRow; line: ResolvedReturnLine }

/** Everything an edit of `row` checks, without writing (the save and its preview share it). */
async function planUpdate(tx: PgDb, row: ReturnRow, input: ClientReturnInput, options: ClientReturnUpdateOptions) {
  const existing = (await tx.prepare("SELECT * FROM client_return_items WHERE return_id = ? ORDER BY id").all(row.id)) as ItemRow[]
  const oldBase = row.order_id === null && existing.every((item) => item.order_item_id === null)
  if ((row.status !== "pending" || oldBase) && !options.canChangeCompleted) throw new ClientReturnError("У вас нет прав на это действие", 403, { status: row.status })
  // null clears the order; nothing sent keeps it.
  const orderId = input.orderId === null ? undefined : (input.orderId ?? row.order_id ?? undefined)
  const storedPriceList = row.price_list ?? ""
  const priceListChanged = input.priceList !== undefined && nameKey(input.priceList) !== nameKey(storedPriceList)
  const merged: ClientReturnInput = {
    clientId: input.clientId ?? (input.client ? undefined : (row.client_id ?? undefined)),
    client: input.client ?? (row.client_id ? undefined : row.client),
    warehouse: input.warehouse ?? row.warehouse,
    orderId,
    returnDate: input.returnDate ?? row.return_date,
    currency: input.currency ?? row.currency,
    deliverer: input.deliverer ?? row.deliverer,
    agent: input.agent ?? row.agent,
    organization: input.organization,
    // A stored price list is kept as it is (even one deleted since); a changed one must exist.
    priceList: priceListChanged ? input.priceList : undefined,
    items:
      input.items ??
      existing.map((item) => ({ orderItemId: item.order_item_id ?? undefined, productId: item.product_id ?? undefined, productName: item.product_name, quantity: Number(item.quantity), price: Number(item.price) })),
  }
  // A client return without an order stays one while no order is chosen (Linko's type «client»).
  const prepared: PreparedReturn = await prepareReturn(tx, merged, row.id, row.return_date, { keepNoOrder: !orderId && row.order_id === null })
  const priceList = priceListChanged ? prepared.priceList : storedPriceList
  // No organization sent: a stored one stays while the order, client, agent and warehouse
  // stay the same; any of them changed → the new default (prepared.organization).
  const sameParties =
    (prepared.order?.id ?? null) === (row.order_id ?? null) &&
    prepared.client.id === row.client_id &&
    nameKey(prepared.agent) === nameKey(row.agent) &&
    nameKey(prepared.warehouse) === nameKey(row.warehouse)
  const organization =
    input.organization === undefined && placeName(row.organization) && sameParties && !(prepared.order && placeName(prepared.order.organization))
      ? String(row.organization).trim()
      : prepared.organization
  if (row.status !== "accepted") return { prepared, organization, priceList, pairs: null, existing }

  // An accepted return already moved stock and the client's balance (both read live from it): only its quantities,
  // prices and own data change, line by line.
  if (nameKey(prepared.warehouse) !== nameKey(row.warehouse)) throw new ClientReturnError("Склад принятого возврата изменить нельзя", 409, { field: "warehouse" })
  const otherClient = row.client_id !== null ? prepared.client.id !== row.client_id : nameKey(prepared.client.name) !== nameKey(row.client)
  const otherOrder = (prepared.order?.id ?? null) !== (row.order_id ?? null)
  const otherCurrency = Boolean(row.currency) && prepared.currency.toUpperCase() !== row.currency.toUpperCase()
  if (otherClient || otherOrder || otherCurrency) {
    throw new ClientReturnError("Клиента, заказ и валюту принятого возврата изменить нельзя", 409, { field: otherClient ? "client" : otherOrder ? "orderId" : "currency" })
  }
  const keyOf = (orderItemId: number | null, productId: number | null, name: string) => (orderItemId ? `oi:${orderItemId}` : productId ? `p:${productId}` : `n:${nameKey(name)}`)
  const pool = new Map<string, ItemRow[]>()
  for (const item of existing) {
    const key = keyOf(item.order_item_id, item.product_id, item.product_name)
    pool.set(key, [...(pool.get(key) ?? []), item])
  }
  const pairs: LinePair[] = []
  // A line that names its own return line (the form sends it) takes that one, so two lines of one order line keep
  // their own quantities; any other takes the next stored line of the same order line / product.
  const unnamed: ResolvedReturnLine[] = []
  for (const line of prepared.lines) {
    const same = pool.get(keyOf(line.orderItemId, line.productId, line.productName))
    const at = line.returnLineId && same ? same.findIndex((item) => item.id === line.returnLineId) : -1
    if (at >= 0) pairs.push({ item: same!.splice(at, 1)[0], line })
    else unnamed.push(line)
  }
  for (const line of unnamed) {
    const item = pool.get(keyOf(line.orderItemId, line.productId, line.productName))?.shift()
    if (!item) throw new ClientReturnError("В принятом возврате нельзя добавлять или удалять товары", 409, { field: "items" })
    pairs.push({ item, line })
  }
  if ([...pool.values()].some((left) => left.length)) throw new ClientReturnError("В принятом возврате нельзя добавлять или удалять товары", 409, { field: "items" })
  await assertAcceptedQuantitiesChangeable(tx, row, pairs)
  return { prepared, organization, priceList, pairs, existing }
}

/** The new lines of an edited (not accepted) return: a line that stays (same order line, else same product) is updated
 * in place, so it keeps its id and what was copied from Linko with it (its Linko order line id, bonus flag and
 * promotion); the others are deleted or inserted. */
async function mergeLines(tx: PgDb, returnId: number, existing: ItemRow[], lines: ResolvedReturnLine[]) {
  const left = [...existing]
  const sameLine = (item: ItemRow, line: ResolvedReturnLine) =>
    line.orderItemId ? item.order_item_id === line.orderItemId : !item.order_item_id && (line.productId ? item.product_id === line.productId : nameKey(item.product_name) === nameKey(line.productName))
  // First the lines that name their own return line (still of the same order line / product), then the others.
  const named = new Map<ResolvedReturnLine, ItemRow>()
  for (const line of lines) {
    const index = line.returnLineId ? left.findIndex((item) => item.id === line.returnLineId && sameLine(item, line)) : -1
    if (index >= 0) named.set(line, left.splice(index, 1)[0])
  }
  const kept: Array<{ item: ItemRow | undefined; line: ResolvedReturnLine }> = lines.map((line) => {
    if (named.has(line)) return { item: named.get(line), line }
    const index = left.findIndex((item) => sameLine(item, line))
    return { item: index >= 0 ? left.splice(index, 1)[0] : undefined, line }
  })
  for (const item of left) await tx.prepare("DELETE FROM client_return_items WHERE id = ?").run(item.id)
  for (const { item, line } of kept) {
    if (item) {
      await tx
        .prepare("UPDATE client_return_items SET product_id = @productId, product_name = @productName, unit = @unit, quantity = @quantity, price = @price, order_item_id = @orderItemId WHERE id = @id")
        .run({ id: item.id, ...line })
    } else {
      await tx
        .prepare(
          `INSERT INTO client_return_items (return_id, product_id, product_name, unit, quantity, price, order_item_id)
           VALUES (@returnId, @productId, @productName, @unit, @quantity, @price, @orderItemId)`,
        )
        .run({ returnId, ...line })
    }
  }
}

/** New quantities of an accepted return: a smaller one takes goods out of its warehouse again, so they must still be
 * there on every day from the day the stock core booked the return (rule 8, warehouseStock's minimum, less what orders
 * reserve); and no confirmed inventory may have counted a changed product since. Else 409. */
async function assertAcceptedQuantitiesChangeable(tx: PgDb, row: ReturnRow, pairs: LinePair[]): Promise<void> {
  const changed = pairs.filter(({ item, line }) => Math.abs(Number(item.quantity) - line.quantity) > 1e-9)
  const warehouse = row.warehouse.trim()
  // The stock core books an accepted return only with a warehouse.
  if (!changed.length || !warehouse) return
  // Same day / moment as lib/stock/sources.ts (accepted_at, else return_date, else created_at).
  const booked = (await tx
    .prepare(
      `SELECT to_char(m, 'YYYY-MM-DD') AS day, to_char(m, 'YYYY-MM-DD"T"HH24:MI:SS') AS moment
         FROM (SELECT COALESCE(fin_ts(accepted_at), fin_ts(return_date), fin_ts(created_at, true)) AS m FROM client_returns WHERE id = @id) x`,
    )
    .get({ id: row.id })) as { day: string | null; moment: string | null } | undefined
  const day = booked?.day || todayIso()
  const moment = booked?.moment || `${day}T00:00:00`
  const index = await catalogIndex(tx)
  // Keys as the stock core books the lines: by product id, else by name.
  const stockKey = (item: ItemRow) => (item.product_id ? `product:${item.product_id}` : ledgerKey(index, item.product_name))
  const need = new Map<string, { product: string; unit: string; required: number }>()
  for (const { item, line } of changed) {
    const less = Number(item.quantity) - line.quantity
    if (!(less > 0)) continue
    const key = stockKey(item)
    const current = need.get(key)
    if (current) current.required += less
    else need.set(key, { product: item.product_name, unit: item.unit || index.byKey.get(key)?.unit || "", required: less })
  }
  if (need.size) {
    const stock = await warehouseStock(warehouse, day, tx)
    const shortages: StockShortage[] = []
    for (const [key, entry] of need) {
      const available = stock.get(key)?.available ?? 0
      if (entry.required > available + 1e-9) shortages.push({ key, product: entry.product, unit: entry.unit, required: round6(entry.required), available: round6(Math.max(0, available)) })
    }
    if (shortages.length) throw new ClientReturnError(`Недостаточно товара на складе. ${shortageMessage(warehouse, shortages)}`, 409, { reason: "stock", shortages, warehouse })
  }
  if (await countedByInventory(tx, warehouse, day, moment, changed.map(({ item }) => stockKey(item)), { registeredAt: moment })) {
    throw new ClientReturnError("Изменение невозможно из-за связи с другими данными", 409, { reason: "inventory" })
  }
}

/** Edits a return (header and lines). A pending one of order lines needs a manager; an accepted, a cancelled one and
 * one without an order need `canChangeCompleted` (403), an accepted one only within its lines (409, planUpdate). */
export async function updateClientReturn(id: number, input: ClientReturnInput, user: { displayName: string }, options: ClientReturnUpdateOptions = {}): Promise<ClientReturn | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  // The stock / finance helpers an accepted return's check uses are installed before the locks are held.
  await prepareUndo()
  const found = await withTransaction(async (tx) => {
    await lockReturns(tx)
    // Lock order (C1): a smaller quantity of an accepted return takes goods out again — the warehouse's stock lock
    // before the row lock.
    await lockWarehousesOf(tx, "SELECT warehouse FROM client_returns WHERE id = @id AND status = 'accepted'", { id })
    const row = await loadReturn(tx, id, true)
    if (!row) return false
    const { prepared, organization, priceList, pairs, existing } = await planUpdate(tx, row, input, options)
    await tx
      .prepare(
        `UPDATE client_returns SET client_id = @clientId, client = @client, warehouse = @warehouse, order_id = @orderId, return_date = @returnDate,
           currency = @currency, amount = @amount, comment = @comment, deliverer = @deliverer, agent = @agent, organization = @organization,
           payment_type = @paymentType, price_list = @priceList, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        clientId: prepared.client.id,
        client: prepared.client.name,
        warehouse: prepared.warehouse,
        orderId: prepared.order?.id ?? null,
        returnDate: prepared.returnDate,
        currency: prepared.currency,
        amount: prepared.amount,
        comment: input.comment !== undefined ? input.comment.trim() : row.comment,
        deliverer: prepared.deliverer,
        agent: prepared.agent,
        organization,
        paymentType: input.paymentType ?? row.payment_type ?? "",
        priceList,
      })
    if (pairs) {
      // An accepted return keeps its lines (and their ids): only quantities and prices change.
      for (const { item, line } of pairs) {
        if (Math.abs(Number(item.quantity) - line.quantity) <= 1e-9 && Math.abs(Number(item.price) - line.price) <= 1e-12) continue
        await tx.prepare("UPDATE client_return_items SET quantity = @quantity, price = @price WHERE id = @id").run({ id: item.id, quantity: line.quantity, price: line.price })
      }
    } else {
      await mergeLines(tx, id, existing, prepared.lines)
    }
    // A return copied from Linko credits the client what Linko booked (client_credit, lib/finance/sources.ts), not its
    // amount: a new amount moves that credit too, as Linko's own edit does. A credit of 0 (Linko credited nothing) and
    // a cancelled return's stay as they are.
    const credit = row.client_credit === undefined || row.client_credit === null ? null : Number(row.client_credit)
    const before = Number(row.amount) || 0
    if (credit !== null && Number.isFinite(credit) && credit !== 0 && row.status !== "cancelled" && Math.abs(prepared.amount - before) > 1e-12) {
      const next = Math.abs(credit - before) < 1e-6 ? prepared.amount : roundMoney(credit + prepared.amount - before)
      await tx.prepare("UPDATE client_returns SET client_credit = @credit WHERE id = @id").run({ id, credit: next })
    }
    await logClientReturn(tx, id, "updated", user.displayName)
    return true
  })
  return found ? getClientReturn(id) : null
}

/** Linko's client_return_preview: the lines «Оформить возврат» would save (a new return, or the edit of `returnId`),
 * checked like the save itself, nothing written. Linko's required fields answer «Обязательное поле.» under each
 * (`fields`); no lines → an empty list. */
export async function previewClientReturn(
  input: ClientReturnInput & { kind?: "client" | "orders" | "old" },
  returnId: number | null,
  options: ClientReturnUpdateOptions = {},
): Promise<ClientReturnPreviewLine[] | null> {
  if (returnId !== null && (!Number.isSafeInteger(returnId) || returnId <= 0 || returnId > 2_147_483_647)) return null
  await prepareUndo()
  const REQUIRED = "Обязательное поле."
  const missing: Record<string, string> = {}
  if (!input.returnDate?.trim()) missing.returnDate = REQUIRED
  if (input.kind !== "orders" && input.clientId === undefined && !input.client?.trim()) missing.client = REQUIRED
  if (!input.warehouse?.trim()) missing.warehouse = REQUIRED
  if (input.kind !== "old" && !input.deliverer?.trim()) missing.deliverer = REQUIRED
  const first = Object.keys(missing)[0]
  if (first) throw new ClientReturnError(REQUIRED, 400, { field: first, fields: missing })
  const prepared = await withTransaction(async (tx): Promise<{ lines: ResolvedReturnLine[]; currency: string } | null> => {
    if (returnId === null) {
      if (!input.items?.length) return { lines: [], currency: "" }
      const ready = await prepareReturn(tx, input, 0, undefined, { keepNoOrder: input.orderId === null })
      return { lines: ready.lines, currency: ready.currency }
    }
    const row = await loadReturn(tx, returnId)
    if (!row) return null
    if (input.items && !input.items.length) return { lines: [], currency: "" }
    const plan = await planUpdate(tx, row, input, options)
    return { lines: plan.prepared.lines, currency: plan.prepared.currency }
  })
  if (!prepared) return null
  const lineIds = prepared.lines.map((line) => line.orderItemId).filter((value): value is number => Boolean(value))
  const owners = lineIds.length
    ? new Map(((await getDb().prepare("SELECT id, order_id FROM order_items WHERE id = ANY(@ids::int[])").all({ ids: lineIds })) as Array<{ id: number; order_id: number }>).map((row) => [Number(row.id), Number(row.order_id)]))
    : new Map<number, number>()
  return prepared.lines.map((line) => ({
    productName: line.productName,
    unit: line.unit,
    orderId: line.orderItemId ? (owners.get(line.orderItemId) ?? null) : null,
    quantity: line.quantity,
    price: line.price,
    currency: prepared.currency,
    total: roundMoney(line.quantity * line.price),
  }))
}

/** Accepts pending returns into their warehouse (stock + client credit start counting); `date` (YYYY-MM-DD, not after
 * today) = the day of the acceptance (acceptMomentOn), default now. */
export async function acceptClientReturns(ids: number[], user: { displayName: string }, date?: string): Promise<ClientReturn[]> {
  await ensureClientReturnsSchema()
  const unique = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647)
  if (!unique.length) throw new ClientReturnError("Выберите возвраты", 400, { field: "ids" })
  const at = acceptMomentOn(date)
  await withTransaction(async (tx) => {
    await lockReturns(tx)
    for (const id of unique) {
      const row = await loadReturn(tx, id, true)
      if (!row) throw new ClientReturnError(`Возврат №${id} не найден`, 404, { id })
      await acceptRow(tx, row, user.displayName, at)
    }
  })
  return Promise.all(unique.map(async (id) => (await getClientReturn(id))!))
}

/** Undoes the acceptance of `row` inside `tx` (the caller sets the new status): the goods
 * the return put back must still be in its warehouse on every day from the day the stock
 * core books the return on (rule 8: warehouseStock's minimum, less what orders reserve),
 * and no confirmed inventory may have counted them since; else 409. */
async function assertAcceptanceUndoable(tx: PgDb, row: ReturnRow): Promise<void> {
  const warehouse = row.warehouse.trim()
  // The stock core books an accepted return only with a warehouse.
  if (!warehouse) return
  await lockWarehouseStock(tx, [warehouse])
  // Same day / moment as lib/stock/sources.ts (accepted_at, else return_date, else created_at).
  const booked = (await tx
    .prepare(
      `SELECT to_char(m, 'YYYY-MM-DD') AS day, to_char(m, 'YYYY-MM-DD"T"HH24:MI:SS') AS moment
         FROM (SELECT COALESCE(fin_ts(accepted_at), fin_ts(return_date), fin_ts(created_at, true)) AS m FROM client_returns WHERE id = @id) x`,
    )
    .get({ id: row.id })) as { day: string | null; moment: string | null } | undefined
  const day = booked?.day || todayIso()
  const moment = booked?.moment || `${day}T00:00:00`
  const [index, stock, items] = await Promise.all([
    catalogIndex(tx),
    warehouseStock(warehouse, day, tx),
    tx.prepare("SELECT * FROM client_return_items WHERE return_id = ? ORDER BY id").all(row.id) as Promise<ItemRow[]>,
  ])
  // Keys as the stock core books the lines: by product id, else by name.
  const need = new Map<string, { product: string; unit: string; required: number }>()
  for (const item of items) {
    const quantity = Number(item.quantity) || 0
    if (!(quantity > 0)) continue
    const key = item.product_id ? `product:${item.product_id}` : ledgerKey(index, item.product_name)
    const current = need.get(key)
    if (current) current.required += quantity
    else need.set(key, { product: item.product_name, unit: item.unit || index.byKey.get(key)?.unit || "", required: quantity })
  }
  const shortages: StockShortage[] = []
  for (const [key, entry] of need) {
    const available = stock.get(key)?.available ?? 0
    if (entry.required > available + 1e-9) {
      shortages.push({ key, product: entry.product, unit: entry.unit, required: round6(entry.required), available: round6(Math.max(0, available)) })
    }
  }
  if (shortages.length) {
    throw new ClientReturnError(`Не возможно отменить. ${shortageMessage(warehouse, shortages)}`, 409, { reason: "stock", shortages })
  }
  // A confirmed inventory counted the returned items after the acceptance: undoing it would break the count.
  if (await countedByInventory(tx, warehouse, day, moment, [...need.keys()], { registeredAt: moment })) {
    throw new ClientReturnError("Отменение невозможно из-за связи с другими данными", 409, { reason: "inventory" })
  }
}

/** The stock / finance cores install their SQL helpers on their own connections:
 * before our transaction holds the return locks (see lib/orders-repo.ts prepareWrites). */
async function prepareUndo(): Promise<void> {
  await ensureClientReturnsSchema()
  await ensureStockSchema()
  await ensureFinanceSchema()
}

/** "Отменить приемку": an accepted return goes back to pending (editable, can be cancelled);
 * its stock receipt and the client credit disappear. 409 when the goods are no longer in
 * the warehouse (sold, moved, written off) or a later inventory counted them. */
export async function unacceptClientReturn(id: number, user: { displayName: string }): Promise<ClientReturn | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await prepareUndo()
  const found = await withTransaction(async (tx) => {
    await lockReturns(tx)
    // Lock order (C1): undoing an acceptance takes the goods out again — the warehouse's stock lock before the row lock.
    await lockWarehousesOf(tx, "SELECT warehouse FROM client_returns WHERE id = @id AND status = 'accepted'", { id })
    const row = await loadReturn(tx, id, true)
    if (!row) return false
    if (row.status !== "accepted") {
      throw new ClientReturnError(row.status === "cancelled" ? "Отмененный возврат нельзя изменить" : "Возврат еще не принят", 409, { status: row.status })
    }
    await assertAcceptanceUndoable(tx, row)
    await tx
      .prepare(
        `UPDATE client_returns SET status = 'pending', accepted_at = NULL, accepted_by = '', unaccepted_at = @at, unaccepted_by = @user,
           updated_at = datetime('now') WHERE id = @id`,
      )
      .run({ id, at: new Date().toISOString(), user: user.displayName })
    await logClientReturn(tx, id, "cancel_accept", user.displayName)
    return true
  })
  return found ? getClientReturn(id) : null
}

/** Cancels a return. A pending one simply; an accepted one only when its acceptance can
 * be undone (as unacceptClientReturn: the goods must still be in the warehouse). */
export async function cancelClientReturn(id: number, user: { displayName: string }): Promise<ClientReturn | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await prepareUndo()
  const found = await withTransaction(async (tx) => {
    await lockReturns(tx)
    // Lock order (C1): undoing an acceptance takes the goods out again — the warehouse's stock lock before the row lock.
    await lockWarehousesOf(tx, "SELECT warehouse FROM client_returns WHERE id = @id AND status = 'accepted'", { id })
    const row = await loadReturn(tx, id, true)
    if (!row) return false
    if (row.status === "cancelled") return true
    const at = new Date().toISOString()
    if (row.status === "accepted") {
      await assertAcceptanceUndoable(tx, row)
      await tx
        .prepare(
          `UPDATE client_returns SET status = 'cancelled', cancelled_at = @at, cancelled_by = @user, accepted_at = NULL, accepted_by = '',
             unaccepted_at = @at, unaccepted_by = @user, updated_at = datetime('now') WHERE id = @id`,
        )
        .run({ id, at, user: user.displayName })
      await logClientReturn(tx, id, "canceled", user.displayName)
      return true
    }
    await tx
      .prepare("UPDATE client_returns SET status = 'cancelled', cancelled_at = @at, cancelled_by = @user, updated_at = datetime('now') WHERE id = @id")
      .run({ id, at, user: user.displayName })
    await logClientReturn(tx, id, "canceled", user.displayName)
    return true
  })
  return found ? getClientReturn(id) : null
}

/** Accepted returns per currency in a local-day range (dashboard "Возвраты"). */
/** `agentIds`: only the returns whose agent (client_returns.agent by name key) is one of these employees. */
export async function acceptedReturnTotals(
  from: string,
  to: string,
  db: PgDb = getDb(),
  agentIds?: number[],
): Promise<{ totals: Array<{ currency: string; amount: number }>; orders: number }> {
  const exists = (await db.prepare("SELECT to_regclass('client_returns') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!exists.ok) return { totals: [], orders: 0 }
  const day = "COALESCE(fin_ts(NULLIF(r.accepted_at, '')), fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))::date"
  const rows = (await db
    .prepare(
      `SELECT r.currency, SUM(r.amount)::float8 AS amount, COUNT(DISTINCT r.order_id)::int AS orders
         FROM client_returns r WHERE r.status = 'accepted' AND ${day} BETWEEN @from::date AND @to::date AND ${ownAgentSql("r.agent")} GROUP BY 1`,
    )
    .all({ from, to, scoped: agentIds !== undefined, agentIds: agentIds ?? [] })) as Array<{ currency: string; amount: number; orders: number }>
  const base = await baseCurrency(db)
  return {
    totals: rows.map((row) => ({ currency: row.currency || base, amount: round2(Number(row.amount) || 0) })).filter((row) => row.amount !== 0),
    orders: rows.reduce((sum, row) => sum + (Number(row.orders) || 0), 0),
  }
}

/** Returns of the period that are not cancelled (pending and accepted), by the day they were made, per currency —
 * the dashboard's «Возвраты» card, as Linko's stats/widget/returns counts them (2026-01-01…11-05: 97 425 940 SUM
 * pending + 3 670 883,88 SUM accepted). */
export async function periodReturnTotals(
  from: string,
  to: string,
  db: PgDb = getDb(),
  agentIds?: number[],
): Promise<{ totals: Array<{ currency: string; amount: number }>; orders: number }> {
  const exists = (await db.prepare("SELECT to_regclass('client_returns') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!exists.ok) return { totals: [], orders: 0 }
  const day = "COALESCE(fin_ts(NULLIF(r.return_date, '')), fin_ts(r.created_at, true))::date"
  const rows = (await db
    .prepare(
      `SELECT r.currency, SUM(r.amount)::float8 AS amount, COUNT(DISTINCT r.order_id)::int AS orders
         FROM client_returns r WHERE r.status <> 'cancelled' AND ${day} BETWEEN @from::date AND @to::date AND ${ownAgentSql("r.agent")} GROUP BY 1`,
    )
    .all({ from, to, scoped: agentIds !== undefined, agentIds: agentIds ?? [] })) as Array<{ currency: string; amount: number; orders: number }>
  const base = await baseCurrency(db)
  return {
    totals: rows.map((row) => ({ currency: row.currency || base, amount: round2(Number(row.amount) || 0) })).filter((row) => row.amount !== 0),
    orders: rows.reduce((sum, row) => sum + (Number(row.orders) || 0), 0),
  }
}

export { formatMoney }
