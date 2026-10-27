import type { NetCostDocument, NetCostSource } from "@/lib/net-cost-types"

// The moving-average cost ledger of ONE stock item (pure; lib/net-cost-sync.ts feeds it
// the stock core's movements and the manual cost entries, in any order). It is THE cost
// of goods of the app: lib/stock/costs.ts reads the "Общий" average from it.
//
// Order: by day; within a day back-dated manual entries first (a cost entered for a past
// day applies "from the start of the chosen day"; so do older entries entered before the
// entry moment was kept, whose `at` is ''), then "на начало дня" inventories, then
// every document in the order its goods actually moved (the moment of the stock effect:
// acceptance, hand-over, write-off, registration of production; each leg of an internal
// transfer at its own given / accepted moment), then "на конец дня" inventories. A manual
// entry entered on its own day (its `at` falls on its day: a cost entered today for today)
// takes its place among the documents at the moment it was entered: it revalues the stock
// on hand then, after that day's earlier receipts, and is never undone by them. A document
// without a known moment that day (back-dated, undated) counts at the start of the day
// when it brings goods in and at the end of the day when it takes them out. At the same
// moment: receipts, then issues, then transfer receipts (a transfer leaves before it
// arrives), then manual entries; then type and id.
//
// Scopes: "Общий" ('') holds every warehouse; a warehouse with its own manual cost entry
// becomes its own scope from its first entry (at the start of that day, or at the moment
// of an entry entered on its own day: its stock moves over at the common average, then
// the entry sets its cost). A transfer between two scopes is a
// receipt of the target at the source's average when the goods left. Within one scope
// a transfer is neutral: the goods leave at A and come back at the same unit (only when
// the average moved while they were on the way does the arrival blend like a receipt).
//
// Брак (defective units: production output flagged defective, and the write-off /
// transfer lines that move such units) is held apart: it carries no value (the batch's
// raw cost belongs to its good output), is not part of B and never touches the average.
//
// Production output: lib/net-cost-sync.ts values a batch's good output from the values
// this ledger issued its raw materials at (Σ raw qty × A at issue ÷ good units), so a
// batch moves value from raw materials to its output without creating or losing any,
// also after a retroactive change of a raw material's average. Output without a cost of
// its own (a batch without raw lines or whose raw materials left at no value, a shift
// entry whose components have no known cost yet) is flagged `atAverage`: it comes in at
// A like any other receipt instead of blending a cost of 0 into the average.
//
// Per scope: balance B and average A (starts at the item's default cost). A receipt of q
// at unit cost r with B > 0 blends A' = (B·A + q·r) / (B + q); with B ≤ 0 it resets A' = r.
// Stock that came in while no cost was known at all (A still an unset 0: no cost receipt,
// no manual entry, no default cost) is valued by the first known cost: A' = r and its Δ·B
// is a revaluation, as with a manual entry, so goods of unknown cost never dilute the
// average. A manual entry sets A' = its cost. Every change revalues the stock on hand:
// Δ = A' − A, Общая сумма переоценки = Δ·B. Issues and other receipts move goods at A.
//
// Value per warehouse V ("Накопленная себестоимость"): issues −q·A, other receipts +q·A,
// a manual entry (and the first known cost of unvalued stock) Δ·B_w to each warehouse,
// a cost receipt Δ·B_w to each warehouse plus q·r − Δ·B to the receiving one. While the
// balance stays ≥ 0 this keeps V = B_w·A exactly ("Текущая себестоимость остатки"); a
// receipt into a negative balance resets the average and leaves the difference (Δ·B) in
// the receiving warehouse ("Разница").
// With `trace` every one of these value changes is returned as a posting (the movement
// at its value, the Δ·B_w parts as "revaluation"), so begin + Σ postings = end exactly,
// per warehouse and per item ("Остаток на определенную дату" in cost mode), together
// with the "Общий" average at the end of every day (lib/stock/costs.ts).

export type LedgerMove = {
  day: string
  /** fin_key of the warehouse. */
  wk: string
  warehouse: string
  qty: number
  value: number
  kind: string
  docType: string
  docId: number
  isDefect: boolean
  /** A receipt without a cost of its own (production output that consumed nothing of
   * known value): it comes in at the scope's average instead of being a cost receipt. */
  atAverage?: boolean
}

/** A manual cost entry; `at` = the local moment it was entered ("YYYY-MM-DDTHH:mm:ss[.mmm]",
 * '' = unknown): on its own day it takes effect then, otherwise from the start of its day. */
export type LedgerEntry = { id: number; day: string; wk: string; warehouse: string; cost: number; at: string }

export type LedgerDocMeta = {
  /** Moment of the document's stock effect, local "YYYY-MM-DDTHH:mm:ss[.mmm]" ('' = unknown). */
  at: string
  /** Internal transfer: the moments its goods left (given) and arrived (accepted). */
  outAt?: string
  inAt?: string
  /** Inventory "на начало дня" / "на конец дня". */
  startOfDay: boolean
  endOfDay: boolean
  /** Internal transfer: fin_key of the source warehouse. */
  fromWk: string
}

export type LedgerRecord = {
  nk: string
  scope: string
  scopeName: string
  place: string
  day: string
  at: string
  sourceType: NetCostSource
  sourceId: number
  entryId: number | null
  qty: number
  realCost: number
  cost: number
  prevCost: number | null
  balance: number
  balanceAfter: number
  revaluation: number | null
  totalRevaluation: number | null
  negativeOk: boolean
  timelapseOk: boolean
  /** Set by the caller (needs the stock core's balances). */
  balanceOk: boolean
  /** The latest record of its scope up to today (the one the balance check applies to). */
  current: boolean
  nextDay: string | null
  negatives: NetCostDocument[]
  docs: NetCostDocument[]
}

export type LedgerWarehouse = {
  wk: string
  name: string
  scope: string
  /** On hand without the defective units. */
  qty: number
  /** Defective units (Брак, no value). */
  defects: number
  value: number
  current: number
  revaluation: number
  avg: number
  hasCost: boolean
}

export type LedgerScope = { key: string; name: string; qty: number; avg: number; hasAvg: boolean }

/** Kind of the postings that revalue stock on hand (no quantity). */
export const REVALUATION_KIND = "revaluation"

/** One value change of one warehouse (trace). */
export type LedgerPosting = { day: string; wk: string; kind: string; docType: string; docId: number; qty: number; value: number }

/** "Общий" average at the end of a day (trace; only days with events). */
export type LedgerAverage = { day: string; avg: number }

/** Average of a warehouse that is its own scope (a manual cost entry of that warehouse),
 * at the end of a day (trace; only days on which it changed or the scope began). */
export type LedgerOwnAverage = { day: string; wk: string; avg: number }

export type LedgerItemResult = {
  records: LedgerRecord[]
  warehouses: LedgerWarehouse[]
  scopes: LedgerScope[]
  /** With `trace`: every value change, in ledger order. */
  postings?: LedgerPosting[]
  /** The "Общий" average after each day that had events. */
  averages?: LedgerAverage[]
  /** The averages of the warehouses that are their own scope. */
  ownAverages?: LedgerOwnAverage[]
  /** Posted value (signed: issues < 0) of every production line (production_movements id →
   * value): the raw issues a batch's output is valued from (lib/net-cost-sync.ts). */
  production: Map<number, number>
}

export type LedgerItemInput = {
  itemKey: string
  moves: LedgerMove[]
  entries: LedgerEntry[]
  defaultCost: number
  /** Totals and the balance check are taken at the end of this day. */
  today: string
  meta: Map<string, LedgerDocMeta>
  /** Collect the documents of every record (detail view). */
  collectDocs?: boolean
  /** Return the value postings (the daily averages are always returned). */
  trace?: boolean
}

const EPS = 1e-6
const MAX_NEGATIVES = 50

export const isCostReceipt = (move: LedgerMove) =>
  move.qty > 0 && !move.isDefect && !move.atAverage && (move.kind === "supply" || move.kind === "manufacture_in" || (move.kind === "inventory_in" && move.value > 0))

/** The production lines whose posted values the ledger returns (LedgerItemResult.production). */
const PRODUCTION_DOC = "production_movements"

type Event =
  | { kind: "split"; day: string; phase: number; at: string; rank: number; tie: string; wk: string; name: string }
  | { kind: "manual"; day: string; phase: number; at: string; rank: number; tie: string; entry: LedgerEntry }
  | { kind: "move"; day: string; phase: number; at: string; rank: number; tie: string; move: LedgerMove }

type Scope = LedgerScope & { whs: Set<string>; record: LedgerRecord | null; negRun: NetCostDocument[] }
type Wh = { wk: string; name: string; scope: string; qty: number; defects: number; value: number; revaluation: number }

const MOMENT = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/

/** "YYYY-MM-DDTHH:mm:ss.mmm" of a moment on `day`; '' when it is unknown or on another day. */
export function momentOnDay(day: string, at: string | undefined): string {
  const match = MOMENT.exec(at ?? "")
  if (!match || match[1] !== day) return ""
  return `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}.${(match[5] ?? "").padEnd(3, "0")}`
}

function movePhase(move: LedgerMove, meta: LedgerDocMeta | undefined): number {
  if (move.docType === "stock_inventories" && meta?.startOfDay) return 2
  if (move.docType === "stock_inventories" && meta?.endOfDay) return 4
  return 3
}

/** The registered moment of a movement (the leg's own one for transfers; '' = unknown). */
function registeredAt(move: LedgerMove, meta: LedgerDocMeta | undefined): string {
  return (move.kind === "transfer_out" ? (meta?.outAt ?? meta?.at) : move.kind === "transfer_in" ? (meta?.inAt ?? meta?.at) : meta?.at) ?? ""
}

/** The moment a movement's goods moved on its day (see the header). */
function moveMoment(move: LedgerMove, meta: LedgerDocMeta | undefined): string {
  return momentOnDay(move.day, registeredAt(move, meta)) || `${move.day}T${move.qty > 0 ? "00:00:00.000" : "23:59:59.999"}`
}

/** At the same moment: receipts (0), issues (1), transfer receipts (2) — a total order. */
const moveRank = (move: LedgerMove) => (move.qty > 0 ? (move.kind === "transfer_in" ? 2 : 0) : 1)

/** A manual entry at the same moment as documents comes after them. */
const MANUAL_RANK = 3

/** Where a manual entry takes effect: at the moment it was entered when that is on its own
 * day (phase 3, among the documents), else at the start of its day (phase 1). */
export function entryPlacement(entry: Pick<LedgerEntry, "day" | "at">): { phase: number; at: string; rank: number } {
  const moment = momentOnDay(entry.day, entry.at)
  return moment ? { phase: 3, at: moment, rank: MANUAL_RANK } : { phase: 1, at: entry.at, rank: 0 }
}

function compareEvents(a: Event, b: Event): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if (a.phase !== b.phase) return a.phase - b.phase
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  if (a.rank !== b.rank) return a.rank - b.rank
  return a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0
}

const near = (a: number, b: number) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b))

export function runItemLedger(input: LedgerItemInput): LedgerItemResult {
  const { itemKey, defaultCost, today, meta, collectDocs, trace } = input
  const events: Event[] = []
  for (const entry of input.entries) {
    const place = entryPlacement(entry)
    events.push({ kind: "manual", day: entry.day, ...place, tie: `manual:${String(entry.id).padStart(10, "0")}`, entry })
  }
  // A warehouse becomes its own scope right before its first entry takes effect (at the
  // start of that day for a back-dated one: phase 0, before everything of the day).
  const ownSince = new Map<string, Extract<Event, { kind: "manual" }>>()
  for (const event of events) {
    if (event.kind !== "manual" || !event.entry.wk) continue
    const known = ownSince.get(event.entry.wk)
    if (!known || compareEvents(event, known) < 0) ownSince.set(event.entry.wk, event)
  }
  for (const [wk, first] of ownSince) {
    const name = first.entry.warehouse
    if (first.phase === 1) events.push({ kind: "split", day: first.day, phase: 0, at: "", rank: 0, tie: wk, wk, name })
    else events.push({ kind: "split", day: first.day, phase: first.phase, at: first.at, rank: first.rank, tie: `!split:${wk}`, wk, name })
  }
  for (const move of input.moves) {
    const info = meta.get(`${move.docType}:${move.docId}`)
    const phase = movePhase(move, info)
    // Inventories keep their phase; their confirmation time orders them among themselves.
    const at = phase === 3 ? moveMoment(move, info) : (info?.at ?? "")
    events.push({ kind: "move", day: move.day, phase, at, rank: moveRank(move), tie: `${move.docType}:${String(move.docId).padStart(10, "0")}:${move.kind}:${move.isDefect ? 1 : 0}`, move })
  }
  events.sort(compareEvents)

  const scopes = new Map<string, Scope>()
  const newScope = (key: string, name: string, avg: number, hasAvg: boolean): Scope => {
    const scope: Scope = { key, name, qty: 0, avg, hasAvg, whs: new Set(), record: null, negRun: [] }
    scopes.set(key, scope)
    return scope
  }
  newScope("", "", defaultCost, false)
  const whs = new Map<string, Wh>()
  const whOf = (wk: string, name: string): Wh => {
    let wh = whs.get(wk)
    if (!wh) {
      wh = { wk, name, scope: "", qty: 0, defects: 0, value: 0, revaluation: 0 }
      whs.set(wk, wh)
      scopes.get("")!.whs.add(wk)
    }
    return wh
  }
  const transit = new Map<number, { scope: string; unit: number }>()
  const records: LedgerRecord[] = []
  let snapshot: LedgerItemResult | null = null
  const postings: LedgerPosting[] = []
  const averages: LedgerAverage[] = []
  const ownAverages: LedgerOwnAverage[] = []
  const production = new Map<number, number>()
  const post = (day: string, wk: string, kind: string, docType: string, docId: number, qty: number, value: number) => {
    if (docType === PRODUCTION_DOC && kind !== REVALUATION_KIND) production.set(docId, (production.get(docId) ?? 0) + value)
    if (trace && (qty || value)) postings.push({ day, wk, kind, docType, docId, qty, value })
  }

  const takeSnapshot = (): LedgerItemResult => ({
    production,
    records,
    warehouses: [...whs.values()].map((wh) => {
      const scope = scopes.get(wh.scope)!
      return {
        wk: wh.wk,
        name: wh.name,
        scope: wh.scope,
        qty: wh.qty,
        defects: wh.defects,
        value: wh.value,
        current: wh.qty * scope.avg,
        revaluation: wh.revaluation,
        avg: scope.avg,
        hasCost: scope.hasAvg || scope.avg > 0,
      }
    }),
    scopes: [...scopes.values()].map(({ key, name, qty, avg, hasAvg }) => ({ key, name, qty, avg, hasAvg })),
  })

  const doc = (move: LedgerMove, cost: number, balanceAfter: number): NetCostDocument => ({
    docType: move.docType,
    docId: move.docId,
    kind: move.kind,
    warehouse: move.warehouse,
    day: move.day,
    qty: move.qty,
    cost,
    balanceAfter,
  })

  /** Revalues the stock on hand of a scope by Δ per unit (caused by the given document). */
  const revalue = (scope: Scope, delta: number, day: string, docType: string, docId: number) => {
    if (!delta) return
    for (const wk of scope.whs) {
      const wh = whs.get(wk)!
      if (!wh.qty) continue
      wh.value += delta * wh.qty
      wh.revaluation += delta * wh.qty
      post(day, wk, REVALUATION_KIND, docType, docId, 0, delta * wh.qty)
    }
  }

  const open = (scope: Scope, record: LedgerRecord) => {
    if (scope.record) scope.record.nextDay = record.day
    if (record.balance < -EPS) {
      record.negativeOk = false
      record.negatives = scope.negRun.slice(-MAX_NEGATIVES)
    }
    scope.record = record
    records.push(record)
  }

  const makeRecord = (scope: Scope, fields: Pick<LedgerRecord, "nk" | "place" | "day" | "at" | "sourceType" | "sourceId" | "entryId" | "qty" | "realCost">, next: number): LedgerRecord => {
    const balance = scope.qty
    const delta = next - scope.avg
    const known = scope.hasAvg || Math.abs(balance) > EPS
    return {
      ...fields,
      scope: scope.key,
      scopeName: scope.name,
      cost: next,
      prevCost: scope.hasAvg ? scope.avg : null,
      balance,
      balanceAfter: balance + fields.qty,
      revaluation: known ? delta : null,
      totalRevaluation: known ? delta * balance : null,
      negativeOk: true,
      timelapseOk: true,
      balanceOk: true,
      current: false,
      nextDay: null,
      negatives: [],
      docs: [],
    }
  }

  /** Balance bookkeeping after a movement: negative runs and the record's documents. */
  const track = (scope: Scope, entry: NetCostDocument) => {
    if (scope.qty < -EPS) {
      scope.negRun.push(entry)
      if (scope.negRun.length > MAX_NEGATIVES) scope.negRun.shift()
      if (scope.record) {
        scope.record.negativeOk = false
        if (scope.record.negatives.length < MAX_NEGATIVES) scope.record.negatives.push(entry)
      }
    } else if (scope.negRun.length) {
      scope.negRun = []
    }
    if (collectDocs && scope.record) scope.record.docs.push(entry)
  }

  const common = scopes.get("")!
  /** Notes the average of `scope` at the end of `day`. Own scopes are keyed by their warehouse. */
  const noteAverage = (day: string, scope: Scope = common) => {
    if (scope.key === "") {
      const last = averages[averages.length - 1]
      if (last && last.day === day) last.avg = scope.avg
      else averages.push({ day, avg: scope.avg })
      return
    }
    const last = ownAverages.findLast((entry) => entry.wk === scope.key)
    if (last && last.day === day) last.avg = scope.avg
    else ownAverages.push({ day, wk: scope.key, avg: scope.avg })
  }

  for (const event of events) {
    if (!snapshot && event.day > today) snapshot = takeSnapshot()

    if (event.kind === "split") {
      const own = newScope(event.wk, whs.get(event.wk)?.name || event.name, common.avg, common.hasAvg)
      const wh = whOf(event.wk, event.name)
      common.whs.delete(event.wk)
      common.qty -= wh.qty
      own.whs.add(event.wk)
      own.qty += wh.qty
      wh.scope = event.wk
      noteAverage(event.day, own)
      continue
    }

    if (event.kind === "manual") {
      const { entry } = event
      const scope = scopes.get(entry.wk && scopes.has(entry.wk) ? entry.wk : "")!
      const record = makeRecord(
        scope,
        { nk: `manual:${entry.id}:${itemKey}`, place: entry.warehouse, day: entry.day, at: entry.at, sourceType: "manual", sourceId: entry.id, entryId: entry.id, qty: 0, realCost: entry.cost },
        entry.cost,
      )
      revalue(scope, entry.cost - scope.avg, entry.day, "manual", entry.id)
      scope.avg = entry.cost
      scope.hasAvg = true
      open(scope, record)
      noteAverage(event.day, scope)
      continue
    }

    const { move } = event
    const wh = whOf(move.wk, move.warehouse)
    const scope = scopes.get(wh.scope)!

    if (move.isDefect) {
      // Брак: counted apart, no value, never part of the average.
      wh.defects += move.qty
      post(move.day, move.wk, move.kind, move.docType, move.docId, move.qty, 0)
      if (collectDocs && scope.record) scope.record.docs.push(doc(move, 0, scope.qty))
      continue
    }

    if (move.qty > 0) {
      let unit: number | null = null
      if (isCostReceipt(move)) unit = move.value / move.qty
      else if (move.kind === "transfer_in") {
        const sent = transit.get(move.docId)
        const fromScope = sent?.scope ?? whs.get(meta.get(`internal_transfers:${move.docId}`)?.fromWk ?? "")?.scope ?? scope.key
        const sentUnit = sent?.unit ?? scopes.get(fromScope)?.avg ?? scope.avg
        // Same scope at an unchanged average: neutral (no record).
        if (fromScope !== scope.key || !near(sentUnit, scope.avg)) unit = sentUnit
      }
      if (unit !== null) {
        const q = move.qty
        const before = scope.qty
        // Stock that came in while no cost was known yet (no cost receipt, no manual entry,
        // no catalog cost: the average is still an unset 0) carries no value; the first
        // known cost values it, like a manual entry (Δ·B is a revaluation), instead of
        // being blended in at 0.
        const unvalued = before > EPS && !scope.hasAvg && scope.avg === 0
        const next = before > EPS && !unvalued ? (before * scope.avg + q * unit) / (before + q) : unit
        const delta = next - scope.avg
        const offset = unvalued ? 0 : delta * before
        const record = makeRecord(
          scope,
          { nk: `${move.docType}:${move.docId}:${itemKey}`, place: move.warehouse, day: move.day, at: registeredAt(move, meta.get(`${move.docType}:${move.docId}`)), sourceType: move.docType as NetCostSource, sourceId: move.docId, entryId: null, qty: q, realCost: unit },
          next,
        )
        revalue(scope, delta, move.day, move.docType, move.docId)
        wh.value += q * unit - offset
        post(move.day, move.wk, move.kind, move.docType, move.docId, q, q * unit)
        post(move.day, move.wk, REVALUATION_KIND, move.docType, move.docId, 0, -offset)
        wh.qty += q
        scope.qty += q
        scope.avg = next
        scope.hasAvg = true
        open(scope, record)
        if (collectDocs) record.docs.push(doc(move, unit, scope.qty))
        if (scope.qty >= -EPS) scope.negRun = []
        noteAverage(event.day, scope)
        continue
      }
      wh.value += move.qty * scope.avg
      post(move.day, move.wk, move.kind, move.docType, move.docId, move.qty, move.qty * scope.avg)
      wh.qty += move.qty
      scope.qty += move.qty
      track(scope, doc(move, scope.avg, scope.qty))
      noteAverage(event.day, scope)
      continue
    }

    const q = -move.qty
    wh.value -= q * scope.avg
    post(move.day, move.wk, move.kind, move.docType, move.docId, -q, -q * scope.avg)
    wh.qty -= q
    scope.qty -= q
    if (move.kind === "transfer_out") transit.set(move.docId, { scope: scope.key, unit: scope.avg })
    track(scope, doc(move, scope.avg, scope.qty))
    noteAverage(event.day, scope)
  }

  const result = snapshot ?? takeSnapshot()

  // Анализ времены: a record registered after a record of the same scope with a later day.
  const byScope = new Map<string, LedgerRecord[]>()
  for (const record of records) {
    const list = byScope.get(record.scope) ?? []
    list.push(record)
    byScope.set(record.scope, list)
  }
  for (const list of byScope.values()) {
    const registered = list.map((record, index) => ({ record, index, at: record.at || `${record.day}T00:00:00` }))
    registered.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.index - b.index))
    let latest = ""
    for (const { record } of registered) {
      if (latest && record.day < latest) record.timelapseOk = false
      if (record.day > latest) latest = record.day
    }
    const current = [...list].reverse().find((record) => record.day <= today)
    if (current) current.current = true
  }

  return { ...result, records, production, averages, ownAverages, ...(trace ? { postings } : {}) }
}
