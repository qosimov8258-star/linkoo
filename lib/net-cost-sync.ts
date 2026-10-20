import "server-only"

import { createHash } from "crypto"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { nowLocalIso, todayIso } from "@/lib/finance/dates"
import { runItemLedger, type LedgerDocMeta, type LedgerEntry, type LedgerItemResult, type LedgerMove, type LedgerRecord } from "@/lib/net-cost-ledger"
import { ensureNetCostSchema } from "@/lib/net-cost-schema"
import type { NetCostTotalRow } from "@/lib/net-cost-types"
import { getStockBalances, getStockCatalog, stockMovementsSql } from "@/lib/stock/ledger"
import { preciseLocalMoment } from "@/lib/stock/moments"
import { STOCK_TABLES } from "@/lib/stock/schema"

// Loads the ledger's sources (the stock core's movements, the manual entries, document
// times, default costs), runs the per-item ledger and keeps net_cost_records / the
// header totals in step with them.
//
// Cache invalidation: a fingerprint = row count + Σ hash of every row of every table the
// stock core reads (STOCK_TABLES) and of net_cost_entries, plus today's date and the
// ledger version. Reads compare it with the stored one (cheap aggregates, no JSON
// parsing) and rebuild only when it differs; the rebuild runs under an advisory lock and
// keeps record ids by natural key (document + item), so links stay valid.

/** Bump when the ledger rules change: forces one rebuild everywhere.
 * 2: real-moment order within a day, Брак held apart, neutral same-scope transfers.
 * 3: a batch's good output absorbs the value of its Брак (lib/stock/sources.ts). */
export const NET_COST_VERSION = "3"
const CHUNK = 1000
const EPS = 1e-6

/** fin_key() in JS: lower-case, trimmed, whitespace collapsed (NBSP counts as space). */
export function finKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

const round = (value: number, digits = 6) => {
  const factor = 10 ** digits
  const result = Math.round((Number(value) || 0) * factor) / factor
  return Object.is(result, -0) ? 0 : result
}

/** Columns of the given tables that exist right now. */
export async function tableColumns(db: PgDb, tables: readonly string[]): Promise<Map<string, Set<string>>> {
  const rows = (await db
    .prepare(
      `SELECT c.relname AS t, a.attname AS c
       FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind IN ('r', 'p') AND c.relname = ANY(@tables::text[])`,
    )
    .all({ tables: [...tables] })) as Array<{ t: string; c: string }>
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!map.has(row.t)) map.set(row.t, new Set())
    map.get(row.t)!.add(row.c)
  }
  return map
}

/** Fingerprint of everything the ledger depends on. */
export async function sourcesFingerprint(db: PgDb): Promise<string> {
  const present = await tableColumns(db, [...STOCK_TABLES, "net_cost_entries"])
  const parts = [...present.keys()]
    .sort()
    .map((table) => `SELECT '${table}' AS t, count(*)::text AS n, COALESCE(sum(hashtextextended(x::text, 0)), 0)::text AS h FROM "${table}" x`)
  const rows = parts.length ? await db.prepare(parts.join(" UNION ALL ")).all() : []
  return createHash("md5")
    .update(`${NET_COST_VERSION}|${todayIso()}|${JSON.stringify(rows)}`)
    .digest("hex")
}

// --- inputs --------------------------------------------------------------------------------

export type LedgerInputs = {
  moves: Map<string, LedgerMove[]>
  entries: Map<string, LedgerEntry[]>
  meta: Map<string, LedgerDocMeta>
  defaults: Map<string, number>
  labels: Map<string, string>
  /** fin_key → canonical warehouse name (warehouses table spelling). */
  warehouses: Map<string, string>
}

const AT = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`

export function entryItemKey(row: { product_id: number | null; raw_material_id: number | null }): string {
  return row.product_id ? `product:${row.product_id}` : `raw_material:${row.raw_material_id}`
}

/** Everything one ledger run needs; `itemKey` limits it to one item (detail view). */
export async function loadLedgerInputs(db: PgDb, itemKey?: string): Promise<LedgerInputs> {
  await ensureNetCostSchema()
  const cols = await tableColumns(db, [
    "supplier_incomings",
    "supplier_returns",
    "write_offs",
    "production_movements",
    "stock_inventories",
    "internal_transfers",
    "client_returns",
    "warehouses",
    "products",
  ])
  const has = (table: string, column?: string) => (column ? Boolean(cols.get(table)?.has(column)) : cols.has(table))

  const warehouses = new Map<string, string>()
  if (has("warehouses")) {
    const rows = (await db
      .prepare("SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, name FROM warehouses WHERE fin_key(name) <> '' ORDER BY fin_key(name), id")
      .all()) as Array<{ k: string; name: string }>
    for (const row of rows) warehouses.set(row.k, row.name)
  }

  const { sql, params } = await stockMovementsSql({}, db)
  const rows = (await db
    .prepare(
      `SELECT m.item_key, m.day, fin_key(m.warehouse) AS wk, MIN(m.warehouse) AS warehouse, m.kind, m.doc_type, m.doc_id, m.is_defect,
              SUM(m.qty) AS qty, SUM(m.value) AS value
       FROM (${sql}) m
       WHERE fin_key(m.warehouse) <> '' ${itemKey ? "AND m.item_key = @nc_item" : ""}
       GROUP BY m.item_key, m.day, fin_key(m.warehouse), m.kind, m.doc_type, m.doc_id, m.is_defect
       HAVING abs(SUM(m.qty)) > 1e-9`,
    )
    .all({ ...params, nc_item: itemKey ?? "" })) as Array<{
    item_key: string
    day: string
    wk: string
    warehouse: string
    kind: string
    doc_type: string
    doc_id: number
    is_defect: number
    qty: number
    value: number
  }>
  const moves = new Map<string, LedgerMove[]>()
  const ids = new Map<string, Set<number>>()
  for (const row of rows) {
    const list = moves.get(row.item_key) ?? []
    list.push({
      day: row.day,
      wk: row.wk,
      warehouse: warehouses.get(row.wk) ?? row.warehouse,
      qty: Number(row.qty) || 0,
      value: Number(row.value) || 0,
      kind: row.kind,
      docType: row.doc_type,
      docId: Number(row.doc_id),
      isDefect: Number(row.is_defect) === 1,
    })
    moves.set(row.item_key, list)
    if (!ids.has(row.doc_type)) ids.set(row.doc_type, new Set())
    ids.get(row.doc_type)!.add(Number(row.doc_id))
  }

  // Moment of each document's stock effect (ordering within a day) and its
  // registration ("Анализ времены"): acceptance, hand-over, the write-off's
  // finishing, production registration; each transfer leg its own moment.
  // The first stored moment of the candidates that parses wins; ISO-like
  // texts keep their milliseconds (fin_ts keeps seconds only).
  type Candidate = { column: string; utc?: boolean }
  const meta = new Map<string, LedgerDocMeta>()
  const metaQuery = async (table: string, moments: { at: Candidate[]; outAt?: Candidate[]; inAt?: Candidate[] }, extra = "") => {
    const list = [...(ids.get(table) ?? [])]
    if (!list.length || !has(table)) return
    const groups = Object.entries(moments).map(([name, candidates]) => ({ name, candidates: (candidates ?? []).filter((candidate) => has(table, candidate.column)) }))
    const select = groups.flatMap((group) =>
      group.candidates.map(
        (candidate, index) =>
          `${candidate.column}::text AS ${group.name}_${index}_raw, ${AT(`fin_ts(NULLIF(btrim(${candidate.column}::text), '')${candidate.utc ? ", true" : ""})`)} AS ${group.name}_${index}_ts`,
      ),
    )
    const found = (await db.prepare(`SELECT id${select.length ? `, ${select.join(", ")}` : ""}${extra ? `, ${extra}` : ""} FROM ${table} WHERE id = ANY(@ids::int[])`).all({ ids: list })) as Array<
      Record<string, unknown> & { id: number; sod?: number; fwk?: string }
    >
    const pick = (row: Record<string, unknown>, group: (typeof groups)[number]) => {
      for (const [index, candidate] of group.candidates.entries()) {
        const parsed = row[`${group.name.toLowerCase()}_${index}_ts`]
        if (typeof parsed !== "string" || !parsed) continue
        return preciseLocalMoment(String(row[`${group.name.toLowerCase()}_${index}_raw`] ?? ""), candidate.utc) ?? parsed
      }
      return ""
    }
    for (const row of found) {
      const at = Object.fromEntries(groups.map((group) => [group.name, pick(row, group)]))
      meta.set(`${table}:${row.id}`, {
        at: at.at ?? "",
        ...(moments.outAt ? { outAt: at.outAt ?? "" } : {}),
        ...(moments.inAt ? { inAt: at.inAt ?? "" } : {}),
        startOfDay: row.sod === 0,
        endOfDay: row.sod === 1,
        fromWk: row.fwk ?? "",
      })
    }
  }
  const created: Candidate = { column: "created_at", utc: true }
  await metaQuery("supplier_incomings", { at: [{ column: "accepted_at" }, created] })
  await metaQuery("supplier_returns", { at: [{ column: "transfer_time" }, created] })
  await metaQuery("write_offs", { at: [{ column: "finished_at" }, { column: "date" }, created] })
  await metaQuery("production_movements", { at: [created] })
  await metaQuery("stock_inventories", { at: [{ column: "confirmed_at", utc: true }, created] }, `${has("stock_inventories", "for_day_end") ? "COALESCE(for_day_end, 0)" : "0"} AS sod`)
  await metaQuery(
    "internal_transfers",
    {
      at: [{ column: "accepted_at" }, created],
      outAt: [{ column: "given_at" }, { column: "created_at_label" }, created],
      inAt: [{ column: "accepted_at" }, created],
    },
    "fin_key(from_warehouse) AS fwk",
  )
  await metaQuery("client_returns", { at: [{ column: "accepted_at" }, created] })

  const entries = new Map<string, LedgerEntry[]>()
  const entryRows = (await db
    .prepare(
      `SELECT id, product_id, raw_material_id, cost, entry_date, warehouse, fin_key(warehouse) AS wk, ${AT("fin_ts(created_at, true)")} AS at
       FROM net_cost_entries ORDER BY id`,
    )
    .all()) as Array<{ id: number; product_id: number | null; raw_material_id: number | null; cost: number; entry_date: string; warehouse: string; wk: string; at: string | null }>
  for (const row of entryRows) {
    const key = entryItemKey(row)
    if (itemKey && key !== itemKey) continue
    const list = entries.get(key) ?? []
    list.push({ id: Number(row.id), day: row.entry_date, wk: row.wk, warehouse: row.wk ? (warehouses.get(row.wk) ?? row.warehouse) : "", cost: Number(row.cost) || 0, at: row.at ?? "" })
    entries.set(key, list)
  }

  const labels = new Map<string, string>()
  for (const item of await getStockCatalog(db)) labels.set(item.key, item.name)
  const defaults = new Map<string, number>()
  if (has("products")) {
    const initial = has("products", "initial_cost") ? "COALESCE(initial_cost, cost)" : "cost"
    const products = (await db.prepare(`SELECT id, ${initial} AS cost FROM products`).all()) as Array<{ id: number; cost: number | null }>
    for (const row of products) defaults.set(`product:${row.id}`, Number(row.cost) || 0)
  }
  return { moves, entries, meta, defaults, labels, warehouses }
}

export function itemLabel(inputs: Pick<LedgerInputs, "labels">, key: string): string {
  return inputs.labels.get(key) ?? (key.startsWith("name:") ? key.slice(5) : key)
}

/** Runs the ledger of every item (or the one given); `trace` adds the value postings and daily averages. */
export function runLedgers(inputs: LedgerInputs, options: { today?: string; collectDocs?: boolean; only?: string; trace?: boolean } = {}): Map<string, LedgerItemResult> {
  const today = options.today ?? todayIso()
  const keys = options.only ? [options.only] : [...new Set([...inputs.moves.keys(), ...inputs.entries.keys()])]
  const results = new Map<string, LedgerItemResult>()
  for (const key of keys) {
    results.set(
      key,
      runItemLedger({
        itemKey: key,
        moves: inputs.moves.get(key) ?? [],
        entries: inputs.entries.get(key) ?? [],
        defaultCost: inputs.defaults.get(key) ?? 0,
        today,
        meta: inputs.meta,
        collectDocs: options.collectDocs,
        trace: options.trace,
      }),
    )
  }
  return results
}

// --- checks & totals ---------------------------------------------------------------------------

/** "Анализ баланса": the ledger's balance today vs. the stock core's (per item and scope;
 * Брак is outside the ledger's balance on both sides). */
async function applyBalanceCheck(db: PgDb, results: Map<string, LedgerItemResult>) {
  const core = new Map<string, Map<string, number>>()
  for (const row of await getStockBalances({}, db)) {
    const byWarehouse = core.get(row.key) ?? new Map<string, number>()
    const wk = finKey(row.warehouse)
    byWarehouse.set(wk, (byWarehouse.get(wk) ?? 0) + row.qty - row.defects)
    core.set(row.key, byWarehouse)
  }
  for (const [key, result] of results) {
    const scopeOf = new Map(result.warehouses.map((wh) => [wh.wk, wh.scope]))
    const expected = new Map<string, number>()
    for (const [wk, qty] of core.get(key) ?? []) {
      const scope = scopeOf.get(wk) ?? ""
      expected.set(scope, (expected.get(scope) ?? 0) + qty)
    }
    for (const scope of result.scopes) {
      const want = expected.get(scope.key) ?? 0
      if (Math.abs(want - scope.qty) <= EPS * Math.max(1, Math.abs(want))) continue
      const current = result.records.find((record) => record.current && record.scope === scope.key)
      if (current) current.balanceOk = false
    }
  }
}

function computeTotals(results: Map<string, LedgerItemResult>, warehouses: Map<string, string>): NetCostTotalRow[] {
  type Acc = { name: string; cumulative: number; last: number; revaluation: number; noCost: number }
  const rows = new Map<string, Acc>()
  for (const [wk, name] of warehouses) rows.set(wk, { name, cumulative: 0, last: 0, revaluation: 0, noCost: 0 })
  const all: Acc = { name: "", cumulative: 0, last: 0, revaluation: 0, noCost: 0 }
  for (const result of results.values()) {
    let itemNoCost = false
    for (const wh of result.warehouses) {
      const acc = rows.get(wh.wk) ?? { name: wh.name, cumulative: 0, last: 0, revaluation: 0, noCost: 0 }
      rows.set(wh.wk, acc)
      const noCost = wh.qty > EPS && !wh.hasCost
      for (const target of [acc, all]) {
        target.cumulative += wh.value
        target.last += wh.current
        target.revaluation += wh.revaluation
      }
      if (noCost) {
        acc.noCost += 1
        itemNoCost = true
      }
    }
    if (itemNoCost) all.noCost += 1
  }
  const finish = (acc: Acc, stock: string | null): NetCostTotalRow => {
    const fault = acc.last - acc.cumulative
    const tolerance = 0.01 + 1e-9 * (Math.abs(acc.last) + Math.abs(acc.cumulative))
    return {
      stock,
      cumulativeCost: round(acc.cumulative, 2),
      lastCost: round(acc.last, 2),
      fault: Math.abs(fault) <= tolerance ? 0 : round(fault, 2),
      totalRevaluation: round(acc.revaluation, 2),
      isCorrect: Math.abs(fault) <= tolerance,
      noCostProductCount: acc.noCost,
    }
  }
  const named = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
  return [finish(all, null), ...named.map((acc) => finish(acc, acc.name))]
}

// --- persistence ---------------------------------------------------------------------------

type StoredRow = Record<string, string | number | null>

function storedRow(key: string, label: string, record: LedgerRecord, seq: number): StoredRow {
  const values = {
    nk: record.nk,
    item_key: key,
    item_label: label,
    scope: record.scope,
    scope_name: record.scopeName,
    place: record.place,
    day: record.day,
    at: record.at,
    seq,
    source_type: record.sourceType,
    source_id: record.sourceId,
    entry_id: record.entryId,
    qty: round(record.qty),
    real_cost: round(record.realCost),
    cost: round(record.cost),
    prev_cost: record.prevCost === null ? null : round(record.prevCost),
    balance: round(record.balance),
    balance_after: round(record.balanceAfter),
    revaluation: record.revaluation === null ? null : round(record.revaluation),
    total_revaluation: record.totalRevaluation === null ? null : round(record.totalRevaluation, 4),
    balance_ok: record.balanceOk ? 1 : 0,
    negative_ok: record.negativeOk ? 1 : 0,
    timelapse_ok: record.timelapseOk ? 1 : 0,
    is_current: record.current ? 1 : 0,
    next_day: record.nextDay,
    negatives: JSON.stringify(record.negatives.map((entry) => ({ ...entry, qty: round(entry.qty), cost: round(entry.cost), balanceAfter: round(entry.balanceAfter) }))),
  }
  return { ...values, sig: createHash("md5").update(JSON.stringify(values)).digest("hex") }
}

const RECORD_COLUMNS: Array<[string, string]> = [
  ["nk", "text"],
  ["item_key", "text"],
  ["item_label", "text"],
  ["scope", "text"],
  ["scope_name", "text"],
  ["place", "text"],
  ["day", "text"],
  ["at", "text"],
  ["seq", "integer"],
  ["source_type", "text"],
  ["source_id", "integer"],
  ["entry_id", "integer"],
  ["qty", "double precision"],
  ["real_cost", "double precision"],
  ["cost", "double precision"],
  ["prev_cost", "double precision"],
  ["balance", "double precision"],
  ["balance_after", "double precision"],
  ["revaluation", "double precision"],
  ["total_revaluation", "double precision"],
  ["balance_ok", "integer"],
  ["negative_ok", "integer"],
  ["timelapse_ok", "integer"],
  ["is_current", "integer"],
  ["next_day", "text"],
  ["negatives", "text"],
  ["sig", "text"],
]

async function persistRecords(db: PgDb, rows: StoredRow[], now: string, stampAll: boolean) {
  const names = RECORD_COLUMNS.map(([name]) => name)
  const updates = names.filter((name) => name !== "nk").map((name) => `${name} = EXCLUDED.${name}`)
  const sql = `INSERT INTO net_cost_records (${names.join(", ")}, last_check_time)
    SELECT ${names.map((name) => `x.${name}`).join(", ")}, @now::text
    FROM jsonb_to_recordset(@rows::jsonb) AS x(${RECORD_COLUMNS.map(([name, type]) => `${name} ${type}`).join(", ")})
    ON CONFLICT (nk) DO UPDATE SET ${updates.join(", ")}, last_check_time = EXCLUDED.last_check_time
    WHERE @stamp::boolean OR net_cost_records.sig IS DISTINCT FROM EXCLUDED.sig`
  for (let index = 0; index < rows.length; index += CHUNK) {
    await db.prepare(sql).all({ rows: JSON.stringify(rows.slice(index, index + CHUNK)), now, stamp: stampAll })
  }
  await db.prepare("DELETE FROM net_cost_records WHERE NOT (nk = ANY(@nks::text[]))").run({ nks: rows.map((row) => String(row.nk)) })
}

export type SyncOptions = {
  /** Rebuild even when the fingerprint did not change. */
  force?: boolean
  /** Stamp "Последнее время проверки" on every record (otherwise only on new / changed ones). */
  stampAll?: boolean
  /** Runs inside the rebuild transaction before the records are written (e.g. purge a period). */
  before?: (tx: PgDb) => Promise<void>
  /** Runs inside the rebuild transaction after the records are written. */
  after?: (tx: PgDb, now: string) => Promise<void>
}

export type SyncResult = { rebuilt: boolean; records: number; incorrect: number }

/** Brings net_cost_records and the totals in step with the sources (no-op when fresh). */
export async function syncNetCost(options: SyncOptions = {}): Promise<SyncResult> {
  await ensureNetCostSchema()
  const db = getDb()
  const fingerprint = await sourcesFingerprint(db)
  if (!options.force) {
    const state = (await db.prepare("SELECT fingerprint FROM net_cost_state WHERE id = 1").get()) as { fingerprint: string } | undefined
    if (state?.fingerprint === fingerprint) return { rebuilt: false, records: -1, incorrect: -1 }
  }
  return withTransaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:net-cost')) AS ok").get()
    if (!options.force) {
      const state = (await tx.prepare("SELECT fingerprint FROM net_cost_state WHERE id = 1").get()) as { fingerprint: string } | undefined
      if (state?.fingerprint === fingerprint) return { rebuilt: false, records: -1, incorrect: -1 }
    }
    const now = nowLocalIso()
    const inputs = await loadLedgerInputs(tx)
    const results = runLedgers(inputs)
    await applyBalanceCheck(tx, results)
    const rows: StoredRow[] = []
    let incorrect = 0
    for (const [key, result] of results) {
      const label = itemLabel(inputs, key)
      result.records.forEach((record, seq) => {
        rows.push(storedRow(key, label, record, seq))
        if (!(record.balanceOk && record.negativeOk && record.timelapseOk)) incorrect += 1
      })
    }
    if (options.before) await options.before(tx)
    await persistRecords(tx, rows, now, Boolean(options.stampAll))
    await tx
      .prepare("UPDATE net_cost_state SET fingerprint = @fingerprint, built_at = @now, totals = @totals WHERE id = 1")
      .run({ fingerprint, now, totals: JSON.stringify(computeTotals(results, inputs.warehouses)) })
    if (options.after) await options.after(tx, now)
    return { rebuilt: true, records: rows.length, incorrect }
  })
}
