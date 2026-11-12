import "server-only"

import type { PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { ensureFinanceSchema, type FinanceSchema } from "@/lib/finance/schema"
import { DELIVERER_CORRECTIONS_TABLE } from "@/lib/finance/sources"
import type { BalanceEntityKind, BalanceInfoValue } from "@/lib/finance/types"

// Entity lists (the rows of each balance page) with the attributes the pages
// filter and display. Lists are small enough (thousands) to filter in JS; the
// heavy part — movements — is aggregated in SQL.

export type EntityRecord = {
  key: string
  id: number | null
  name: string
  info: Record<string, BalanceInfoValue>
  /** Supplier reserve per currency (suppliers.products qty*price). */
  reserve?: Record<string, number>
}

export function nameKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Mirrors fin_place(): "-", "Не указано", "Все …" mean "no value". */
export function placeName(value: unknown): string {
  const text = String(value ?? "").trim()
  return ["", "-", "—", "не указано", "не указан", "все", "все филиалы", "все организации"].includes(nameKey(text)) ? "" : text
}

function paymentKind(value: unknown): "cash" | "bank" | "" {
  const text = nameKey(value)
  if (/^(нал|cash|naq)/.test(text)) return "cash"
  if (/^(банк|bank|card|карт|переч|o'tkaz|otkaz|transfer)/.test(text)) return "bank"
  return ""
}

function fullName(first: unknown, last: unknown) {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim()
}

const VANSELL_POSITION = /(ван|вэн|van)[\s-]*(сел|sel)/i

/** Баланс кассы lists the cashboxes newest first (by id), as Linko's stats/cashboxes_sum_list does. */
async function cashboxes(db: PgDb): Promise<EntityRecord[]> {
  const rows = (await db
    .prepare("SELECT id, name, currency, cashier, branch, payment_type, vansell, order_number FROM cashboxes ORDER BY id DESC")
    .all()) as Array<{ id: number; name: string; currency: string; cashier: string; branch: string; payment_type: string; vansell: number; order_number: number }>
  return rows.map((row) => ({
    key: String(row.id),
    id: row.id,
    name: row.name,
    info: {
      currency: normCurrency(row.currency),
      type: paymentKind(row.payment_type) === "bank" ? "bank" : "cash",
      cashier: row.cashier.trim(),
      branch: placeName(row.branch),
      vansell: row.vansell ? 1 : 0,
      order_number: row.order_number,
    },
  }))
}

async function clients(db: PgDb, s: FinanceSchema): Promise<EntityRecord[]> {
  const optional = (column: string) => (s.col("clients", column) ? `c.${column}` : `'' AS ${column}`)
  // The financial account of the shop (Клиенты → Финансовые счета): "Долги по счетам" adds the shops of an account up.
  const accounts = await financialAccountsOf(db)
  const rows = (await db
    .prepare(
      `SELECT c.id, c.name, COALESCE(c.inn, '') AS inn, c.type, c.zone, c.agent, c.deliverer, c.collector, c.phone, c.tab,
              to_char(fin_ts(c.created_at, true), 'YYYY-MM-DD') AS created, ${optional("branch")}, ${optional("code")}
       FROM clients c ORDER BY lower(c.name), c.id`,
    )
    .all()) as Array<Record<string, string | number>>
  return rows.map((row) => ({
    key: String(row.id),
    id: Number(row.id),
    name: String(row.name),
    info: {
      inn: String(row.inn ?? "").trim(),
      type: placeName(row.type),
      zone: placeName(row.zone),
      agent: placeName(row.agent),
      deliverer: placeName(row.deliverer),
      collector: placeName(row.collector),
      branch: placeName(row.branch),
      phone: String(row.phone ?? ""),
      code: String(row.code ?? ""),
      tab: String(row.tab ?? ""),
      created: String(row.created ?? ""),
      account_id: accounts.get(Number(row.id))?.id ?? null,
      account_name: accounts.get(Number(row.id))?.name ?? "",
      // A deleted account still holds its shops' money (Linko shows it in the client list); the account listings
      // leave it out (lib/finance/ledger.ts).
      account_deleted: accounts.get(Number(row.id))?.deleted ? 1 : 0,
    },
  }))
}

/** shop id → its financial account (financial_account_markets), deleted accounts included (flagged), when those tables exist. */
async function financialAccountsOf(db: PgDb): Promise<Map<number, { id: number; name: string; deleted: boolean }>> {
  const present = (await db
    .prepare("SELECT to_regclass('financial_accounts') IS NOT NULL AS a, to_regclass('financial_account_markets') IS NOT NULL AS m")
    .get()) as { a: boolean; m: boolean } | undefined
  if (!present?.a || !present.m) return new Map()
  const rows = (await db
    .prepare(
      `SELECT m.client_id, a.id, a.name, COALESCE(a.deleted, 0) AS deleted
         FROM financial_account_markets m JOIN financial_accounts a ON a.id = m.financial_account_id`,
    )
    .all()) as Array<{ client_id: number; id: number; name: string; deleted: number }>
  return new Map(rows.map((row) => [Number(row.client_id), { id: Number(row.id), name: row.name, deleted: Number(row.deleted) === 1 }]))
}

async function suppliers(db: PgDb): Promise<EntityRecord[]> {
  const rows = (await db.prepare("SELECT id, name, category, branch, organization, products FROM suppliers ORDER BY lower(name), id").all()) as Array<{
    id: number
    name: string
    category: string
    branch: string
    organization: string
    products: string
  }>
  return rows.map((row) => {
    const reserve: Record<string, number> = {}
    try {
      const products = JSON.parse(row.products || "[]") as Array<{ qty?: unknown; price?: unknown; currency?: unknown }>
      for (const item of Array.isArray(products) ? products : []) {
        const value = Number(item.qty) * Number(item.price)
        if (!Number.isFinite(value) || value === 0) continue
        const code = normCurrency(String(item.currency ?? ""))
        reserve[code] = (reserve[code] ?? 0) + value
      }
    } catch {
      // malformed JSON = no reserve
    }
    return {
      key: String(row.id),
      id: row.id,
      name: row.name,
      info: { category: placeName(row.category), branch: placeName(row.branch), organization: placeName(row.organization) },
      reserve,
    }
  })
}

type EmployeeRow = { id: number; first_name: string; last_name: string; position: string; branch: string; active: number }

function employeeRecord(row: EmployeeRow): EntityRecord {
  return {
    key: String(row.id),
    id: row.id,
    name: fullName(row.first_name, row.last_name),
    info: { first_name: row.first_name, last_name: row.last_name, position: row.position, branch: placeName(row.branch), active: row.active ? 1 : 0 },
  }
}

/** Баланс сотрудников lists the employees by id, as Linko's staff/salary_balance does. */
async function employees(db: PgDb): Promise<EntityRecord[]> {
  const rows = (await db.prepare("SELECT id, first_name, last_name, position, branch, active FROM employees ORDER BY id").all()) as EmployeeRow[]
  return rows.map(employeeRecord)
}

/** Van-sell agents: position "Вансел…", cashier of a van-sell cashbox, or
 * anyone with van-sell ledger rows (there is no explicit van-sell flag). */
async function vansellAgents(db: PgDb, s: FinanceSchema): Promise<EntityRecord[]> {
  const rows = (await db
    .prepare("SELECT id, first_name, last_name, position, branch, active FROM employees ORDER BY lower(first_name), lower(last_name), id")
    .all()) as EmployeeRow[]
  const cashiers = new Set(
    ((await db.prepare("SELECT cashier FROM cashboxes WHERE vansell = 1").all()) as Array<{ cashier: string }>).map((row) => nameKey(row.cashier)),
  )
  const withRows = new Set<number>()
  if (s.has("vansell_transactions")) {
    const ids = (await db.prepare("SELECT DISTINCT employee_id FROM vansell_transactions").all()) as Array<{ employee_id: number }>
    for (const row of ids) withRows.add(Number(row.employee_id))
  }
  // Like Linko's «Баланс вансел»: the managers (Зав. склад) of the van-sell warehouses are listed, with or without
  // movements (info.is_vansell = 1); other van-sell agents are listed once they have movements (lib/finance/ledger.ts).
  const managers = await vansellManagers(db, s, rows)
  return rows
    .filter((row) => managers.has(row.id) || VANSELL_POSITION.test(row.position) || cashiers.has(nameKey(fullName(row.first_name, row.last_name))) || withRows.has(row.id))
    .map((row) => {
      const record = employeeRecord(row)
      record.info.is_vansell = managers.has(row.id) ? 1 : 0
      return record
    })
}

/** Employees who manage a van-sell warehouse (warehouses.online = «Вэнсел»): by manager_id, else by the manager's name
 * (the lowest employee id of that name, like the ledger's emp_keys). */
async function vansellManagers(db: PgDb, s: FinanceSchema, employees?: EmployeeRow[]): Promise<Set<number>> {
  if (!s.has("warehouses") || !s.col("warehouses", "online") || !s.col("warehouses", "manager")) return new Set()
  const rows = (await db
    .prepare(`SELECT manager, ${s.col("warehouses", "manager_id") ? "manager_id" : "NULL::int AS manager_id"} FROM warehouses WHERE COALESCE(online, 0) = 1`)
    .all()) as Array<{ manager: string | null; manager_id: number | null }>
  const list = employees ?? ((await db.prepare("SELECT id, first_name, last_name, position, branch, active FROM employees").all()) as EmployeeRow[])
  const byName = new Map<string, number>()
  for (const row of [...list].sort((a, b) => a.id - b.id)) {
    const key = nameKey(fullName(row.first_name, row.last_name))
    if (key && !byName.has(key)) byName.set(key, row.id)
  }
  const out = new Set<number>()
  for (const row of rows) {
    const id = row.manager_id !== null && row.manager_id !== undefined ? Number(row.manager_id) : byName.get(nameKey(row.manager ?? ""))
    if (id) out.add(id)
  }
  return out
}

/** True when the employee is a van-sell agent: a "Вансел…" position, the manager of a van-sell warehouse or the
 * cashier of a van-sell cashbox (the rule of the Баланс вансел list, without
 * its "already has van-sell rows" fallback). Manual van-sell movements may
 * only be written for such an employee (404 "Вансел не найден" otherwise). */
export async function isVansellAgent(db: PgDb, employeeId: number): Promise<boolean> {
  const row = (await db.prepare("SELECT id, first_name, last_name, position FROM employees WHERE id = @id").get({ id: employeeId })) as
    | { id: number; first_name: string; last_name: string; position: string | null }
    | undefined
  if (!row) return false
  if (VANSELL_POSITION.test(row.position ?? "")) return true
  if ((await vansellManagers(db, await ensureFinanceSchema(db))).has(Number(row.id))) return true
  const cashier = (await db
    .prepare("SELECT 1 AS ok FROM cashboxes WHERE vansell = 1 AND lower(btrim(regexp_replace(cashier, '\\s+', ' ', 'g'))) = @name LIMIT 1")
    .get({ name: nameKey(fullName(row.first_name, row.last_name)) })) as { ok: number } | undefined
  return Boolean(cashier)
}

/** Same pattern as the "Доставщик" options of Баланс клиентов (lib/finance-client-balance.ts). */
const DELIVERY_POSITION = /достав|курьер|экспедит|водит|deliver|eltuv|yetkaz|haydov/i

/** Every employee; info.is_deliverer = 1 for the ones «Долги доставщиков» lists. Like Linko, that is whoever's
 * access right (Права доступа) carries the «Доставщик» capability (Доставщик, Супер-Админ, Оператор, Вансел агент, …),
 * active or not; an employee without an access right row goes by the right named in its position. Without the access
 * right tables, the old guess (a delivery position or named as deliverer somewhere) is used. */
async function deliverers(db: PgDb, s: FinanceSchema): Promise<EntityRecord[]> {
  const withRight = s.col("employees", "access_right_id")
  // Like the employee card: without a right of its own, the right its account signs in with (not an administrator's).
  const withAccount = withRight && s.col("users", "employee_id") && s.col("users", "access_right_id") && s.col("users", "role")
  const right = withAccount
    ? `, COALESCE(e.access_right_id, (SELECT CASE WHEN u.role <> 'admin' THEN u.access_right_id END FROM users u WHERE u.employee_id = e.id ORDER BY u.id LIMIT 1)) AS access_right_id`
    : withRight
      ? ", e.access_right_id"
      : ""
  const rows = (await db
    .prepare(`SELECT e.id, e.first_name, e.last_name, e.position, e.branch, e.active${right} FROM employees e ORDER BY lower(e.first_name), lower(e.last_name), e.id`)
    .all()) as Array<EmployeeRow & { access_right_id?: number | null }>
  const rights = await delivererAccessRights(db, s)
  if (rights) {
    return rows.map((row) => {
      const record = employeeRecord(row)
      const rightId = row.access_right_id === null || row.access_right_id === undefined ? null : Number(row.access_right_id)
      // Without a known access right, the right is read from the position "<access right> · <job>" (older rows:
      // "<access right>|<job>"). A one-part position is only a job title: those are the placeholder employees kept for
      // documents that name a user Linko has deleted, and Linko does not list them.
      const parts = String(row.position ?? "").split(/\s*[|·]\s*/)
      const named = parts.length > 1 ? nameKey(parts[0]) : ""
      record.info.is_deliverer = (rightId !== null && rights.all.has(rightId) ? rights.ids.has(rightId) : Boolean(named) && rights.names.has(named)) ? 1 : 0
      return record
    })
  }
  const values = async (sql: string, ok: boolean): Promise<unknown[]> => (ok ? ((await db.prepare(sql).all()) as Array<{ v: unknown }>).map((row) => row.v) : [])
  const [clientNames, orderNames, paymentNames, paymentIds, correctionIds] = await Promise.all([
    values("SELECT DISTINCT deliverer AS v FROM clients", s.col("clients", "deliverer")),
    values("SELECT DISTINCT delivery_man AS v FROM orders", s.col("orders", "delivery_man")),
    values("SELECT DISTINCT delivery_man AS v FROM customer_payments", s.col("customer_payments", "delivery_man")),
    values("SELECT DISTINCT delivery_man_id AS v FROM customer_payments WHERE delivery_man_id IS NOT NULL", s.col("customer_payments", "delivery_man_id")),
    values(`SELECT DISTINCT employee_id AS v FROM ${DELIVERER_CORRECTIONS_TABLE}`, s.has(DELIVERER_CORRECTIONS_TABLE)),
  ])
  const names = new Set([...clientNames, ...orderNames, ...paymentNames].map((value) => nameKey(placeName(value))).filter(Boolean))
  const ids = new Set([...paymentIds, ...correctionIds].map(Number))
  return rows.map((row) => {
    const record = employeeRecord(row)
    record.info.is_deliverer = DELIVERY_POSITION.test(row.position ?? "") || names.has(nameKey(record.name)) || ids.has(row.id) ? 1 : 0
    return record
  })
}

/** Access rights that carry the «Доставщик» capability: their ids and names (null without the tables or the capability). */
async function delivererAccessRights(db: PgDb, s: FinanceSchema): Promise<{ ids: Set<number>; names: Set<string>; all: Set<number> } | null> {
  if (!s.has("access_rights") || !s.has("capabilities") || !s.col("access_rights", "capability_ids")) return null
  const capabilities = (await db.prepare("SELECT id FROM capabilities WHERE lower(btrim(name)) = 'доставщик'").all()) as Array<{ id: number }>
  if (!capabilities.length) return null
  const wanted = new Set(capabilities.map((row) => Number(row.id)))
  const rights = (await db.prepare("SELECT id, name, capability_ids FROM access_rights").all()) as Array<{ id: number; name: string; capability_ids: string | null }>
  const ids = new Set<number>()
  const names = new Set<string>()
  for (const right of rights) {
    let list: unknown = []
    try {
      list = JSON.parse(right.capability_ids || "[]")
    } catch {
      list = []
    }
    if (Array.isArray(list) && list.some((id) => wanted.has(Number(id)))) {
      ids.add(Number(right.id))
      names.add(nameKey(right.name))
    }
  }
  return { ids, names, all: new Set(rights.map((right) => Number(right.id))) }
}

/** Employees by normalised full name (lowest id wins, like the ledger's emp_keys). */
export async function loadEmployeesByName(db: PgDb): Promise<Map<string, EntityRecord>> {
  const rows = (await db.prepare("SELECT id, first_name, last_name, position, branch, active FROM employees ORDER BY id").all()) as EmployeeRow[]
  const byName = new Map<string, EntityRecord>()
  for (const row of rows) {
    const record = employeeRecord(row)
    const key = nameKey(record.name)
    if (key && !byName.has(key)) byName.set(key, record)
  }
  return byName
}

/** Row key of a person referenced by name (clients.agent …): the employee id,
 * "name:<name>" when no employee has that name, "none" when empty. */
export function personKey(name: unknown, employees: Map<string, EntityRecord>): string {
  const key = nameKey(placeName(name))
  if (!key) return "none"
  const employee = employees.get(key)
  return employee ? employee.key : `name:${key}`
}

async function branches(db: PgDb, s: FinanceSchema): Promise<EntityRecord[]> {
  if (!s.has("branches")) return []
  // Баланс филиалов lists the branches that keep a debt balance ("Учет долга"), not the main one — as Linko does
  // (show_balance and not is_main); branches copied from Linko carry Linko's own answer (branches.in_balance).
  const listed = s.col("branches", "debt_tracking")
    ? `WHERE ${s.col("branches", "in_balance") ? "COALESCE(in_balance, " : "("}CASE WHEN debt_tracking = 1 AND is_main = 0 THEN 1 ELSE 0 END) = 1`
    : ""
  const rows = (await db.prepare(`SELECT id, name, currency, is_main FROM branches ${listed} ORDER BY id`).all()) as Array<{ id: number; name: string; currency: string; is_main: number }>
  return rows.map((row) => ({ key: String(row.id), id: row.id, name: row.name, info: { currency: normCurrency(row.currency), is_main: row.is_main ? 1 : 0, branch: row.name } }))
}

/** Rows of a balance page before money is attached. `account` and `agent`
 * use the client list (accounts / agents are rolled up from clients in the
 * ledger); `deliverer` returns every employee (see deliverers()). */
export async function loadEntities(kind: BalanceEntityKind, db: PgDb, s: FinanceSchema): Promise<EntityRecord[]> {
  switch (kind) {
    case "cashbox":
      return cashboxes(db)
    case "client":
    case "account":
    case "agent":
      return clients(db, s)
    case "supplier":
      return suppliers(db)
    case "vansell":
      return vansellAgents(db, s)
    case "branch":
      return branches(db, s)
    case "employee":
      return employees(db)
    case "deliverer":
      return deliverers(db, s)
  }
}

/** Legal names by normalised INN from contracts (active first, newest first). */
export async function loadContractNames(db: PgDb, s: FinanceSchema): Promise<Map<string, string>> {
  if (!s.has("contracts")) return new Map()
  const rows = (await db
    .prepare(
      `SELECT inn, official_name FROM contracts
       WHERE btrim(inn) <> '' AND btrim(official_name) <> ''
       ORDER BY (status = 'active') DESC, id DESC`,
    )
    .all()) as Array<{ inn: string; official_name: string }>
  const names = new Map<string, string>()
  for (const row of rows) {
    const inn = innKey(row.inn)
    if (inn && !names.has(inn)) names.set(inn, row.official_name.trim())
  }
  return names
}

export function innKey(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase()
}
