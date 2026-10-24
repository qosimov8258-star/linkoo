import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import type { CatalogKind } from "@/lib/products-types"

// Lazy, idempotent schema of the catalog pages (Продукты / Сырье).
// products and raw_materials (created in lib/db.ts) get the demo fields that the old
// forms did not store; raw_materials also gets the product-only columns (soft delete,
// subcategory, flags) so both kinds share one implementation. Images and agent limits
// live in their own tables keyed by (item_kind, item_id).

declare global {
  var __linkoCatalogSchema: Promise<void> | undefined
}

export const CATALOG_TABLE: Record<CatalogKind, "products" | "raw_materials"> = { product: "products", raw_material: "raw_materials" }

/** Columns whose name differs between the two tables (everything else is shared). */
export const KIND_COLUMNS: Record<CatalogKind, { weight: string; isInventory: string }> = {
  product: { weight: "weight", isInventory: "is_inventory" },
  raw_material: { weight: "mass", isInventory: "show_as_inventory" },
}

const COMMON_COLUMNS = [
  "box_amount DOUBLE PRECISION NOT NULL DEFAULT 0",
  "expiration_days INTEGER",
  "notify_expire_days INTEGER",
  "box_sizes TEXT NOT NULL DEFAULT '[]'",
  "sale_min_price DOUBLE PRECISION NOT NULL DEFAULT 0",
  "sale_max_price DOUBLE PRECISION NOT NULL DEFAULT 0",
  "sale_price_currency TEXT NOT NULL DEFAULT ''",
  "deleted_at TEXT NOT NULL DEFAULT ''",
  "deleted_by TEXT NOT NULL DEFAULT ''",
]

/** Product columns raw_materials lacks (and the ones raw-materials-repo used to add itself). */
const RAW_COLUMNS = [
  "deleted INTEGER NOT NULL DEFAULT 0",
  "subcategory TEXT NOT NULL DEFAULT ''",
  "track_series INTEGER NOT NULL DEFAULT 0",
  "manual_discount INTEGER NOT NULL DEFAULT 0",
  "hide_from_agent INTEGER NOT NULL DEFAULT 0",
  "has_photo INTEGER NOT NULL DEFAULT 0",
  "price_updated_date TEXT NOT NULL DEFAULT 'Не установлена'",
  "perfect_store INTEGER NOT NULL DEFAULT 0",
  "limit_price INTEGER NOT NULL DEFAULT 0",
  "product_group TEXT NOT NULL DEFAULT ''",
  "ikpu TEXT NOT NULL DEFAULT ''",
  "invoice_unit_code TEXT NOT NULL DEFAULT ''",
  "vat TEXT NOT NULL DEFAULT 'Без НДС'",
  "sale_points TEXT NOT NULL DEFAULT '0'",
  "price_lists TEXT NOT NULL DEFAULT '[]'",
  "price_min REAL NOT NULL DEFAULT 0",
  "price_max REAL NOT NULL DEFAULT 0",
]

async function createSchema(db: PgDb): Promise<void> {
  await ensureFinanceSchema(db)
  const alter = (table: string, columns: string[]) => columns.map((column) => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column};`).join("\n")
  await db.exec(`
    ${alter("products", COMMON_COLUMNS)}
    ${alter("raw_materials", [...COMMON_COLUMNS, ...RAW_COLUMNS])}
    CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      item_kind TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS product_images_item_idx ON product_images (item_kind, item_id);
    CREATE TABLE IF NOT EXISTS product_limits (
      id SERIAL PRIMARY KEY,
      item_kind TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      agent TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS product_limits_item_idx ON product_limits (item_kind, item_id);
    -- A products row that really is a raw material (the reference keeps them out of the products list): the catalog list and the
    -- stock ledger skip it, its raw_materials twin carries the item instead. Additive: the products row itself is never changed.
    CREATE TABLE IF NOT EXISTS product_kind_overrides (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'raw_material',
      raw_material_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

/** Ensures the catalog columns / tables (once per process) and returns the db. */
export async function catalogDb(): Promise<PgDb> {
  const db = getDb()
  if (!globalThis.__linkoCatalogSchema) {
    globalThis.__linkoCatalogSchema = createSchema(db).catch((error) => {
      globalThis.__linkoCatalogSchema = undefined
      throw error
    })
  }
  await globalThis.__linkoCatalogSchema
  return db
}
