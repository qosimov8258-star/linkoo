import "server-only"

import type { PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { priceListKey } from "@/lib/item-prices"
import { catalogKey, type CatalogItem, type CatalogKind } from "@/lib/products-types"

// Reference checks of a product / raw material write (create, edit, multi edit, Excel import):
//   * Мера / Группа / ДОП. параметры units → units_of_measure ("Ед.измерения"),
//   * Тип продукта → a top-level product type, Подкатегория → one of its children,
//   * Бренд → brands, Организация → organizations,
//   * price-list entries → price_lists (by name), their currencies and the sale-limit currency
//     → the currencies table,
// each matched by fin_key and stored in the dictionary's own spelling. Only values that change
// are checked (`current` = the stored item; null on create), so an item that still carries an
// old free-text value can be edited without fixing it first.
//   * Штрих-код / Артикул must not belong to another live product or raw material (a scanner or
//     "Обновить с excel" must resolve a code to ONE item).
// The checks return field errors (Russian i18n keys); lib/products-write.ts turns them into
// CatalogError (400 for unknown references, 409 for codes already in use).

export const REF_ERRORS = {
  unit: "Единица измерения не найдена",
  type: "Тип продукта не найден",
  subcategory: "Подкатегория не найдена",
  brand: "Бренд не найден",
  organization: "Организация не найдена",
  priceList: "Прайс-лист не найден",
  currency: "Валюта не найдена",
  barcode: "Штрих-код уже используется",
  article: "Артикул уже используется",
} as const

export type FieldErrors = Record<string, string>

const changed = (current: CatalogItem | null, value: string, stored: string | undefined) => !current || catalogKey(value) !== catalogKey(stored)

async function nameIn(db: PgDb, table: "units_of_measure" | "brands" | "organizations" | "price_lists", value: string): Promise<string | null> {
  const row = (await db.prepare(`SELECT name FROM ${table} WHERE fin_key(name) = fin_key(@value) ORDER BY id LIMIT 1`).get({ value })) as { name: string } | undefined
  return row?.name ?? null
}

/** Тип / Подкатегория pair in the stored spelling; a lone child name is completed with its (only) parent. */
async function resolveType(db: PgDb, type: string, subcategory: string): Promise<{ type: string; subcategory: string } | { error: FieldErrors }> {
  const top = (await db
    .prepare(
      `SELECT t.id, t.name FROM product_types t
        WHERE fin_key(t.name) = fin_key(@type)
          AND (t.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM product_types p WHERE p.id = t.parent_id))
        ORDER BY t.id LIMIT 1`,
    )
    .get({ type })) as { id: number; name: string } | undefined
  if (!top) {
    if (!subcategory) {
      // "Limonad" alone: a child type whose parent is unambiguous.
      const children = (await db
        .prepare(
          `SELECT c.name, p.name AS parent FROM product_types c JOIN product_types p ON p.id = c.parent_id
            WHERE fin_key(c.name) = fin_key(@type) ORDER BY c.id LIMIT 2`,
        )
        .all({ type })) as Array<{ name: string; parent: string }>
      if (children.length === 1) return { type: children[0].parent, subcategory: children[0].name }
    }
    return { error: { type: REF_ERRORS.type } }
  }
  if (!subcategory) return { type: top.name, subcategory: "" }
  const child = (await db
    .prepare("SELECT name FROM product_types WHERE parent_id = @parent AND fin_key(name) = fin_key(@subcategory) ORDER BY id LIMIT 1")
    .get({ parent: top.id, subcategory })) as { name: string } | undefined
  if (!child) return { error: { subcategory: REF_ERRORS.subcategory } }
  return { type: top.name, subcategory: child.name }
}

/**
 * Checks the dictionary references of `item` (see the header) and rewrites them in place to the
 * stored spelling. Returns the field errors (empty = valid).
 */
export async function resolveCatalogRefs(db: PgDb, item: CatalogItem, current: CatalogItem | null): Promise<FieldErrors> {
  const fields: FieldErrors = {}

  for (const field of ["unit", "boxUnit"] as const) {
    const value = item[field].trim()
    if (!value || !changed(current, value, current?.[field])) continue
    const found = await nameIn(db, "units_of_measure", value)
    if (found) item[field] = found
    else fields[field] = REF_ERRORS.unit
  }
  const storedBoxUnits = new Set((current?.boxSizes ?? []).map((size) => catalogKey(size.unit)))
  for (const size of item.boxSizes) {
    const value = size.unit.trim()
    if (!value || storedBoxUnits.has(catalogKey(value))) continue
    const found = await nameIn(db, "units_of_measure", value)
    if (found) size.unit = found
    else fields.boxSizes = REF_ERRORS.unit
  }

  const type = item.type.trim()
  const subcategory = item.subcategory.trim()
  if ((type || subcategory) && (changed(current, type, current?.type) || changed(current, subcategory, current?.subcategory))) {
    if (!type) fields.type = REF_ERRORS.type
    else {
      const resolved = await resolveType(db, type, subcategory)
      if ("error" in resolved) Object.assign(fields, resolved.error)
      else {
        item.type = resolved.type
        item.subcategory = resolved.subcategory
      }
    }
  }

  for (const [field, table] of [
    ["brand", "brands"],
    ["organization", "organizations"],
  ] as const) {
    const value = item[field].trim()
    if (!value || !changed(current, value, current?.[field])) continue
    const found = await nameIn(db, table, value)
    if (found) item[field] = found
    else fields[field] = REF_ERRORS[field]
  }

  // Price lists by name (an entry the item already has is kept even if its list was renamed meanwhile).
  const storedPrices = new Map((current?.priceLists ?? []).map((entry) => [priceListKey(entry.name), entry]))
  let currencies: Set<string> | null = null
  const knownCurrency = async (value: string): Promise<string | null> => {
    currencies ??= new Set((await loadCurrencyContext(db)).currencies.map((currency) => currency.code))
    const code = normCurrency(value)
    return currencies.has(code) ? code : null
  }
  for (const entry of item.priceLists) {
    const stored = storedPrices.get(priceListKey(entry.name))
    if (!stored) {
      const found = await nameIn(db, "price_lists", entry.name.trim())
      if (found) entry.name = found
      else fields.priceLists = REF_ERRORS.priceList
    }
    for (const key of ["currency", "nonCashCurrency"] as const) {
      const value = entry[key]?.trim()
      if (!value || (stored && normCurrency(stored[key]) === normCurrency(value))) continue
      const code = await knownCurrency(value)
      if (code) entry[key] = code
      else fields.priceLists ??= REF_ERRORS.currency
    }
  }
  const saleCurrency = item.salePriceCurrency.trim()
  if (item.limitPrice && saleCurrency && changed(current, saleCurrency, current?.salePriceCurrency)) {
    const code = await knownCurrency(saleCurrency)
    if (code) item.salePriceCurrency = code
    else fields.salePriceCurrency = REF_ERRORS.currency
  }
  return fields
}

const LIVE_ITEMS = `SELECT 'product' AS kind, id, barcode, article FROM products WHERE COALESCE(deleted, 0) = 0
  UNION ALL SELECT 'raw_material', id, barcode, article FROM raw_materials WHERE COALESCE(deleted, 0) = 0`

/**
 * Штрих-код / Артикул of `item` that another live product or raw material already has (`all` =
 * check every code, e.g. on restore; otherwise only the codes the write adds). Empty = available.
 */
export async function codeConflicts(db: PgDb, kind: CatalogKind, item: CatalogItem, current: CatalogItem | null, all = false): Promise<FieldErrors> {
  const fields: FieldErrors = {}
  const stored = new Set((all ? [] : (current?.barcodes ?? [])).map((code) => code.trim()))
  const codes = item.barcodes.map((code) => code.trim()).filter((code) => code && !stored.has(code))
  if (codes.length) {
    const hit = await db
      .prepare(
        `SELECT 1 AS hit FROM (${LIVE_ITEMS}) o
          WHERE NOT (o.kind = @kind AND o.id = @id)
            AND EXISTS (SELECT 1 FROM unnest(string_to_array(replace(replace(COALESCE(o.barcode, ''), ';', ','), chr(10), ','), ',')) AS x
                         WHERE btrim(x) = ANY(@codes::text[]))
          LIMIT 1`,
      )
      .get({ kind, id: item.id, codes })
    if (hit) fields.barcodes = REF_ERRORS.barcode
  }
  const article = item.article.trim()
  if (article && (all || !current || article.toLowerCase() !== current.article.trim().toLowerCase())) {
    const hit = await db
      .prepare(`SELECT 1 AS hit FROM (${LIVE_ITEMS}) o WHERE NOT (o.kind = @kind AND o.id = @id) AND lower(btrim(o.article)) = lower(@article) LIMIT 1`)
      .get({ kind, id: item.id, article })
    if (hit) fields.article = REF_ERRORS.article
  }
  return fields
}
