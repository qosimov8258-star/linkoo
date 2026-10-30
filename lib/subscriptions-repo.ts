import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { ensureEmployeesSchema } from "@/lib/employees-schema"

// "Подписки" (demo #/billing, API main/billing/*, main/crud/subscriptions/): every active employee has at most one
// license (employee_subscriptions); licenses come from purchased packages (billing_packages, "Доступно N шт."), the
// price list is billing_prices (per period, with the discount already applied), the balance and its movements live in
// billing_account / billing_ledger (АКТ сверки).

const DDL = `
  CREATE TABLE IF NOT EXISTS billing_packages (
    id SERIAL PRIMARY KEY, license_key TEXT NOT NULL, license_name TEXT NOT NULL, begin_date TEXT NOT NULL, end_date TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0, available INTEGER
  );
  CREATE TABLE IF NOT EXISTS billing_prices (
    period INTEGER NOT NULL, license_key TEXT NOT NULL, license_name TEXT NOT NULL, price NUMERIC NOT NULL DEFAULT 0,
    percent NUMERIC NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (period, license_key)
  );
  CREATE TABLE IF NOT EXISTS employee_subscriptions (
    employee_id INTEGER PRIMARY KEY, seq SERIAL, license_key TEXT NOT NULL, license_name TEXT NOT NULL, begin_date TEXT, end_date TEXT,
    price NUMERIC NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS billing_account (
    id INTEGER PRIMARY KEY, balance NUMERIC NOT NULL DEFAULT 0, support_phone TEXT NOT NULL DEFAULT '', server_name TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS billing_ledger (
    id SERIAL PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL, debit NUMERIC NOT NULL DEFAULT 0, credit NUMERIC NOT NULL DEFAULT 0,
    begin_date TEXT, end_date TEXT
  );
`

const SCHEMA_VERSION = 1

declare global {
  var __linkoSubscriptionsSchema: { version: number; ready: Promise<void> } | undefined
}

/** The billing tables (+ the employees columns), prepared once per process on the maintenance pool
 * (outsideTransaction), never inside a request transaction; a failed attempt is retried by the next call. */
function ensureSchema(): Promise<void> {
  const current = globalThis.__linkoSubscriptionsSchema
  if (current?.version === SCHEMA_VERSION) return current.ready
  const ready = outsideTransaction(async () => {
    await getDb().exec(DDL)
    await ensureEmployeesSchema()
  }).catch((error) => {
    if (globalThis.__linkoSubscriptionsSchema?.ready === ready) globalThis.__linkoSubscriptionsSchema = undefined
    throw error
  })
  globalThis.__linkoSubscriptionsSchema = { version: SCHEMA_VERSION, ready }
  return ready
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0")
const iso = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function fromIso(value: string): Date {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Adds calendar months, clamping the day (31 jan + 1 month = 28/29 feb). */
function addMonths(value: string, months: number): string {
  const date = fromIso(value)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, last))
  return iso(date)
}

function addDays(value: string, days: number): string {
  const date = fromIso(value)
  date.setUTCDate(date.getUTCDate() + days)
  return iso(date)
}

/** End date of a period that starts on `begin`: 15 jan + 1 month = 14 feb. */
function periodEnd(begin: string, months: number): string {
  return addDays(addMonths(begin, months), -1)
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type SubscriptionRow = {
  id: number
  name: string
  accessRight: string
  license: { key: string | null; name: string }
  beginDate: string | null
  endDate: string | null
  price: number
  isEnding: boolean
}

export type SubscriptionFilters = {
  license: string
  accessRightId: number | null
  branchId: number | null
  zoneId: number | null
  priceListId: number | null
  jobId: number | null
  organizationId: number | null
  ending: boolean
}

export type SubscriptionQuery = {
  tab: "with" | "without"
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: SubscriptionFilters
}

const ORDERABLE: Record<string, string> = {
  subscription_end_date: "s.end_date",
  subscription_begin_date: "s.begin_date",
  id: "e.id",
  first_name: "lower(e.first_name)",
}

type ListRow = {
  id: number
  first_name: string
  last_name: string
  access_right: string | null
  license_key: string | null
  license_name: string | null
  begin_date: string | null
  end_date: string | null
  price: number | null
}

function activeClause(tab: "with" | "without") {
  return tab === "with" ? "s.end_date >= @today" : "(s.end_date IS NULL OR s.end_date < @today)"
}

function whereFor(query: SubscriptionQuery) {
  const where = ["e.active = 1", activeClause(query.tab)]
  const params: Record<string, unknown> = { today: today() }
  const f = query.filters
  if (query.search) {
    where.push("(e.id::text = @exact OR btrim(concat_ws(' ', e.first_name, e.last_name)) ILIKE @search OR s.license_name ILIKE @search)")
    params.exact = query.search
    params.search = `%${query.search}%`
  }
  if (f.license) { where.push("s.license_key = @license"); params.license = f.license }
  if (f.accessRightId) { where.push("e.access_right_id = @accessRightId"); params.accessRightId = f.accessRightId }
  if (f.branchId) { where.push("e.branch_ids::jsonb @> to_jsonb(@branchId::int)"); params.branchId = f.branchId }
  if (f.priceListId) { where.push("(e.details::jsonb -> 'priceListIds') @> to_jsonb(@priceListId::int)"); params.priceListId = f.priceListId }
  if (f.jobId) { where.push("e.job_id = @jobId"); params.jobId = f.jobId }
  if (f.organizationId) { where.push("e.organization_ids::jsonb @> to_jsonb(@organizationId::int)"); params.organizationId = f.organizationId }
  if (f.zoneId) { where.push("(e.details::jsonb -> 'zoneIds') @> to_jsonb(@zoneId::int)"); params.zoneId = f.zoneId }
  if (f.ending) { where.push("s.end_date IS NOT NULL AND s.end_date <= @endingBefore"); params.endingBefore = addDays(today(), 7) }
  return { clause: where.join(" AND "), params }
}

export async function listSubscriptions(query: SubscriptionQuery): Promise<{ count: number; results: SubscriptionRow[] }> {
  await ensureSchema()
  const db = getDb()
  const { clause, params } = whereFor(query)
  const from = `FROM employees e
    LEFT JOIN employee_subscriptions s ON s.employee_id = e.id
    LEFT JOIN access_rights ar ON ar.id = e.access_right_id
    WHERE ${clause}`
  const total = (await db.prepare(`SELECT count(*)::int AS n ${from}`).get(params)) as { n: number }
  const desc = query.ordering.startsWith("-")
  const column = ORDERABLE[query.ordering.replace(/^-/, "")] ?? ORDERABLE.subscription_end_date
  const rows = (await db
    .prepare(
      `SELECT e.id, e.first_name, e.last_name, ar.name AS access_right, s.license_key, s.license_name, s.begin_date, s.end_date, s.price::float8 AS price
       ${from} ORDER BY ${column} ${desc ? "DESC" : "ASC"} NULLS LAST, s.seq ASC NULLS LAST, e.id ASC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as ListRow[]
  const endingBefore = addDays(today(), 7)
  return {
    count: total.n,
    results: rows.map((row) => ({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      accessRight: row.access_right ?? "",
      license: { key: row.license_key, name: row.license_name ?? "Не указано" },
      beginDate: row.begin_date,
      endDate: row.end_date,
      price: row.price ?? 0,
      isEnding: Boolean(row.end_date && row.end_date <= endingBefore),
    })),
  }
}

// ---------------------------------------------------------------------------
// Balance, prices, licenses
// ---------------------------------------------------------------------------

export type BillingSummary = { balance: number; supportPhone: string; serverName: string; noSubscription: number; paymentDeadline: string | null }

export async function getBillingSummary(): Promise<BillingSummary> {
  await ensureSchema()
  const db = getDb()
  const account = (await db.prepare("SELECT balance::float8 AS balance, support_phone, server_name FROM billing_account WHERE id = 1").get()) as
    | { balance: number; support_phone: string; server_name: string }
    | undefined
  const without = (await db
    .prepare(
      `SELECT count(*)::int AS n FROM employees e LEFT JOIN employee_subscriptions s ON s.employee_id = e.id
       WHERE e.active = 1 AND (s.end_date IS NULL OR s.end_date < @today)`,
    )
    .get({ today: today() })) as { n: number }
  return {
    balance: account?.balance ?? 0,
    supportPhone: account?.support_phone ?? "",
    serverName: account?.server_name ?? "",
    noSubscription: without.n,
    paymentDeadline: null,
  }
}

export type PricePeriod = { period: number; percent: number; licenses: Array<{ key: string; name: string; price: number }> }

export async function getPricing(): Promise<PricePeriod[]> {
  await ensureSchema()
  const rows = (await getDb()
    .prepare("SELECT period, license_key, license_name, price::float8 AS price, percent::float8 AS percent FROM billing_prices ORDER BY period ASC, sort_order ASC")
    .all()) as Array<{ period: number; license_key: string; license_name: string; price: number; percent: number }>
  const periods = new Map<number, PricePeriod>()
  for (const row of rows) {
    const entry = periods.get(row.period) ?? { period: row.period, percent: row.percent, licenses: [] }
    entry.licenses.push({ key: row.license_key, name: row.license_name, price: row.price })
    periods.set(row.period, entry)
  }
  return [...periods.values()]
}

const GROUP_ORDER = ["manufacture", "delivery", "merch", "supervisor", "supervisor_agent", "agent", "operator"]

/** Purchased licenses still free ("Доступно N шт."); admin is not sold. */
export async function getLicenseGroups(): Promise<Array<{ key: string; name: string; available: number }>> {
  await ensureSchema()
  const rows = (await getDb()
    .prepare(
      `SELECT license_key AS key, max(license_name) AS name, coalesce(sum(available) FILTER (WHERE end_date >= @today), 0)::int AS available
       FROM billing_packages WHERE license_key <> 'admin' GROUP BY license_key`,
    )
    .all({ today: today() })) as Array<{ key: string; name: string; available: number }>
  return rows.sort((a, b) => GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key))
}

/** All license types for the "Подписки" filter (reference select_licence). */
export async function listLicenseTypes(): Promise<Array<{ key: string; name: string }>> {
  await ensureSchema()
  const order = ["agent", "delivery", "supervisor", "supervisor_agent", "merch", "operator", "manufacture", "admin"]
  const rows = (await getDb().prepare("SELECT license_key AS key, max(license_name) AS name FROM billing_packages GROUP BY license_key").all()) as Array<{ key: string; name: string }>
  return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
}

// ---------------------------------------------------------------------------
// Prolong price / extend
// ---------------------------------------------------------------------------

export type ProlongOption = {
  period: number
  percent: number
  total: number
  licenses: Array<{ key: string; name: string; amount: number; beginDate: string; endDate: string; price: number; total: number }>
}

type SelectedSubscription = { employee_id: number; license_key: string; license_name: string; end_date: string | null }

async function selectedSubscriptions(db: PgDb, ids: number[]): Promise<SelectedSubscription[]> {
  return (await db
    .prepare("SELECT employee_id, license_key, license_name, end_date FROM employee_subscriptions WHERE employee_id = ANY(@ids::int[])")
    .all({ ids })) as SelectedSubscription[]
}

/** Where the next period of a subscription starts: the day after it ends, or today when it already ended. */
function nextBegin(endDate: string | null): string {
  const now = today()
  return endDate && endDate >= now ? addDays(endDate, 1) : now
}

export async function getProlongPrice(ids: number[]): Promise<ProlongOption[]> {
  await ensureSchema()
  const db = getDb()
  const [pricing, subs] = await Promise.all([getPricing(), selectedSubscriptions(db, ids)])
  return pricing.map((period) => {
    const groups = new Map<string, { name: string; amount: number; begin: string }>()
    for (const sub of subs) {
      const begin = nextBegin(sub.end_date)
      const group = groups.get(sub.license_key) ?? { name: sub.license_name, amount: 0, begin }
      group.amount += 1
      if (begin < group.begin) group.begin = begin
      groups.set(sub.license_key, group)
    }
    const licenses = [...groups.entries()].map(([key, group]) => {
      const price = period.licenses.find((license) => license.key === key)?.price ?? 0
      return {
        key,
        name: group.name,
        amount: group.amount,
        beginDate: group.begin,
        endDate: periodEnd(group.begin, period.period),
        price,
        total: price * period.period * group.amount,
      }
    })
    return { period: period.period, percent: period.percent, total: licenses.reduce((sum, license) => sum + license.total, 0), licenses }
  })
}

export type BillingResult = { ok: true } | { ok: false; error: "insufficient_funds" | "nothing_selected" | "no_license" | "bad_period" | "bad_date" }

async function charge(tx: PgDb, amount: number, type: string, begin: string | null, end: string | null): Promise<boolean> {
  const account = (await tx.prepare("SELECT balance::float8 AS balance FROM billing_account WHERE id = 1 FOR UPDATE").get()) as { balance: number } | undefined
  if (!account || account.balance < amount) return false
  await tx.prepare("UPDATE billing_account SET balance = balance - @amount WHERE id = 1").run({ amount })
  await tx
    .prepare("INSERT INTO billing_ledger (date, type, debit, credit, begin_date, end_date) VALUES (@date, @type, @amount, 0, @begin, @end)")
    .run({ date: today(), type, amount, begin, end })
  return true
}

/** "Подтвердить" of "Продлить подписку": charges the balance and moves every selected subscription forward by `period` months. */
export async function extendSubscriptions(ids: number[], period: number): Promise<BillingResult> {
  await ensureSchema()
  if (!ids.length) return { ok: false, error: "nothing_selected" }
  const options = await getProlongPrice(ids)
  const option = options.find((item) => item.period === period)
  if (!option || !option.licenses.length) return { ok: false, error: option ? "nothing_selected" : "bad_period" }
  return withTransaction(async (tx) => {
    const subs = await selectedSubscriptions(tx, ids)
    const prices = new Map(option.licenses.map((license) => [license.key, license.price]))
    const begin = option.licenses.map((license) => license.beginDate).sort()[0]
    const end = option.licenses.map((license) => license.endDate).sort().at(-1) ?? null
    if (!(await charge(tx, option.total, "Продление подписки", begin, end))) return { ok: false, error: "insufficient_funds" } as const
    for (const sub of subs) {
      const start = nextBegin(sub.end_date)
      const stillRunning = Boolean(sub.end_date && sub.end_date >= today())
      await tx
        .prepare(
          `UPDATE employee_subscriptions SET end_date = @end, begin_date = CASE WHEN @running THEN begin_date ELSE @start END, price = @price
           WHERE employee_id = @id RETURNING employee_id`,
        )
        .run({ id: sub.employee_id, end: periodEnd(start, period), start, running: stillRunning, price: prices.get(sub.license_key) ?? 0 })
    }
    return { ok: true } as const
  })
}

// ---------------------------------------------------------------------------
// Attach / detach / purchase
// ---------------------------------------------------------------------------

/** Takes one free license of `licenseKey` from the earliest running package and gives it to the employee. */
async function takeLicense(tx: PgDb, employeeId: number, licenseKey: string): Promise<boolean> {
  const pkg = (await tx
    .prepare(
      `SELECT id, license_name, end_date FROM billing_packages
       WHERE license_key = @key AND end_date >= @today AND coalesce(available, 0) > 0 AND begin_date <= @today
       ORDER BY end_date ASC, id ASC LIMIT 1 FOR UPDATE`,
    )
    .get({ key: licenseKey, today: today() })) as { id: number; license_name: string; end_date: string } | undefined
  if (!pkg) return false
  const month = (await tx.prepare("SELECT price::float8 AS price FROM billing_prices WHERE period = 1 AND license_key = ?").get(licenseKey)) as { price: number } | undefined
  await tx.prepare("UPDATE billing_packages SET available = available - 1 WHERE id = @id").run({ id: pkg.id })
  await giveBack(tx, employeeId)
  await tx
    .prepare(
      `INSERT INTO employee_subscriptions (employee_id, license_key, license_name, begin_date, end_date, price)
       VALUES (@id, @key, @name, @begin, @end, @price)
       ON CONFLICT (employee_id) DO UPDATE SET license_key = @key, license_name = @name, begin_date = @begin, end_date = @end, price = @price
       RETURNING employee_id`,
    )
    .run({ id: employeeId, key: licenseKey, name: pkg.license_name, begin: today(), end: pkg.end_date, price: month?.price ?? 0 })
  return true
}

/** Frees the license an employee currently holds (if it still sits in a running package). */
async function giveBack(tx: PgDb, employeeId: number): Promise<void> {
  const sub = (await tx.prepare("SELECT license_key, end_date FROM employee_subscriptions WHERE employee_id = ? FOR UPDATE").get(employeeId)) as
    | { license_key: string; end_date: string | null }
    | undefined
  if (!sub || !sub.end_date || sub.end_date < today()) return
  await tx
    .prepare(
      `UPDATE billing_packages SET available = least(total, coalesce(available, 0) + 1)
       WHERE id = (SELECT id FROM billing_packages WHERE license_key = @key AND end_date = @end ORDER BY id LIMIT 1)`,
    )
    .run({ key: sub.license_key, end: sub.end_date })
}

export async function attachLicenseToEmployee(employeeId: number, licenseKey: string): Promise<boolean> {
  await ensureSchema()
  return withTransaction((tx) => takeLicense(tx, employeeId, licenseKey))
}

export async function attachSubscriptions(ids: number[], licenseKey: string): Promise<BillingResult> {
  await ensureSchema()
  if (!ids.length) return { ok: false, error: "nothing_selected" }
  return withTransaction(async (tx) => {
    for (const id of ids) {
      if (!(await takeLicense(tx, id, licenseKey))) throw new NoLicense()
    }
    return { ok: true } as const
  }).catch((error) => {
    if (error instanceof NoLicense) return { ok: false, error: "no_license" } as const
    throw error
  })
}

class NoLicense extends Error {}

/** "Открепить": the employees lose their subscription and the licenses go back to their packages. */
export async function detachSubscriptions(ids: number[]): Promise<number> {
  await ensureSchema()
  return withTransaction(async (tx) => {
    let removed = 0
    for (const id of ids) {
      await giveBack(tx, id)
      const result = await tx.prepare("DELETE FROM employee_subscriptions WHERE employee_id = ? RETURNING employee_id").run(id)
      removed += result.changes
    }
    return removed
  })
}

/** "Купить подписку": a new package per license type, paid from the balance. */
export async function purchasePackages(input: { period: number; startDate: string; items: Array<{ licenseKey: string; count: number }> }): Promise<BillingResult> {
  await ensureSchema()
  const pricing = (await getPricing()).find((item) => item.period === input.period)
  if (!pricing) return { ok: false, error: "bad_period" }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || input.startDate < today()) return { ok: false, error: "bad_date" }
  const items = input.items.filter((item) => item.count > 0 && pricing.licenses.some((license) => license.key === item.licenseKey))
  if (!items.length) return { ok: false, error: "nothing_selected" }
  const total = items.reduce((sum, item) => sum + (pricing.licenses.find((license) => license.key === item.licenseKey)?.price ?? 0) * input.period * item.count, 0)
  const end = periodEnd(input.startDate, input.period)
  return withTransaction(async (tx) => {
    if (!(await charge(tx, total, "Покупка подписки", input.startDate, end))) return { ok: false, error: "insufficient_funds" } as const
    for (const item of items) {
      const license = pricing.licenses.find((entry) => entry.key === item.licenseKey)!
      await tx
        .prepare("INSERT INTO billing_packages (license_key, license_name, begin_date, end_date, total, available) VALUES (@key, @name, @begin, @end, @count, @count)")
        .run({ key: license.key, name: license.name, begin: input.startDate, end, count: item.count })
    }
    return { ok: true } as const
  })
}

// ---------------------------------------------------------------------------
// АКТ сверки
// ---------------------------------------------------------------------------

export type ActRow = { date: string; type: string; debit: number; credit: number; beginDate: string | null; endDate: string | null }

export async function getAct(begin: string, end: string): Promise<{ rows: ActRow[]; total: number }> {
  await ensureSchema()
  const db = getDb()
  const before = (await db
    .prepare("SELECT coalesce(sum(credit - debit), 0)::float8 AS balance FROM billing_ledger WHERE date < @begin")
    .get({ begin })) as { balance: number }
  const inside = (await db
    .prepare("SELECT date, type, debit::float8 AS debit, credit::float8 AS credit, begin_date, end_date FROM billing_ledger WHERE date >= @begin AND date <= @end ORDER BY date ASC, id ASC")
    .all({ begin, end })) as Array<{ date: string; type: string; debit: number; credit: number; begin_date: string | null; end_date: string | null }>
  const closing = before.balance + inside.reduce((sum, row) => sum + row.credit - row.debit, 0)
  const rows: ActRow[] = [
    { date: begin, type: "Остаток на начало", debit: 0, credit: before.balance, beginDate: null, endDate: null },
    ...inside.map((row) => ({ date: row.date, type: row.type, debit: row.debit, credit: row.credit, beginDate: row.begin_date, endDate: row.end_date })),
    { date: end, type: "Остаток на конец", debit: 0, credit: closing, beginDate: null, endDate: null },
  ]
  return { rows, total: closing }
}
