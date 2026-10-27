import "server-only"

import { z } from "zod"

import { getDb, type PgDb } from "@/lib/db"
import { parseBalanceListQuery, type ParsedQuery } from "@/lib/finance/api"
import { roundMoney, visibleCurrencyCodes } from "@/lib/finance/currency"
import { nameKey, placeName } from "@/lib/finance/entities"
import { getBalanceList, type BalanceListParams, type BalanceTypeFilter } from "@/lib/finance/ledger"
import { sortBalanceRows } from "@/lib/finance/rows"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { MOVEMENT_COLUMNS, type BalanceListResult, type BalanceRow, type CurrencyBalance } from "@/lib/finance/types"
import type { ClientBalanceOptions } from "@/lib/finance-client-balance-types"
import { strictNum } from "@/lib/strict-number"
import { zodErrorResponse } from "@/lib/validation"

// "Баланс клиентов" (demo #/statistics/market) on top of the shared ledger:
// getBalanceList("client") does all balance math; this layer adds the demo
// filters the shared list does not know (single "Доставщик", visits /
// refusals, "Только оплаты с счет фактурой", clients without a type), the
// client-type mode with a search over type names, and the demo's default
// order (newest client first). Data gaps: there are no visits, refusals or
// invoice flags in the database, so those filters are applied strictly
// against "nothing recorded".

export type ClientBalanceParams = BalanceListParams & {
  /** "Доставщик" (one delivery person) — clients.deliverer, AND-ed with `deliverers`. */
  deliveryMan?: string
  /** "Последнее посещение": no visits are recorded, so any value matches no client. */
  lastVisit?: "success" | "unsuccess" | ""
  /** Days since the last refusal / visit: none recorded (null), so only a lower bound passes. */
  rejectDaysMin?: number
  rejectDaysMax?: number
  visitDaysMin?: number
  visitDaysMax?: number
  /** "Только оплаты с счет фактурой": no payment carries an invoice flag, so payments drop out of the balances. */
  onlyInvoicePayments?: boolean
}

const COLUMNS = [...MOVEMENT_COLUMNS.client, "not_accepted_payment"]
const FIELDS = ["begin_balance", ...COLUMNS, "end_balance"]
const EARLIEST_DAY = "1900-01-01"

const flag = z
  .enum(["1", "0", "true", "false"])
  .optional()
  .transform((value) => value === "1" || value === "true")
const days = strictNum(z.number().int().min(0).optional())

const extraQuery = z.object({
  deliveryMan: z.string().trim().optional(),
  lastVisit: z.enum(["success", "unsuccess", ""]).optional(),
  rejectDaysMin: days,
  rejectDaysMax: days,
  visitDaysMin: days,
  visitDaysMax: days,
  onlyInvoicePayments: flag,
})

/** Query of GET /api/balances/client-balance: every param of GET
 * /api/balances/client plus the extras above (clientType "-" = no type). */
export function parseClientBalanceQuery(url: string): ParsedQuery<ClientBalanceParams> {
  const base = parseBalanceListQuery(url)
  if (base.error) return base
  const params = new URL(url).searchParams
  const raw: Record<string, string> = {}
  for (const name of Object.keys(extraQuery.shape)) {
    const value = params.get(name)
    if (value !== null && value.trim() !== "") raw[name] = value
  }
  const extra = extraQuery.safeParse(raw)
  if (!extra.success) return { error: zodErrorResponse(extra.error) }
  return { data: { ...base.data, ...extra.data } }
}

function emptyBalance(): CurrencyBalance {
  return Object.fromEntries(FIELDS.map((field) => [field, 0])) as CurrencyBalance
}

function previousDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  const day = date.toISOString().slice(0, 10)
  return day < EARLIEST_DAY ? EARLIEST_DAY : day
}

/** Same rule as the shared list: a missing value passes only an open upper bound. */
function inRange(value: number | null, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true
  if (value === null) return max === undefined
  return (min === undefined || value >= min) && (max === undefined || value <= max)
}

function matchesBalanceType(row: BalanceRow, type: BalanceTypeFilter | "" | undefined, currency: string | undefined): boolean {
  if (!type) return true
  const field = type.endsWith("_for_begin") ? "begin_balance" : "end_balance"
  const wantNegative = type.startsWith("debtor")
  return Object.entries(row.currencies).some(([code, balance]) => {
    if (currency && code !== currency) return false
    const value = balance[field] ?? 0
    return wantNegative ? value < -1e-9 : value > 1e-9
  })
}

/** Removes every payment from the balances (no payment has an invoice):
 * payments before `from` leave begin/end, payments in the period leave the
 * payment column and end. */
function dropPayments(rows: BalanceRow[], before: Map<string, BalanceRow>): BalanceRow[] {
  return rows.map((row) => {
    const currencies: Record<string, CurrencyBalance> = {}
    for (const [code, balance] of Object.entries(row.currencies)) {
      const earlier = before.get(row.key)?.currencies[code]?.payment ?? 0
      const inPeriod = balance.payment ?? 0
      currencies[code] = {
        ...balance,
        begin_balance: roundMoney(balance.begin_balance - earlier),
        payment: 0,
        not_accepted_payment: 0,
        end_balance: roundMoney(balance.end_balance - earlier - inPeriod),
      }
    }
    return { ...row, currencies }
  })
}

function addInto(target: CurrencyBalance, source: CurrencyBalance | undefined) {
  if (!source) return
  for (const field of FIELDS) target[field] = (target[field] ?? 0) + (source[field] ?? 0)
}

function roundBalance(balance: CurrencyBalance): CurrencyBalance {
  return Object.fromEntries(Object.entries(balance).map(([field, value]) => [field, roundMoney(value)])) as CurrencyBalance
}

/** "Показать по типам клиентов": one row per client type (key "type:<type>"). */
function rollupTypes(rows: BalanceRow[], codes: string[]): BalanceRow[] {
  const groups = new Map<string, BalanceRow>()
  for (const row of rows) {
    const type = String(row.info.type ?? "")
    const key = `type:${nameKey(type)}`
    let group = groups.get(key)
    if (!group) {
      group = { key, id: null, name: type, info: { type, clients: 0 }, currencies: Object.fromEntries(codes.map((code) => [code, emptyBalance()])), members: [] }
      groups.set(key, group)
    }
    if (row.id !== null) group.members!.push(row.id)
    group.info.clients = Number(group.info.clients) + 1
    for (const code of codes) addInto(group.currencies[code], row.currencies[code])
  }
  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })
  return [...groups.values()]
    .map((group) => ({ ...group, currencies: Object.fromEntries(Object.entries(group.currencies).map(([code, balance]) => [code, roundBalance(balance)])) }))
    .sort((a, b) => (a.name === "" ? 1 : b.name === "" ? -1 : collator.compare(a.name, b.name)))
}

function sumRows(rows: BalanceRow[], codes: string[]): Record<string, CurrencyBalance> {
  const totals: Record<string, CurrencyBalance> = {}
  for (const code of codes) {
    totals[code] = emptyBalance()
    for (const row of rows) addInto(totals[code], row.currencies[code])
    totals[code] = roundBalance(totals[code])
  }
  return totals
}

/** Rows + totals of "Баланс клиентов" for one page (see ClientBalanceParams). */
export async function getClientBalanceList(params: ClientBalanceParams, db: PgDb = getDb()): Promise<BalanceListResult> {
  const types = params.groupBy === "type"
  const base: BalanceListParams = {
    ...params,
    // Applied below: type names may be "-" (no type), search runs over type names in type mode.
    clientTypes: undefined,
    search: types ? undefined : params.search,
    balanceType: "",
    groupBy: null,
    ordering: undefined,
    page: 1,
    pageSize: 0,
    totalsIgnoreSearch: false,
  }
  const list = await getBalanceList("client", base, db)
  const codes = list.currencies.map((currency) => currency.code)
  let rows = list.rows

  const wantedTypes = (params.clientTypes ?? []).map((value) => nameKey(placeName(value)))
  if (wantedTypes.length) rows = rows.filter((row) => wantedTypes.includes(nameKey(row.info.type)))
  const deliveryMan = nameKey(params.deliveryMan)
  if (deliveryMan) rows = rows.filter((row) => nameKey(row.info.deliverer) === deliveryMan)
  // Nothing about visits / refusals is stored: the last visit is unknown for everybody.
  if (params.lastVisit) rows = []
  if (!inRange(null, params.rejectDaysMin, params.rejectDaysMax) || !inRange(null, params.visitDaysMin, params.visitDaysMax)) rows = []

  if (params.onlyInvoicePayments && rows.length) {
    const earlier = params.from > EARLIEST_DAY ? (await getBalanceList("client", { ...base, from: EARLIEST_DAY, to: previousDay(params.from), search: undefined }, db)).rows : []
    rows = dropPayments(rows, new Map(earlier.map((row) => [row.key, row])))
  }
  rows = rows.filter((row) => matchesBalanceType(row, params.balanceType, params.balanceCurrency))

  if (types) {
    rows = rollupTypes(rows, codes)
    const query = nameKey(params.search)
    if (query) rows = rows.filter((row) => nameKey(row.name).includes(query))
  }

  const totals = sumRows(rows, codes)
  if (params.ordering?.length) sortBalanceRows(rows, params.ordering)
  else if (!types) rows = [...rows].sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
  const pageSize = Math.max(0, Math.floor(params.pageSize ?? 0))
  const page = Math.max(1, Math.floor(params.page ?? 1))

  return {
    ...list,
    visibleCurrencies: visibleCurrencyCodes(list.currencies, totals),
    count: rows.length,
    page,
    pageSize,
    rows: pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows,
    totals,
  }
}

const AGENT_POSITION = /агент|agent|торгов|представит/i
const DELIVERY_POSITION = /достав|курьер|экспедит|водит|deliver|eltuv|yetkaz|haydov/i
const COLLECTOR_POSITION = /инкас|collector|inkas/i

function uniqueNames(values: unknown[]): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const name = placeName(value)
    if (name && !seen.has(nameKey(name))) seen.set(nameKey(name), name)
  }
  return [...seen.values()]
}

function sorted(values: string[]): string[] {
  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })
  return [...values].sort(collator.compare)
}

/** Options of the filter popup (branches and organizations keep their table order first). */
export async function getClientBalanceOptions(db: PgDb = getDb()): Promise<ClientBalanceOptions> {
  const s = await ensureFinanceSchema(db)
  const column = async (sql: string, ok = true): Promise<string[]> =>
    ok ? ((await db.prepare(sql).all()) as Array<{ v: unknown }>).map((row) => String(row.v ?? "")) : []

  const [branchRows, clientBranches, organizationRows, paymentOrgs, entryOrgs, clientRows, typeRows, employees] = await Promise.all([
    column("SELECT name AS v FROM branches ORDER BY id", s.has("branches")),
    column("SELECT DISTINCT branch AS v FROM clients", s.col("clients", "branch")),
    column("SELECT name AS v FROM organizations ORDER BY id", s.has("organizations")),
    column("SELECT DISTINCT organization AS v FROM customer_payments", s.has("customer_payments")),
    column("SELECT DISTINCT organization AS v FROM cash_management_entries", s.col("cash_management_entries", "organization")),
    db.prepare("SELECT DISTINCT type, zone, agent, deliverer, collector FROM clients").all() as Promise<
      Array<{ type: string; zone: string; agent: string; deliverer: string; collector: string }>
    >,
    column("SELECT name AS v FROM client_types ORDER BY id", s.has("client_types")),
    db.prepare("SELECT first_name, last_name, position FROM employees WHERE active = 1").all() as Promise<Array<{ first_name: string; last_name: string; position: string }>>,
  ])
  const staff = (pattern: RegExp) =>
    employees.filter((row) => pattern.test(row.position ?? "")).map((row) => `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim())
  const field = (name: "type" | "zone" | "agent" | "deliverer" | "collector") => clientRows.map((row) => row[name])

  return {
    branches: uniqueNames([...branchRows, ...sorted(uniqueNames(clientBranches))]),
    organizations: uniqueNames([...organizationRows, ...sorted(uniqueNames([...paymentOrgs, ...entryOrgs]))]),
    zones: sorted(uniqueNames(field("zone"))),
    types: sorted(uniqueNames([...typeRows, ...field("type")])),
    untyped: clientRows.some((row) => placeName(row.type) === ""),
    agents: sorted(uniqueNames([...field("agent"), ...staff(AGENT_POSITION)])),
    deliverers: sorted(uniqueNames([...field("deliverer"), ...staff(DELIVERY_POSITION)])),
    collectors: sorted(uniqueNames([...field("collector"), ...staff(COLLECTOR_POSITION)])),
  }
}
