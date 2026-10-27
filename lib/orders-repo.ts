import "server-only"

import { CashError, resolveOrganization } from "@/lib/cash/common"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { placeName } from "@/lib/finance/entities"
import { getBalanceList } from "@/lib/finance/ledger"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { lockWarehouseStock } from "@/lib/internal-transfers-stock"
import { keySql, nameKey } from "@/lib/platform-refs"
import { findRestrictedProducts, PRODUCT_RESTRICTION_DENIED } from "@/lib/product-restrictions-check"
import { ensureProductRestrictionsSchema } from "@/lib/product-restrictions-repo"
import { getStockBalances, getStockPending } from "@/lib/stock/ledger"
import { ensureStockSchema } from "@/lib/stock/schema"
import {
  EDITABLE_STATUSES,
  FINAL_STATUSES,
  ORDER_STATUSES,
  RELEASED_STATUSES,
  STOCK_STATUSES,
  canChangeStatus,
  type AgentLimitExceeded,
  type Order,
} from "@/components/orders/orders-data"

// Client orders (Продажи → Заказы).
//
// - An order belongs to a client by orders.client_id (contract 6); `client`
//   is the name snapshot. The client must exist.
// - An order has ONE currency (orders.currency); every line is in it. The
//   total (`amount`, "<sum> <CUR>") is derived from the lines; an order
//   without lines keeps a validated, non-negative amount (legacy money-only
//   orders). Deleting the last line resets it to 0.
// - Statuses and transitions: components/orders/orders-data.ts. Доставлено /
//   Отменен are final; lines can change only in Не подтвержден / В процессе /
//   Есть на складе.
// - Stock (contract 4): an order with lines in "Есть на складе" (reserved),
//   "В пути" / "Доставлено" (shipped) names its warehouse (orders.warehouse,
//   the warehouses.name). Entering such a status, changing the warehouse or a
//   line of a reserved order checks availability: on hand − reserved by other
//   orders (lib/stock/ledger.ts) must cover the order's quantity, else 409.
// - Agent limits (Продукты → "Добавить лимит", product_limits): an order that is
//   not cancelled must keep its agent within every product limit (Реализовано
//   counted as the product card counts it), else 409 with `agentLimit`. Checked
//   when an order is created, when its agent changes and when a line grows.
// - Product restrictions (Персонал → Заказ → "Ограничение продуктов"): an agent with a
//   product / product type list may sell only those products, else 409
//   "Агенту запрещено продавать товар" with `productRestriction` {agent, products}.
//   Checked for the lines a new order has, a line that is added, changes its product or
//   grows, and every line when the order's agent changes or it comes back from Отменен.
//   The time windows (Ограничение времени) are enforced by the order routes.
// - shipped_at (ISO, UTC "Z") is the moment the order left the warehouse;
//   the finance ledger dates realization by it.
// - Every change is logged in order_logs (the order card "Логи" tab).
// - `balance` / `negative` of a listed order are the client's CURRENT ledger
//   balance (lib/finance), never stored.
// - organization (the finance filter "Организация"): the chosen one (a known
//   organization), else the same fallbacks as payments (lib/cash/common.ts
//   resolveOrganization): the client's contracts (one organization) → the
//   agent's single organization → the warehouse manager's single organization
//   → the only organization. Orders saved without one are filled the same way
//   (ORGANIZATION_BACKFILL, empty values only).

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const MAX_MONEY = 1e13
export const MAX_QTY = 1e9

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ORDER_COLUMNS: Array<[string, string]> = [
  ["payment_date", "TEXT NOT NULL DEFAULT ''"],
  ["payment_type", "TEXT NOT NULL DEFAULT ''"],
  ["organization", "TEXT NOT NULL DEFAULT ''"],
  ["warehouse", "TEXT NOT NULL DEFAULT ''"],
  ["delivery_man", "TEXT NOT NULL DEFAULT ''"],
  ["client_id", "INTEGER"],
  ["shipped_at", "TEXT"],
  ["currency", "TEXT NOT NULL DEFAULT ''"],
  ["price_list", "TEXT NOT NULL DEFAULT ''"],
  ["created_by", "TEXT NOT NULL DEFAULT ''"],
  ["comment", "TEXT NOT NULL DEFAULT ''"],
  ["delivery_type", "TEXT NOT NULL DEFAULT ''"],
  ["deal_type", "TEXT NOT NULL DEFAULT ''"],
  ["invoice_number", "TEXT NOT NULL DEFAULT ''"],
  ["invoice_date", "TEXT NOT NULL DEFAULT ''"],
  ["invoice_active", "INTEGER NOT NULL DEFAULT 0"],
  ["contract", "TEXT NOT NULL DEFAULT ''"],
]

const DDL = `
${ORDER_COLUMNS.map(([name, type]) => `ALTER TABLE orders ADD COLUMN IF NOT EXISTS ${name} ${type};`).join("\n")}
CREATE INDEX IF NOT EXISTS orders_client_id_idx ON orders (client_id);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  product_name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SUM',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
-- Money precision (contract 3): older databases created these as REAL (float4).
DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['quantity', 'unit_price', 'cost_price', 'discount_percent'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'order_items' AND column_name = c AND data_type = 'real') THEN
      EXECUTE format('ALTER TABLE order_items ALTER COLUMN %I TYPE double precision USING round(%I::numeric, 6)::double precision', c, c);
    END IF;
  END LOOP;
END $$;
-- Lines belong to an existing order. NOT VALID: older databases may hold
-- orphan lines; the constraint still applies to every new or changed line.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'order_items'::regclass AND confrelid = 'orders'::regclass AND contype = 'f') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS order_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  amount TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS order_logs_order_idx ON order_logs (order_id);
`

// Organization of orders saved without one (older versions, API callers that
// sent none), with the fallbacks of resolveOrderOrganization: the client's
// contracts when they all name one organization → the agent's single
// organization → the warehouse manager's single organization → the only
// organization, in the canonical spelling of a known organization. Fills ONLY
// empty values (fin_place(organization) = ''), never changes a set one, so it
// is idempotent and gives the same result for the same data. Needs the fin_*
// helpers (ensureFinanceSchema). A failure only logs a warning.
const ORGANIZATION_BACKFILL = `
-- employees.organizations (JSON array text, or a comma list): its single organization, empty when none or several.
CREATE OR REPLACE FUNCTION orders_single_org(raw text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n int; one_org text;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN RETURN ''; END IF;
  BEGIN
    SELECT count(DISTINCT fin_key(v)), min(fin_place(v)) INTO n, one_org FROM json_array_elements_text(raw::json) AS v WHERE fin_place(v) <> '';
  EXCEPTION WHEN others THEN
    SELECT count(DISTINCT fin_key(v)), min(fin_place(v)) INTO n, one_org FROM unnest(string_to_array(raw, ',')) AS v WHERE fin_place(v) <> '';
  END;
  RETURN CASE WHEN n = 1 THEN one_org ELSE '' END;
END
$$;

DO $$
DECLARE org_count int := 0; only_org text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orders WHERE fin_place(organization) = '') THEN RETURN; END IF;
  -- Scratch tables of this transaction only (dropped at COMMIT, gone on ROLLBACK).
  CREATE TEMP TABLE IF NOT EXISTS ord_org_client (id int PRIMARY KEY, org text NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS ord_org_person (k text PRIMARY KEY, org text NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS ord_org_warehouse (k text PRIMARY KEY, org text NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS ord_org_known (k text PRIMARY KEY, name text NOT NULL) ON COMMIT DROP;
  TRUNCATE pg_temp.ord_org_client, pg_temp.ord_org_person, pg_temp.ord_org_warehouse, pg_temp.ord_org_known;
  -- The client's (not cancelled) contracts when they all belong to one organization.
  IF to_regclass('contracts') IS NOT NULL AND to_regclass('clients') IS NOT NULL THEN
    INSERT INTO pg_temp.ord_org_client
      SELECT c.id, min(fin_place(to_jsonb(k) ->> 'organization'))
      FROM clients c JOIN contracts k ON fin_key(to_jsonb(k) ->> 'client') = fin_key(c.name)
      WHERE COALESCE(to_jsonb(k) ->> 'status', '') <> 'cancelled' AND fin_place(to_jsonb(k) ->> 'organization') <> ''
      GROUP BY c.id HAVING count(DISTINCT fin_key(to_jsonb(k) ->> 'organization')) = 1;
  END IF;
  IF to_regclass('employees') IS NOT NULL THEN
    -- An employee's single organization (the first employee of that name).
    INSERT INTO pg_temp.ord_org_person
      SELECT DISTINCT ON (fin_key(e.first_name || ' ' || e.last_name)) fin_key(e.first_name || ' ' || e.last_name), orders_single_org(to_jsonb(e) ->> 'organizations')
      FROM employees e WHERE fin_key(e.first_name || ' ' || e.last_name) <> ''
      ORDER BY fin_key(e.first_name || ' ' || e.last_name), e.id;
    DELETE FROM pg_temp.ord_org_person WHERE org = '';
    -- The warehouse manager's single organization.
    IF to_regclass('warehouses') IS NOT NULL THEN
      INSERT INTO pg_temp.ord_org_warehouse
        SELECT DISTINCT ON (fin_key(w.name)) fin_key(w.name), orders_single_org(to_jsonb(e) ->> 'organizations')
        FROM warehouses w
        JOIN employees e ON e.id = NULLIF(to_jsonb(w) ->> 'manager_id', '')::int
          OR (NULLIF(to_jsonb(w) ->> 'manager_id', '') IS NULL AND fin_key(e.first_name || ' ' || e.last_name) = fin_key(to_jsonb(w) ->> 'manager'))
        WHERE fin_key(w.name) <> ''
        ORDER BY fin_key(w.name), w.id, e.id;
      DELETE FROM pg_temp.ord_org_warehouse WHERE org = '';
    END IF;
  END IF;
  IF to_regclass('organizations') IS NOT NULL THEN
    SELECT count(*), min(name) INTO org_count, only_org FROM organizations;
    INSERT INTO pg_temp.ord_org_known
      SELECT DISTINCT ON (fin_key(g.name)) fin_key(g.name), g.name FROM organizations g WHERE fin_place(g.name) <> '' ORDER BY fin_key(g.name), g.id;
  END IF;

  UPDATE orders o SET organization = COALESCE(kn.name, y.org)
  FROM (
    SELECT o2.id, COALESCE(cl.org, ag.org, wh.org, CASE WHEN org_count = 1 THEN only_org END) AS org
    FROM orders o2
    LEFT JOIN pg_temp.ord_org_client cl ON cl.id = o2.client_id
    LEFT JOIN pg_temp.ord_org_person ag ON ag.k = fin_key(o2.agent)
    LEFT JOIN pg_temp.ord_org_warehouse wh ON wh.k = fin_key(o2.warehouse)
    WHERE fin_place(o2.organization) = ''
  ) y
  LEFT JOIN pg_temp.ord_org_known kn ON kn.k = fin_key(y.org)
  WHERE o.id = y.id AND fin_place(o.organization) = '' AND fin_place(y.org) <> '';
EXCEPTION WHEN others THEN
  RAISE WARNING 'orders organization backfill skipped: %', SQLERRM;
END $$;
`

const SCHEMA_VERSION = 2

declare global {
  var __linkoOrdersSchema: { version: number; ready: Promise<void> } | undefined
}

/** Order columns, order_items (double precision, FK), order_logs and the
 * organization backfill of older orders; once per process. */
export function ensureOrdersSchema(): Promise<void> {
  if (globalThis.__linkoOrdersSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(async () => {
      await withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(72120931)")
        await tx.exec(DDL)
      })
      // fin_key / fin_place (installed by the finance core on its own connection, outside our transaction).
      await ensureFinanceSchema()
      await withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(72120931)")
        await tx.exec(ORGANIZATION_BACKFILL)
      })
    }).catch((error) => {
      globalThis.__linkoOrdersSchema = undefined
      throw error
    })
    globalThis.__linkoOrdersSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoOrdersSchema!.ready
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type OrderRow = {
  id: number
  client: string
  client_id: number | null
  zone: string
  type: string
  product: string
  created: string
  delivery: string
  agent: string
  amount: string
  balance: string
  negative: number
  status: string
  discount: string | null
  payment_date: string | null
  payment_type: string | null
  organization: string | null
  warehouse: string | null
  delivery_man: string | null
  shipped_at: string | null
  currency: string | null
  price_list: string | null
  created_by: string | null
  comment: string | null
  delivery_type: string | null
  deal_type: string | null
  invoice_number: string | null
  invoice_date: string | null
  invoice_active: number | null
  contract: string | null
  created_at: string | null
  c_branch?: string | null
  c_phone?: string | null
  c_deliverer?: string | null
}

export type ItemRow = {
  id: number
  order_id: number
  product_id: number | null
  product_name: string
  unit: string
  quantity: number
  unit_price: number
  cost_price: number
  discount_percent: number
  currency: string
}

const ORDER_SELECT = `SELECT o.*, c.branch AS c_branch, c.phone AS c_phone, c.deliverer AS c_deliverer
  FROM orders o LEFT JOIN clients c ON c.id = o.client_id`

function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    client: row.client,
    clientId: row.client_id ?? null,
    zone: row.zone,
    type: row.type,
    product: row.product,
    created: row.created,
    delivery: row.delivery,
    agent: row.agent,
    amount: row.amount,
    balance: "",
    negative: false,
    status: row.status,
    discount: row.discount ?? undefined,
    paymentDate: row.payment_date ?? "",
    paymentType: row.payment_type ?? "",
    organization: row.organization ?? "",
    warehouse: row.warehouse ?? "",
    currency: orderCurrencyOf(row) ?? "",
    deliveryMan: row.delivery_man ?? "",
    priceList: row.price_list ?? "",
    createdBy: row.created_by ?? "",
    comment: row.comment ?? "",
    deliveryType: row.delivery_type ?? "",
    dealType: row.deal_type ?? "",
    invoiceNumber: row.invoice_number ?? "",
    invoiceDate: row.invoice_date ?? "",
    invoiceActive: row.invoice_active === 1,
    contract: row.contract ?? "",
    shippedAt: row.shipped_at || null,
    createdAt: row.created_at ?? undefined,
    clientBranch: row.c_branch ?? "",
    clientPhone: row.c_phone ?? "",
    clientDeliverer: row.c_deliverer ?? "",
  }
}

/** The order's currency: the stored one, else the one of its amount text (legacy rows). */
function orderCurrencyOf(row: Pick<OrderRow, "currency" | "amount">): string | null {
  if (row.currency) return row.currency
  return parseMoneyText(row.amount ?? "")?.currency ?? null
}

// ---------------------------------------------------------------------------
// Money text
// ---------------------------------------------------------------------------

/** "60 000 SUM", "1 234,5 USD", "100", "0.45 usd" → value + currency (null when absent). */
export function parseMoneyText(text: string): { value: number; currency: string | null } | null {
  const match = /^\s*(-?[\d\s  .,]*\d)\s*([A-Za-z]{2,10})?\s*$/.exec(String(text ?? ""))
  if (!match) return null
  const digits = match[1].replace(/[\s  ]/g, "").replace(",", ".")
  if (!/^-?\d+(\.\d+)?$/.test(digits)) return null
  const value = Number(digits)
  if (!Number.isFinite(value)) return null
  return { value, currency: match[2] ? match[2].toUpperCase() : null }
}

export function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const grouped = rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[  ]/g, " ")
  return `${grouped} ${currency}`
}

function roundQty(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export function lineTotal(row: Pick<ItemRow, "quantity" | "unit_price" | "discount_percent">): number {
  return Number(row.quantity) * Number(row.unit_price) * (1 - Number(row.discount_percent) / 100)
}

// ---------------------------------------------------------------------------
// Lookups (validated references)
// ---------------------------------------------------------------------------

export type ClientRef = { id: number; name: string; zone: string; type: string; agent: string; deliverer: string }

const NOT_SET = new Set(["", "не указано", "не указан", "—", "-"])

/** By id, else by exact name (case / spacing-insensitive). 400 when missing or ambiguous. */
export async function resolveClient(db: PgDb, input: { clientId?: number | null; client?: string | null }): Promise<ClientRef> {
  if (input.clientId !== undefined && input.clientId !== null) {
    const row = (await db.prepare("SELECT id, name, zone, type, agent, deliverer FROM clients WHERE id = ?").get(input.clientId)) as ClientRef | undefined
    if (!row) throw new OrderError("Клиент не найден", 400, { field: "clientId" })
    return row
  }
  const name = String(input.client ?? "").trim()
  if (!name) throw new OrderError("Укажите клиента", 400, { field: "client" })
  const rows = (await db
    .prepare(`SELECT id, name, zone, type, agent, deliverer FROM clients WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 2`)
    .all({ name })) as ClientRef[]
  if (!rows.length) throw new OrderError("Клиент не найден", 400, { field: "client" })
  if (rows.length > 1) throw new OrderError("Найдено несколько клиентов с таким названием, укажите clientId", 400, { field: "client" })
  return rows[0]
}

/** Canonical warehouse name; 400 when unknown or inactive. */
export async function resolveWarehouse(db: PgDb, name: string): Promise<string> {
  const row = (await db
    .prepare(`SELECT name, active FROM warehouses WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`)
    .get({ name })) as { name: string; active: number | null } | undefined
  if (!row) throw new OrderError(`Склад «${name}» не найден`, 400, { field: "warehouse" })
  if (row.active === 0) throw new OrderError(`Склад «${row.name}» неактивен`, 400, { field: "warehouse" })
  return row.name
}

/** Canonical "First Last" of an employee; "" for "Не указано". 400 when unknown. */
export async function resolveEmployee(db: PgDb, name: string, field: string, label: string): Promise<string> {
  if (NOT_SET.has(nameKey(name))) return ""
  const row = (await db
    .prepare(
      `SELECT btrim(first_name || ' ' || last_name) AS name FROM employees
        WHERE ${keySql("first_name || ' ' || last_name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`,
    )
    .get({ name })) as { name: string } | undefined
  if (!row) throw new OrderError(`${label}: сотрудник «${name}» не найден`, 400, { field })
  return row.name
}

async function currencyCodes(db: PgDb): Promise<{ base: string; codes: Map<string, string> }> {
  const rows = (await db.prepare("SELECT code, is_base FROM currencies ORDER BY is_base DESC, id").all()) as Array<{ code: string; is_base: number }>
  const codes = new Map(rows.map((row) => [row.code.trim().toUpperCase(), row.code.trim()]))
  const base = rows.find((row) => row.is_base === 1)?.code.trim() || rows[0]?.code.trim() || "SUM"
  if (!codes.size) codes.set(base.toUpperCase(), base)
  return { base, codes }
}

export async function resolveCurrency(db: PgDb, code: string): Promise<string> {
  const { codes } = await currencyCodes(db)
  const found = codes.get(code.trim().toUpperCase())
  if (!found) throw new OrderError(`Неизвестная валюта «${code}»`, 400, { field: "currency" })
  return found
}

export async function baseCurrency(db: PgDb): Promise<string> {
  return (await currencyCodes(db)).base
}

export type ProductRef = { id: number; name: string; unit: string }

/** A sellable catalog product by id, else by exact name. 400 when unknown, deleted or not for sale. */
export async function resolveProduct(db: PgDb, input: { productId?: number | null; productName?: string | null }): Promise<ProductRef> {
  let row: { id: number; name: string; unit: string; can_sell: number; deleted: number } | undefined
  if (input.productId !== undefined && input.productId !== null) {
    row = (await db.prepare("SELECT id, name, unit, can_sell, deleted FROM products WHERE id = ?").get(input.productId)) as typeof row
    if (!row) throw new OrderError("Товар не найден в каталоге", 400, { field: "productId" })
  } else {
    const name = String(input.productName ?? "").trim()
    if (!name) throw new OrderError("Укажите товар", 400, { field: "productId" })
    const rows = (await db
      .prepare(`SELECT id, name, unit, can_sell, deleted FROM products WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY deleted, id LIMIT 2`)
      .all({ name })) as NonNullable<typeof row>[]
    if (!rows.length) throw new OrderError(`Товар «${name}» не найден в каталоге`, 400, { field: "productName" })
    row = rows[0]
  }
  if (row.deleted === 1) throw new OrderError(`Товар «${row.name}» удален`, 400, { field: "productId" })
  if (row.can_sell === 0) throw new OrderError(`Товар «${row.name}» недоступен для продажи`, 400, { field: "productId" })
  return { id: row.id, name: row.name, unit: row.unit || "шт." }
}

// ---------------------------------------------------------------------------
// Organization and the defaults of a new order
// ---------------------------------------------------------------------------

/** employees.organizations (JSON array text, or a comma list) → its single organization, "" when none / several. */
function singleOrganization(raw: unknown): string {
  let list: unknown = raw
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw)
    } catch {
      list = raw.split(",")
    }
  }
  const names = new Map<string, string>()
  for (const item of Array.isArray(list) ? list : []) {
    const name = placeName(item)
    if (name && !names.has(nameKey(name))) names.set(nameKey(name), name)
  }
  return names.size === 1 ? [...names.values()][0] : ""
}

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  return Boolean(((await db.prepare("SELECT to_regclass(@table) IS NOT NULL AS ok").get({ table })) as { ok: boolean } | undefined)?.ok)
}

/** Documents that take their organization from the order they belong to (lib/cash/common.ts
 * resolveOrganization: order first). client_returns joins once it has its own column. */
const ORDER_LINKED_ORGANIZATION_TABLES = ["customer_payments", "client_returns"] as const

/** The order's organization changed from `before` to `after`: its documents that still carry
 * `before` (or none) move to `after`. Nothing moves when `after` is empty. */
async function moveLinkedOrganization(db: PgDb, orderId: number, before: string, after: string): Promise<void> {
  if (!placeName(after)) return
  for (const table of ORDER_LINKED_ORGANIZATION_TABLES) {
    const row = (await db
      .prepare(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name IN ('order_id', 'organization')`,
      )
      .get()) as { n: number } | undefined
    if (row?.n !== 2) continue
    await db
      .prepare(`UPDATE ${table} SET organization = @after WHERE order_id = @orderId AND fin_key(fin_place(organization)) = fin_key(fin_place(@before::text))`)
      .run({ orderId, before, after })
  }
}

/** Single organization of the manager of `warehouse` (by manager_id, else by name); "" when unknown. */
async function warehouseManagerOrganization(db: PgDb, warehouse: string): Promise<string> {
  if (!warehouse.trim() || !(await tableExists(db, "warehouses"))) return ""
  const row = (await db
    .prepare(
      `SELECT to_jsonb(e) ->> 'organizations' AS organizations FROM warehouses w
         JOIN employees e ON e.id = NULLIF(to_jsonb(w) ->> 'manager_id', '')::int
           OR (NULLIF(to_jsonb(w) ->> 'manager_id', '') IS NULL AND ${keySql("e.first_name || ' ' || e.last_name")} = ${keySql("to_jsonb(w) ->> 'manager'")})
        WHERE ${keySql("w.name")} = ${keySql("@name::text")} ORDER BY w.id, e.id LIMIT 1`,
    )
    .get({ name: warehouse })) as { organizations: unknown } | undefined
  return singleOrganization(row?.organizations)
}

/** Organization of an order. A chosen one must be a known organization (canonical
 * spelling returned, 400 otherwise). Without one, the fallbacks of payments
 * (lib/cash/common.ts resolveOrganization): the client's contracts (one
 * organization) → the agent's single organization → then the warehouse
 * manager's single organization → the only organization. "" when unknown. */
export async function resolveOrderOrganization(
  db: PgDb,
  explicit: string | null | undefined,
  hints: { clientId?: number | null; agent?: string | null; warehouse?: string | null },
): Promise<string> {
  try {
    if (placeName(explicit)) return await resolveOrganization(db, explicit, {}, "organization")
    const byParty = await resolveOrganization(db, "", { clientId: hints.clientId ?? null, employeeName: hints.agent?.trim() || null }, "organization")
    if (byParty) return byParty
    const byWarehouse = await warehouseManagerOrganization(db, hints.warehouse ?? "")
    if (!byWarehouse) return ""
    const known = (await tableExists(db, "organizations"))
      ? ((await db.prepare("SELECT name FROM organizations ORDER BY id").all()) as Array<{ name: string }>).map((row) => row.name)
      : []
    return known.find((name) => nameKey(name) === nameKey(byWarehouse)) ?? byWarehouse
  } catch (error) {
    if (error instanceof CashError) throw new OrderError(error.message, error.status, { field: "organization" })
    throw error
  }
}

export type OrderDefaults = {
  /** The client's agent when it is an employee ("" without a client). */
  agent: string
  /** The active price list marked "default for orders", else the client's branch price list. */
  priceList: string
  /** The client's branch warehouse when the branch has exactly one active sales warehouse, else "". */
  warehouse: string
  /** resolveOrderOrganization without a chosen organization. */
  organization: string
}

/** Defaults of the "Добавление заказа" dialog for a client (none = before the client is
 * chosen). `agent` / `warehouse` are the dialog's current choices, used for the organization. */
export async function getOrderDefaults(input: { clientId?: number; agent?: string; warehouse?: string }): Promise<OrderDefaults> {
  await ensureOrdersSchema()
  await ensureFinanceSchema()
  const db = getDb()
  let client: { id: number; agent: string | null; branch: string | null } | undefined
  if (input.clientId !== undefined) {
    client = (await db.prepare("SELECT id, agent, to_jsonb(c) ->> 'branch' AS branch FROM clients c WHERE id = ?").get(input.clientId)) as typeof client
    if (!client) throw new OrderError("Клиент не найден", 404, { field: "clientId" })
  }

  let agent = ""
  if (client && !NOT_SET.has(nameKey(client.agent ?? ""))) {
    agent = await resolveEmployee(db, client.agent ?? "", "agent", "Агент").catch(() => "")
  }

  let priceList = ""
  if (await tableExists(db, "price_lists")) {
    const active = "COALESCE(to_jsonb(p) ->> 'is_active', '1') NOT IN ('0', 'false')"
    const byFlag = (await db
      .prepare(
        `SELECT p.name FROM price_lists p WHERE ${active} AND COALESCE(to_jsonb(p) ->> 'is_default_for_order', '0') IN ('1', 'true')
          ORDER BY p.id LIMIT 1`,
      )
      .get()) as { name: string } | undefined
    priceList = byFlag?.name ?? ""
    const branch = placeName(client?.branch)
    if (!priceList && branch && (await tableExists(db, "branches"))) {
      const row = (await db
        .prepare(
          `SELECT p.name FROM branches b JOIN price_lists p ON ${keySql("p.name")} = ${keySql("to_jsonb(b) ->> 'price_list'")}
            WHERE ${keySql("b.name")} = ${keySql("@branch::text")} AND ${active} ORDER BY b.id, p.id LIMIT 1`,
        )
        .get({ branch })) as { name: string } | undefined
      priceList = row?.name ?? ""
    }
  }

  let warehouse = ""
  const branch = placeName(client?.branch)
  if (branch && (await tableExists(db, "warehouses"))) {
    const rows = (await db
      .prepare(
        `SELECT w.name FROM warehouses w
          WHERE ${keySql("to_jsonb(w) ->> 'branch'")} = ${keySql("@branch::text")} AND COALESCE(to_jsonb(w) ->> 'active', '1') NOT IN ('0', 'false')
            AND COALESCE(to_jsonb(w) ->> 'for_return', '0') IN ('0', 'false')
          ORDER BY w.id LIMIT 2`,
      )
      .all({ branch })) as Array<{ name: string }>
    if (rows.length === 1) warehouse = rows[0].name
  }

  const organization = await resolveOrderOrganization(db, "", {
    clientId: client?.id ?? null,
    agent: input.agent !== undefined ? input.agent : agent,
    warehouse: input.warehouse !== undefined ? input.warehouse : warehouse,
  })
  return { agent, priceList, warehouse, organization }
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export type OrderLineInput = {
  productId?: number
  productName?: string
  unit?: string
  quantity: number
  unitPrice: number
  costPrice?: number
  discountPercent?: number
  currency?: string
}

type ResolvedLine = {
  productId: number
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  costPrice: number
  discountPercent: number
}

async function resolveLine(db: PgDb, line: OrderLineInput, orderCurrency: string): Promise<ResolvedLine> {
  const product = await resolveProduct(db, { productId: line.productId, productName: line.productName })
  if (line.currency !== undefined && line.currency.trim() && line.currency.trim().toUpperCase() !== orderCurrency.toUpperCase()) {
    throw new OrderError(`Валюта позиции (${line.currency.trim().toUpperCase()}) не совпадает с валютой заказа (${orderCurrency})`, 400, { field: "currency" })
  }
  const quantity = Number(line.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QTY) throw new OrderError("Количество должно быть больше 0 и не больше 1 000 000 000", 400, { field: "quantity" })
  const unitPrice = Number(line.unitPrice)
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_MONEY) throw new OrderError("Цена должна быть от 0 до 10 000 000 000 000", 400, { field: "unitPrice" })
  const discountPercent = Number(line.discountPercent ?? 0)
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new OrderError("Скидка должна быть от 0 до 100%", 400, { field: "discountPercent" })
  const costPrice = Number(line.costPrice ?? 0)
  if (!Number.isFinite(costPrice) || costPrice < 0 || costPrice > MAX_MONEY) throw new OrderError("Неверная себестоимость", 400, { field: "costPrice" })
  if (quantity * unitPrice > MAX_MONEY) throw new OrderError("Сумма позиции слишком большая", 400, { field: "unitPrice" })
  return {
    productId: product.id,
    productName: product.name,
    unit: (line.unit ?? "").trim() || product.unit,
    quantity,
    unitPrice,
    costPrice,
    discountPercent,
  }
}

async function listItemRows(db: PgDb, orderId: number): Promise<ItemRow[]> {
  return (await db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC").all(orderId)) as ItemRow[]
}

/** orders.amount / product from the lines; no lines → "0 <currency>" / "—" (or the kept free amount). */
async function syncSummary(db: PgDb, order: OrderRow, keepAmount?: string): Promise<void> {
  const items = await listItemRows(db, order.id)
  const currency = orderCurrencyOf(order) ?? (await baseCurrency(db))
  let amount: string
  let product: string
  if (!items.length) {
    amount = keepAmount ?? formatMoney(0, currency)
    product = keepAmount !== undefined ? order.product || "—" : "—"
  } else {
    const total = items.reduce((sum, item) => sum + lineTotal(item), 0)
    amount = formatMoney(total, currency)
    product = items.map((item) => `${item.product_name} x${roundQty(Number(item.quantity))}`).join(", ")
  }
  await db.prepare("UPDATE orders SET amount = @amount, product = @product, updated_at = datetime('now') WHERE id = @id").run({ id: order.id, amount, product })
}

// ---------------------------------------------------------------------------
// Stock availability (contract 4)
// ---------------------------------------------------------------------------

const LEDGER_END = "2100-12-31"

type Need = { key: string; name: string; quantity: number }

function lineKey(productId: number | null, name: string): string {
  return productId ? `product:${productId}` : `name:${nameKey(name)}`
}

/** 409 when on hand − reserved by other orders cannot cover `needs` at `warehouse`.
 * `ownReserved` = quantities this order already reserves there (excluded). Reads
 * committed data on a separate connection: callers hold the order lock AND the
 * warehouse's stock lock (lockWarehouseStock, taken by lockOrderWarehouses before the
 * order row is locked), so a write-off, transfer, supplier return or return unaccept of
 * the same warehouse either committed before this read or waits for this order. */
async function assertAvailable(warehouse: string, needs: Need[], ownReserved: Map<string, number>): Promise<void> {
  const wanted = new Map<string, Need>()
  for (const need of needs) {
    const current = wanted.get(need.key)
    if (current) current.quantity += need.quantity
    else wanted.set(need.key, { ...need })
  }
  if (!wanted.size) return
  const [balances, pending] = await Promise.all([
    getStockBalances({ warehouses: [warehouse], date: LEDGER_END }),
    getStockPending({ warehouses: [warehouse] }),
  ])
  const onHand = new Map<string, number>()
  for (const row of balances) if (nameKey(row.warehouse) === nameKey(warehouse)) onHand.set(row.key, (onHand.get(row.key) ?? 0) + row.qty)
  const reserved = new Map<string, number>()
  for (const row of pending) if (nameKey(row.warehouse) === nameKey(warehouse)) reserved.set(row.key, (reserved.get(row.key) ?? 0) + row.reserved)
  const short: Array<{ product: string; needed: number; available: number }> = []
  for (const need of wanted.values()) {
    const available = roundQty((onHand.get(need.key) ?? 0) - ((reserved.get(need.key) ?? 0) - (ownReserved.get(need.key) ?? 0)))
    if (need.quantity > available + 1e-9) short.push({ product: need.name, needed: roundQty(need.quantity), available: Math.max(0, available) })
  }
  if (short.length) {
    const first = short[0]
    throw new OrderError(
      `Недостаточно товара на складе «${warehouse}»: ${first.product} — нужно ${first.needed}, доступно ${first.available}`,
      409,
      { shortage: short, warehouse },
    )
  }
}

function needsOf(items: Array<Pick<ItemRow, "product_id" | "product_name" | "quantity">>): Need[] {
  return items.map((item) => ({ key: lineKey(item.product_id, item.product_name), name: item.product_name, quantity: Number(item.quantity) }))
}

function reservedBy(order: Pick<OrderRow, "status" | "warehouse">, items: ItemRow[], warehouse: string): Map<string, number> {
  const own = new Map<string, number>()
  if (order.status !== "Есть на складе" || nameKey(order.warehouse ?? "") !== nameKey(warehouse)) return own
  for (const need of needsOf(items)) own.set(need.key, (own.get(need.key) ?? 0) + need.quantity)
  return own
}

// ---------------------------------------------------------------------------
// Agent limits (Продукты → "Добавить лимит", product_limits)
// ---------------------------------------------------------------------------

const isCancelledStatus = (status: string | null | undefined) => /^отмен/i.test(String(status ?? "").trim())

/** Quantity per product of order lines. */
function quantitiesByProduct(lines: Array<{ productId: number | null; productName: string; quantity: number }>): Map<number, { name: string; quantity: number }> {
  const result = new Map<number, { name: string; quantity: number }>()
  for (const line of lines) {
    if (!line.productId) continue
    const current = result.get(line.productId)
    if (current) current.quantity += Number(line.quantity) || 0
    else result.set(line.productId, { name: line.productName, quantity: Number(line.quantity) || 0 })
  }
  return result
}

const itemsByProduct = (items: ItemRow[]) =>
  quantitiesByProduct(items.map((item) => ({ productId: item.product_id, productName: item.product_name, quantity: Number(item.quantity) })))

/** 409 when the order makes `agent` sell more of a product than the agent's limit.
 * Реализовано is counted exactly as the product card shows it (lib/products-catalog.ts
 * itemLimits): Σ quantities of the agent's orders that are not cancelled and were created
 * since the limit was set. `after` = this order's quantity per product after the change;
 * `before` = what the order counted for this agent before it (empty for a new order, a
 * cancelled one or another agent). Only a product whose quantity grows is checked, so an
 * order that keeps or lowers its quantities is never refused, even when the agent is
 * already over a limit that was lowered later. An order created before the limit was set
 * does not count towards it. Without the catalog's product_limits table nothing is limited.
 * "Now" (a new order) is fin_ts(datetime('now'), true): the same UTC text → Tashkent wall
 * clock conversion as the stored created_at columns, so the comparison does not depend on
 * the database session's TimeZone (now() is a timestamptz and would be shifted by it). */
async function assertAgentLimits(
  db: PgDb,
  input: { agent: string; orderId?: number; createdAt?: string | null; after: Map<number, { name: string; quantity: number }>; before?: Map<number, { name: string; quantity: number }> },
): Promise<void> {
  if (!nameKey(input.agent) || NOT_SET.has(nameKey(input.agent))) return
  const grown = [...input.after.entries()].filter(([productId, line]) => line.quantity > (input.before?.get(productId)?.quantity ?? 0) + 1e-9)
  if (!grown.length || !(await tableExists(db, "product_limits"))) return
  const limits = (await db
    .prepare(
      `SELECT l.item_id, l.agent, l.amount::float8 AS amount,
              (SELECT COALESCE(SUM(oi.quantity), 0)::float8 FROM orders o JOIN order_items oi ON oi.order_id = o.id
                WHERE fin_key(o.agent) = fin_key(l.agent) AND o.status NOT ILIKE 'отмен%' AND o.id <> @orderId
                  AND (oi.product_id = l.item_id OR (oi.product_id IS NULL AND fin_key(oi.product_name) = fin_key(COALESCE(p.name, ''))))
                  AND COALESCE(fin_ts(o.created_at, true), fin_ts(datetime('now'), true)) >= COALESCE(fin_ts(l.created_at, true), '-infinity'::timestamp)) AS realized,
              (COALESCE(fin_ts(@createdAt::text, true), fin_ts(datetime('now'), true)) >= COALESCE(fin_ts(l.created_at, true), '-infinity'::timestamp)) AS counts
         FROM product_limits l LEFT JOIN products p ON p.id = l.item_id
        WHERE l.item_kind = 'product' AND l.item_id = ANY(@ids::int[]) AND fin_key(l.agent) = fin_key(@agent)
        ORDER BY l.id`,
    )
    .all({ orderId: input.orderId ?? 0, createdAt: input.createdAt ?? null, ids: grown.map(([productId]) => productId), agent: input.agent })) as Array<{
    item_id: number
    agent: string
    amount: number
    realized: number
    counts: boolean
  }>
  for (const [productId, line] of grown) {
    for (const limit of limits.filter((row) => Number(row.item_id) === productId && row.counts)) {
      const amount = Number(limit.amount) || 0
      const realized = roundQty(Number(limit.realized) || 0)
      const requested = roundQty(line.quantity)
      if (realized + requested <= amount + 1e-9) continue
      const detail: AgentLimitExceeded = {
        agent: limit.agent,
        productId,
        product: line.name,
        limit: amount,
        realized,
        requested,
        remaining: roundQty(Math.max(0, amount - realized)),
      }
      throw new OrderError(
        `Превышен лимит агента «${detail.agent}» по товару «${detail.product}»: лимит ${detail.limit}, реализовано ${detail.realized}, в заказе ${detail.requested}`,
        409,
        { field: "items", agentLimit: detail },
      )
    }
  }
}

/** 409 when `agent` may not sell one of `productIds` (lib/product-restrictions-check.ts):
 * an agent with a product / product type list sells only those products. An agent that is
 * not set, unknown or without a list is not restricted. */
async function assertProductsAllowed(db: PgDb, agent: string, productIds: Array<number | null | undefined>): Promise<void> {
  if (!nameKey(agent) || NOT_SET.has(nameKey(agent))) return
  const ids = productIds.filter((id): id is number => typeof id === "number" && id > 0)
  if (!ids.length) return
  const violation = await findRestrictedProducts(db, { agent, productIds: ids })
  if (violation) throw new OrderError(PRODUCT_RESTRICTION_DENIED, 409, { field: "items", productRestriction: violation })
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export type OrderLogEntry = { id: number; kind: string; status: string; comment: string; amount: string; createdBy: string; createdAt: string }

async function addLog(db: PgDb, orderId: number, entry: { kind: "Создан" | "Обновленный"; status: string; comment?: string; amount: string; user: string }) {
  await db
    .prepare("INSERT INTO order_logs (order_id, kind, status, comment, amount, created_by) VALUES (@orderId, @kind, @status, @comment, @amount, @user)")
    .run({ orderId, kind: entry.kind, status: entry.status, comment: entry.comment ?? "", amount: entry.amount, user: entry.user })
}

export async function listOrderLogs(orderId: number): Promise<OrderLogEntry[]> {
  await ensureOrdersSchema()
  const rows = (await getDb().prepare("SELECT * FROM order_logs WHERE order_id = ? ORDER BY id DESC").all(orderId)) as Array<{
    id: number
    kind: string
    status: string
    comment: string
    amount: string
    created_by: string
    created_at: string
  }>
  return rows.map((row) => ({ id: row.id, kind: row.kind, status: row.status, comment: row.comment, amount: row.amount, createdBy: row.created_by, createdAt: row.created_at }))
}

// ---------------------------------------------------------------------------
// Client balances (read-only, from the finance ledger)
// ---------------------------------------------------------------------------

export type ClientLedgerBalance = { lines: string[]; negative: boolean; byCurrency: Record<string, number>; lastOrder: string | null; lastPayment: string | null }

/** Current (today's end) ledger balances per client id; empty map when the ledger is unavailable. */
export async function clientLedgerBalances(options: { keys?: string[]; mode?: "created" | "realization" } = {}): Promise<Map<number, ClientLedgerBalance>> {
  const out = new Map<number, ClientLedgerBalance>()
  try {
    const today = todayIso()
    const result = await getBalanceList("client", { from: today, to: today, pageSize: 0, keys: options.keys, mode: options.mode ?? "created" })
    for (const row of result.rows) {
      if (row.id === null) continue
      const byCurrency: Record<string, number> = {}
      const lines: string[] = []
      for (const currency of result.currencies) {
        const value = Math.round((row.currencies[currency.code]?.end_balance ?? 0) * 100) / 100
        if (Math.abs(value) < 0.005) continue
        byCurrency[currency.code] = value
        lines.push(formatMoney(value, currency.code))
      }
      out.set(row.id, {
        lines,
        negative: Object.values(byCurrency).some((value) => value < 0),
        byCurrency,
        lastOrder: typeof row.info.last_order === "string" ? row.info.last_order : null,
        lastPayment: typeof row.info.last_payment === "string" ? row.info.last_payment : null,
      })
    }
    if (!out.size && !options.keys) return out
    for (const id of out.keys()) if (!out.get(id)!.lines.length) out.get(id)!.lines.push(formatMoney(0, result.baseCurrency))
  } catch (error) {
    console.error("client ledger balances unavailable", error)
  }
  return out
}

async function attachBalances(orders: Order[]): Promise<Order[]> {
  if (!orders.length) return orders
  const ids = [...new Set(orders.map((order) => order.clientId).filter((id): id is number => typeof id === "number"))]
  const balances = await clientLedgerBalances(ids.length <= 50 ? { keys: ids.map(String) } : {})
  for (const order of orders) {
    const balance = order.clientId ? balances.get(order.clientId) : undefined
    order.balance = balance?.lines.join(", ") || ""
    order.negative = balance?.negative ?? false
  }
  return orders
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type OrderInput = Omit<Order, "id">
export type OrderPatch = Partial<OrderInput>

export async function listOrders(search?: string, options: { withBalances?: boolean } = {}): Promise<Order[]> {
  await ensureOrdersSchema()
  const db = getDb()
  const rows = search
    ? ((await db
        .prepare(`${ORDER_SELECT} WHERE o.client ILIKE @q OR o.agent ILIKE @q OR o.id::text = @id ORDER BY o.id DESC`)
        .all({ q: `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`, id: search.trim() })) as OrderRow[])
    : ((await db.prepare(`${ORDER_SELECT} ORDER BY o.id DESC`).all()) as OrderRow[])
  const orders = rows.map(rowToOrder)
  return options.withBalances === false ? orders : attachBalances(orders)
}

export async function getOrder(id: number, options: { withBalances?: boolean } = {}): Promise<Order | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureOrdersSchema()
  const row = (await getDb().prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id)) as OrderRow | undefined
  if (!row) return null
  const order = rowToOrder(row)
  return options.withBalances === false ? order : (await attachBalances([order]))[0]
}

/** The client's operative (by creation) and actual (by realization) debt, for the order card. */
export async function getOrderClientDebt(order: Order): Promise<{ operative: string; actual: string; operativeNegative: boolean; actualNegative: boolean } | null> {
  if (!order.clientId) return null
  const key = [String(order.clientId)]
  const [operative, actual] = await Promise.all([clientLedgerBalances({ keys: key, mode: "created" }), clientLedgerBalances({ keys: key, mode: "realization" })])
  const op = operative.get(order.clientId)
  const ac = actual.get(order.clientId)
  return {
    operative: op?.lines.join(", ") ?? "",
    actual: ac?.lines.join(", ") ?? "",
    operativeNegative: op?.negative ?? false,
    actualNegative: ac?.negative ?? false,
  }
}

const RU_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** "20 окт. 14:05" in Asia/Tashkent. */
export function formatOrderTimestamp(date: Date): string {
  const local = new Date(date.getTime() + 5 * 3600 * 1000)
  const day = String(local.getUTCDate()).padStart(2, "0")
  const hours = String(local.getUTCHours()).padStart(2, "0")
  const minutes = String(local.getUTCMinutes()).padStart(2, "0")
  return `${day} ${RU_MONTHS[local.getUTCMonth()]} ${hours}:${minutes}`
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type OrderCreateInput = {
  clientId?: number
  client?: string
  zone?: string
  type?: string
  product?: string
  delivery?: string
  agent?: string
  /** "<amount> [<currency>]" or a number; ignored when `items` are given (the total is derived). */
  amount?: string | number
  currency?: string
  status?: string
  discount?: string
  paymentDate?: string
  paymentType?: "cash" | "bank" | ""
  organization?: string
  warehouse?: string
  deliveryMan?: string
  priceList?: string
  comment?: string
  deliveryType?: string
  dealType?: string
  items?: OrderLineInput[]
}

export type OrderUpdateInput = Omit<OrderCreateInput, "items"> & {
  created?: string
  invoiceNumber?: string
  invoiceDate?: string
  invoiceActive?: boolean
  contract?: string
}

function assertStatus(status: string): string {
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
    throw new OrderError(`Неизвестный статус «${status}». Допустимо: ${ORDER_STATUSES.join(", ")}`, 400, { field: "status" })
  }
  return status
}

function parseAmount(raw: string | number): { value: number; currency: string | null } {
  const parsed = typeof raw === "number" ? (Number.isFinite(raw) ? { value: raw, currency: null } : null) : parseMoneyText(raw)
  if (!parsed) throw new OrderError("Сумма заказа: укажите число и валюту, например «60000 SUM»", 400, { field: "amount" })
  if (parsed.value < 0) throw new OrderError("Сумма заказа не может быть отрицательной", 400, { field: "amount" })
  if (parsed.value > MAX_MONEY) throw new OrderError("Сумма заказа слишком большая", 400, { field: "amount" })
  return parsed
}

async function lockOrders(db: PgDb) {
  // Serializes order writers, so two orders cannot reserve the same last units.
  await db.exec("SELECT pg_advisory_xact_lock(72120932)")
}

/** The stock lock of the warehouses an order write may reserve / ship from: the same
 * transaction-scoped lock as every other stock document (write-offs, transfers, supplier
 * returns, supply / client-return unaccept), so their stock checks and the order's
 * availability check see each other. Lock order: orders lock → warehouse lock, and it is
 * taken before the order row is locked (FOR UPDATE), the order a warehouse rename uses
 * (warehouse lock → orders rows), so the two never wait on each other in a cycle. */
async function lockOrderWarehouses(db: PgDb, warehouses: Array<string | null | undefined>): Promise<void> {
  await lockWarehouseStock(db, warehouses.map((name) => String(name ?? "")))
}

function nowIso(): string {
  return new Date().toISOString()
}

async function prepareWrites() {
  await ensureOrdersSchema()
  // The stock / finance cores install their SQL helpers and extension columns
  // (DDL on orders) on their own connections; do it before our transaction
  // holds a lock on an orders row, or that DDL would wait for us while we
  // wait for the stock check.
  await ensureStockSchema()
  await ensureFinanceSchema()
  // The product restriction tables (and the move of the older name-based table): the order
  // checks below read them inside the transaction and never run DDL there.
  await ensureProductRestrictionsSchema()
}

export async function createOrder(input: OrderCreateInput, user: { displayName: string }): Promise<Order> {
  await prepareWrites()
  const id = await withTransaction(async (tx) => {
    await lockOrders(tx)
    const client = await resolveClient(tx, input)
    const status = assertStatus(input.status?.trim() || "Есть на складе")
    let currency = input.currency?.trim() ? await resolveCurrency(tx, input.currency) : null
    const lines = input.items ?? []
    let amountValue = 0
    if (input.amount !== undefined && input.amount !== "") {
      // With lines the total is derived from them; the amount only names the currency.
      const parsed = parseAmount(input.amount)
      if (parsed.currency) {
        const code = await resolveCurrency(tx, parsed.currency)
        if (currency && code !== currency) throw new OrderError("Валюта суммы не совпадает с валютой заказа", 400, { field: "amount" })
        currency = code
      }
      amountValue = parsed.value
    }
    const lineCurrency = lines.find((line) => line.currency?.trim())?.currency
    if (!currency && lineCurrency) currency = await resolveCurrency(tx, lineCurrency)
    currency ??= await baseCurrency(tx)
    // Reserving / shipping stock: the warehouse's stock lock, before its name is resolved, so a
    // rename of that warehouse either finished before (the new name resolves) or waits for this order.
    if (lines.length && STOCK_STATUSES.includes(status)) await lockOrderWarehouses(tx, [input.warehouse])
    const warehouse = input.warehouse?.trim() ? await resolveWarehouse(tx, input.warehouse) : ""
    const agentDefault = !NOT_SET.has(nameKey(client.agent ?? "")) ? client.agent : user.displayName
    const agent = input.agent?.trim() ? (await resolveEmployee(tx, input.agent, "agent", "Агент")) || agentDefault : agentDefault
    const deliveryMan = input.deliveryMan?.trim() ? await resolveEmployee(tx, input.deliveryMan, "deliveryMan", "Доставщик") : ""
    const organization = await resolveOrderOrganization(tx, input.organization, { clientId: client.id, agent, warehouse })
    const resolved: ResolvedLine[] = []
    for (const line of lines) resolved.push(await resolveLine(tx, line, currency))
    if (resolved.length && STOCK_STATUSES.includes(status)) {
      if (!warehouse) throw new OrderError("Укажите склад заказа", 400, { field: "warehouse" })
      // Already held unless the resolved name keys differently from the text sent (no-op then).
      await lockOrderWarehouses(tx, [warehouse])
      await assertAvailable(warehouse, resolved.map((line) => ({ key: lineKey(line.productId, line.productName), name: line.productName, quantity: line.quantity })), new Map())
    }
    // A new order that is not cancelled: its agent must be allowed to sell every product, and it
    // counts towards the agent's product limits.
    if (!isCancelledStatus(status)) {
      await assertProductsAllowed(tx, agent, resolved.map((line) => line.productId))
      await assertAgentLimits(tx, { agent, after: quantitiesByProduct(resolved) })
    }
    const total = resolved.reduce((sum, line) => sum + line.quantity * line.unitPrice * (1 - line.discountPercent / 100), 0)
    if (total > MAX_MONEY) throw new OrderError("Сумма заказа слишком большая", 400, { field: "items" })
    const amount = formatMoney(resolved.length ? total : amountValue, currency)
    const product = resolved.length
      ? resolved.map((line) => `${line.productName} x${roundQty(line.quantity)}`).join(", ")
      : input.product?.trim() || "—"
    const inserted = await tx
      .prepare(
        `INSERT INTO orders (client, client_id, zone, type, product, created, delivery, agent, amount, balance, negative, status, discount,
           payment_date, payment_type, organization, warehouse, delivery_man, shipped_at, currency, price_list, created_by, comment,
           delivery_type, deal_type)
         VALUES (@client, @clientId, @zone, @type, @product, @created, @delivery, @agent, @amount, '', 0, @status, @discount,
           @paymentDate, @paymentType, @organization, @warehouse, @deliveryMan, @shippedAt, @currency, @priceList, @createdBy, @comment,
           @deliveryType, @dealType)`,
      )
      .run({
        client: client.name,
        clientId: client.id,
        zone: input.zone?.trim() || client.zone || "",
        type: input.type?.trim() || client.type || "",
        product,
        created: formatOrderTimestamp(new Date()),
        delivery: input.delivery?.trim() || "—",
        agent,
        amount,
        status,
        discount: input.discount?.trim() || null,
        paymentDate: input.paymentDate ?? "",
        paymentType: input.paymentType ?? "",
        organization,
        warehouse,
        deliveryMan,
        shippedAt: RELEASED_STATUSES.includes(status) ? nowIso() : null,
        currency,
        priceList: input.priceList?.trim() ?? "",
        createdBy: user.displayName,
        comment: input.comment?.trim() ?? "",
        deliveryType: input.deliveryType?.trim() ?? "",
        dealType: input.dealType?.trim() ?? "",
      })
    const orderId = Number(inserted.lastInsertRowid)
    for (const line of resolved) await insertLine(tx, orderId, line, currency)
    await addLog(tx, orderId, { kind: "Создан", status, amount, user: user.displayName })
    return orderId
  })
  return (await getOrder(id))!
}

async function insertLine(db: PgDb, orderId: number, line: ResolvedLine, currency: string): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit, quantity, unit_price, cost_price, discount_percent, currency)
       VALUES (@orderId, @productId, @productName, @unit, @quantity, @unitPrice, @costPrice, @discountPercent, @currency)`,
    )
    .run({ orderId, ...line, currency })
  return Number(result.lastInsertRowid)
}

/** Fields that may still change once the order is final (Доставлено / Отменен). */
const FINAL_EDITABLE = new Set(["paymentDate", "comment", "invoiceNumber", "invoiceDate", "invoiceActive", "contract", "organization"])
/** Fields fixed once the goods left the warehouse (В пути). */
const SHIPPED_FIXED = new Set(["clientId", "client", "amount", "currency", "warehouse"])
/** API field → orders column (text fields compared against the stored value). */
const FIELD_COLUMNS: Record<string, string> = {
  client: "client",
  zone: "zone",
  type: "type",
  product: "product",
  delivery: "delivery",
  agent: "agent",
  amount: "amount",
  currency: "currency",
  discount: "discount",
  paymentType: "payment_type",
  organization: "organization",
  warehouse: "warehouse",
  deliveryMan: "delivery_man",
  priceList: "price_list",
  deliveryType: "delivery_type",
  dealType: "deal_type",
  created: "created",
}

export async function updateOrder(id: number, patch: OrderUpdateInput, user: { displayName: string }): Promise<Order | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await prepareWrites()
  const found = await withTransaction(async (tx) => {
    await lockOrders(tx)
    // Only a status or warehouse change can reserve / ship stock (assertAvailable below).
    if (patch.status !== undefined || patch.warehouse !== undefined) {
      const head = (await tx.prepare("SELECT warehouse FROM orders WHERE id = ?").get(id)) as { warehouse: string | null } | undefined
      if (head) await lockOrderWarehouses(tx, [head.warehouse, patch.warehouse])
    }
    const current = (await tx.prepare("SELECT * FROM orders WHERE id = ? FOR UPDATE").get(id)) as OrderRow | undefined
    if (!current) return false
    const items = await listItemRows(tx, id)
    const from = current.status
    const target = patch.status !== undefined ? assertStatus(patch.status.trim()) : from
    const changed = Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key)

    if (target !== from && !canChangeStatus(from, target)) {
      throw new OrderError(`Нельзя изменить статус заказа с «${from}» на «${target}»`, 409, { from, to: target })
    }
    if (FINAL_STATUSES.includes(from)) {
      // Only the payment terms / invoice details of a final order may still change.
      const blocked = changed.filter((key) => key !== "status" && !FINAL_EDITABLE.has(key))
      const reallyChanged = blocked.filter((key) => {
        const value = (patch as Record<string, unknown>)[key]
        const column = FIELD_COLUMNS[key]
        if (!column || typeof value !== "string") return true
        const stored = String((current as Record<string, unknown>)[column] ?? "")
        return key === "client" || key === "agent" || key === "deliveryMan" || key === "warehouse" ? nameKey(value) !== nameKey(stored) : value.trim() !== stored
      })
      if (reallyChanged.length) throw new OrderError(`Заказ в статусе «${from}» нельзя изменить`, 409, { fields: reallyChanged })
    }

    const next: Record<string, unknown> = {}
    let currency = orderCurrencyOf(current) ?? (await baseCurrency(tx))
    const sets = (column: string, value: unknown) => {
      next[column] = value
    }

    // Client
    if (patch.clientId !== undefined || (patch.client !== undefined && nameKey(patch.client) !== nameKey(current.client))) {
      const client = await resolveClient(tx, { clientId: patch.clientId, client: patch.client })
      if (client.id !== current.client_id || client.name !== current.client) {
        sets("client", client.name)
        sets("client_id", client.id)
        if (patch.zone === undefined) sets("zone", client.zone || "")
        if (patch.type === undefined) sets("type", client.type || "")
      }
    }
    // Currency / amount
    if (patch.currency !== undefined && patch.currency.trim()) {
      const code = await resolveCurrency(tx, patch.currency)
      if (code !== currency) {
        if (items.length) throw new OrderError("Валюту заказа с товарами изменить нельзя", 409, { field: "currency" })
        currency = code
        sets("currency", code)
      }
    }
    if (patch.amount !== undefined && patch.amount !== "") {
      const parsed = parseAmount(patch.amount)
      const code = parsed.currency ? await resolveCurrency(tx, parsed.currency) : currency
      const text = formatMoney(parsed.value, code)
      const currentParsed = parseMoneyText(current.amount)
      const same = currentParsed && Math.abs(currentParsed.value - parsed.value) < 0.005 && (currentParsed.currency ?? currency) === code
      if (!same) {
        if (items.length) throw new OrderError("Сумма заказа рассчитывается по товарам", 409, { field: "amount" })
        if (code !== currency) {
          currency = code
          sets("currency", code)
        }
        sets("amount", text)
      }
    }
    // Warehouse
    let warehouse = current.warehouse ?? ""
    if (patch.warehouse !== undefined && nameKey(patch.warehouse) !== nameKey(warehouse)) {
      warehouse = patch.warehouse.trim() ? await resolveWarehouse(tx, patch.warehouse) : ""
      sets("warehouse", warehouse)
    }
    if (from === "В пути" || from === "Доставлено") {
      const blocked = Object.keys(next).filter((column) => SHIPPED_FIXED.has(column === "client_id" ? "clientId" : column))
      if (blocked.length) throw new OrderError("Клиента, сумму, валюту и склад отгруженного заказа изменить нельзя", 409, { fields: blocked })
    }
    // People
    if (patch.agent !== undefined && nameKey(patch.agent) !== nameKey(current.agent)) {
      sets("agent", (await resolveEmployee(tx, patch.agent, "agent", "Агент")) || current.agent)
    }
    if (patch.deliveryMan !== undefined && nameKey(patch.deliveryMan) !== nameKey(current.delivery_man ?? "")) {
      sets("delivery_man", await resolveEmployee(tx, patch.deliveryMan, "deliveryMan", "Доставщик"))
    }
    // Plain fields
    const text = (value: string | undefined) => (value === undefined ? undefined : value.trim())
    const plain: Array<[keyof OrderUpdateInput, string]> = [
      ["zone", "zone"],
      ["type", "type"],
      ["delivery", "delivery"],
      ["discount", "discount"],
      ["paymentDate", "payment_date"],
      ["paymentType", "payment_type"],
      ["priceList", "price_list"],
      ["comment", "comment"],
      ["deliveryType", "delivery_type"],
      ["dealType", "deal_type"],
      ["created", "created"],
      ["invoiceNumber", "invoice_number"],
      ["invoiceDate", "invoice_date"],
      ["contract", "contract"],
    ]
    for (const [field, column] of plain) {
      const value = text(patch[field] as string | undefined)
      if (value !== undefined && value !== ((current as Record<string, unknown>)[column] ?? "")) sets(column, value)
    }
    if (patch.product !== undefined && !items.length && patch.product.trim() !== current.product) sets("product", patch.product.trim() || "—")
    if (patch.invoiceActive !== undefined && (patch.invoiceActive ? 1 : 0) !== (current.invoice_active ?? 0)) sets("invoice_active", patch.invoiceActive ? 1 : 0)

    // Agent limits: a not cancelled order counts towards its agent's limits, so a new agent
    // (or an order that comes back from a cancelled status) must still fit them.
    if (items.length && !isCancelledStatus(target)) {
      const agentAfter = (next.agent as string | undefined) ?? current.agent
      const counted = !isCancelledStatus(from) && nameKey(agentAfter) === nameKey(current.agent)
      // A new agent (or an order back from Отменен) must be allowed to sell every line.
      if (!counted) await assertProductsAllowed(tx, agentAfter, items.map((item) => item.product_id))
      await assertAgentLimits(tx, { agent: agentAfter, orderId: id, createdAt: current.created_at, after: itemsByProduct(items), before: counted ? itemsByProduct(items) : undefined })
    }

    // Status and stock
    if (target !== from) sets("status", target)
    if (items.length && STOCK_STATUSES.includes(target)) {
      if (!warehouse) throw new OrderError("Укажите склад заказа", 400, { field: "warehouse" })
      const entering = !STOCK_STATUSES.includes(from)
      const releasing = from === "Есть на складе" && RELEASED_STATUSES.includes(target)
      const moved = "warehouse" in next
      const unknownFrom = !(ORDER_STATUSES as readonly string[]).includes(from)
      if (entering || releasing || moved || unknownFrom) {
        // Already held unless the resolved name keys differently from the text sent (no-op then).
        await lockOrderWarehouses(tx, [warehouse])
        await assertAvailable(warehouse, needsOf(items), reservedBy(current, items, warehouse))
      }
    }
    if (RELEASED_STATUSES.includes(target) && !RELEASED_STATUSES.includes(from)) sets("shipped_at", nowIso())
    if (!RELEASED_STATUSES.includes(target) && current.shipped_at) sets("shipped_at", null)

    // Organization: a chosen one must be known (400). A cleared one, or the empty
    // one of an older order that changes now, takes the default of the order's
    // client / agent / warehouse (resolveOrderOrganization). When the client, agent
    // or warehouse changes and no organization is sent, an organization that was
    // the default of the old ones follows the new ones; one chosen by hand stays.
    const storedOrganization = current.organization ?? ""
    let organization: string | undefined
    const organizationHints = {
      clientId: (next.client_id as number | undefined) ?? current.client_id,
      agent: (next.agent as string | undefined) ?? current.agent,
      warehouse,
    }
    if (patch.organization !== undefined) organization = await resolveOrderOrganization(tx, patch.organization, organizationHints)
    else if (!placeName(storedOrganization) && Object.keys(next).length) organization = await resolveOrderOrganization(tx, "", organizationHints)
    else if ("client_id" in next || "agent" in next || "warehouse" in next) {
      const before = await resolveOrderOrganization(tx, "", { clientId: current.client_id, agent: current.agent, warehouse: current.warehouse ?? "" })
      if (nameKey(before) === nameKey(storedOrganization)) {
        const after = await resolveOrderOrganization(tx, "", organizationHints)
        if (after) organization = after
      }
    }
    if (organization !== undefined && organization !== storedOrganization && (organization || patch.organization !== undefined)) sets("organization", organization)
    // The order's payments (and returns, once they carry an organization) took the
    // order's organization when they were made: they move with it, so the order's
    // debt and its payments stay under the same organization. A payment of another
    // organization (chosen by hand) keeps its own.
    if ("organization" in next && placeName(String(next.organization ?? "")) && nameKey(String(next.organization)) !== nameKey(storedOrganization)) {
      await moveLinkedOrganization(tx, id, storedOrganization, String(next.organization ?? ""))
    }

    const changedColumns = Object.keys(next)
    const currencyChanged = "currency" in next
    // Legacy rows get their currency stored with the first real change.
    if (changedColumns.length && !current.currency && !currencyChanged) next.currency = currency
    const columns = Object.keys(next)
    if (changedColumns.length) {
      await tx
        .prepare(`UPDATE orders SET ${columns.map((column) => `${column} = @${column}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...next, id })
      if (!items.length && currencyChanged && !("amount" in next)) {
        const after = (await tx.prepare("SELECT amount FROM orders WHERE id = ?").get(id)) as { amount: string }
        const value = parseMoneyText(after.amount)?.value ?? 0
        await tx.prepare("UPDATE orders SET amount = @amount WHERE id = @id").run({ id, amount: formatMoney(value, currency) })
      }
      const comment =
        target !== from
          ? `Изменен статус: ${from} - ${target}`
          : `Изменено: ${changedColumns.join(", ")}`
      const amountRow = (await tx.prepare("SELECT amount FROM orders WHERE id = ?").get(id)) as { amount: string }
      await addLog(tx, id, { kind: "Обновленный", status: target, comment, amount: amountRow.amount, user: user.displayName })
    }
    return true
  })
  return found ? getOrder(id) : null
}

// ---------------------------------------------------------------------------
// Line writes (used by lib/order-items-repo.ts)
// ---------------------------------------------------------------------------

type LineOp = { kind: "create"; line: OrderLineInput } | { kind: "update"; itemId: number; line: OrderLineInput } | { kind: "delete"; itemId: number }

/** Adds / changes / removes one line of an order: the order must exist (404)
 * and be editable (409); the line is validated against the catalog; a
 * reserved order re-checks stock; the order total follows. Returns the line
 * id, or null when the line does not exist. */
export async function writeOrderLine(orderId: number, op: LineOp, user: { displayName: string }): Promise<number | null> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || orderId > 2_147_483_647) throw new OrderError("Заказ не найден", 404)
  await prepareWrites()
  return withTransaction(async (tx) => {
    await lockOrders(tx)
    // Adding / changing a line of a reserved order re-checks its warehouse's stock (assertAvailable below).
    if (op.kind !== "delete") {
      const head = (await tx.prepare("SELECT status, warehouse FROM orders WHERE id = ?").get(orderId)) as { status: string; warehouse: string | null } | undefined
      if (head && STOCK_STATUSES.includes(head.status)) await lockOrderWarehouses(tx, [head.warehouse])
    }
    const order = (await tx.prepare("SELECT * FROM orders WHERE id = ? FOR UPDATE").get(orderId)) as OrderRow | undefined
    if (!order) throw new OrderError("Заказ не найден", 404)
    const known = (ORDER_STATUSES as readonly string[]).includes(order.status)
    if (known && !EDITABLE_STATUSES.includes(order.status)) {
      throw new OrderError(`Товары заказа в статусе «${order.status}» изменить нельзя`, 409, { status: order.status })
    }
    const items = await listItemRows(tx, orderId)
    const currency = orderCurrencyOf(order) ?? (await baseCurrency(tx))
    let existing: ItemRow | undefined
    if (op.kind !== "create") {
      existing = items.find((item) => item.id === op.itemId)
      if (!existing) return null
    }
    let resolved: ResolvedLine | null = null
    if (op.kind !== "delete") {
      // New lines take the order currency; a legacy line of another currency keeps its own.
      const expected = existing && existing.currency && existing.currency.toUpperCase() !== currency.toUpperCase() ? existing.currency : currency
      resolved = await resolveLine(tx, op.line, expected)
    }
    // Product restrictions: a line that is added, changes its product or grows.
    if (resolved && !isCancelledStatus(order.status)) {
      const grows = !existing || existing.product_id !== resolved.productId || resolved.quantity > Number(existing.quantity) + 1e-9
      if (grows) await assertProductsAllowed(tx, order.agent, [resolved.productId])
    }
    // Agent limits: the order's quantity per product after the change (only growth is checked).
    if (resolved && !isCancelledStatus(order.status)) {
      const others = items.filter((item) => !existing || item.id !== existing.id)
      await assertAgentLimits(tx, {
        agent: order.agent,
        orderId,
        createdAt: order.created_at,
        after: quantitiesByProduct([...others.map((item) => ({ productId: item.product_id, productName: item.product_name, quantity: Number(item.quantity) })), resolved]),
        before: itemsByProduct(items),
      })
    }
    // Stock of a reserved order: the order's quantities after the change.
    if (resolved && STOCK_STATUSES.includes(order.status)) {
      const warehouse = order.warehouse ?? ""
      if (!warehouse) throw new OrderError("Укажите склад заказа", 400, { field: "warehouse" })
      const key = lineKey(resolved.productId, resolved.productName)
      const after = items
        .filter((item) => !existing || item.id !== existing.id)
        .filter((item) => lineKey(item.product_id, item.product_name) === key)
        .reduce((sum, item) => sum + Number(item.quantity), resolved.quantity)
      await assertAvailable(warehouse, [{ key, name: resolved.productName, quantity: after }], reservedBy(order, items, warehouse))
    }
    let lineId: number | null = existing?.id ?? null
    let comment = ""
    if (op.kind === "create" && resolved) {
      lineId = await insertLine(tx, orderId, resolved, currency)
      comment = `Добавлен товар: ${resolved.productName} x${roundQty(resolved.quantity)}`
    } else if (op.kind === "update" && resolved && existing) {
      await tx
        .prepare(
          `UPDATE order_items SET product_id = @productId, product_name = @productName, unit = @unit, quantity = @quantity,
             unit_price = @unitPrice, cost_price = @costPrice, discount_percent = @discountPercent
           WHERE id = @id AND order_id = @orderId`,
        )
        .run({ ...resolved, id: existing.id, orderId })
      comment = `Изменен товар: ${resolved.productName} x${roundQty(resolved.quantity)}`
    } else if (op.kind === "delete" && existing) {
      await tx.prepare("DELETE FROM order_items WHERE id = ? AND order_id = ?").run(existing.id, orderId)
      comment = `Удален товар: ${existing.product_name}`
    }
    if (!order.currency) await tx.prepare("UPDATE orders SET currency = @currency WHERE id = @id").run({ id: orderId, currency })
    await syncSummary(tx, { ...order, currency })
    const amountRow = (await tx.prepare("SELECT amount FROM orders WHERE id = ?").get(orderId)) as { amount: string }
    await addLog(tx, orderId, { kind: "Обновленный", status: order.status, comment, amount: amountRow.amount, user: user.displayName })
    return lineId
  })
}
