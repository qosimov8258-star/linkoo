import "server-only"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"
import { getEmployee } from "@/lib/employees-repo"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"

/**
 * "Зарплата и установка планов" (the reference's staff/salary): one record per employee and month with the fixed salary,
 * the KPI plans (performance indicators) and the totals per currency. Bonuses come from the KPI facts, so they are kept
 * as stored and only the totals are re-derived when the salary changes.
 */

export type SalaryIndicator = { id: number; name: string; plan: number; planType: string }
export type SalaryCurrencyTotal = { name: string; totalBonus: number; totalSalary: number }

export type SalaryRecord = {
  id: number
  userId: number
  name: string
  firstName: string
  secondName: string
  position: string
  phone: string
  month: number
  year: number
  salary: number
  currency: string
  currencies: SalaryCurrencyTotal[]
  totalBonus: number
  totalSalary: number
  isApproved: boolean
  indicators: SalaryIndicator[]
}

type Row = {
  id: number
  user_id: number
  first_name: string
  second_name: string
  position: string
  phone: string | null
  month: number
  year: number
  salary: number | string
  currency: string
  currencies: string
  total_bonus: number | string
  total_salary: number | string
  is_approved: number
  indicators: string
}

const SCHEMA_VERSION = 2

declare global {
  var __linkoSalaryRecordsSchema: { version: number; ready: Promise<void> } | undefined
}

/** salary_records / salary_last_dates / salary_credits, once per process and outside any request transaction. */
function ensureSchema(): Promise<void> {
  if (globalThis.__linkoSalaryRecordsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:salary_records:schema'))")
        // The currency of a record is a code of Валюты (the base currency when none is chosen), always written by the code.
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS salary_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            first_name TEXT NOT NULL DEFAULT '',
            second_name TEXT NOT NULL DEFAULT '',
            position TEXT NOT NULL DEFAULT '',
            phone TEXT,
            month INTEGER NOT NULL,
            year INTEGER NOT NULL,
            salary DOUBLE PRECISION NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT '',
            currencies TEXT NOT NULL DEFAULT '[]',
            total_bonus DOUBLE PRECISION NOT NULL DEFAULT 0,
            total_salary DOUBLE PRECISION NOT NULL DEFAULT 0,
            is_approved INTEGER NOT NULL DEFAULT 0,
            indicators TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (user_id, month, year)
          );
        `)
        await tx.exec(`CREATE TABLE IF NOT EXISTS salary_last_dates (month INTEGER NOT NULL, year INTEGER NOT NULL, last_date TEXT, PRIMARY KEY (month, year))`)
        // The employee-balance transactions made by "Зачислить" (type monthly = the salary, performance_bonus = the KPI bonus); the finance
        // ledger ("Баланс сотрудников", reports) reads them. Dated with the last day of the record's month, like the reference.
        await tx.exec(
          `CREATE TABLE IF NOT EXISTS salary_credits (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, type TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT '', amount DOUBLE PRECISION NOT NULL DEFAULT 0, created_date TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '')`,
        )
      }),
    ).catch((error: unknown) => {
      globalThis.__linkoSalaryRecordsSchema = undefined
      throw error
    })
    globalThis.__linkoSalaryRecordsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoSalaryRecordsSchema!.ready
}

/** Wrong input of a salary write (answered 400 with this Russian i18n key). */
export class SalaryInputError extends Error {}

/** The currency of a salary: a currency of Валюты given by its code or name ("USD", "AQSh dollari"), stored as its code;
 * the base currency when none is given. An unknown currency is refused. */
async function salaryCurrency(db: ReturnType<typeof getDb>, value: string): Promise<string> {
  const context = await loadCurrencyContext(db)
  const text = value.normalize("NFC").trim()
  if (!text) return context.base
  const code = normCurrency(text, context.base)
  const name = text.toLocaleLowerCase("ru")
  const found = context.currencies.find((currency) => currency.code === code || currency.name.normalize("NFC").trim().toLocaleLowerCase("ru") === name)
  if (!found) throw new SalaryInputError("Неизвестная валюта")
  return found.code
}

/** The base currency of Валюты (the currency of a record created without a salary). */
async function baseCurrencyCode(db: ReturnType<typeof getDb>): Promise<string> {
  return (await loadCurrencyContext(db)).base
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function rowToRecord(row: Row): SalaryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: `${row.first_name} ${row.second_name}`.trim(),
    firstName: row.first_name,
    secondName: row.second_name,
    position: row.position,
    phone: row.phone ?? "",
    month: row.month,
    year: row.year,
    salary: Number(row.salary),
    currency: row.currency,
    currencies: parseJson<SalaryCurrencyTotal[]>(row.currencies, []),
    totalBonus: Number(row.total_bonus),
    totalSalary: Number(row.total_salary),
    isApproved: row.is_approved === 1,
    indicators: parseJson<SalaryIndicator[]>(row.indicators, []).sort((a, b) => a.id - b.id),
  }
}

/** Totals per currency + overall totals; the salary is counted in the record's own currency. */
function totals(salary: number, currency: string, currencies: SalaryCurrencyTotal[]) {
  const map = new Map<string, SalaryCurrencyTotal>()
  for (const item of currencies) map.set(item.name, { name: item.name, totalBonus: item.totalBonus, totalSalary: item.totalBonus })
  if (!map.has(currency)) map.set(currency, { name: currency, totalBonus: 0, totalSalary: 0 })
  const own = map.get(currency)!
  own.totalSalary = own.totalBonus + salary
  const list = [...map.values()]
  return {
    currencies: list,
    totalBonus: list.reduce((sum, item) => sum + item.totalBonus, 0),
    totalSalary: list.reduce((sum, item) => sum + item.totalSalary, 0),
  }
}

export type SalaryListParams = { month: number; year: number; tab: "all" | "true" | "false"; search?: string; page?: number; pageSize?: number }

export async function listSalaryRecords(params: SalaryListParams): Promise<{ count: number; results: SalaryRecord[]; lastDate: string | null }> {
  await ensureSchema()
  const db = getDb()
  const rows = (await db
    .prepare("SELECT * FROM salary_records WHERE month = ? AND year = ? ORDER BY id ASC")
    .all(params.month, params.year)) as Row[]
  const search = (params.search ?? "").trim().toLowerCase()
  const filtered = rows
    .map(rowToRecord)
    .filter((record) => params.tab === "all" || record.isApproved === (params.tab === "true"))
    .filter((record) => !search || record.name.toLowerCase().includes(search))
  const pageSize = Math.max(1, params.pageSize ?? 25)
  const page = Math.max(1, params.page ?? 1)
  const last = (await db.prepare("SELECT last_date FROM salary_last_dates WHERE month = ? AND year = ?").get(params.month, params.year)) as { last_date: string | null } | undefined
  return { count: filtered.length, results: filtered.slice((page - 1) * pageSize, page * pageSize), lastDate: last?.last_date ?? null }
}

/** Every record of the month (the Excel export / copy need the whole month, not one page). */
export async function allSalaryRecords(month: number, year: number): Promise<SalaryRecord[]> {
  await ensureSchema()
  const db = getDb()
  return ((await db.prepare("SELECT * FROM salary_records WHERE month = ? AND year = ? ORDER BY id ASC").all(month, year)) as Row[]).map(rowToRecord)
}

async function findRow(db: ReturnType<typeof getDb>, userId: number, month: number, year: number) {
  return (await db.prepare("SELECT * FROM salary_records WHERE user_id = ? AND month = ? AND year = ?").get(userId, month, year)) as Row | undefined
}

async function userInfo(userId: number) {
  const employee = await getEmployee(userId)
  if (!employee) return null
  return {
    first: employee.firstName,
    second: employee.lastName,
    position: employee.accessRight || "",
    phone: employee.phone || "",
  }
}

async function touchLastDate(db: ReturnType<typeof getDb>, month: number, year: number) {
  const now = new Date().toISOString().replace("Z", "")
  await db
    .prepare(
      `INSERT INTO salary_last_dates (month, year, last_date) VALUES (?, ?, ?)
       ON CONFLICT (month, year) DO UPDATE SET last_date = EXCLUDED.last_date RETURNING month`,
    )
    .run(month, year, now)
}

/** Creates (or updates the salary of) the employees' records for the month. */
export async function setSalaries(month: number, year: number, currency: string, entries: Array<{ userId: number; salary: number }>): Promise<number> {
  await ensureSchema()
  const db = getDb()
  const cur = await salaryCurrency(db, currency)
  let done = 0
  for (const entry of entries) {
    const existing = await findRow(db, entry.userId, month, year)
    if (existing) {
      const t = totals(entry.salary, cur, parseJson<SalaryCurrencyTotal[]>(existing.currencies, []))
      await db
        .prepare(`UPDATE salary_records SET salary = ?, currency = ?, currencies = ?, total_bonus = ?, total_salary = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(entry.salary, cur, JSON.stringify(t.currencies), t.totalBonus, t.totalSalary, existing.id)
      done += 1
      continue
    }
    const info = await userInfo(entry.userId)
    if (!info) continue
    const t = totals(entry.salary, cur, [])
    await db
      .prepare(
        `INSERT INTO salary_records (user_id, first_name, second_name, position, phone, month, year, salary, currency, currencies, total_bonus, total_salary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(entry.userId, info.first, info.second, info.position, info.phone, month, year, entry.salary, cur, JSON.stringify(t.currencies), t.totalBonus, t.totalSalary)
    done += 1
  }
  if (done) await touchLastDate(db, month, year)
  return done
}

/** Last day of the month at the current local time: the date of the "Зачислить" transactions (the reference dates them that way). */
function creditDate(month: number, year: number) {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const time = nowLocalIso().replace("T", " ").slice(11, 19) || "00:00:00"
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}`
}

/** "Зачислить" writes the salary and the KPI bonus of the record to the employee's balance, "Отменить зачисление" removes them. */
export async function setApproved(month: number, year: number, userIds: number[], approved: boolean): Promise<number> {
  await ensureSchema()
  const ids = [...new Set(userIds)].sort((a, b) => a - b)
  if (!ids.length) return 0
  // One transaction, the month's records locked in user order: a parallel "Зачислить" (a double click, a second tab)
  // waits for this one and then sees the record already approved, so the credits are never written twice; a failure
  // leaves no record approved without its credits.
  return withTransaction(async (db) => {
    const rows = (await db
      .prepare("SELECT * FROM salary_records WHERE month = ? AND year = ? AND user_id = ANY(?::int[]) ORDER BY user_id FOR UPDATE")
      .all(month, year, ids)) as Row[]
    let done = 0
    for (const existing of rows) {
      const userId = existing.user_id
      const result = await db
        .prepare("UPDATE salary_records SET is_approved = ?, updated_at = datetime('now') WHERE id = ?")
        .run(approved ? 1 : 0, existing.id)
      done += result.changes
      if (approved === (existing.is_approved === 1)) continue
      await db.prepare("DELETE FROM salary_credits WHERE user_id = ? AND month = ? AND year = ?").run(userId, month, year)
      if (!approved) continue
      const record = rowToRecord(existing)
      const date = creditDate(month, year)
      const insert = db.prepare("INSERT INTO salary_credits (user_id, month, year, type, currency, amount, created_date, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      if (record.salary) await insert.run(userId, month, year, "monthly", record.currency, record.salary, date, "Зарплата")
      for (const item of record.currencies) if (item.totalBonus) await insert.run(userId, month, year, "performance_bonus", item.name, item.totalBonus, date, "КПИ")
    }
    return done
  })
}

/** "Установить KPI": replaces the KPI plans of the employees (a plan of 0/empty drops the KPI). Missing records are created. */
export async function setPlans(
  month: number,
  year: number,
  users: Array<{ userId: number; plans: Array<{ id: number; name: string; planType: string; plan: number }> }>,
): Promise<number> {
  await ensureSchema()
  const db = getDb()
  let done = 0
  for (const user of users) {
    const indicators: SalaryIndicator[] = user.plans.filter((item) => item.plan > 0).map((item) => ({ id: item.id, name: item.name, plan: item.plan, planType: item.planType }))
    const existing = await findRow(db, user.userId, month, year)
    if (existing) {
      await db.prepare("UPDATE salary_records SET indicators = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(indicators), existing.id)
      done += 1
      continue
    }
    const info = await userInfo(user.userId)
    if (!info) continue
    const base = await baseCurrencyCode(db)
    const t = totals(0, base, [])
    await db
      .prepare(
        `INSERT INTO salary_records (user_id, first_name, second_name, position, phone, month, year, salary, currency, currencies, total_bonus, total_salary, indicators)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .run(user.userId, info.first, info.second, info.position, info.phone, month, year, base, JSON.stringify(t.currencies), t.totalBonus, t.totalSalary, JSON.stringify(indicators))
    done += 1
  }
  if (done) await touchLastDate(db, month, year)
  return done
}

/** "Дублировать": copies the KPI plans and/or the salary of the employees (all of them when none are given) to another month. */
export async function copyMonth(
  from: { month: number; year: number },
  to: { month: number; year: number },
  userIds: number[],
  options: { copyKpi: boolean; copySalary: boolean },
): Promise<number> {
  await ensureSchema()
  const db = getDb()
  const source = (await allSalaryRecords(from.month, from.year)).filter((record) => !userIds.length || userIds.includes(record.userId))
  let done = 0
  for (const record of source) {
    const existing = await findRow(db, record.userId, to.month, to.year)
    if (existing) {
      const current = rowToRecord(existing)
      const salary = options.copySalary ? record.salary : current.salary
      const currency = options.copySalary ? record.currency : current.currency
      const indicators = options.copyKpi ? record.indicators : current.indicators
      const t = totals(salary, currency, current.currencies)
      await db
        .prepare(`UPDATE salary_records SET salary = ?, currency = ?, indicators = ?, currencies = ?, total_bonus = ?, total_salary = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(salary, currency, JSON.stringify(indicators), JSON.stringify(t.currencies), t.totalBonus, t.totalSalary, existing.id)
    } else {
      const salary = options.copySalary ? record.salary : 0
      const currency = options.copySalary ? record.currency : await baseCurrencyCode(db)
      const t = totals(salary, currency, [])
      await db
        .prepare(
          `INSERT INTO salary_records (user_id, first_name, second_name, position, phone, month, year, salary, currency, currencies, total_bonus, total_salary, indicators)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.userId,
          record.name.split(" ")[0] ?? "",
          record.name.split(" ").slice(1).join(" "),
          record.position,
          record.phone,
          to.month,
          to.year,
          salary,
          currency,
          JSON.stringify(t.currencies),
          t.totalBonus,
          t.totalSalary,
          JSON.stringify(options.copyKpi ? record.indicators : []),
        )
    }
    done += 1
  }
  if (done) await touchLastDate(db, to.month, to.year)
  return done
}

/** "Перерасчет KPI": re-derives the totals of the month and stamps the "ДАННЫЕ ЗА" date. */
export async function recalculate(month: number, year: number): Promise<number> {
  await ensureSchema()
  const db = getDb()
  const records = await allSalaryRecords(month, year)
  for (const record of records) {
    const t = totals(record.salary, record.currency, record.currencies)
    await db
      .prepare("UPDATE salary_records SET currencies = ?, total_bonus = ?, total_salary = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(t.currencies), t.totalBonus, t.totalSalary, record.id)
  }
  await touchLastDate(db, month, year)
  return records.length
}

/** KPI statistics of one month for the "Скачать EXCEL" sheet: the KPI columns (reference order) and, per employee, the work days and the facts. */
export type SalaryKpiStats = {
  columns: string[]
  rows: Record<number, { workDays: number | null; workedDays: number | null; facts: Record<string, Array<number | null>> }>
}

/** No KPI statistics are stored for this company yet, so the sheet carries the salary columns only. (The reference
 * account's monthly statistics that the removed demo scripts wrote into salary_kpi_columns / _rows / _facts are not read.) */
export async function salaryKpiStats(month: number, year: number): Promise<SalaryKpiStats> {
  void month
  void year
  return { columns: [], rows: {} }
}
