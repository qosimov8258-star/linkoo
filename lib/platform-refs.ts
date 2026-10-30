import "server-only"

import type { PgDb } from "@/lib/db"
import { usageTableLabel } from "@/lib/usage-labels"

// Where the platform's master data (employees, branches, job positions,
// currencies) is referenced by other records, for the delete check (409 with a
// usage list, contract 7) and the rename cascade. Most tables are created
// lazily by their own modules, so every column is used only while it exists
// (information_schema, read on each call). Documents mostly store the NAME as
// text (the demo links them by id); names are matched like the finance core
// does (lower-case, trimmed, whitespace / NBSP collapsed), written inline here
// so this works on a fresh database before lib/finance/schema.ts defines fin_key().
// History tables (*_log / *_logs) follow a rename but never block a delete.

export type RefKind = "name" | "id" | "code"
export type Reference = { table: string; column: string; kind: RefKind; history: boolean }
export type Usage = { table: string; label: string; count: number }

/** Section labels (Russian i18n keys) of the referencing tables. */
const TABLE_LABELS: Record<string, string> = {
  branch_balance_transactions: "Баланс филиалов",
  branch_kpi_balances: "KPI план филиалов",
  branch_kpi_plans: "KPI план филиалов",
  cash_acceptances: "Управления кассой",
  cash_entry_staff: "Расходы на персонал",
  cash_management_entries: "Управления кассой",
  cash_transfers: "Управления кассой",
  cashback_withdrawal_requests: "Запросы на снятие кэшбэка",
  cashboxes: "Кассы",
  client_balance_corrections: "Баланс клиентов",
  client_balance_imports: "Баланс клиентов",
  client_zones: "Зоны",
  client_bulk_payments: "Оплаты от клиентов",
  account_bulk_payments: "Оплаты от клиентов",
  clients: "Клиенты",
  contracts: "Договоры",
  customer_payments: "Оплаты от клиентов",
  debt_limits: "Лимиты долга",
  deliverer_balance_transactions: "Баланс доставщиков",
  employee_balance_transactions: "Баланс сотрудников",
  employees: "Сотрудники",
  field_gps_points: "Отслеживание",
  field_photo_reports: "Фото отчеты",
  field_refusals: "Отказы",
  field_route_plans: "Маршруты",
  field_visits: "Визиты",
  financial_accounts: "Финансовые счета",
  internal_transfers: "Передачи между складами",
  inventory_items: "Работа с инвентарем",
  invoice_incomings: "Входящие счет фактуры",
  loyalty_card_transactions: "Накопительная карта",
  order_items: "Заказы",
  orders: "Заказы",
  price_lists: "Прайс-листы",
  product_limits: "Ограничение продуктов",
  product_restrictions: "Ограничение продуктов",
  product_type_restrictions: "Ограничение продуктов",
  production_movements: "Производство",
  production_stages: "Этапы производства",
  production_staff: "Сотрудники производства",
  products: "Продукты",
  raw_materials: "Сырье",
  repricings: "Переоценка",
  salary_plans: "Планирование зарплаты",
  stock_inventories: "Инвентаризация",
  supplier_balance_transactions: "Баланс поставщиков",
  supplier_incoming_expenses: "Приход от поставщиков",
  supplier_incomings: "Приход от поставщиков",
  supplier_payments: "Оплаты поставщикам",
  supplier_returns: "Возврат поставщиков",
  suppliers: "Поставщики",
  survey_plans: "Опросы",
  surveys: "Опросник",
  tasks: "Задачи",
  transport_vehicles: "Транспорт",
  vansell_debt_limits: "Баланс вансел",
  vansell_transactions: "Баланс вансел",
  warehouses: "Склады",
}

export function referenceLabel(table: string): string {
  return usageTableLabel(table, TABLE_LABELS)
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** SQL twin of nameKey(): lower-case, trimmed, NBSP / narrow NBSP as spaces, whitespace collapsed. */
export function keySql(expression: string): string {
  return `lower(btrim(regexp_replace(replace(replace(coalesce(${expression}, ''), chr(160), ' '), chr(8239), ' '), '\\s+', ' ', 'g')))`
}

export function nameKey(value: string): string {
  return value
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

const isHistoryTable = (table: string) => /_logs?$/.test(table)
const TEXTUAL = new Set(["text", "character varying"])
const INTEGER = new Set(["integer", "bigint", "smallint"])

type ColumnRow = { table_name: string; column_name: string; data_type: string }

/** Base-table columns of the current schema (optionally only `tables`). */
export async function listColumns(db: PgDb, where: string, params?: Record<string, unknown>): Promise<ColumnRow[]> {
  const statement = db.prepare(
    `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND (${where})
      ORDER BY c.table_name, c.column_name`,
  )
  return (await (params && Object.keys(params).length ? statement.all(params) : statement.all())) as ColumnRow[]
}

/** Keeps the known references whose column exists now (with the expected type). */
export async function existingReferences(db: PgDb, known: ReadonlyArray<{ table: string; column: string; kind: RefKind }>): Promise<Reference[]> {
  if (!known.length) return []
  const rows = await listColumns(db, "c.table_name = ANY(@tables::text[])", { tables: [...new Set(known.map((ref) => ref.table))] })
  const types = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]))
  return known
    .filter((ref) => {
      const type = types.get(`${ref.table}.${ref.column}`)
      if (!type) return false
      return ref.kind === "id" ? INTEGER.has(type) : TEXTUAL.has(type)
    })
    .map((ref) => ({ ...ref, history: isHistoryTable(ref.table) }))
}

/** Columns found by name pattern: text ones as `textKind`, integer `*_id` ones as ids. */
export async function discoverReferences(db: PgDb, where: string, textKind: RefKind, exceptTable: string): Promise<Reference[]> {
  const rows = await listColumns(db, `c.table_name <> @except AND (${where})`, { except: exceptTable })
  const found: Reference[] = []
  for (const row of rows) {
    const history = isHistoryTable(row.table_name)
    if (row.column_name.endsWith("_id")) {
      if (INTEGER.has(row.data_type)) found.push({ table: row.table_name, column: row.column_name, kind: "id", history })
    } else if (TEXTUAL.has(row.data_type)) {
      found.push({ table: row.table_name, column: row.column_name, kind: textKind, history })
    }
  }
  return found
}

/**
 * Rows referencing a record, counted per table (history tables skipped).
 * `name` refs match the name key, `code` refs match one of `codes` (upper-cased,
 * trimmed), `id` refs the id. `skipNames` turns name matching off (two records
 * share the name, so a name says nothing about which one is meant).
 */
export async function usageOf(
  db: PgDb,
  refs: Reference[],
  target: { id: number; name?: string; codes?: string[]; skipNames?: boolean },
): Promise<Usage[]> {
  const byTable = new Map<string, string[]>()
  for (const ref of refs) {
    if (ref.history) continue
    const column = quoteIdent(ref.column)
    let condition: string | null = null
    if (ref.kind === "id") condition = `${column} = @id`
    else if (ref.kind === "name" && target.name && !target.skipNames) condition = `${keySql(column)} = ${keySql("@name::text")}`
    else if (ref.kind === "code" && target.codes?.length) condition = `upper(btrim(${column})) = ANY(@codes::text[])`
    if (condition) byTable.set(ref.table, [...(byTable.get(ref.table) ?? []), condition])
  }
  const usage = new Map<string, number>()
  for (const [table, conditions] of byTable) {
    const row = (await db
      .prepare(`SELECT COUNT(*)::int AS n FROM ${quoteIdent(table)} WHERE ${conditions.join(" OR ")}`)
      .get({ id: target.id, name: target.name ?? "", codes: target.codes ?? [] })) as { n: number } | undefined
    const count = Number(row?.n ?? 0)
    if (count > 0) {
      const label = referenceLabel(table)
      usage.set(label, (usage.get(label) ?? 0) + count)
    }
  }
  // One entry per section label (several tables can belong to one screen).
  const firstTable = new Map<string, string>()
  for (const [table] of byTable) if (!firstTable.has(referenceLabel(table))) firstTable.set(referenceLabel(table), table)
  return [...usage].map(([label, count]) => ({ table: firstTable.get(label) ?? label, label, count }))
}

export type RenameChange = { table: string; column: string; rows: number }

/** Rewrites every `name` reference of `oldName` (by key) to `newName`. Run it
 * inside the transaction that renames the record. */
export async function cascadeNameRename(db: PgDb, refs: Reference[], oldName: string, newName: string): Promise<RenameChange[]> {
  const changes: RenameChange[] = []
  if (nameKey(oldName) === "" || oldName === newName) return changes
  for (const ref of refs) {
    if (ref.kind !== "name") continue
    const column = quoteIdent(ref.column)
    const result = await db
      .prepare(
        `UPDATE ${quoteIdent(ref.table)} SET ${column} = @newName
          WHERE ${keySql(column)} = ${keySql("@oldName::text")} AND ${column} IS DISTINCT FROM @newName`,
      )
      .run({ newName, oldName })
    if (result.changes > 0) changes.push({ table: ref.table, column: ref.column, rows: result.changes })
  }
  return changes
}
