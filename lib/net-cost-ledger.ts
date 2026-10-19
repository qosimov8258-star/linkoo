import type { NetCostDocument, NetCostSource } from "@/lib/net-cost-types"

// The moving-average cost ledger of ONE stock item (pure; lib/net-cost-sync.ts feeds it
// the stock core's movements and the manual cost entries, in any order).
//
// Order: by day; within a day manual entries first (a cost applies "from the start of the
// chosen day"), then "на начало дня" inventories, receipts, issues, "на конец дня"
// inventories; ties by the document's registration time, type and id.
//
// Scopes: "Общий" ('') holds every warehouse; a warehouse with its own manual cost entry
// becomes its own scope from the day of its first entry (its stock moves over at the
// common average, then the entry sets its cost). A transfer between two scopes is a
// receipt of the target at the source's average when the goods left.
//
// Per scope: balance B and average A (starts at the item's default cost). A receipt of q
// at unit cost r with B > 0 blends A' = (B·A + q·r) / (B + q); with B ≤ 0 it resets A' = r.
// A manual entry sets A' = its cost. Every change revalues the stock on hand: Δ = A' − A,
// Общая сумма переоценки = Δ·B. Issues and other receipts move goods at A.
//
// Value per warehouse V ("Накопленная себестоимость"): issues −q·A, other receipts +q·A,
// a manual entry Δ·B_w to each warehouse, a cost receipt Δ·B_w to each warehouse plus
// q·r − Δ·B to the receiving one. While the balance stays ≥ 0 this keeps V = B_w·A
// exactly ("Текущая себестоимость остатки"); a receipt into a negative balance resets the
// average and leaves the difference (Δ·B) in the receiving warehouse ("Разница").

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
}

export type LedgerEntry = { id: number; day: string; wk: string; warehouse: string; cost: number; at: string }

export type LedgerDocMeta = {
  /** Registration time of the document, local "YYYY-MM-DDTHH:mm:ss" ('' = unknown). */
  at: string
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

export type LedgerWarehouse = { wk: string; name: string; scope: string; qty: number; value: number; current: number; revaluation: number; avg: number; hasCost: boolean }

export type LedgerScope = { key: string; name: string; qty: number; avg: number; hasAvg: boolean }

export type LedgerItemResult = { records: LedgerRecord[]; warehouses: LedgerWarehouse[]; scopes: LedgerScope[] }

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
}

const EPS = 1e-6
const MAX_NEGATIVES = 50

export const isCostReceipt = (move: LedgerMove) =>
  move.qty > 0 && (move.kind === "supply" || (move.kind === "manufacture_in" && !move.isDefect) || (move.kind === "inventory_in" && move.value > 0))

type Event =
  | { kind: "split"; day: string; phase: number; at: string; tie: string; wk: string; name: string }
  | { kind: "manual"; day: string; phase: number; at: string; tie: string; entry: LedgerEntry }
  | { kind: "move"; day: string; phase: number; at: string; tie: string; move: LedgerMove }

type Scope = LedgerScope & { whs: Set<string>; record: LedgerRecord | null; negRun: NetCostDocument[] }
type Wh = { wk: string; name: string; scope: string; qty: number; value: number; revaluation: number }

function movePhase(move: LedgerMove, meta: LedgerDocMeta | undefined): number {
  if (move.docType === "stock_inventories" && meta?.startOfDay) return 2
  if (move.docType === "stock_inventories" && meta?.endOfDay) return 5
  return move.qty > 0 ? 3 : 4
}

function compareEvents(a: Event, b: Event): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if (a.phase !== b.phase) return a.phase - b.phase
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  return a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0
}

export function runItemLedger(input: LedgerItemInput): LedgerItemResult {
  const { itemKey, defaultCost, today, meta, collectDocs } = input
  const ownSince = new Map<string, { day: string; name: string }>()
  for (const entry of input.entries) {
    if (!entry.wk) continue
    const known = ownSince.get(entry.wk)
    if (!known || entry.day < known.day) ownSince.set(entry.wk, { day: entry.day, name: entry.warehouse })
  }

  const events: Event[] = []
  for (const [wk, since] of ownSince) events.push({ kind: "split", day: since.day, phase: 0, at: "", tie: wk, wk, name: since.name })
  for (const entry of input.entries) events.push({ kind: "manual", day: entry.day, phase: 1, at: entry.at, tie: `manual:${String(entry.id).padStart(10, "0")}`, entry })
  for (const move of input.moves) {
    const info = meta.get(`${move.docType}:${move.docId}`)
    events.push({ kind: "move", day: move.day, phase: movePhase(move, info), at: info?.at ?? "", tie: `${move.docType}:${String(move.docId).padStart(10, "0")}:${move.kind}`, move })
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
      wh = { wk, name, scope: "", qty: 0, value: 0, revaluation: 0 }
      whs.set(wk, wh)
      scopes.get("")!.whs.add(wk)
    }
    return wh
  }
  const transit = new Map<number, { scope: string; unit: number }>()
  const records: LedgerRecord[] = []
  let snapshot: LedgerItemResult | null = null

  const takeSnapshot = (): LedgerItemResult => ({
    records,
    warehouses: [...whs.values()].map((wh) => {
      const scope = scopes.get(wh.scope)!
      return { wk: wh.wk, name: wh.name, scope: wh.scope, qty: wh.qty, value: wh.value, current: wh.qty * scope.avg, revaluation: wh.revaluation, avg: scope.avg, hasCost: scope.hasAvg || scope.avg > 0 }
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

  /** Revalues the stock on hand of a scope by Δ per unit. */
  const revalue = (scope: Scope, delta: number) => {
    if (!delta) return
    for (const wk of scope.whs) {
      const wh = whs.get(wk)!
      if (!wh.qty) continue
      wh.value += delta * wh.qty
      wh.revaluation += delta * wh.qty
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

  for (const event of events) {
    if (!snapshot && event.day > today) snapshot = takeSnapshot()

    if (event.kind === "split") {
      const common = scopes.get("")!
      const own = newScope(event.wk, whs.get(event.wk)?.name || event.name, common.avg, common.hasAvg)
      const wh = whOf(event.wk, event.name)
      common.whs.delete(event.wk)
      common.qty -= wh.qty
      own.whs.add(event.wk)
      own.qty += wh.qty
      wh.scope = event.wk
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
      revalue(scope, entry.cost - scope.avg)
      scope.avg = entry.cost
      scope.hasAvg = true
      open(scope, record)
      continue
    }

    const { move } = event
    const wh = whOf(move.wk, move.warehouse)
    const scope = scopes.get(wh.scope)!

    if (move.qty > 0) {
      let unit: number | null = null
      if (isCostReceipt(move)) unit = move.value / move.qty
      else if (move.kind === "transfer_in") {
        const sent = transit.get(move.docId)
        const fromScope = sent?.scope ?? whs.get(meta.get(`internal_transfers:${move.docId}`)?.fromWk ?? "")?.scope ?? scope.key
        if (fromScope !== scope.key) unit = sent?.unit ?? scopes.get(fromScope)?.avg ?? scope.avg
      }
      if (unit !== null) {
        const q = move.qty
        const before = scope.qty
        const next = before > EPS ? (before * scope.avg + q * unit) / (before + q) : unit
        const delta = next - scope.avg
        const record = makeRecord(
          scope,
          { nk: `${move.docType}:${move.docId}:${itemKey}`, place: move.warehouse, day: move.day, at: event.at, sourceType: move.docType as NetCostSource, sourceId: move.docId, entryId: null, qty: q, realCost: unit },
          next,
        )
        revalue(scope, delta)
        wh.value += q * unit - delta * before
        wh.qty += q
        scope.qty += q
        scope.avg = next
        scope.hasAvg = true
        open(scope, record)
        if (collectDocs) record.docs.push(doc(move, unit, scope.qty))
        if (scope.qty >= -EPS) scope.negRun = []
        continue
      }
      wh.value += move.qty * scope.avg
      wh.qty += move.qty
      scope.qty += move.qty
      track(scope, doc(move, scope.avg, scope.qty))
      continue
    }

    const q = -move.qty
    wh.value -= q * scope.avg
    wh.qty -= q
    scope.qty -= q
    if (move.kind === "transfer_out") transit.set(move.docId, { scope: scope.key, unit: scope.avg })
    track(scope, doc(move, scope.avg, scope.qty))
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

  return { ...result, records }
}
