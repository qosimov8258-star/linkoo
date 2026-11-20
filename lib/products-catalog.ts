import "server-only"

import type { PgDb } from "@/lib/db"
import { parseItemPrices } from "@/lib/item-prices"
import { CATALOG_TABLE, KIND_COLUMNS, catalogDb } from "@/lib/products-schema"
import { shortRuDate } from "@/lib/ref-date"
import { withCostOfGoods } from "@/lib/stock/costs"
import {
  EMPTY_CATALOG_FILTERS,
  catalogKey,
  cleanText,
  leadingNumber,
  type CatalogBoxSize,
  type CatalogDetail,
  type CatalogFilters,
  type CatalogItem,
  type CatalogKind,
  type CatalogLimit,
  type CatalogListResult,
  type CatalogPrice,
  type CatalogTab,
} from "@/lib/products-types"
import { strictId } from "@/lib/strict-number"

// Read side of the catalog pages: stored row → CatalogItem, the paged list of
// GET /api/{products|raw-materials}?view=list and the item detail. The list and the detail
// answer `cost` = the one cost of goods (lib/stock/costs.ts); products.cost is its cache.

export type CatalogRow = Record<string, unknown> & { id: number; name: string }

const int = (value: unknown) => Number(value) === 1
const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value))
const nullableInt = (value: unknown) => (value === null || value === undefined || value === "" ? null : Math.trunc(num(value)))

export function splitBarcodes(value: unknown): string[] {
  return [
    ...new Set(
      text(value)
        .split(/[,;\n]/)
        .map((code) => code.trim())
        .filter((code) => code && !/^не установлен/i.test(code)),
    ),
  ]
}

function parseBoxSizes(value: unknown): CatalogBoxSize[] {
  try {
    const parsed = JSON.parse(text(value) || "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({ unit: text(entry.unit), height: num(entry.height), width: num(entry.width), length: num(entry.length) }))
  } catch {
    return []
  }
}

function parsePrices(row: CatalogRow): CatalogPrice[] {
  const entries: CatalogPrice[] = parseItemPrices(text(row.price_lists))
  // Raw materials saved before the multi price-list form keep one legacy price.
  if (!entries.length && text(row.price_list).trim()) {
    const cash = leadingNumber(row.cash_price)
    entries.push({ name: text(row.price_list).trim(), cash, nonCash: leadingNumber(row.non_cash_price) || cash, min: 0, max: 0, currency: "SUM", nonCashCurrency: "SUM" })
  }
  return entries
}

export function rowToItem(kind: CatalogKind, row: CatalogRow): CatalogItem {
  const columns = KIND_COLUMNS[kind]
  const boxAmount = num(row.box_amount) || leadingNumber(row.sub_unit)
  return {
    kind,
    id: Number(row.id),
    name: text(row.name),
    fullName: text(row.full_name),
    barcodes: splitBarcodes(row.barcode),
    article: text(row.article),
    code: text(row.integration_code),
    type: cleanText(row.type),
    subcategory: cleanText(row.subcategory),
    organization: cleanText(row.organization),
    unit: text(row.unit),
    boxUnit: cleanText(row.product_group),
    boxAmount,
    orderNumber: text(row.order_number),
    supplier: cleanText(row.supplier),
    brand: cleanText(row.brand),
    color: cleanText(row.color),
    description: cleanText(row.description),
    minStock: leadingNumber(row.min_stock),
    weight: leadingNumber(row[columns.weight]),
    netWeight: leadingNumber(row.net_weight),
    volume: leadingNumber(row.volume),
    ikpu: text(row.ikpu),
    invoiceUnitCode: text(row.invoice_unit_code),
    vat: text(row.vat) || "Без НДС",
    canSell: int(row.can_sell),
    isMml: int(row.only_mml),
    perfectStore: int(row.perfect_store),
    isInventory: int(row[columns.isInventory]),
    sellOnlyBox: int(row.group_only),
    showInBot: int(row.show_in_bot),
    trackExpiry: int(row.track_expiry),
    trackSeries: int(row.track_series),
    expirationDays: nullableInt(row.expiration_days),
    notifyExpireDays: nullableInt(row.notify_expire_days),
    markedProduct: int(row.marked_product),
    manualDiscount: int(row.manual_discount),
    hideFromAgent: int(row.hide_from_agent),
    limitPrice: int(row.limit_price),
    saleMinPrice: num(row.sale_min_price),
    saleMaxPrice: num(row.sale_max_price),
    salePriceCurrency: text(row.sale_price_currency),
    salePoints: leadingNumber(row.sale_points),
    boxSizes: parseBoxSizes(row.box_sizes),
    priceLists: parsePrices(row),
    priceMin: num(row.price_min),
    priceMax: num(row.price_max),
    priceUpdatedDate: shortRuDate(cleanText(row.price_updated_date)),
    cost: num(row.cost),
    deleted: int(row.deleted),
    deletedAt: text(row.deleted_at),
    createdDate: text(row.created_date),
    createdAt: text(row.created_at),
    primaryImageId: row.primary_image_id === null || row.primary_image_id === undefined ? null : Number(row.primary_image_id),
    imageCount: num(row.image_count),
  }
}

/** SELECT of the item rows with their image info (alias t). */
function itemSelect(kind: CatalogKind): string {
  return `SELECT t.*,
    (SELECT i.id FROM product_images i WHERE i.item_kind = '${kind}' AND i.item_id = t.id ORDER BY i.is_primary DESC, i.id LIMIT 1) AS primary_image_id,
    (SELECT COUNT(*) FROM product_images i WHERE i.item_kind = '${kind}' AND i.item_id = t.id) AS image_count
    FROM ${CATALOG_TABLE[kind]} t`
}

export async function readCatalogRow(db: PgDb, kind: CatalogKind, id: number, lock = false): Promise<CatalogRow | null> {
  const sql = lock ? `SELECT * FROM ${CATALOG_TABLE[kind]} WHERE id = @id FOR UPDATE` : `${itemSelect(kind)} WHERE t.id = @id`
  return ((await db.prepare(sql).get({ id })) as CatalogRow | undefined) ?? null
}

export async function getCatalogItem(kind: CatalogKind, id: number): Promise<CatalogItem | null> {
  const db = await catalogDb()
  const row = await readCatalogRow(db, kind, id)
  return row ? rowToItem(kind, row) : null
}

// --- list ------------------------------------------------------------------------------

export type CatalogListQuery = {
  tab: CatalogTab
  search: string
  ordering: string
  page: number
  /** 0 = every row. */
  pageSize: number
  filters: CatalogFilters
  ids: number[]
}

export const DEFAULT_LIST_QUERY: CatalogListQuery = { tab: "", search: "", ordering: "", page: 1, pageSize: 25, filters: EMPTY_CATALOG_FILTERS, ids: [] }

/** TEXT column parsed as a JSON array ('[]' when invalid). */
const jsonArray = (column: string) =>
  `COALESCE(CASE WHEN pg_input_is_valid(${column}, 'jsonb') THEN CASE WHEN jsonb_typeof(${column}::jsonb) = 'array' THEN ${column}::jsonb END END, '[]'::jsonb)`

/** Sort key of a text column as Linko's database collation orders it: case, spaces and punctuation ignored
 * («"OLIVIA" …» among the O's, «Салонный  фильтр  (Malibu…» by its letters), digits before Latin before Cyrillic;
 * an empty value is NULL, so it comes last ascending and first descending (Postgres' default, like Linko's). */
const textKey = (column: string) => `NULLIF(lower(regexp_replace(COALESCE(${column}, ''), '[^[:alnum:]]', '', 'g')), '') COLLATE "C"`

const ORDER_SQL: Record<string, string> = {
  name: textKey("t.name"),
  barcode: `(CASE WHEN t.barcode ~* '^\\s*не установлен' THEN NULL ELSE NULLIF(lower(btrim(t.barcode)), '') END) COLLATE "C"`,
  vendor_code: textKey("t.article"),
  // Linko orders by the type's name (the product's own type: a child type stored in t.type, else t.subcategory's).
  type: textKey("COALESCE(NULLIF(btrim(t.subcategory), ''), t.type)"),
  // Linko's API ignores ordering=division__name (the list stays newest first); sorting by the name here is deliberate.
  division__name: textKey("t.organization"),
  created_date: "t.id",
  stock_number: "(CASE WHEN btrim(t.order_number) ~ '^[0-9]{1,15}$' THEN btrim(t.order_number)::bigint END)",
  id: "t.id",
}

function listWhere(kind: CatalogKind, query: CatalogListQuery, params: Record<string, unknown>): string {
  const columns = KIND_COLUMNS[kind]
  const where: string[] = []
  const f = query.filters
  where.push(query.tab === "4" ? "COALESCE(t.deleted, 0) = 1" : "COALESCE(t.deleted, 0) = 0")
  // Linko's raw materials kept as products (stock items) are listed under Сырье, not here.
  if (kind === "product") where.push("COALESCE(t.is_raw, 0) = 0")
  // "Инвентари" is a filter: Linko's "Все" (757), "Можно продавать" (624) and "Сняты с продажи" (133, its is_gear=False
  // is ignored) list the inventory items too (checked 2026-11-20).
  if (query.tab === "1") where.push("t.can_sell = 1")
  if (query.tab === "2") where.push(`t.${columns.isInventory} = 1`)
  if (query.tab === "3") where.push("t.can_sell = 0")
  if (f.canSell === "1") where.push("t.can_sell = 1")
  if (f.canSell === "2") where.push("t.can_sell = 0")
  // Тип продукта / Подкатегория: product_types ids (Linko's typeParent=306), or names from an older link. A parent takes
  // its children too, as Linko's does; a product of a child type keeps that name in t.type (Linko's product has one
  // type), one with both in t.type / t.subcategory.
  const typeId = (value: string) => (/^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : null)
  if (f.typeChild) {
    const id = typeId(f.typeChild)
    params.typeChild = id ?? f.typeChild
    const child = id !== null ? "(SELECT fin_key(name) FROM product_types WHERE id = @typeChild)" : "fin_key(@typeChild)"
    where.push(`(fin_key(t.type) = ${child} OR fin_key(t.subcategory) = ${child})`)
  } else if (f.typeParent) {
    const id = typeId(f.typeParent)
    params.typeParent = id ?? f.typeParent
    where.push(
      id !== null
        ? "fin_key(t.type) IN (SELECT fin_key(name) FROM product_types WHERE id = @typeParent OR parent_id = @typeParent)"
        : "(fin_key(t.type) = fin_key(@typeParent) OR fin_key(t.type) IN (SELECT fin_key(c.name) FROM product_types c JOIN product_types p ON p.id = c.parent_id WHERE fin_key(p.name) = fin_key(@typeParent)))",
    )
  }
  // A directory id (Linko's measurement=17, brand=85, division=59) matches that row's own spelling only («шт» and «ШТ»
  // are two measurements there); a name (a value only items carry, an older link) matches case-insensitively.
  const anyOf = (name: string, column: string, values: string[], directory?: string) => {
    if (!values.length) return
    const ids = directory ? values.map((value) => (/^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : null)).filter((id): id is number => id !== null) : []
    const names = values.filter((value) => !directory || !/^\d{1,9}$/.test(value.trim())).map(catalogKey)
    const parts: string[] = []
    if (ids.length) {
      params[`${name}Ids`] = ids
      parts.push(`btrim(COALESCE(${column}, '')) IN (SELECT btrim(d.name) FROM ${directory} d WHERE d.id = ANY(@${name}Ids::integer[]))`)
    }
    if (names.length) {
      params[name] = names
      parts.push(`fin_key(${column}) = ANY(@${name}::text[])`)
    }
    where.push(`(${parts.join(" OR ")})`)
  }
  anyOf("units", "t.unit", f.measurement, "units_of_measure")
  anyOf("brands", "t.brand", f.brand, "brands")
  anyOf("suppliers", "t.supplier", f.provider, "suppliers")
  anyOf("colors", "t.color", f.color)
  anyOf("organizations", "t.organization", f.division, "organizations")
  if (f.isMML) where.push("t.only_mml = 1")
  if (f.isGear) where.push(`t.${columns.isInventory} = 1`)
  if (f.isPerfectStore) where.push("t.perfect_store = 1")
  const supply = String(f.supply ?? "").trim()
  if (/^\d+$/.test(supply) && Number(supply) > 0) {
    // A digit id only ("0x10" is no filter); an id beyond int4 belongs to no supply, so the
    // filter matches nothing instead of failing in Postgres.
    params.supply = strictId(supply) ?? 0
    where.push(`fin_key(t.name) IN (SELECT fin_key(l.j ->> 'product') FROM supplier_incomings s
      CROSS JOIN LATERAL jsonb_array_elements(${jsonArray("s.items")}) AS l(j) WHERE s.id = @supply AND jsonb_typeof(l.j) = 'object')`)
  }
  const needle = catalogKey(query.search)
  if (needle) {
    params.needle = needle
    // Linko's search reads the name, barcodes, article and code — not the full name («coca» finds 7 products there).
    where.push(`(strpos(fin_key(t.name), @needle) > 0 OR strpos(lower(t.barcode), @needle) > 0
      OR strpos(lower(t.article), @needle) > 0 OR strpos(lower(t.integration_code), @needle) > 0)`)
  }
  if (query.ids.length) {
    params.ids = query.ids
    where.push("t.id = ANY(@ids::integer[])")
  }
  return where.join(" AND ")
}

async function hasSupplierIncomings(db: PgDb): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass('supplier_incomings') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

export async function listCatalog(kind: CatalogKind, query: CatalogListQuery): Promise<CatalogListResult> {
  const db = await catalogDb()
  const params: Record<string, unknown> = {}
  const effective = query.filters.supply && !(await hasSupplierIncomings(db)) ? { ...query, filters: { ...query.filters, supply: "" } } : query
  const where = listWhere(kind, effective, params)
  // The db shim treats a lone object as a positional value when the SQL has no @names.
  const args = () => (Object.keys(params).length ? [params] : [])
  const countRow = (await db.prepare(`SELECT COUNT(*) AS n FROM ${CATALOG_TABLE[kind]} t WHERE ${where}`).get(...args())) as { n: string | number } | undefined
  const count = Number(countRow?.n ?? 0)
  // ordering: one column or several, comma-separated ("vendor_code,-created_date"); ties fall back to the newest first.
  const order = [
    ...query.ordering
      .split(",")
      .map((entry) => ({ sql: ORDER_SQL[entry.trim().replace(/^-/, "")], desc: entry.trim().startsWith("-") }))
      .filter((entry) => entry.sql)
      .map((entry) => `${entry.sql} ${entry.desc ? "DESC" : "ASC"}`),
    "t.id DESC",
  ].join(", ")
  let paging = ""
  if (query.pageSize > 0) {
    params.limit = query.pageSize
    params.offset = (Math.max(1, query.page) - 1) * query.pageSize
    paging = "LIMIT @limit OFFSET @offset"
  }
  const rows = (await db.prepare(`${itemSelect(kind)} WHERE ${where} ORDER BY ${order} ${paging}`).all(...args())) as CatalogRow[]
  return { results: await withCostOfGoods(kind, rows.map((row) => rowToItem(kind, row)), db), count }
}

// --- detail ----------------------------------------------------------------------------

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(@table) IS NOT NULL AS ok").get({ table })) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

/** Agent limits with the quantity the agent already sold (orders since the limit was set, not cancelled). */
async function itemLimits(db: PgDb, item: CatalogItem): Promise<CatalogLimit[]> {
  const rows = (await db
    .prepare("SELECT id, agent, amount, created_at FROM product_limits WHERE item_kind = @kind AND item_id = @id ORDER BY id")
    .all({ kind: item.kind, id: item.id })) as Array<{ id: number; agent: string; amount: number; created_at: string }>
  if (!rows.length) return []
  const canCount = (await tableExists(db, "orders")) && (await tableExists(db, "order_items"))
  const limits: CatalogLimit[] = []
  for (const row of rows) {
    let realized = 0
    if (canCount) {
      const sold = (await db
        .prepare(
          `SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM orders o JOIN order_items oi ON oi.order_id = o.id
            WHERE fin_key(o.agent) = fin_key(@agent) AND o.status NOT ILIKE 'отмен%'
              AND ((@kind = 'product' AND oi.product_id = @id) OR (oi.product_id IS NULL AND fin_key(oi.product_name) = fin_key(@name)))
              AND COALESCE(fin_ts(o.created_at, true), fin_ts(datetime('now'), true)) >= COALESCE(fin_ts(@since, true), '-infinity'::timestamp)`,
        )
        .get({ agent: row.agent, kind: item.kind, id: item.id, name: item.name, since: row.created_at })) as { n: string | number } | undefined
      realized = num(sold?.n)
    }
    limits.push({ id: Number(row.id), agent: row.agent, amount: num(row.amount), realized, createdAt: row.created_at })
  }
  return limits
}

export async function getCatalogDetail(kind: CatalogKind, id: number): Promise<CatalogDetail | null> {
  const db = await catalogDb()
  const row = await readCatalogRow(db, kind, id)
  if (!row) return null
  const [item] = await withCostOfGoods(kind, [rowToItem(kind, row)], db)
  const images = (await db
    .prepare("SELECT id, is_primary, created_at FROM product_images WHERE item_kind = @kind AND item_id = @id ORDER BY is_primary DESC, id")
    .all({ kind, id })) as Array<{ id: number; is_primary: number; created_at: string }>
  return {
    ...item,
    images: images.map((image) => ({ id: Number(image.id), isPrimary: int(image.is_primary), createdAt: image.created_at })),
    limits: await itemLimits(db, item),
    attributes: kind === "product" ? await itemAttributes(db, id) : {},
  }
}

/** «Характеристика» values of a product: {attribute id: value} (product_attribute_assignments). */
async function itemAttributes(db: PgDb, id: number): Promise<Record<string, string>> {
  if (!(await tableExists(db, "product_attribute_assignments"))) return {}
  const row = (await db.prepare("SELECT values_json FROM product_attribute_assignments WHERE product_id = @id").get({ id })) as { values_json: string } | undefined
  try {
    const value = JSON.parse(row?.values_json ?? "{}") as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""))
  } catch {
    return {}
  }
}
