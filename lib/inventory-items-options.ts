import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { nameKey, placeName } from "@/lib/finance/entities"
import { ensureInventorySchema } from "@/lib/inventory-items-schema"
import { INVENTORY_CONDITIONS, type InventoryOptions, type InventoryProductOption, type InventoryTemplateClient } from "@/lib/inventory-items-types"
import { getStockBalances, getStockPending } from "@/lib/stock/ledger"

// Lookups of "Работа с инвентарем": the filter popup, the dialogs and the
// import template. Clients are searched through GET /api/clients; staff come
// from employees (+ system users); zones and agents from the clients.

function unique(values: Iterable<unknown>): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const name = placeName(value)
    const key = nameKey(name)
    if (key && !seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
}

async function column(db: PgDb, sql: string): Promise<string[]> {
  const rows = (await db.prepare(sql).all()) as Array<{ v: string | null }>
  return rows.map((row) => row.v ?? "")
}

/** Состояние (Linko main/gear_condition): the inventory_conditions names in id order; Linko's defaults while it is empty. */
export async function inventoryConditions(db: PgDb = getDb()): Promise<string[]> {
  const names = (await column(db, "SELECT name AS v FROM inventory_conditions ORDER BY id")).map((name) => name.trim()).filter(Boolean)
  return names.length ? [...new Set(names)] : [...INVENTORY_CONDITIONS]
}

/** Names in the given order, blanks left out. */
function present(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean)
}

export async function getInventoryOptions(): Promise<InventoryOptions> {
  await ensureInventorySchema()
  const db = getDb()
  const [products, warehouses, employees, users, zones, clientAgents, organizations, productOrgs, branches, clientTypes, clientTypeNames, moduleUsers, conditions, stocks, staff] = await Promise.all([
    db.prepare("SELECT id, name, unit, organization FROM products WHERE is_inventory = 1 AND deleted = 0 ORDER BY lower(name), id").all() as Promise<
      Array<{ id: number; name: string; unit: string | null; organization: string | null }>
    >,
    db.prepare("SELECT name, branch FROM warehouses WHERE COALESCE(active, 1) = 1 ORDER BY lower(name), id").all() as Promise<Array<{ name: string; branch: string | null }>>,
    column(db, "SELECT btrim(concat_ws(' ', first_name, last_name)) AS v FROM employees WHERE active = 1"),
    column(db, "SELECT COALESCE(NULLIF(btrim(display_name), ''), username) AS v FROM users"),
    column(db, "SELECT DISTINCT zone AS v FROM clients"),
    column(db, "SELECT DISTINCT agent AS v FROM clients"),
    column(db, "SELECT name AS v FROM organizations"),
    column(db, "SELECT DISTINCT organization AS v FROM products WHERE is_inventory = 1"),
    column(db, "SELECT name AS v FROM branches UNION SELECT branch FROM warehouses"),
    column(db, "SELECT name AS v FROM client_types"),
    column(db, "SELECT DISTINCT type AS v FROM clients"),
    column(
      db,
      `SELECT responsible AS v FROM inventory_items UNION SELECT created_by FROM inventory_items UNION SELECT created_by FROM inventory_item_logs
       UNION SELECT created_by FROM inventory_item_checks UNION SELECT requested_by FROM inventory_item_requests UNION SELECT updated_by FROM inventory_item_requests`,
    ),
    inventoryConditions(db),
    // Linko's Склад select lists the warehouses newest first (saas/for_select m=Stock).
    column(db, "SELECT name AS v FROM warehouses WHERE COALESCE(active, 1) = 1 ORDER BY id DESC"),
    // Linko's Ответственный select: the active staff in id order (main/crud/for_select).
    column(db, "SELECT btrim(concat_ws(' ', first_name, last_name)) AS v FROM employees WHERE active = 1 ORDER BY id"),
  ])
  const seenWarehouses = new Set<string>()
  return {
    products: products.map((row) => ({ id: Number(row.id), name: row.name, unit: row.unit ?? "", organization: placeName(row.organization) })),
    warehouses: warehouses
      .filter((row) => {
        const key = nameKey(row.name)
        if (!key || seenWarehouses.has(key)) return false
        seenWarehouses.add(key)
        return true
      })
      .map((row) => ({ name: row.name.trim(), branch: placeName(row.branch) })),
    // Like Linko's selects, two warehouses / staff members of the same name are both listed.
    stocks: present(stocks),
    conditions,
    responsibles: unique([...employees, ...users]),
    staff: present(staff),
    users: unique([...employees, ...users, ...moduleUsers]),
    zones: unique(zones),
    agents: unique([...employees, ...clientAgents]),
    organizations: unique([...organizations, ...productOrgs]),
    branches: unique(branches),
    clientTypes: unique([...clientTypes, ...clientTypeNames]),
  }
}

/** Linko's order of the inventory products (stock/all_balances?is_gear=true): the product order number, then the
 * position Linko listed it at (inventory_product_positions), newest first for the rest. (No "?" in the pattern: the
 * database layer turns every "?" into a parameter.) */
const PRODUCT_ORDER = `(CASE WHEN btrim(COALESCE(p.order_number, '')) ~ '^-{0,1}[0-9]+([.][0-9]+){0,1}$' THEN btrim(p.order_number)::numeric END) NULLS LAST,
  pos.position NULLS LAST, p.id DESC`

/**
 * Inventory products for the "Продукт" select of "Добавление / Изменение инвентаря" with their stock (Linko
 * stock/all_balances?is_gear=true&stock=: "<name> (<balance> <unit>)" over "Доступно: <available> <unit>"): the balance
 * in the chosen warehouse, or in every warehouse while none is chosen. Like Linko's, the reserved part is the pending
 * orders and transfers plus the items of the product that sit on that warehouse with no client (each holds one unit).
 * Read-only use of the stock core; `includeId` keeps the product of an edited item even if it is no longer inventory.
 */
export async function listInventoryProducts(warehouse: string, includeId: number | null): Promise<InventoryProductOption[]> {
  await ensureInventorySchema()
  const db = getDb()
  const rows = (await db
    .prepare(
      `SELECT p.id, p.name, p.unit FROM products p LEFT JOIN inventory_product_positions pos ON pos.id = p.id
       WHERE (p.is_inventory = 1 AND p.deleted = 0) OR p.id = ? ORDER BY ${PRODUCT_ORDER}`,
    )
    .all(includeId ?? 0)) as Array<{ id: number; name: string; unit: string | null }>
  const qty = new Map<string, number>()
  const reserved = new Map<string, number>()
  if (rows.length) {
    const scope = warehouse.trim() ? { warehouses: [warehouse] } : {}
    const [balances, pending, items] = await Promise.all([
      getStockBalances(scope, db),
      getStockPending(scope, db),
      db
        .prepare(
          `SELECT 'product:' || i.product_id AS key, count(*)::int AS n FROM inventory_items i
           WHERE i.deleted = 0 AND i.product_id IS NOT NULL AND i.client_id IS NULL AND btrim(COALESCE(i.client, '')) = ''
             ${warehouse.trim() ? "AND fin_key(i.warehouse) = fin_key(?)" : ""}
           GROUP BY i.product_id`,
        )
        .all(...(warehouse.trim() ? [warehouse] : [])) as Promise<Array<{ key: string; n: number }>>,
    ])
    for (const row of balances) qty.set(row.key, (qty.get(row.key) ?? 0) + row.qty)
    for (const row of pending) reserved.set(row.key, (reserved.get(row.key) ?? 0) + row.reserved)
    for (const row of items) reserved.set(row.key, (reserved.get(row.key) ?? 0) + Number(row.n))
  }
  return rows.map((row) => {
    const key = `product:${row.id}`
    const balance = qty.get(key) ?? 0
    return { id: Number(row.id), name: row.name, unit: row.unit ?? "", balance, available: balance - (reserved.get(key) ?? 0) }
  })
}

/** Clients of the import template ("Выберите агента и зону"); no agent / zone = every client. */
export async function listTemplateClients(agents: string[], zones: string[]): Promise<InventoryTemplateClient[]> {
  await ensureInventorySchema()
  const where: string[] = []
  const args: unknown[] = []
  if (agents.length) {
    where.push("(fin_key(agent) = ANY(?::text[]) OR fin_key(zone_agent) = ANY(?::text[]))")
    args.push(agents.map(nameKey), agents.map(nameKey))
  }
  if (zones.length) {
    where.push("fin_key(zone) = ANY(?::text[])")
    args.push(zones.map(nameKey))
  }
  const rows = (await getDb()
    .prepare(`SELECT id, name, zone, agent FROM clients ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY lower(name), id LIMIT 20000`)
    .all(...args)) as Array<{ id: number; name: string; zone: string | null; agent: string | null }>
  return rows.map((row) => ({ id: Number(row.id), name: row.name, zone: placeName(row.zone), agent: placeName(row.agent) }))
}
