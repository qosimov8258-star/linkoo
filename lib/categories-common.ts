import "server-only"

import { NextResponse } from "next/server"

import { ensureCashSchema } from "@/lib/cash/schema"
import { categoryOptionTitle, type CategoryKind } from "@/lib/category-options"
import type { CategoryUsage } from "@/lib/categories-schema"
import type { CategoryOptionKey } from "@/lib/cash/types"
import { getDb, type PgDb } from "@/lib/db"
import { parseAnyDate } from "@/lib/finance/dates"

// Storage rules shared by lib/income-categories-repo.ts and lib/expense-categories-repo.ts
// (demo finance/income_category, finance/expense_category):
//   * names are unique per kind by the finance name key (lower-case, trimmed,
//     collapsed whitespace — the fin_key() the cash readers match legacy names by);
//   * a save writes BOTH `options` (["<key>"] / []) and `parameter` (the option's
//     Russian title / ''), so the cash_category_options_sync trigger of
//     lib/cash/schema.ts never re-derives the options;
//   * a rename is copied to the legacy text columns of the money rows linked by id
//     (cash_management_entries.category, customer_payments.income_category,
//     supplier_payments.category), which the ledger statements, the cash list search
//     and the supplier payments list still read;
//   * a delete is refused (409) while money rows reference the category by id or, for
//     legacy rows without an id, by name (and, for expenses, while it has children).
// Every table / column is checked first: the money tables and their id columns are
// created lazily by other modules.

export class CategoryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: "name" | "options" | "parentId",
    readonly usage?: CategoryUsage[],
  ) {
    super(message)
  }
}

/** JSON response of a CategoryError ({error, fields?, usage?}); null for other errors. */
export function categoryErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof CategoryError)) return null
  return NextResponse.json(
    {
      error: error.message,
      ...(error.field ? { fields: { [error.field]: error.message } } : {}),
      ...(error.usage ? { usage: error.usage } : {}),
    },
    { status: error.status },
  )
}

export const CATEGORY_TABLES: Record<CategoryKind, "income_categories" | "expense_categories"> = {
  income: "income_categories",
  expense: "expense_categories",
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

declare global {
  var __linkoCategoryCollation: Promise<string> | undefined
}

/** The `options` columns, the options trigger and the money tables' category id
 * columns come from the cash core schema. If it cannot be installed the pages still
 * work with their own idempotent column. */
export async function ensureCategorySchema(): Promise<void> {
  try {
    await ensureCashSchema()
  } catch (error) {
    console.error("[categories] ensureCashSchema failed, adding the options columns only", error)
    await getDb().exec(
      "ALTER TABLE income_categories ADD COLUMN IF NOT EXISTS options TEXT; ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS options TEXT;",
    )
  }
}

/**
 * Collation of the default name order. The demo lists names case-insensitively with
 * Latin before Cyrillic ("1111, ananas, Avans OYlik, … Админ, Аренда, бинзин").
 * The ICU root collation does exactly that (and places ё after е); the Russian ICU
 * collation ("ru-x-icu", like Intl.Collator("ru")) puts Cyrillic FIRST and the
 * database default (en_US.UTF-8 on macOS libc) mixes Cyrillic before Latin, so
 * neither is used. Without ICU, "C" on lower() keeps Latin before Cyrillic.
 */
export async function nameCollation(db: PgDb): Promise<string> {
  globalThis.__linkoCategoryCollation ??= db
    .prepare("SELECT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu') AS ok")
    .get()
    .then((row) => (row?.ok ? '"und-x-icu"' : '"C"'))
    .catch((error) => {
      globalThis.__linkoCategoryCollation = undefined
      throw error
    })
  return globalThis.__linkoCategoryCollation
}

/** Same normalisation as the SQL fin_key() / lib/finance/entities.ts nameKey(). */
export function categoryNameKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** SQL twin of categoryNameKey (no dependency on the fin_* functions). */
export function keySql(expression: string): string {
  return `lower(btrim(regexp_replace(replace(replace(coalesce(${expression}, ''), chr(160), ' '), chr(8239), ' '), '\\s+', ' ', 'g')))`
}

/** Existing columns of the given tables (lazy schema). */
export async function tableColumns(db: PgDb, tables: string[]): Promise<Map<string, Set<string>>> {
  const rows = (await db
    .prepare(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.table_name = ANY(@tables::text[])`,
    )
    .all({ tables })) as Array<{ table_name: string; column_name: string }>
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    const columns = map.get(row.table_name) ?? new Set<string>()
    columns.add(row.column_name)
    map.set(row.table_name, columns)
  }
  return map
}

/** "YYYY-MM-DDTHH:mm:ss" of a created_at value, shown as stored (the demo prints its naive timestamps unshifted). */
export function localCreatedDate(value: unknown): string {
  return parseAnyDate(value == null ? "" : String(value)) ?? ""
}

/** `options` / `parameter` pair written for the dialog's single choice. */
export function optionColumns(option: CategoryOptionKey | ""): { options: string; parameter: string } {
  return option ? { options: JSON.stringify([option]), parameter: categoryOptionTitle(option) } : { options: "[]", parameter: "" }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Cash entries named "Перевод" are transfer legs for the ledger (lib/finance/sources.ts isTransfer). */
const RESERVED_KEYS = new Set(["перевод"])

/** Serialises the writes of one kind (uniqueness check + insert / rename / delete). */
export async function lockCategories(db: PgDb, kind: CategoryKind) {
  await db.prepare(`SELECT pg_advisory_xact_lock(hashtext('linko:${CATEGORY_TABLES[kind]}'))`).get()
}

export async function assertNameAvailable(db: PgDb, kind: CategoryKind, name: string, exceptId: number | null) {
  const key = categoryNameKey(name)
  if (!key) throw new CategoryError("Обязательное поле", 400, "name")
  if (RESERVED_KEYS.has(key)) throw new CategoryError("Это наименование зарезервировано системой", 400, "name")
  const duplicate = await db
    .prepare(`SELECT id FROM ${CATEGORY_TABLES[kind]} WHERE ${keySql("name")} = @key AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1`)
    .get({ key, exceptId })
  if (duplicate) {
    throw new CategoryError(
      kind === "income" ? "Категория приходов с таким наименованием уже существует" : "Категория расходов с таким наименованием уже существует",
      400,
      "name",
    )
  }
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** Section labels (Russian i18n keys) of the referencing tables. */
const USAGE_LABELS: Record<string, string> = {
  cash_management_entries: "Касса",
  customer_payments: "Оплаты",
  supplier_payments: "Оплаты поставщикам",
  expense_categories: "Дочерние категории",
}

type Reference = {
  table: string
  /** Column holding the category id. */
  idColumn: string
  /** Legacy text copy of the name. */
  textColumn: string
  /** Rows with all of these NULL are legacy rows matched by name. */
  nullIds: string[]
  /** Extra condition of a legacy row (amount sign, not a transfer leg). */
  legacy?: (columns: Set<string>) => string
}

const notTransfer = (columns: Set<string>) => (columns.has("op_type") ? "COALESCE(op_type, 0) NOT IN (1, 2) AND category <> 'Перевод'" : "category <> 'Перевод'")

/** Money rows that point at a category. Cash entries are typed by sign like the cash
 * list reads them (amount ≥ 0 = income name, < 0 = expense name). */
const REFERENCES: Record<CategoryKind, Reference[]> = {
  income: [
    {
      table: "cash_management_entries",
      idColumn: "income_category_id",
      textColumn: "category",
      nullIds: ["income_category_id", "expense_category_id"],
      legacy: (columns) => `amount >= 0 AND ${notTransfer(columns)}`,
    },
    { table: "customer_payments", idColumn: "income_category_id", textColumn: "income_category", nullIds: ["income_category_id"] },
    { table: "supplier_payments", idColumn: "income_category_id", textColumn: "category", nullIds: ["income_category_id", "expense_category_id"] },
  ],
  expense: [
    {
      table: "cash_management_entries",
      idColumn: "expense_category_id",
      textColumn: "category",
      nullIds: ["income_category_id", "expense_category_id"],
      legacy: (columns) => `amount < 0 AND ${notTransfer(columns)}`,
    },
    { table: "supplier_payments", idColumn: "expense_category_id", textColumn: "category", nullIds: ["income_category_id", "expense_category_id"] },
  ],
}

/** Where the category is used: by id, legacy rows by name, and (expense) child categories. */
export async function categoryUsage(db: PgDb, kind: CategoryKind, row: { id: number; name: string }): Promise<CategoryUsage[]> {
  const refs = REFERENCES[kind]
  const columnsOf = await tableColumns(db, [...new Set(refs.map((ref) => ref.table))])
  const key = categoryNameKey(row.name)
  const usage: CategoryUsage[] = []
  for (const ref of refs) {
    const columns = columnsOf.get(ref.table)
    if (!columns) continue
    const conditions: string[] = []
    if (columns.has(ref.idColumn)) conditions.push(`${ref.idColumn} = @id`)
    if (columns.has(ref.textColumn)) {
      // Missing id columns (lazy schema) mean every row is a legacy, name-only row.
      const nulls = ref.nullIds.filter((column) => columns.has(column)).map((column) => `${column} IS NULL`)
      const extra = ref.legacy ? [ref.legacy(columns)] : []
      conditions.push(`(${[...nulls, ...extra, `${keySql(ref.textColumn)} = @key`].join(" AND ")})`)
    }
    if (!conditions.length) continue
    const result = await db.prepare(`SELECT COUNT(*) AS n FROM ${ref.table} WHERE ${conditions.join(" OR ")}`).get({ id: row.id, key })
    const count = Number(result?.n ?? 0)
    if (count > 0) usage.push({ table: ref.table, label: USAGE_LABELS[ref.table] ?? ref.table, count })
  }
  if (kind === "expense") {
    const children = await db.prepare("SELECT COUNT(*) AS n FROM expense_categories WHERE parent_id = @id").get({ id: row.id })
    const count = Number(children?.n ?? 0)
    if (count > 0) usage.push({ table: "expense_categories", label: USAGE_LABELS.expense_categories, count })
  }
  return usage
}

/** Copies a new name to the legacy text columns of the rows linked by id. Returns the updated row count. */
export async function cascadeCategoryRename(db: PgDb, kind: CategoryKind, id: number, name: string): Promise<number> {
  const refs = REFERENCES[kind]
  const columnsOf = await tableColumns(db, [...new Set(refs.map((ref) => ref.table))])
  let changed = 0
  for (const ref of refs) {
    const columns = columnsOf.get(ref.table)
    if (!columns?.has(ref.idColumn) || !columns.has(ref.textColumn)) continue
    // A legacy cash entry (no op_type) is typed by its category text: leave the markers alone.
    const guard =
      ref.table === "cash_management_entries"
        ? columns.has("op_type")
          ? ` AND NOT (op_type IS NULL AND category IN ('Перевод', 'Клиент'))`
          : ` AND category NOT IN ('Перевод', 'Клиент')`
        : ""
    const result = await db
      .prepare(`UPDATE ${ref.table} SET ${ref.textColumn} = @name WHERE ${ref.idColumn} = @id AND ${ref.textColumn} IS DISTINCT FROM @name${guard}`)
      .run({ id, name })
    changed += result.changes
  }
  return changed
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/** ORDER BY of the paged list (alias c); default = name, case-insensitive, like the demo. */
export function categoryOrderBy(ordering: string | undefined, collation: string, extra: Record<string, string> = {}): string {
  const name = `lower(c.name) COLLATE ${collation}`
  const map: Record<string, string> = {
    name: `${name} ASC, c.id ASC`,
    "-name": `${name} DESC, c.id DESC`,
    id: "c.id ASC",
    "-id": "c.id DESC",
    created_date: `c.created_at ASC, c.id ASC`,
    "-created_date": `c.created_at DESC, c.id DESC`,
    ...extra,
  }
  return map[ordering ?? ""] ?? map.name
}
