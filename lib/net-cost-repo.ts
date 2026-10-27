import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { currencyLabel } from "@/lib/finance/currency"
import { ensureNetCostSchema } from "@/lib/net-cost-schema"
import { loadLedgerInputs, runLedgers, syncNetCost } from "@/lib/net-cost-sync"
import {
  NET_COST_CHECKS,
  type NetCostActionInput,
  type NetCostActionKind,
  type NetCostActionResult,
  type NetCostCheckKey,
  type NetCostDetail,
  type NetCostDocument,
  type NetCostListResult,
  type NetCostOptions,
  type NetCostRecord,
  type NetCostSource,
  type NetCostTotalRow,
  type NetCostTotals,
} from "@/lib/net-cost-types"
import { getStockCatalog } from "@/lib/stock/ledger"

// Reads of "Себестоимость" (list, header totals, detail, options) and the four
// maintenance actions. Every read first brings the cached records in step with the
// documents (lib/net-cost-sync.ts: a no-op while the sources are unchanged).
//
// The actions in our app (the demo's backend rewrites the costs stored on its documents;
// ours never stores costs on documents, every reader values them through the ledger):
//   Проверить            rebuild everything now, run the checks, stamp every record's
//                        "Последнее время проверки".
//   Перерасчет           rebuild now and stamp the chosen records: only the incorrect
//                        ones, or the ones of the period / product / warehouse.
//   Пересчитать          the same for a period (after an Excel import, demo
//                        recalc_excel_period).
//   Перезаписать         rebuild now and re-bind the period's documents to the cost in
//                        effect on their day (the documents list of each record is the
//                        ledger's binding), stamping the period's records.
//   Сгенерировать заново delete the period's cached records and create them again from the
//                        documents (new numbers); manual entries are source data and stay.

export type NetCostListQuery = {
  search: string
  products: string[]
  /** Warehouse names; "" = "Общий". */
  stocks: string[]
  isCorrect: "" | "true" | "false"
  beginDate: string
  endDate: string
  faults: NetCostCheckKey[]
  ordering: string
  page: number
  /** 0 = everything (Excel). */
  pageSize: number
}

type RecordRow = {
  id: number
  nk: string
  item_key: string
  item_label: string
  scope: string
  scope_name: string
  place: string
  day: string
  at: string
  source_type: string
  source_id: number
  entry_id: number | null
  qty: number
  real_cost: number
  cost: number
  prev_cost: number | null
  balance: number
  balance_after: number
  revaluation: number | null
  total_revaluation: number | null
  balance_ok: number
  negative_ok: number
  timelapse_ok: number
  next_day: string | null
  negatives: string
  last_check_time: string
}

/** The moment a record took effect on its day: its registered moment when that is on its day,
 * else the start of the day ('': a back-dated manual entry or document counts from 00:00 —
 * lib/net-cost-ledger.ts). The list orders by it (and the item's ledger order `seq`). */
const EFFECTIVE_AT = "(CASE WHEN substr(at,1,10) = day THEN at ELSE '' END)"

const ORDERINGS: Record<string, string> = {
  product__name: "item_label",
  stock: "scope_name",
  created_date: `day, ${EFFECTIVE_AT}, seq`,
  cost: "cost",
  real_cost: "real_cost",
  id: "id",
}

/** Binds named parameters only when the SQL uses some (the db shim would bind a lone object otherwise). */
function stmt(db: PgDb, sql: string, params: Record<string, unknown>) {
  const prepared = db.prepare(sql)
  const args = /@[A-Za-z_]\w*/.test(sql) ? [params] : []
  return { get: () => prepared.get(...args), all: () => prepared.all(...args), run: () => prepared.run(...args) }
}

function displayDate(day: string, at: string): string {
  return at && at.slice(0, 10) === day ? at.slice(0, 16) : day
}

function toRecord(row: RecordRow): NetCostRecord {
  const flags: Record<NetCostCheckKey, boolean> = {
    is_balance_correct: Number(row.balance_ok) === 1,
    is_negative_balance_correct: Number(row.negative_ok) === 1,
    is_timelapse_correct: Number(row.timelapse_ok) === 1,
  }
  const checkData = NET_COST_CHECKS.map((check) => ({ key: check.key, name: check.name, isCorrect: flags[check.key] }))
  const num = (value: number | null) => (value === null || value === undefined ? null : Number(value))
  return {
    id: Number(row.id),
    itemKey: row.item_key,
    itemName: row.item_label,
    stock: row.scope ? row.scope_name : "",
    warehouse: row.place,
    date: displayDate(row.day, row.at),
    sourceType: row.source_type as NetCostSource,
    sourceId: Number(row.source_id),
    qty: Number(row.qty),
    realCost: Number(row.real_cost),
    cost: Number(row.cost),
    prevCost: num(row.prev_cost),
    balance: Number(row.balance),
    revaluation: num(row.revaluation),
    totalRevaluation: num(row.total_revaluation),
    isCorrect: checkData.every((check) => check.isCorrect),
    checkData,
    lastCheckTime: row.last_check_time,
    isManual: row.source_type === "manual",
    entryId: row.entry_id === null ? null : Number(row.entry_id),
  }
}

async function baseCurrency(db: PgDb): Promise<string> {
  return currencyLabel((await loadCurrencyContext(db)).base)
}

/** Brings the cache in step with the documents (call before reading it). */
export async function ensureNetCostFresh(): Promise<void> {
  await syncNetCost()
}

function listWhere(query: Partial<NetCostListQuery>): { where: string; params: Record<string, unknown> } {
  const parts: string[] = []
  const params: Record<string, unknown> = {}
  const search = (query.search ?? "").trim()
  if (search) {
    parts.push("(item_label ILIKE @q OR id::text = @qs OR source_id::text = @qs)")
    params.q = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    params.qs = search.replace(/^№/, "").trim()
  }
  if (query.products?.length) {
    parts.push("item_key = ANY(@products::text[])")
    params.products = query.products
  }
  if (query.stocks?.length) {
    const common = query.stocks.includes("")
    const names = query.stocks.filter(Boolean)
    const options: string[] = []
    if (common) options.push("scope = ''")
    if (names.length) {
      options.push("scope = ANY(SELECT fin_key(x) FROM unnest(@stocks::text[]) AS x) OR fin_key(place) = ANY(SELECT fin_key(x) FROM unnest(@stocks::text[]) AS x)")
      params.stocks = names
    }
    parts.push(`(${options.join(" OR ")})`)
  }
  const allOk = "(balance_ok = 1 AND negative_ok = 1 AND timelapse_ok = 1)"
  if (query.isCorrect === "true") parts.push(allOk)
  if (query.isCorrect === "false") parts.push(`NOT ${allOk}`)
  if (query.faults?.length) {
    const column: Record<NetCostCheckKey, string> = { is_balance_correct: "balance_ok", is_negative_balance_correct: "negative_ok", is_timelapse_correct: "timelapse_ok" }
    parts.push(`(${query.faults.map((key) => `${column[key]} = 0`).join(" OR ")})`)
  }
  if (query.beginDate) {
    parts.push("day >= @begin")
    params.begin = query.beginDate
  }
  if (query.endDate) {
    parts.push("day <= @end")
    params.end = query.endDate
  }
  return { where: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params }
}

export async function listNetCost(query: NetCostListQuery): Promise<NetCostListResult> {
  await ensureNetCostFresh()
  const db = getDb()
  const { where, params } = listWhere(query)
  const key = query.ordering.replace(/^-/, "")
  const direction = query.ordering.startsWith("-") ? "DESC" : "ASC"
  const order = ORDERINGS[key]
    ? `${ORDERINGS[key]
        .split(", ")
        .map((column) => `${column} ${direction}`)
        .join(", ")}, id ${direction}`
    : `day DESC, ${EFFECTIVE_AT} DESC, seq DESC, id DESC`
  const total = (await stmt(db, `SELECT COUNT(*)::int AS n FROM net_cost_records ${where}`, params).get()) as { n: number } | undefined
  const count = Number(total?.n ?? 0)
  const pageSize = Math.max(0, Math.floor(query.pageSize))
  const page = pageSize ? Math.min(Math.max(1, query.page), Math.max(1, Math.ceil(count / pageSize))) : 1
  const limit = pageSize ? `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : ""
  const rows = (await stmt(db, `SELECT * FROM net_cost_records ${where} ORDER BY ${order} ${limit}`, params).all()) as RecordRow[]
  return { count, page, pageSize, results: rows.map(toRecord), currency: await baseCurrency(db) }
}

export async function getNetCostTotals(): Promise<NetCostTotals> {
  await ensureNetCostFresh()
  const db = getDb()
  const state = (await db.prepare("SELECT totals, built_at FROM net_cost_state WHERE id = 1").get()) as { totals: string; built_at: string } | undefined
  let rows: NetCostTotalRow[] = []
  try {
    rows = JSON.parse(state?.totals || "[]") as NetCostTotalRow[]
  } catch {
    rows = []
  }
  return { currency: await baseCurrency(db), rows, builtAt: state?.built_at ?? "" }
}

export async function getNetCostRecordRow(db: PgDb, id: number): Promise<RecordRow | null> {
  return ((await db.prepare("SELECT * FROM net_cost_records WHERE id = @id").get({ id })) as RecordRow | undefined) ?? null
}

export async function getNetCostRecord(id: number): Promise<NetCostRecord | null> {
  await ensureNetCostFresh()
  const row = await getNetCostRecordRow(getDb(), id)
  return row ? toRecord(row) : null
}

/** The record with its documents (the item's ledger is run again to bind them). */
export async function getNetCostDetail(id: number): Promise<NetCostDetail | null> {
  await ensureNetCostFresh()
  const db = getDb()
  const row = await getNetCostRecordRow(db, id)
  if (!row) return null
  const inputs = await loadLedgerInputs(db, row.item_key)
  const record = runLedgers(inputs, { collectDocs: true, only: row.item_key })
    .get(row.item_key)
    ?.records.find((entry) => entry.nk === row.nk)
  let negatives: NetCostDocument[] = []
  try {
    negatives = JSON.parse(row.negatives || "[]") as NetCostDocument[]
  } catch {
    negatives = []
  }
  let comment = ""
  if (row.entry_id) {
    const entry = (await db.prepare("SELECT comment FROM net_cost_entries WHERE id = @id").get({ id: row.entry_id })) as { comment: string } | undefined
    comment = entry?.comment ?? ""
  }
  return { ...toRecord(row), balanceAfter: Number(row.balance_after), nextDate: row.next_day, comment, documents: record?.docs ?? [], negativeTransactions: negatives }
}

export async function getNetCostOptions(): Promise<NetCostOptions> {
  await ensureNetCostSchema()
  const db = getDb()
  const catalog = await getStockCatalog(db)
  const warehouses = (await db
    .prepare("SELECT DISTINCT ON (fin_key(name)) name FROM warehouses WHERE fin_key(name) <> '' ORDER BY fin_key(name), id")
    .all()
    .catch(() => [])) as Array<{ name: string }>
  return {
    items: catalog.map((item) => ({ key: item.key, name: item.name, kind: item.kind })),
    warehouses: warehouses.map((row) => row.name).sort((a, b) => a.localeCompare(b, "ru")),
    currency: await baseCurrency(db),
    faultTypes: NET_COST_CHECKS.map((check) => ({ key: check.key, name: check.name })),
  }
}

// --- actions ---------------------------------------------------------------------------------

function actionWhere(input: NetCostActionInput, withChecks: boolean): { where: string; params: Record<string, unknown> } {
  const parts: string[] = []
  const params: Record<string, unknown> = {}
  if (withChecks && input.onlyWrong) parts.push("NOT (balance_ok = 1 AND negative_ok = 1 AND timelapse_ok = 1)")
  if (!input.onlyWrong || !withChecks) {
    if (input.beginDate) {
      parts.push("day >= @begin")
      params.begin = input.beginDate
    }
    if (input.endDate) {
      parts.push("day <= @end")
      params.end = input.endDate
    }
    if (input.product) {
      parts.push("item_key = @product")
      params.product = input.product
    }
    if (input.stockType === "common") parts.push("scope = ''")
    if (input.stockType === "own") {
      if (input.stock) {
        parts.push("(scope = fin_key(@stock) OR fin_key(place) = fin_key(@stock))")
        params.stock = input.stock
      } else parts.push("scope <> ''")
    }
  }
  return { where: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params }
}

async function countWhere(db: PgDb, where: string, params: Record<string, unknown>, incorrectOnly = false): Promise<number> {
  const extra = incorrectOnly ? `${where ? `${where} AND` : "WHERE"} NOT (balance_ok = 1 AND negative_ok = 1 AND timelapse_ok = 1)` : where
  const row = (await stmt(db, `SELECT COUNT(*)::int AS n FROM net_cost_records ${extra}`, params).get()) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

export async function runNetCostAction(action: NetCostActionKind, input: NetCostActionInput): Promise<NetCostActionResult> {
  let affected = 0
  let incorrect = 0
  let records = 0
  const stamp = async (tx: PgDb, now: string, where: string, params: Record<string, unknown>) => {
    const changed = await tx.prepare(`UPDATE net_cost_records SET last_check_time = @now ${where}`).run({ ...params, now })
    affected = changed.changes
  }
  const totals = async (tx: PgDb, where: string, params: Record<string, unknown>) => {
    records = await countWhere(tx, "", {})
    incorrect = await countWhere(tx, where, params, true)
  }

  if (action === "recheck") {
    await syncNetCost({
      force: true,
      stampAll: true,
      after: async (tx) => {
        affected = await countWhere(tx, "", {})
        await totals(tx, "", {})
      },
    })
  } else if (action === "regenerate") {
    const { where, params } = actionWhere({ ...input, onlyWrong: false }, false)
    await syncNetCost({
      force: true,
      before: async (tx) => {
        await stmt(tx, `DELETE FROM net_cost_records ${where}`, params).run()
      },
      after: async (tx, now) => {
        await stamp(tx, now, where, params)
        await totals(tx, where, params)
      },
    })
  } else {
    // recalc (only errors or the chosen ones), recalc-period, reset-period.
    const scoped = action === "recalc" ? input : { ...input, onlyWrong: false }
    const { where, params } = actionWhere(scoped, true)
    await syncNetCost({
      force: true,
      after: async (tx, now) => {
        await stamp(tx, now, where, params)
        await totals(tx, scoped.onlyWrong ? "" : where, params)
      },
    })
  }
  return { action, affected, incorrect, records }
}
