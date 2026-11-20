import "server-only"

import { getDb } from "@/lib/db"

// Data of Linko's order filter (Продажи → Заказы → «Показать фильтр», its OrderFilterForm): the option lists of the selects
// and, per order, the facts the list rows do not carry (what the order's lines hold, the shop's INN / type / contract, the
// financial account the order is booked on). The list filters on the client (components/orders/order-filter-panel.tsx).
// Read-only.

export type FilterOption = { id: number; name: string }
export type TreeOption = FilterOption & { parentId: number | null }

export type OrderFilterFacts = {
  /** Products of the order's lines. */
  products: number[]
  /** Product types of those products (product_types.id) and their parent types. */
  types: number[]
  brands: number[]
  /** A line's product is marked (products.marked_product). */
  marked: boolean
  /** The financial account the order is booked on (orders.financial_account_id, else its shop's account). */
  account: number | null
  /** The shop's INN. */
  inn: string
  /** The shop's client type (client_types.id) and that type's parent (itself when it has none). */
  clientType: number | null
  clientTypeParent: number | null
  /** The shop has an active contract (Финансы → Договоры). */
  contract: boolean
  /** The order's organization (organizations.id): orders.organization_id, else the organization of its name. */
  division: number | null
  /** The promotions applied to the order (orders.promotions: ids and their types, e.g. "bonus"). Without one, Linko's
   * «Тип акции» counts a manual discount (orders.with_discount and a discount percent above 0) as "discount" and a bonus
   * line without a promotion as "bonus". */
  promotions: number[]
  promotionTypes: string[]
  /** A line is a bonus line (order_items.is_bonus): Linko's «Только бонусные заказы». */
  bonus: boolean
  /** Linko's order is_new («Только новые», orders.is_new). */
  isNew: boolean
  /** «Сборщик»: the employee id of orders.collector_id. */
  collector: number | null
}

export type OrderFilterData = {
  options: {
    financeAccounts: FilterOption[]
    employees: FilterOption[]
    /** Every employee, the inactive ones too: an id in the URL (deliveryMan=204) names an order's person even when the
     * select no longer lists them, as Linko's server filters by the id. */
    allEmployees: FilterOption[]
    productTypes: TreeOption[]
    products: Array<FilterOption & { typeId: number | null }>
    clients: FilterOption[]
    inns: string[]
    clientTypes: TreeOption[]
    branches: FilterOption[]
    transports: FilterOption[]
    warehouses: FilterOption[]
    priceLists: FilterOption[]
    /** Linko's divisions (Организация), shown with its DIVISIONS setting. */
    organizations: FilterOption[]
    zones: FilterOption[]
    promotions: FilterOption[]
    brands: FilterOption[]
    currencies: Array<FilterOption & { code: string }>
  }
  facts: Record<number, OrderFilterFacts>
}

async function present(tables: string[]): Promise<Set<string>> {
  const rows = (await getDb()
    .prepare("SELECT t AS name FROM unnest(@tables::text[]) AS t WHERE to_regclass(t) IS NOT NULL")
    .all({ tables })) as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

async function list<T>(ok: boolean, sql: string): Promise<T[]> {
  if (!ok) return []
  try {
    return (await getDb().prepare(sql).all()) as T[]
  } catch (error) {
    console.error("order filter options unavailable", error)
    return []
  }
}

const num = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) && value !== null && value !== "" ? n : null
}

/** «Организация»: like Linko's (the signed-in user's divisions), the organizations of the user's employee card, else all;
 * by name as Linko sorts them (case and punctuation ignored, digits, then Latin, then Cyrillic). */
async function userOrganizations(all: FilterOption[], employeeId: number | null | undefined): Promise<FilterOption[]> {
  let own = all
  if (employeeId && Number.isSafeInteger(employeeId)) {
    const row = (await list<{ ids: string | null }>(true, `SELECT organization_ids AS ids FROM employees WHERE id = ${employeeId}`))[0]
    let ids: number[] = []
    try {
      const parsed: unknown = JSON.parse(row?.ids ?? "[]")
      ids = Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []
    } catch {
      ids = []
    }
    if (ids.length) own = all.filter((item) => ids.includes(Number(item.id)))
  }
  return [...own].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", ignorePunctuation: true }) || a.id - b.id)
}

/** orders.promotions (JSON list of {id, name, type}) → its entries with a numeric id; none when unreadable. */
function promotionsOf(raw: string | null): Array<{ id: number; type: string }> {
  try {
    const parsed: unknown = JSON.parse(raw || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => ({ id: Number((entry as { id?: unknown })?.id), type: String((entry as { type?: unknown })?.type ?? "") }))
      .filter((entry) => Number.isSafeInteger(entry.id))
  } catch {
    return []
  }
}

export async function getOrderFilterData(employeeId?: number | null): Promise<OrderFilterData> {
  const has = await present([
    "orders", "order_items", "products", "product_types", "brands", "clients", "client_types", "financial_accounts",
    "financial_account_markets", "contracts", "contract_clients", "employees", "branches", "transports", "warehouses",
    "price_lists", "client_zones", "ref_records", "currencies", "organizations",
  ])
  // Option lists, each in the order Linko's select lists it: newest first for the server-searched ones (financial
  // accounts, shops, products), A–Z for the warehouses (its StockSearchField) and the currencies (Euro, SUM, USD), the
  // reference lists by their ids.
  const [financeAccounts, employees, productTypes, products, clients, clientTypes, branches, transports, warehouses, priceLists, organizations, zones, promotions, brands, currencies] =
    await Promise.all([
      list<FilterOption>(has.has("financial_accounts"), "SELECT id, name FROM financial_accounts WHERE COALESCE(deleted::text, '0') NOT IN ('1', 'true', 't') ORDER BY id DESC"),
      list<FilterOption>(has.has("employees"), "SELECT id, TRIM(CONCAT_WS(' ', first_name, last_name)) AS name FROM employees WHERE COALESCE(active::text, 'true') NOT IN ('0', 'false', 'f') ORDER BY id"),
      list<TreeOption>(has.has("product_types"), "SELECT id, name, parent_id AS \"parentId\" FROM product_types ORDER BY id"),
      list<FilterOption & { typeId: number | null }>(
        has.has("products") && has.has("product_types"),
        "SELECT p.id, p.name, (SELECT MIN(t.id) FROM product_types t WHERE t.name = p.type) AS \"typeId\" FROM products p WHERE COALESCE(p.deleted::text, '0') NOT IN ('1', 'true', 't') ORDER BY p.id DESC",
      ),
      list<FilterOption>(has.has("clients"), "SELECT id, name FROM clients ORDER BY id DESC"),
      list<TreeOption>(has.has("client_types"), "SELECT id, name, parent_id AS \"parentId\" FROM client_types ORDER BY id"),
      list<FilterOption>(has.has("branches"), "SELECT id, name FROM branches ORDER BY id"),
      list<FilterOption>(has.has("transports"), "SELECT id, number AS name FROM transports ORDER BY id DESC"),
      list<FilterOption>(has.has("warehouses"), "SELECT id, name FROM warehouses ORDER BY LOWER(name), id"),
      list<FilterOption>(has.has("price_lists"), "SELECT id, name FROM price_lists ORDER BY id"),
      list<FilterOption>(has.has("organizations"), "SELECT id, name FROM organizations ORDER BY id"),
      list<FilterOption>(has.has("client_zones"), "SELECT id, name FROM client_zones ORDER BY id"),
      list<FilterOption>(has.has("ref_records"), "SELECT CAST(id::text AS BIGINT) AS id, (data::jsonb)->>'name' AS name FROM ref_records WHERE kind = 'promo' AND deleted = 0 AND id::text ~ '^[0-9]+$' ORDER BY CAST(id::text AS BIGINT) DESC"),
      list<FilterOption>(has.has("brands"), "SELECT id, name FROM brands ORDER BY id"),
      list<FilterOption & { code: string }>(has.has("currencies"), "SELECT id, name, code FROM currencies ORDER BY code, id"),
    ])
  const allEmployees = await list<FilterOption>(has.has("employees"), "SELECT id, TRIM(CONCAT_WS(' ', first_name, last_name)) AS name FROM employees ORDER BY id")
  const inns = (
    await list<{ inn: string }>(has.has("clients"), "SELECT DISTINCT TRIM(inn) AS inn FROM clients WHERE TRIM(COALESCE(inn, '')) <> '' ORDER BY 1")
  ).map((row) => row.inn)

  // Facts per order.
  const facts: Record<number, OrderFilterFacts> = {}
  // «Организация» filters by id: three organizations may share a name (Linko's division filter does too).
  const divisionIds = (await list<{ ok: boolean }>(
    has.has("orders"),
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'organization_id') AS ok",
  ))[0]?.ok
  const promotionColumn = (await list<{ ok: boolean }>(
    has.has("orders"),
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'promotions') AS ok",
  ))[0]?.ok
  // Columns some databases may not have yet (added by the schema bootstrap or the Linko imports).
  const columns = new Set(
    (
      await list<{ name: string }>(
        has.has("orders"),
        "SELECT table_name || '.' || column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name IN ('orders', 'order_items') AND column_name IN ('with_discount', 'is_new', 'collector_id', 'is_bonus', 'promotion')",
      )
    ).map((row) => row.name),
  )
  const column = (name: string, fallback: string) => (columns.has(name) ? name.replace(/^orders\./, "o.").replace(/^order_items\./, "i.") : fallback)
  const orders = await list<{ id: number; client_id: number | null; account: number | null; division: number | null; promotions: string | null; with_discount: unknown; discount_percent: unknown; is_new: unknown; collector_id: unknown }>(
    has.has("orders"),
    `SELECT o.id, o.client_id, o.financial_account_id AS account,
            ${divisionIds ? "COALESCE(o.organization_id, g.id)" : "g.id"} AS division,
            ${promotionColumn ? "o.promotions" : "NULL::text"} AS promotions,
            ${column("orders.with_discount", "0")} AS with_discount, o.discount_percent,
            ${column("orders.is_new", "0")} AS is_new, ${column("orders.collector_id", "NULL::int")} AS collector_id
       FROM orders o
       ${has.has("organizations") ? "LEFT JOIN LATERAL (SELECT MIN(id) AS id FROM organizations WHERE name = o.organization) g ON true" : "LEFT JOIN LATERAL (SELECT NULL::int AS id) g ON true"}`,
  )
  for (const order of orders) {
    const applied = promotionsOf(order.promotions)
    facts[order.id] = {
      products: [],
      types: [],
      brands: [],
      marked: false,
      account: num(order.account),
      inn: "",
      clientType: null,
      clientTypeParent: null,
      contract: false,
      division: num(order.division),
      promotions: [...new Set(applied.map((promotion) => promotion.id))],
      promotionTypes: [...new Set(applied.map((promotion) => promotion.type).filter(Boolean))],
      bonus: false,
      isNew: Number(order.is_new) === 1,
      collector: num(order.collector_id),
    }
    if (!applied.length && Number(order.with_discount) === 1 && Number(order.discount_percent) > 0) facts[order.id].promotionTypes.push("discount")
  }
  const lines = await list<{ order_id: number; product_id: number | null; type_id: number | null; parent_id: number | null; brand_id: number | null; marked: unknown; is_bonus: unknown; promotion: string | null }>(
    has.has("order_items") && has.has("products") && has.has("product_types") && has.has("brands"),
    `SELECT DISTINCT i.order_id, i.product_id, t.id AS type_id, t.parent_id, b.id AS brand_id, p.marked_product AS marked,
            ${column("order_items.is_bonus", "0")} AS is_bonus, ${column("order_items.promotion", "NULL::text")} AS promotion
       FROM order_items i
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN LATERAL (SELECT id, parent_id FROM product_types WHERE name = p.type ORDER BY id LIMIT 1) t ON true
       LEFT JOIN LATERAL (SELECT id FROM brands WHERE name = p.brand ORDER BY id LIMIT 1) b ON true`,
  )
  const push = (values: number[], value: unknown) => {
    const n = num(value)
    if (n !== null && !values.includes(n)) values.push(n)
  }
  for (const line of lines) {
    const fact = facts[line.order_id]
    if (!fact) continue
    push(fact.products, line.product_id)
    push(fact.types, line.type_id)
    push(fact.types, line.parent_id)
    push(fact.brands, line.brand_id)
    if (["1", "true", "t"].includes(String(line.marked ?? "").toLowerCase())) fact.marked = true
    if (Number(line.is_bonus) === 1) {
      fact.bonus = true
      if (!fact.promotions.length && !String(line.promotion ?? "").trim() && !fact.promotionTypes.includes("bonus")) fact.promotionTypes.push("bonus")
    }
  }
  const shops = await list<{ id: number; inn: string | null; type_id: number | null; parent_id: number | null }>(
    has.has("clients") && has.has("client_types"),
    `SELECT c.id, c.inn, t.id AS type_id, t.parent_id
       FROM clients c LEFT JOIN LATERAL (SELECT id, parent_id FROM client_types WHERE name = c.type ORDER BY id LIMIT 1) t ON true`,
  )
  const shopById = new Map(shops.map((shop) => [Number(shop.id), shop]))
  const accounts = await list<{ client_id: number; account_id: number }>(
    has.has("financial_account_markets") && has.has("financial_accounts"),
    "SELECT m.client_id, m.financial_account_id AS account_id FROM financial_account_markets m JOIN financial_accounts a ON a.id = m.financial_account_id",
  )
  const accountOfShop = new Map(accounts.map((row) => [Number(row.client_id), Number(row.account_id)]))
  const contracted = new Set(
    (
      await list<{ client_id: number }>(
        has.has("contracts") && has.has("contract_clients"),
        "SELECT DISTINCT cc.client_id FROM contract_clients cc JOIN contracts k ON k.id = cc.contract_id WHERE k.status = 'active'",
      )
    ).map((row) => Number(row.client_id)),
  )
  for (const order of orders) {
    const fact = facts[order.id]
    const clientId = num(order.client_id)
    if (clientId === null) continue
    const shop = shopById.get(clientId)
    fact.inn = (shop?.inn ?? "").trim()
    fact.clientType = num(shop?.type_id)
    fact.clientTypeParent = num(shop?.parent_id) ?? fact.clientType
    fact.account ??= accountOfShop.get(clientId) ?? null
    fact.contract = contracted.has(clientId)
  }

  return {
    options: {
      financeAccounts,
      employees,
      allEmployees,
      productTypes: productTypes.map((row) => ({ ...row, parentId: num(row.parentId) })),
      products: products.map((row) => ({ ...row, typeId: num(row.typeId) })),
      clients,
      inns,
      clientTypes: clientTypes.map((row) => ({ ...row, parentId: num(row.parentId) })),
      branches,
      transports,
      warehouses,
      priceLists,
      organizations: await userOrganizations(organizations, employeeId),
      zones,
      promotions: promotions.filter((row) => row.name),
      brands,
      currencies,
    },
    facts,
  }
}
