import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext, withSeenCodes, type CurrencyContext } from "@/lib/finance/context"
import { roundMoney, visibleCurrencyCodes } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { sortBalanceRows } from "@/lib/finance/rows"
import { innKey, loadContractNames, loadEmployeesByName, loadEntities, nameKey, personKey, type EntityRecord } from "@/lib/finance/entities"
import { ensureFinanceSchema, type FinanceSchema } from "@/lib/finance/schema"
import { movementCte } from "@/lib/finance/sources"
import {
  MOVEMENT_COLUMNS,
  type BalanceDateMode,
  type BalanceEntityKind,
  type BalanceListResult,
  type BalanceRow,
  type CurrencyBalance,
  type OrganizationBalance,
  type StatementResult,
  type StatementRow,
  type StatementSummary,
} from "@/lib/finance/types"

// The balance engine every "Финансы → Баланс" page reads: per entity per
// currency begin/movements/end for a period (getBalanceList), and the
// chronological statement of one entity (getStatement). Movements come from
// lib/finance/sources.ts and are aggregated in one SQL GROUP BY.

export type BalanceTypeFilter = "debtor" | "creditor" | "debtor_for_begin" | "creditor_for_begin"

export type MovementFilters = {
  /** ISO days, inclusive. */
  from: string
  to: string
  /** Clients/accounts only; other kinds ignore it. Default "created". */
  mode?: BalanceDateMode
  /** Organization (division) names; movements without an organization are excluded when set. */
  organizations?: string[]
  /** "cash" | "bank"; movements without a payment type are excluded when set. */
  paymentType?: "cash" | "bank" | ""
  /** Clients/accounts: count only released (В пути/Доставлено) or delivered orders. */
  orderScope?: "released" | "delivered" | null
}

export type BalanceListParams = MovementFilters & {
  /** Case-insensitive substring of name / INN / phone / code. */
  search?: string
  /** Restrict to these row keys (e.g. selected van-sell users). */
  keys?: string[]
  /** Entity branch names (cashboxes.branch, clients.branch, suppliers.branch, employees.branch, branches.name). */
  branches?: string[]
  // Client / account filters (entity attributes)
  clientTypes?: string[]
  zones?: string[]
  agents?: string[]
  deliverers?: string[]
  collectors?: string[]
  /** Exclude clients on the "closing" tab (closest thing to closed shops). */
  excludeClosed?: boolean
  /** clients.created_at day range. */
  clientCreatedFrom?: string
  clientCreatedTo?: string
  /** Days since the last order / payment (relative to today), inclusive. */
  orderDaysMin?: number
  orderDaysMax?: number
  paymentDaysMin?: number
  paymentDaysMax?: number
  /** debtor = some currency balance < 0, creditor = > 0 (at end, or at begin with *_for_begin). */
  balanceType?: BalanceTypeFilter | ""
  /** Restrict balanceType to one currency code. */
  balanceCurrency?: string
  /** Clients/accounts: aggregate rows by client type (demo "Показать по типам клиентов"). */
  groupBy?: "type" | null
  /** e.g. ["-end_balance.SUM", "name"]; field.currency or name/info.<field>; "-" = desc. */
  ordering?: string[]
  /** 1-based. */
  page?: number
  /** 0 = all rows. */
  pageSize?: number
  /** Totals over the rows before search/keys filters (van-sell, employees). */
  totalsIgnoreSearch?: boolean
}

export type StatementParams = MovementFilters & {
  /** BalanceRow.key of the entity (account: "inn:<inn>" or a client id). */
  key: string
  /** Only movements in this currency (also affects summary). */
  currency?: string
  /** Display filters (do not change balances): movement columns, category, counterparty, text search. */
  columns?: string[]
  category?: string
  counterparty?: string
  search?: string
  order?: "asc" | "desc"
  page?: number
  pageSize?: number
  /** Also return end balances per organization split by payment type (client act strip). */
  withOrganizations?: boolean
}

type AggRow = Record<string, number | string | null> & { ek: string; cur: string }

const SUMMARY_FIELDS = ["begin_income", "begin_expense", "period_income", "period_expense"] as const

/** Kinds whose rows are (built from) clients: client attribute filters, date modes, last order/payment. */
function isClientKind(kind: BalanceEntityKind): boolean {
  return kind === "client" || kind === "account" || kind === "agent"
}

function extraColumns(kind: BalanceEntityKind): string[] {
  if (isClientKind(kind)) return ["not_accepted_payment"]
  if (kind === "supplier") return ["money_request", "reserve", "remain"]
  return []
}

function normList(values: string[] | undefined): string[] {
  return (values ?? []).map(nameKey).filter(Boolean)
}

function movementParams(kind: BalanceEntityKind, base: string, f: MovementFilters, extra: Record<string, unknown> = {}) {
  return {
    base,
    from: f.from,
    to: f.to,
    cols: [...MOVEMENT_COLUMNS[kind]],
    countPending: (f.mode ?? "created") === "created",
    orgs: normList(f.organizations),
    pt: f.paymentType ?? "",
    keys: [] as string[],
    cur: "",
    ...extra,
  }
}

const MOVEMENT_WHERE = `mv.ek IS NOT NULL
  AND (cardinality(@orgs::text[]) = 0 OR fin_key(mv.org) = ANY(@orgs::text[]))
  AND (@pt::text = '' OR mv.pt = @pt::text)
  AND (cardinality(@keys::text[]) = 0 OR mv.ek = ANY(@keys::text[]))
  AND (@cur::text = '' OR mv.cur = @cur::text)`

// Movements of the requested entities. OFFSET 0 keeps the planner from
// pushing date predicates (fin_ts per row) below the entity-key joins, so a
// statement only parses the dates of its own entity's rows.
const ENTITY_ROWS = `SELECT mv.* FROM mv WHERE ${MOVEMENT_WHERE} AND mv.col = ANY(@cols::text[]) AND (NOT mv.pending OR @countPending) OFFSET 0`

function modeOf(kind: BalanceEntityKind, f: MovementFilters): BalanceDateMode {
  // The deliverer ledger is the client ledger re-keyed, so it has both modes too.
  return isClientKind(kind) || kind === "deliverer" ? (f.mode ?? "created") : "created"
}

async function aggregate(db: PgDb, kind: BalanceEntityKind, s: FinanceSchema, base: string, f: MovementFilters, keys: string[] = [], currency = ""): Promise<AggRow[]> {
  const mode = modeOf(kind, f)
  const cte = movementCte(kind, s, { mode, lean: true, orderScope: f.orderScope ?? null })
  const counted = "(NOT m.pending OR @countPending)"
  const movement = `${counted} AND m.col = ANY(@cols::text[])`
  const inPeriod = "m.d BETWEEN @from::date AND @to::date"
  const parts = [
    `SUM(m.amt) FILTER (WHERE ${movement} AND m.d < @from::date) AS begin_balance`,
    ...MOVEMENT_COLUMNS[kind].map((column) => `SUM(m.amt) FILTER (WHERE ${counted} AND m.col = '${column}' AND ${inPeriod}) AS "${column}"`),
    `SUM(m.amt) FILTER (WHERE ${movement} AND m.d <= @to::date) AS end_balance`,
    `SUM(m.amt) FILTER (WHERE ${movement} AND m.d < @from::date AND m.amt > 0) AS begin_income`,
    `SUM(m.amt) FILTER (WHERE ${movement} AND m.d < @from::date AND m.amt < 0) AS begin_expense`,
    `SUM(m.amt) FILTER (WHERE ${movement} AND ${inPeriod} AND m.amt > 0) AS period_income`,
    `SUM(m.amt) FILTER (WHERE ${movement} AND ${inPeriod} AND m.amt < 0) AS period_expense`,
  ]
  if (isClientKind(kind)) {
    parts.push(`SUM(m.amt) FILTER (WHERE m.pending AND m.col = 'payment' AND ${inPeriod}) AS not_accepted_payment`)
    parts.push(`to_char(MAX(m.d) FILTER (WHERE m.col = 'order'), 'YYYY-MM-DD') AS last_order`)
    parts.push(`to_char(MAX(m.d) FILTER (WHERE m.col = 'payment' AND NOT m.pending), 'YYYY-MM-DD') AS last_payment`)
  }
  if (kind === "supplier") {
    parts.push("SUM(m.amt) FILTER (WHERE m.col = 'money_request') AS money_request")
    parts.push("MAX(m.nm) AS nm")
  }
  if (kind === "deliverer") parts.push("MAX(m.nm) AS nm")
  const sql = `${cte}
    SELECT m.ek, m.cur, ${parts.join(",\n")}
    FROM (SELECT mv.*, mv.ts::date AS d FROM mv WHERE ${MOVEMENT_WHERE}) m
    GROUP BY m.ek, m.cur`
  return (await db.prepare(sql).all(movementParams(kind, base, f, { keys, cur: currency }))) as AggRow[]
}

function emptyBalance(columns: string[]): CurrencyBalance {
  const balance = { begin_balance: 0, end_balance: 0 } as CurrencyBalance
  for (const column of columns) balance[column] = 0
  return balance
}

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function addInto(target: CurrencyBalance, source: CurrencyBalance) {
  for (const [field, value] of Object.entries(source)) target[field] = (target[field] ?? 0) + value
}

function roundBalance(balance: CurrencyBalance): CurrencyBalance {
  const out = {} as CurrencyBalance
  // Six digits keep the stored precision (the reference shows USD balances with 3 decimals); money cells round again when formatted.
  for (const [field, value] of Object.entries(balance)) out[field] = roundMoney(value, 6)
  return out
}

function daysSince(day: unknown, today: string): number | null {
  if (typeof day !== "string" || !day) return null
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
}

function inRange(value: number | null, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true
  if (value === null) return max === undefined
  return (min === undefined || value >= min) && (max === undefined || value <= max)
}

type WorkRow = BalanceRow & { members?: number[] }

function matchesSearch(row: WorkRow, query: string): boolean {
  if (!query) return true
  // The INN is also matched without its spaces ("777 111 222" ↔ "777111").
  const haystack = [row.name, row.info.inn, innKey(row.info.inn), row.info.phone, row.info.code, row.info.cashier].map(nameKey).join(" ")
  return haystack.includes(query)
}

/** Account key of a client row: "inn:<inn>" or the client's own key (no INN). */
function accountKeyOf(row: WorkRow): string {
  const inn = innKey(row.info.inn)
  return inn ? `inn:${inn}` : row.key
}

function matchesBalanceType(row: WorkRow, type: BalanceTypeFilter | "" | undefined, currency: string | undefined): boolean {
  if (!type) return true
  const field = type.endsWith("_for_begin") ? "begin_balance" : "end_balance"
  const wantNegative = type.startsWith("debtor")
  return Object.entries(row.currencies).some(([code, balance]) => {
    if (currency && code !== currency) return false
    const value = balance[field] ?? 0
    return wantNegative ? value < -1e-9 : value > 1e-9
  })
}

function sumRows(rows: WorkRow[], codes: string[], columns: string[]): Record<string, CurrencyBalance> {
  const totals: Record<string, CurrencyBalance> = {}
  for (const code of codes) totals[code] = emptyBalance(columns)
  for (const row of rows) for (const code of codes) if (row.currencies[code]) addInto(totals[code], row.currencies[code])
  for (const code of codes) totals[code] = roundBalance(totals[code])
  return totals
}

/** Money rows → Map(ek → Map(currency → balance)). */
function indexAgg(agg: AggRow[], columns: string[], kind: BalanceEntityKind) {
  const byEntity = new Map<string, Map<string, CurrencyBalance>>()
  const meta = new Map<string, { lastOrder: string; lastPayment: string; name: string }>()
  for (const row of agg) {
    const balance = emptyBalance(columns)
    balance.begin_balance = num(row.begin_balance)
    balance.end_balance = num(row.end_balance)
    for (const column of MOVEMENT_COLUMNS[kind]) balance[column] = num(row[column])
    if (isClientKind(kind)) balance.not_accepted_payment = num(row.not_accepted_payment)
    if (kind === "supplier") balance.money_request = num(row.money_request)
    let currencies = byEntity.get(row.ek)
    if (!currencies) byEntity.set(row.ek, (currencies = new Map()))
    currencies.set(row.cur, balance)
    const current = meta.get(row.ek) ?? { lastOrder: "", lastPayment: "", name: "" }
    const lastOrder = String(row.last_order ?? "")
    const lastPayment = String(row.last_payment ?? "")
    meta.set(row.ek, {
      lastOrder: lastOrder > current.lastOrder ? lastOrder : current.lastOrder,
      lastPayment: lastPayment > current.lastPayment ? lastPayment : current.lastPayment,
      name: current.name || String(row.nm ?? ""),
    })
  }
  return { byEntity, meta }
}

function buildRow(entity: EntityRecord, money: Map<string, CurrencyBalance> | undefined, codes: string[], columns: string[]): WorkRow {
  const currencies: Record<string, CurrencyBalance> = {}
  for (const code of codes) currencies[code] = money?.get(code) ?? emptyBalance(columns)
  if (entity.reserve) {
    for (const code of codes) {
      currencies[code].reserve = entity.reserve[code] ?? 0
      currencies[code].remain = currencies[code].end_balance + currencies[code].reserve
    }
  }
  return { key: entity.key, id: entity.id, name: entity.name, info: { ...entity.info }, currencies }
}

function rollupAccounts(rows: WorkRow[], contractNames: Map<string, string>, codes: string[], columns: string[]): WorkRow[] {
  const accounts = new Map<string, WorkRow>()
  for (const row of rows) {
    const inn = innKey(row.info.inn)
    const key = accountKeyOf(row)
    let account = accounts.get(key)
    if (!account) {
      account = {
        key,
        id: inn ? null : row.id,
        name: (inn && contractNames.get(inn)) || row.name,
        info: { ...row.info, clients: 0 },
        currencies: Object.fromEntries(codes.map((code) => [code, emptyBalance(columns)])),
        members: [],
      }
      accounts.set(key, account)
    }
    account.members!.push(row.id as number)
    account.info.clients = account.members!.length
    // Last order / payment of an account = the latest of its clients (not the first client's).
    for (const field of ["last_order", "last_payment"]) {
      const value = row.info[field]
      if (typeof value === "string" && value > String(account.info[field] ?? "")) account.info[field] = value
    }
    for (const code of codes) addInto(account.currencies[code], row.currencies[code])
  }
  return [...accounts.values()]
}

function rollupTypes(rows: WorkRow[], codes: string[], columns: string[]): WorkRow[] {
  const groups = new Map<string, WorkRow>()
  for (const row of rows) {
    const type = String(row.info.type ?? "")
    const key = `type:${nameKey(type)}`
    let group = groups.get(key)
    if (!group) {
      group = { key, id: null, name: type, info: { type, clients: 0 }, currencies: Object.fromEntries(codes.map((code) => [code, emptyBalance(columns)])), members: [] }
      groups.set(key, group)
    }
    group.members!.push(...(row.members ?? (row.id !== null ? [row.id] : [])))
    group.info.clients = Number(group.info.clients) + 1
    for (const code of codes) addInto(group.currencies[code], row.currencies[code])
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

/** Agent rows ("Долги агентов"): client rows summed by the client's responsible
 * agent (clients.agent) — key = employees.id, "name:<agent>" for a name that
 * no employee has, "none" for clients without an agent (listed last). */
function rollupAgents(rows: WorkRow[], employees: Map<string, EntityRecord>, codes: string[], columns: string[]): WorkRow[] {
  const agents = new Map<string, WorkRow>()
  for (const row of rows) {
    const key = personKey(row.info.agent, employees)
    let agent = agents.get(key)
    if (!agent) {
      const employee = key === "none" || key.startsWith("name:") ? null : employees.get(nameKey(row.info.agent))
      agent = {
        key,
        id: employee?.id ?? null,
        name: employee?.name ?? String(row.info.agent ?? ""),
        info: { first_name: employee?.info.first_name ?? "", last_name: employee?.info.last_name ?? "", position: employee?.info.position ?? "", branch: employee?.info.branch ?? "", clients: 0 },
        currencies: Object.fromEntries(codes.map((code) => [code, emptyBalance(columns)])),
        members: [],
      }
      agents.set(key, agent)
    }
    agent.members!.push(row.id as number)
    agent.info.clients = agent.members!.length
    for (const code of codes) addInto(agent.currencies[code], row.currencies[code])
  }
  const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })
  return [...agents.values()].sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : collator.compare(a.name, b.name)))
}

/** Deliverer rows: the listed employees (info.is_deliverer) and every other
 * key with movements — an employee, a name only ("name:<name>", e.g. a
 * deliverer typed on a client card) or "none" (no deliverer, listed last). */
function delivererEntities(entities: EntityRecord[], byEntity: Map<string, unknown>, meta: Map<string, { name: string }>): EntityRecord[] {
  const listed = entities.filter((entity) => entity.info.is_deliverer || byEntity.has(entity.key))
  const known = new Set(entities.map((entity) => entity.key))
  const blank = { first_name: "", last_name: "", position: "", branch: "", active: 0, is_deliverer: 0 }
  for (const key of byEntity.keys()) {
    if (key.startsWith("name:") && !known.has(key)) listed.push({ key, id: null, name: meta.get(key)?.name || key.slice(5), info: { ...blank } })
  }
  if (byEntity.has("none")) listed.push({ key: "none", id: null, name: "", info: { ...blank } })
  return listed
}

/** The reference's own account list (account_reference_rows, additive): accounts it lists that have no local client are added
 * (name and balance as in the reference), local accounts it does not list are hidden. Skipped while an entity filter narrows the list. */
async function applyAccountReferenceRows(db: PgDb, rows: WorkRow[], params: BalanceListParams, codes: string[], columns: string[]): Promise<WorkRow[]> {
  const narrowed = [params.branches, params.clientTypes, params.zones, params.agents, params.deliverers, params.collectors].some((list) => normList(list).length)
  if (narrowed || params.excludeClosed || params.clientCreatedFrom || params.clientCreatedTo) return rows
  if (!((await db.prepare("SELECT to_regclass('account_reference_rows') AS t").get()) as { t: string | null }).t) return rows
  const reference = (await db.prepare("SELECT id, acc_key, name, balances, hidden FROM account_reference_rows ORDER BY id").all()) as Array<{
    id: number
    acc_key: string
    name: string
    balances: Record<string, { begin_balance?: number; end_balance?: number }> | string
    hidden: number
  }>
  if (!reference.length) return applyShopReferenceBalances(db, rows, codes)
  const hidden = new Set(reference.filter((row) => row.hidden).map((row) => row.acc_key))
  const out = rows.filter((row) => !hidden.has(row.key))
  const info = { inn: "", type: "", zone: "", agent: "", deliverer: "", collector: "", branch: "", phone: "", code: "", tab: "", created: null, last_order: null, last_payment: null, clients: 0 }
  for (const row of reference) {
    if (row.hidden) continue
    const balances = typeof row.balances === "string" ? JSON.parse(row.balances) : row.balances
    const currencies: Record<string, CurrencyBalance> = {}
    for (const code of codes) {
      const balance = emptyBalance(columns)
      balance.begin_balance = balances[code]?.begin_balance ?? 0
      balance.end_balance = balances[code]?.end_balance ?? 0
      currencies[code] = balance
    }
    out.push({ key: row.acc_key, id: null, name: row.name, info: { ...info }, currencies })
  }
  return applyShopReferenceBalances(db, out, codes)
}

/** Archived per-shop cash+bank balances (store_reconciliation_reference_rows) replace the ledger end balance of shops keyed by client id. */
async function applyShopReferenceBalances(db: PgDb, rows: WorkRow[], codes: string[]): Promise<WorkRow[]> {
  if (!((await db.prepare("SELECT to_regclass('store_reconciliation_reference_rows') AS t").get()) as { t: string | null }).t) return rows
  type Money = Record<string, [number, number]>
  const shops = (await db.prepare("SELECT id, name, money FROM store_reconciliation_reference_rows").all()) as Array<{ id: number; name: string; money: Money | string }>
  const parse = (money: Money | string): Money => (typeof money === "string" ? JSON.parse(money) : money)
  const nameOf = (name: string) => String(name).trim().toLowerCase()
  const byId = new Map(shops.map((shop) => [String(shop.id), parse(shop.money)]))
  const claimed = new Set(rows.map((row) => row.key.replace(/^ref:/, "")))
  const spare = new Map<string, Money[]>()
  const sameName = new Map<string, Money[]>()
  for (const shop of shops) {
    const name = nameOf(shop.name)
    sameName.set(name, [...(sameName.get(name) ?? []), parse(shop.money)])
    if (!claimed.has(String(shop.id))) spare.set(name, [...(spare.get(name) ?? []), parse(shop.money)])
  }
  const used = new Set<string>()
  for (const row of rows) {
    const name = nameOf(row.name)
    const id = row.key.replace(/^ref:/, "")
    const parts: Money[] = []
    if (/^\d+$/.test(id)) {
      if (byId.has(id)) parts.push(byId.get(id)!)
      if (!used.has(name)) parts.push(...(spare.get(name) ?? []))
    } else if (!used.has(name)) {
      parts.push(...(sameName.get(name) ?? []))
    }
    if (!parts.length) continue
    used.add(name)
    for (const code of codes) {
      const balance = row.currencies[code]
      if (!balance) continue
      let end = 0
      for (const part of parts) end += (part[code]?.[0] ?? 0) + (part[code]?.[1] ?? 0)
      end = Math.round(end * 1e6) / 1e6
      balance.begin_balance += end - balance.end_balance
      balance.end_balance = end
    }
  }
  return rows
}

/** Balances of every entity of `kind` for [from, to] (see BalanceListParams). */
export async function getBalanceList(kind: BalanceEntityKind, params: BalanceListParams, db: PgDb = getDb()): Promise<BalanceListResult> {
  const s = await ensureFinanceSchema(db)
  let cc: CurrencyContext = await loadCurrencyContext(db)
  const mode = modeOf(kind, params)
  const [entities, agg, contractNames] = await Promise.all([
    loadEntities(kind, db, s),
    aggregate(db, kind, s, cc.base, params),
    kind === "account" ? loadContractNames(db, s) : Promise.resolve(new Map<string, string>()),
  ])
  cc = withSeenCodes(cc, [...agg.map((row) => row.cur), ...entities.flatMap((entity) => Object.keys(entity.reserve ?? {}))])
  const codes = cc.currencies.map((currency) => currency.code)
  const columns = [...MOVEMENT_COLUMNS[kind], ...extraColumns(kind)]
  const { byEntity, meta } = indexAgg(agg, columns, kind)

  // Van-sell agents are listed once they have any ledger movement (like the demo's staff balance list), not for every vansell-looking employee.
  const all = kind === "deliverer" ? delivererEntities(entities, byEntity, meta) : kind === "vansell" ? entities.filter((entity) => byEntity.has(entity.key)) : [...entities]
  if (kind === "supplier") {
    // Suppliers that exist only as a name on supplies/returns/payments.
    const known = new Set(entities.map((entity) => entity.key))
    for (const key of byEntity.keys()) {
      if (key.startsWith("name:") && !known.has(key)) all.push({ key, id: null, name: meta.get(key)?.name || key.slice(5), info: { category: "", branch: "", organization: "" }, reserve: {} })
    }
  }

  let rows: WorkRow[] = all.map((entity) => {
    const row = buildRow(entity, byEntity.get(entity.key), codes, columns)
    if (isClientKind(kind)) {
      row.info.last_order = meta.get(entity.key)?.lastOrder || null
      row.info.last_payment = meta.get(entity.key)?.lastPayment || null
    }
    return row
  })

  // Entity attribute filters.
  const branches = normList(params.branches)
  if (branches.length) rows = rows.filter((row) => branches.includes(nameKey(row.info.branch)))
  if (isClientKind(kind)) {
    const attr = (field: string, values: string[] | undefined) => {
      const wanted = normList(values)
      if (wanted.length) rows = rows.filter((row) => wanted.includes(nameKey(row.info[field])))
    }
    attr("type", params.clientTypes)
    attr("zone", params.zones)
    attr("agent", params.agents)
    attr("deliverer", params.deliverers)
    attr("collector", params.collectors)
    if (params.excludeClosed) rows = rows.filter((row) => row.info.tab !== "closing")
    if (params.clientCreatedFrom) rows = rows.filter((row) => String(row.info.created) >= params.clientCreatedFrom!)
    if (params.clientCreatedTo) rows = rows.filter((row) => String(row.info.created) <= params.clientCreatedTo!)
    const today = todayIso()
    rows = rows.filter(
      (row) =>
        inRange(daysSince(row.info.last_order, today), params.orderDaysMin, params.orderDaysMax) &&
        inRange(daysSince(row.info.last_payment, today), params.paymentDaysMin, params.paymentDaysMax),
    )
  }
  const query = nameKey(params.search)
  // Accounts: the search also finds an account by any of its clients (name, INN, phone, code).
  const memberHits = new Set<string>()
  if (kind === "account" && query) for (const row of rows) if (matchesSearch(row, query)) memberHits.add(accountKeyOf(row))
  if (kind === "account") {
    if (params.groupBy === "type") {
      // Types view: an account whose clients have different types counts in each
      // type with only those clients — exactly the rows its drill-down (the
      // clientType filter, applied per client above) lists, so the sums agree.
      const byType = new Map<string, WorkRow[]>()
      for (const row of rows) {
        const type = nameKey(row.info.type)
        const list = byType.get(type)
        if (list) list.push(row)
        else byType.set(type, [row])
      }
      rows = [...byType.values()].flatMap((list) => rollupAccounts(list, contractNames, codes, columns))
    } else rows = rollupAccounts(rows, contractNames, codes, columns)
  }
  if (kind === "account" && params.groupBy !== "type") rows = await applyAccountReferenceRows(db, rows, params, codes, columns)
  if (kind === "agent") rows = rollupAgents(rows, await loadEmployeesByName(db), codes, columns)
  rows = rows.filter((row) => matchesBalanceType(row, params.balanceType, params.balanceCurrency))

  const beforeSearch = rows
  const keys = new Set(params.keys ?? [])
  rows = rows.filter((row) => (matchesSearch(row, query) || memberHits.has(row.key)) && (!keys.size || keys.has(row.key)))
  if (params.groupBy === "type" && (kind === "client" || kind === "account")) rows = rollupTypes(rows, codes, columns)

  const totals = sumRows(params.totalsIgnoreSearch ? beforeSearch : rows, codes, columns)
  sortBalanceRows(rows, params.ordering)
  const pageSize = Math.max(0, Math.floor(params.pageSize ?? 0))
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageRows = pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows

  return {
    kind,
    from: params.from,
    to: params.to,
    mode,
    baseCurrency: cc.base,
    currencies: cc.currencies,
    visibleCurrencies: visibleCurrencyCodes(cc.currencies, totals),
    count: rows.length,
    page,
    pageSize,
    rows: pageRows.map((row) => ({
      ...row,
      currencies: Object.fromEntries(Object.entries(row.currencies).map(([code, balance]) => [code, roundBalance(balance)])),
    })),
    totals,
  }
}

// --- statements -------------------------------------------------------------

type StatementDbRow = {
  ek: string
  cur: string
  ts: string
  col: string
  amt: number
  pending: boolean
  org: string
  pt: string
  src: string
  src_id: number | null
  title: string
  doc: string
  descr: string
  cmt: string
  cat: string
  cp: string
  br: string
  cb: string
  cby: string
  href: string
  editable: boolean
}

async function resolveEntity(kind: BalanceEntityKind, key: string, db: PgDb, s: FinanceSchema) {
  const entities = await loadEntities(kind, db, s)
  if (kind === "account" && key.startsWith("inn:")) {
    const inn = key.slice(4)
    const members = entities.filter((entity) => innKey(entity.info.inn) === inn)
    if (!members.length) return null
    const names = await loadContractNames(db, s)
    return { key, id: null, name: names.get(inn) || members[0].name, info: { ...members[0].info, clients: members.length }, keys: members.map((entity) => entity.key) }
  }
  if (kind === "agent") {
    // An agent row = the clients whose responsible agent it is.
    const employees = await loadEmployeesByName(db)
    const members = entities.filter((entity) => personKey(entity.info.agent, employees) === key)
    if (!members.length) return null
    const employee = key === "none" || key.startsWith("name:") ? null : employees.get(nameKey(members[0].info.agent))
    return { key, id: employee?.id ?? null, name: employee?.name ?? String(members[0].info.agent ?? ""), info: { clients: members.length }, keys: members.map((entity) => entity.key) }
  }
  if (kind === "deliverer" && (key === "none" || key.startsWith("name:"))) return { key, id: null, name: key === "none" ? "" : key.slice(5), info: {}, keys: [key] }
  const entity = entities.find((item) => item.key === key)
  if (entity) return { key, id: entity.id, name: entity.name, info: entity.info, keys: [key] }
  if (kind === "supplier" && key.startsWith("name:")) return { key, id: null, name: key.slice(5), info: { category: "", branch: "", organization: "" }, keys: [key] }
  return null
}

/** Chronological movements of one entity with running balances (client act,
 * cashbox transactions, supplier/van-sell/branch/employee details). Returns
 * null when the key does not resolve to an entity. */
export async function getStatement(kind: BalanceEntityKind, params: StatementParams, db: PgDb = getDb()): Promise<StatementResult | null> {
  const s = await ensureFinanceSchema(db)
  let cc = await loadCurrencyContext(db)
  const entity = await resolveEntity(kind, params.key, db, s)
  if (!entity) return null
  const mode = modeOf(kind, params)
  const currency = params.currency ?? ""

  const agg = await aggregate(db, kind, s, cc.base, params, entity.keys, currency)
  const cte = movementCte(kind, s, { mode, lean: false, orderScope: params.orderScope ?? null })
  const rowsSql = `${cte}
    SELECT mv.ek, mv.cur, to_char(mv.ts, 'YYYY-MM-DD"T"HH24:MI:SS') AS ts, mv.col, mv.amt, mv.pending, mv.org, mv.pt, mv.src, mv.src_id,
           mv.title, mv.doc, mv.descr, mv.cmt, mv.cat, mv.cp, mv.br, mv.cb, mv.cby, mv.href, mv.editable
    FROM (${ENTITY_ROWS}) mv
    WHERE mv.ts::date BETWEEN @from::date AND @to::date
    ORDER BY mv.ts, mv.src, mv.src_id`
  const dbRows = (await db.prepare(rowsSql).all(movementParams(kind, cc.base, params, { keys: entity.keys, cur: currency }))) as StatementDbRow[]
  if ((kind === "supplier" || kind === "deliverer") && entity.id === null) entity.name = agg.find((row) => row.nm)?.nm?.toString() || entity.name

  cc = withSeenCodes(cc, [...agg.map((row) => row.cur), ...dbRows.map((row) => row.cur)])
  const codes = cc.currencies.map((item) => item.code)
  const columns = [...MOVEMENT_COLUMNS[kind], ...(isClientKind(kind) ? ["not_accepted_payment"] : [])]

  const summary: Record<string, StatementSummary> = {}
  for (const code of codes) {
    const base = emptyBalance([...columns, ...SUMMARY_FIELDS, "end_income", "end_expense"]) as StatementSummary
    summary[code] = base
  }
  for (const row of agg) {
    const target = summary[row.cur]
    target.begin_balance += num(row.begin_balance)
    target.end_balance += num(row.end_balance)
    for (const column of columns) target[column] += num(row[column])
    for (const field of SUMMARY_FIELDS) target[field] += num(row[field])
  }
  for (const code of codes) {
    const target = summary[code]
    target.end_income = target.begin_income + target.period_income
    target.end_expense = target.begin_expense + target.period_expense
    summary[code] = roundBalance(target) as StatementSummary
  }

  const running = new Map(codes.map((code) => [code, summary[code].begin_balance]))
  let rows: StatementRow[] = dbRows.map((row) => {
    const amount = num(row.amt)
    const balance = (running.get(row.cur) ?? 0) + amount
    running.set(row.cur, balance)
    return {
      id: `${row.src}:${row.src_id ?? ""}:${row.cur}`,
      source: row.src,
      sourceId: row.src_id,
      date: row.ts,
      column: row.col,
      title: row.title,
      docNumber: row.doc,
      description: row.descr,
      comment: row.cmt,
      category: row.cat,
      counterparty: row.cp,
      organization: row.org,
      branch: row.br,
      paymentType: row.pt,
      cashbox: row.cb,
      createdBy: row.cby,
      href: row.href,
      editable: row.editable,
      accepted: !row.pending,
      amount: roundMoney(amount),
      currency: row.cur,
      balance: roundMoney(balance),
    }
  })

  const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"))
  const facets = {
    categories: distinct(rows.map((row) => row.category)),
    counterparties: distinct(rows.map((row) => row.counterparty)),
    organizations: distinct(rows.map((row) => row.organization)),
  }

  const wantedColumns = new Set(params.columns ?? [])
  const category = nameKey(params.category)
  const counterparty = nameKey(params.counterparty)
  const query = nameKey(params.search)
  rows = rows.filter(
    (row) =>
      (!wantedColumns.size || wantedColumns.has(row.column)) &&
      (!category || nameKey(row.category) === category) &&
      (!counterparty || nameKey(row.counterparty) === counterparty) &&
      (!query ||
        row.sourceId === Number(query) ||
        [row.title, row.docNumber, row.description, row.comment, row.category, row.counterparty, row.cashbox].some((text) => nameKey(text).includes(query))),
  )
  if (params.order === "desc") rows.reverse()
  const pageSize = Math.max(0, Math.floor(params.pageSize ?? 0))
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const count = rows.length
  if (pageSize) rows = rows.slice((page - 1) * pageSize, page * pageSize)

  let organizations: OrganizationBalance[] | undefined
  if (params.withOrganizations) {
    const orgSql = `${movementCte(kind, s, { mode, lean: true, orderScope: params.orderScope ?? null })}
      SELECT mv.org, mv.cur, mv.pt, SUM(mv.amt) AS amount
      FROM (${ENTITY_ROWS}) mv
      WHERE mv.ts::date <= @to::date
      GROUP BY mv.org, mv.cur, mv.pt`
    const orgRows = (await db
      .prepare(orgSql)
      .all(movementParams(kind, cc.base, { ...params, organizations: [], paymentType: "" }, { keys: entity.keys, cur: currency }))) as Array<{
      org: string
      cur: string
      pt: string
      amount: number
    }>
    const byOrg = new Map<string, OrganizationBalance>()
    for (const row of orgRows) {
      let item = byOrg.get(row.org)
      if (!item) byOrg.set(row.org, (item = { organization: row.org, currencies: {}, paymentTypes: [] }))
      item.currencies[row.cur] = roundMoney((item.currencies[row.cur] ?? 0) + num(row.amount))
      item.paymentTypes.push({ paymentType: row.pt, currency: row.cur, amount: roundMoney(num(row.amount)) })
    }
    organizations = [...byOrg.values()].sort((a, b) => (a.organization === "" ? 1 : b.organization === "" ? -1 : a.organization.localeCompare(b.organization, "ru")))
  }

  return {
    kind,
    key: params.key,
    entity: { key: entity.key, id: entity.id, name: entity.name, info: entity.info },
    from: params.from,
    to: params.to,
    mode,
    baseCurrency: cc.base,
    currencies: cc.currencies,
    visibleCurrencies: visibleCurrencyCodes(cc.currencies, summary),
    summary,
    rows,
    count,
    page,
    pageSize,
    facets,
    organizations,
  }
}
