import "server-only"

import { createHash } from "crypto"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { nowLocalIso, todayIso } from "@/lib/finance/dates"
import { momentOnDay, runItemLedger, type LedgerDocMeta, type LedgerEntry, type LedgerItemResult, type LedgerMove, type LedgerRecord } from "@/lib/net-cost-ledger"
import { ensureNetCostSchema } from "@/lib/net-cost-schema"
import type { NetCostTotalRow } from "@/lib/net-cost-types"
import { getStockBalances, getStockCatalog, stockMovementsSql } from "@/lib/stock/ledger"
import { preciseLocalMoment } from "@/lib/stock/moments"
import { jsonLines } from "@/lib/stock/sources"
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
 * 3: a batch's good output absorbs the value of its Брак (lib/stock/sources.ts).
 * 4: orders at their ship moment; production output valued from the ledger's own raw
 *    issues (batches) / recipe norms at the ledger averages (shift entries); output
 *    that consumed nothing comes in at the average; stock that came in while no cost
 *    was known is valued by the first known cost (never blended in at 0).
 * 5: output without a cost of its own (components / raw materials of unknown cost) at
 *    the average; items that feed each other in production solved exactly.
 * 6: a manual entry entered on its own day takes effect at the moment it was entered
 *    (net_cost_entries.entered_at, else created_at), after that day's earlier documents.
 * 7: older entries (no entered_at) keep the start-of-day rule they were entered under. */
export const NET_COST_VERSION = "7"
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

/** One component of a shift entry's recipe norms: `amount` of `key` per unit of output. */
export type CostBasisLine = { key: string; amount: number }

/** How production lines are tied together (production_movements id →). */
export type ProductionLinks = {
  /** The batch of a batch line (shift entries have none). */
  party: Map<number, number>
  /** The recipe norms a shift entry's output was costed with (lib/production-activity-repo.ts). */
  basis: Map<number, CostBasisLine[]>
}

export type LedgerInputs = {
  moves: Map<string, LedgerMove[]>
  entries: Map<string, LedgerEntry[]>
  meta: Map<string, LedgerDocMeta>
  defaults: Map<string, number>
  /** Catalog cost of every item (an item without any ledger history yet). */
  fallbacks: Map<string, number>
  labels: Map<string, string>
  /** fin_key → canonical warehouse name (warehouses table spelling). */
  warehouses: Map<string, string>
  production: ProductionLinks
}

const AT = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`

export function entryItemKey(row: { product_id: number | null; raw_material_id: number | null }): string {
  return row.product_id ? `product:${row.product_id}` : `raw_material:${row.raw_material_id}`
}

/** The parsed cost_basis JSON of a shift entry (null when absent or invalid). */
function parseBasis(text: unknown): CostBasisLine[] | null {
  if (typeof text !== "string" || !text.trim()) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return null
    const lines = parsed
      .map((line) => ({ key: String((line as CostBasisLine)?.key ?? ""), amount: Number((line as CostBasisLine)?.amount) }))
      .filter((line) => line.key && Number.isFinite(line.amount) && line.amount > 0)
    return lines
  } catch {
    return null
  }
}

/** `itemKey` and every item its production output is valued from (the raw materials of
 * its batches, the recipe components of its shift entries, recursively), plus the other
 * outputs of those batches (a batch spreads its raw value over all its good units). */
async function productionClosure(db: PgDb, itemKey: string, has: (table: string, column?: string) => boolean): Promise<string[]> {
  if (!has("production_movements", "party_id") || !has("production_movements", "item_kind") || !has("production_movements", "item_id")) return [itemKey]
  const key = (alias: string) => `${alias}.item_kind || ':' || ${alias}.item_id`
  const basis = has("production_movements", "cost_basis")
    ? `UNION
       SELECT ${key("m")}, c.j ->> 'key'
       FROM production_movements m CROSS JOIN LATERAL jsonb_array_elements(${jsonLines("m.cost_basis")}) AS c(j)
       WHERE m.direction = 'made' AND m.party_id IS NULL AND m.cost_basis IS NOT NULL`
    : ""
  const rows = (await db
    .prepare(
      `WITH RECURSIVE nc_deps AS (
         SELECT ${key("m")} AS made, ${key("r")} AS dep
         FROM production_movements m JOIN production_movements r ON r.party_id = m.party_id AND r.direction IN ('raw', 'made') AND r.id <> m.id
         WHERE m.direction = 'made' AND m.party_id IS NOT NULL
         ${basis}
       ), nc_need(k) AS (
         SELECT @nc_item::text
         UNION
         SELECT d.dep FROM nc_need n JOIN nc_deps d ON d.made = n.k WHERE d.dep IS NOT NULL
       )
       SELECT k FROM nc_need`,
    )
    .all({ nc_item: itemKey })) as Array<{ k: string }>
  return [...new Set([itemKey, ...rows.map((row) => row.k)])]
}

/** Everything one ledger run needs; `itemKey` limits it to one item and the items its
 * production output is valued from (detail view). */
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
    "orders",
    "warehouses",
    "products",
    "net_cost_entries",
  ])
  const has = (table: string, column?: string) => (column ? Boolean(cols.get(table)?.has(column)) : cols.has(table))
  const itemKeys = itemKey ? await productionClosure(db, itemKey, has) : null
  const wanted = itemKeys ? new Set(itemKeys) : null

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
       WHERE fin_key(m.warehouse) <> '' ${itemKeys ? "AND m.item_key = ANY(@nc_items::text[])" : ""}
       GROUP BY m.item_key, m.day, fin_key(m.warehouse), m.kind, m.doc_type, m.doc_id, m.is_defect
       HAVING abs(SUM(m.qty)) > 1e-9`,
    )
    .all({ ...params, nc_items: itemKeys ?? [] })) as Array<{
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
  // Orders leave at their ship moment (orders.shipped_at, ISO UTC, written by the orders
  // module); without one they would count at the end of the day, after every receipt.
  await metaQuery("orders", { at: [{ column: "shipped_at", utc: true }, created] })

  // Production lines: their batch, and the recipe norms of shift entries.
  const production: ProductionLinks = { party: new Map(), basis: new Map() }
  const productionIds = [...(ids.get("production_movements") ?? [])]
  if (productionIds.length && has("production_movements", "party_id")) {
    const basis = has("production_movements", "cost_basis") ? "cost_basis" : "NULL::text AS cost_basis"
    const links = (await db
      .prepare(`SELECT id, party_id, ${basis} FROM production_movements WHERE id = ANY(@ids::int[]) AND (party_id IS NOT NULL OR direction = 'made')`)
      .all({ ids: productionIds })) as Array<{ id: number; party_id: number | null; cost_basis: string | null }>
    for (const row of links) {
      if (row.party_id !== null && row.party_id !== undefined) production.party.set(Number(row.id), Number(row.party_id))
      else {
        const lines = parseBasis(row.cost_basis)
        if (lines) production.basis.set(Number(row.id), lines)
      }
    }
  }

  // The moment an entry was entered (local, with milliseconds): entered_at. It places an
  // entry of its own day at that moment (ledger). Older rows (entered_at NULL, entered while
  // every cost applied "from the start of the chosen day") keep that rule: an older entry
  // created on its own day gets no moment (start of the day, shown as the day); a
  // back-dated one keeps its creation moment (created_at is UTC), which is on a later day.
  const entries = new Map<string, LedgerEntry[]>()
  const enteredAt = has("net_cost_entries", "entered_at") ? "entered_at" : "NULL::text AS entered_at"
  const entryRows = (await db
    .prepare(
      `SELECT id, product_id, raw_material_id, cost, entry_date, warehouse, fin_key(warehouse) AS wk, ${enteredAt}, created_at::text AS created_raw,
              ${AT("fin_ts(created_at, true)")} AS at
       FROM net_cost_entries ORDER BY id`,
    )
    .all()) as Array<{
    id: number
    product_id: number | null
    raw_material_id: number | null
    cost: number
    entry_date: string
    warehouse: string
    wk: string
    entered_at: string | null
    created_raw: string | null
    at: string | null
  }>
  for (const row of entryRows) {
    const key = entryItemKey(row)
    if (wanted && !wanted.has(key)) continue
    const list = entries.get(key) ?? []
    const created = row.at ? (preciseLocalMoment(row.created_raw, true) ?? row.at) : ""
    const at = preciseLocalMoment(row.entered_at) ?? (momentOnDay(row.entry_date, created) ? "" : created)
    list.push({ id: Number(row.id), day: row.entry_date, wk: row.wk, warehouse: row.wk ? (warehouses.get(row.wk) ?? row.warehouse) : "", cost: Number(row.cost) || 0, at })
    entries.set(key, list)
  }

  const labels = new Map<string, string>()
  const fallbacks = new Map<string, number>()
  for (const item of await getStockCatalog(db)) {
    labels.set(item.key, item.name)
    fallbacks.set(item.key, Number(item.fallbackCost) || 0)
  }
  const defaults = new Map<string, number>()
  if (has("products")) {
    const initial = has("products", "initial_cost") ? "COALESCE(initial_cost, cost)" : "cost"
    const products = (await db.prepare(`SELECT id, ${initial} AS cost FROM products`).all()) as Array<{ id: number; cost: number | null }>
    for (const row of products) defaults.set(`product:${row.id}`, Number(row.cost) || 0)
  }
  return { moves, entries, meta, defaults, fallbacks, labels, warehouses, production }
}

export function itemLabel(inputs: Pick<LedgerInputs, "labels">, key: string): string {
  return inputs.labels.get(key) ?? (key.startsWith("name:") ? key.slice(5) : key)
}

// --- production output values ------------------------------------------------------------
//
// A batch's good output is valued from what the ledger issued its raw materials at:
// unit = Σ raw lines' posted values ÷ Σ good output units (Брак carries no value), so the
// batch moves value from raw materials to its output without creating or losing any —
// also when a raw material's average changes later (a back-dated receipt, an expense
// added to an accepted supply). A shift entry (no batch) is valued by the recipe norms it
// was registered with × the components' ledger average at the end of its day; an older
// one without stored norms keeps its stored cost.
// Output that carries no cost of its own comes in at the item's average (never as a cost
// receipt at 0, which would dilute the average): a batch without raw lines, or whose raw
// materials all left at no value (raw stock of unknown cost); a shift entry whose
// components have no known cost yet; an older shift entry stored without a cost.
// The items are run in dependency order (raw materials before what is made from them).
// Items that depend on each other (rework of an item into itself, two items made from
// each other) form a fixed point: output values → ledger → raw issue values → output
// values. The ledger is affine in those values, so the group is solved directly (one
// Newton step with a finite-difference Jacobian, checked by a further run) and only
// falls back to plain repetition for very large groups.

type BatchPlan = {
  /** Raw lines: production_movements id → item key, stored value (≤ 0). */
  raw: Array<{ docId: number; item: string; stored: number }>
  goodQty: number
}

type ProductionPlan = {
  batches: Map<number, BatchPlan>
  /** made item → the items its output value depends on. */
  deps: Map<string, Set<string>>
}

/** Rounds of a group of items that depend on each other (Newton steps and, beyond
 * MAX_UNKNOWNS output lines, plain repetitions). */
const MAX_ROUNDS = 200
const MAX_NEWTON = 8
const MAX_UNKNOWNS = 200

function productionPlan(inputs: LedgerInputs): ProductionPlan {
  const batches = new Map<number, BatchPlan>()
  const batch = (party: number) => {
    let plan = batches.get(party)
    if (!plan) batches.set(party, (plan = { raw: [], goodQty: 0 }))
    return plan
  }
  const made = new Map<number, string[]>()
  for (const [item, moves] of inputs.moves) {
    for (const move of moves) {
      if (move.docType !== "production_movements") continue
      const party = inputs.production.party.get(move.docId)
      if (party === undefined) continue
      if (move.kind === "manufacture_out") batch(party).raw.push({ docId: move.docId, item, stored: move.value })
      else if (move.kind === "manufacture_in" && !move.isDefect && move.qty > 0) {
        batch(party).goodQty += move.qty
        const items = made.get(party) ?? []
        items.push(item)
        made.set(party, items)
      }
    }
  }
  const deps = new Map<string, Set<string>>()
  const depend = (item: string, on: string) => {
    const set = deps.get(item) ?? new Set<string>()
    set.add(on)
    deps.set(item, set)
  }
  for (const [party, items] of made) for (const item of items) for (const line of batches.get(party)?.raw ?? []) depend(item, line.item)
  for (const [item, moves] of inputs.moves) {
    for (const move of moves) {
      if (move.docType !== "production_movements" || move.kind !== "manufacture_in") continue
      for (const line of inputs.production.basis.get(move.docId) ?? []) depend(item, line.key)
    }
  }
  return { batches, deps }
}

/** Strongly connected groups of `keys` (and what they depend on), dependencies first (Tarjan). */
function dependencyOrder(keys: string[], deps: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const groups: string[][] = []
  let counter = 0
  for (const root of keys) {
    if (index.has(root)) continue
    const work: Array<{ node: string; next: string[]; at: number }> = []
    const enter = (node: string) => {
      index.set(node, counter)
      low.set(node, counter)
      counter += 1
      stack.push(node)
      onStack.add(node)
      work.push({ node, next: [...(deps.get(node) ?? [])], at: 0 })
    }
    enter(root)
    while (work.length) {
      const frame = work[work.length - 1]
      if (frame.at < frame.next.length) {
        const child = frame.next[frame.at++]
        if (!index.has(child)) enter(child)
        else if (onStack.has(child)) low.set(frame.node, Math.min(low.get(frame.node)!, index.get(child)!))
        continue
      }
      work.pop()
      if (work.length) {
        const parent = work[work.length - 1].node
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!))
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const group: string[] = []
        let member: string
        do {
          member = stack.pop()!
          onStack.delete(member)
          group.push(member)
        } while (member !== frame.node)
        groups.push(group)
      }
    }
  }
  return groups
}

/** The last average on or before `day` of a list ordered by day. */
function averageUpTo<T extends { day: string; avg: number }>(list: readonly T[] | undefined, day: string): number | undefined {
  let found: number | undefined
  for (const entry of list ?? []) {
    if (entry.day > day) break
    found = entry.avg
  }
  return found
}

/** The moves of `item` with their production output valued (see above); the same array
 * when nothing changes. */
function valuedMoves(item: string, inputs: LedgerInputs, plan: ProductionPlan, results: Map<string, LedgerItemResult>): LedgerMove[] {
  const moves = inputs.moves.get(item) ?? []
  let changed = false
  const valued = moves.map((move) => {
    if (move.docType !== "production_movements" || move.kind !== "manufacture_in" || move.isDefect || !(move.qty > 0)) return move
    const party = inputs.production.party.get(move.docId)
    if (party !== undefined) {
      const batch = plan.batches.get(party)
      if (!batch || !batch.raw.length || !(batch.goodQty > 0)) {
        changed = true
        return { ...move, atAverage: true }
      }
      let rawValue = 0
      for (const line of batch.raw) rawValue -= results.get(line.item)?.production.get(line.docId) ?? line.stored
      changed = true
      // Raw materials that all left at no value (stock of unknown cost): no cost of its own.
      if (!(rawValue > EPS)) return { ...move, atAverage: true }
      return { ...move, value: (rawValue * move.qty) / batch.goodQty, atAverage: false }
    }
    const basis = inputs.production.basis.get(move.docId)
    if (basis) {
      let unit = 0
      for (const line of basis) {
        const result = results.get(line.key)
        const own = result?.ownAverages?.filter((entry) => entry.wk === move.wk)
        const average = averageUpTo(own, move.day) ?? averageUpTo(result?.averages, move.day) ?? inputs.fallbacks.get(line.key) ?? inputs.defaults.get(line.key) ?? 0
        if (average > 0) unit += line.amount * average
      }
      changed = true
      // No component has a known cost yet: no cost of its own.
      if (!(unit * move.qty > EPS)) return { ...move, atAverage: true }
      return { ...move, value: unit * move.qty, atAverage: false }
    }
    if (move.value > 0) return move
    changed = true
    return { ...move, atAverage: true }
  })
  return changed ? valued : moves
}

/** Runs the ledger of every item (or of the one given, with what its output is valued
 * from); `trace` adds the value postings. */
export function runLedgers(inputs: LedgerInputs, options: { today?: string; collectDocs?: boolean; only?: string; trace?: boolean } = {}): Map<string, LedgerItemResult> {
  const today = options.today ?? todayIso()
  const plan = productionPlan(inputs)
  const keys = options.only ? [options.only] : [...new Set([...inputs.moves.keys(), ...inputs.entries.keys()])]
  const results = new Map<string, LedgerItemResult>()
  const run = (key: string, moves: LedgerMove[]) =>
    runItemLedger({
      itemKey: key,
      moves,
      entries: inputs.entries.get(key) ?? [],
      defaultCost: inputs.defaults.get(key) ?? 0,
      today,
      meta: inputs.meta,
      collectDocs: options.collectDocs,
      trace: options.trace,
    })
  for (const group of dependencyOrder(keys, plan.deps)) {
    const cyclic = group.length > 1 || Boolean(plan.deps.get(group[0])?.has(group[0]))
    if (!cyclic) {
      results.set(group[0], run(group[0], valuedMoves(group[0], inputs, plan, results)))
      continue
    }
    solveGroup(group, inputs, plan, results, run)
  }
  if (options.only) return new Map(results.has(options.only) ? [[options.only, results.get(options.only)!]] : [])
  return results
}

/** Output values of a group's valued production lines (`item|line id` → value; NaN = at the average). */
type OutputValues = Map<string, number>

const isValuedOutput = (move: LedgerMove) => move.docType === "production_movements" && move.kind === "manufacture_in" && !move.isDefect && move.qty > 0

/** Same lines, same "at the average" lines, and every value within the ledger's tolerance. */
function settled(a: OutputValues, b: OutputValues): boolean {
  if (a.size !== b.size) return false
  for (const [id, value] of a) {
    const other = b.get(id)
    if (other === undefined) return false
    if (Number.isNaN(value) || Number.isNaN(other)) {
      if (!(Number.isNaN(value) && Number.isNaN(other))) return false
    } else if (Math.abs(value - other) > EPS * Math.max(1, Math.abs(value))) return false
  }
  return true
}

/** x of `n` unknowns from A·x = b (Gaussian elimination, partial pivoting); null when singular. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  const a = matrix.map((row, index) => [...row, rhs[index]])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    if (!(Math.abs(a[pivot][col]) > 1e-12)) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / a[col][col]
      if (!factor) continue
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row][n]
    for (let k = row + 1; k < n; k += 1) sum -= a[row][k] * x[k]
    x[row] = sum / a[row][row]
  }
  return x.every(Number.isFinite) ? x : null
}

/** Runs a group of items whose production output values depend on each other until the
 * output values equal what the ledger then issues their raw materials at (see above). */
function solveGroup(
  group: string[],
  inputs: LedgerInputs,
  plan: ProductionPlan,
  results: Map<string, LedgerItemResult>,
  run: (key: string, moves: LedgerMove[]) => LedgerItemResult,
) {
  /** The output values the current results lead to. */
  const evaluate = (): OutputValues => {
    const values: OutputValues = new Map()
    for (const key of group) {
      for (const move of valuedMoves(key, inputs, plan, results)) {
        if (isValuedOutput(move)) values.set(`${key}|${move.docId}`, move.atAverage ? Number.NaN : move.value)
      }
    }
    return values
  }
  /** Runs the group's ledgers with the given output values. */
  const apply = (values: OutputValues) => {
    for (const key of group) {
      const moves = (inputs.moves.get(key) ?? []).map((move) => {
        const value = isValuedOutput(move) ? values.get(`${key}|${move.docId}`) : undefined
        if (value === undefined) return move
        return Number.isNaN(value) ? { ...move, atAverage: true } : { ...move, value, atAverage: false }
      })
      results.set(key, run(key, moves))
    }
  }

  let x = evaluate()
  let newton = 0
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    apply(x)
    const fx = evaluate()
    if (settled(x, fx)) return
    const valued = [...fx.keys()].filter((id) => !Number.isNaN(fx.get(id)!) && x.has(id) && !Number.isNaN(x.get(id)!))
    const sameLines = valued.length === [...fx.values()].filter((value) => !Number.isNaN(value)).length && valued.length === [...x.values()].filter((value) => !Number.isNaN(value)).length
    // The unknowns: lines valued from the ledger (an older shift entry keeps its stored cost).
    const ids = valued.filter((id) => {
      const line = Number(id.slice(id.lastIndexOf("|") + 1))
      return inputs.production.party.has(line) || inputs.production.basis.has(line)
    })
    if (!sameLines || !ids.length || ids.length > MAX_UNKNOWNS || newton >= MAX_NEWTON) {
      x = fx
      continue
    }
    // The ledger is affine in the output values while the same lines are valued:
    // F(x + d) = F(x) + J·d, so the fixed point is x + d with (I − J)·d = F(x) − x.
    newton += 1
    const jacobian: number[][] = ids.map(() => new Array<number>(ids.length).fill(0))
    ids.forEach((id, col) => {
      const step = 1e-3 * Math.max(1, Math.abs(x.get(id)!))
      const probe = new Map(x)
      probe.set(id, x.get(id)! + step)
      apply(probe)
      const fp = evaluate()
      ids.forEach((other, row) => {
        jacobian[row][col] = ((fp.get(other) ?? Number.NaN) - fx.get(other)!) / step
      })
    })
    const delta = solveLinear(
      jacobian.map((row, i) => row.map((value, j) => (i === j ? 1 : 0) - value)),
      ids.map((id) => fx.get(id)! - x.get(id)!),
    )
    if (!delta) {
      x = fx
      continue
    }
    const next = new Map(fx)
    ids.forEach((id, index) => next.set(id, x.get(id)! + delta[index]))
    x = next
  }
  apply(x)
  console.warn(`[net-cost] production values of ${group.join(", ")} did not settle in ${MAX_ROUNDS} rounds`)
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
