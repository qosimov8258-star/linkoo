import "server-only"

import { costsFromLedger, documentLineUnit, documentLineValues, loadCostLedger } from "@/lib/stock/costs"
import { getStockCatalog, stockMovementsSql } from "@/lib/stock/ledger"
import type { StockCatalogItem } from "@/lib/stock/types"

import { defineModel, type FilterDef, type ModelImpl, type RunContext } from "../context"
import { nameKey, type ProductInfo } from "../directory"
import { YES_NO } from "../facets"
import { dayGroups, max, min, plain, round, sum, yesNo, type GroupDef, type MeasureFn } from "../pivot"

// The stock models of the old report builder — one record per movement of the stock ledger (lib/stock: every
// document line that moved goods in or out of a warehouse, the source of «Остаток» and «Движение товаров»):
//   stock_transaction        «Склад»: every movement on its day;
//   stock_transaction_party  «Остаток партий»: the movements of the production batches, by the day of the batch.
// A receipt is a positive quantity, an issue a negative one. The cost of a movement is the one the cost ledger
// moved it at (base currency).

type Move = {
  day: string
  warehouse: string
  key: string
  name: string
  item?: StockCatalogItem
  product?: ProductInfo
  qty: number
  /** Unit cost, base currency (0 when unknown or not asked for). */
  cost: number
  type: string
  docId: number
  user: string
  comment: string
  /** Production batch (Партия №) of the movement. */
  party: number | null
  box: number
  kg: number
}

const TYPE_LABEL: Record<string, string> = {
  supply: "Поставка",
  supply_return: "Возврат поставщику",
  order: "Заказ",
  return: "Возврат",
  writeoff: "Списание",
  transfer_in: "Внутренний перевод",
  transfer_out: "Внутренний перевод",
  manufacture_in: "Заявка на П.",
  manufacture_out: "Расход сырья",
  inventory_in: "Инвентаризация",
  inventory_out: "Инвентаризация",
  none_in: "Прочее",
  none_out: "Прочее",
}
const TYPE_OPTIONS = [...new Set(Object.values(TYPE_LABEL))]
const COST_FIELDS = ["d_net_cost_sum", "d_net_cost_min", "d_net_cost_max", "net_cost_id", "net_cost_id_real"]
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())

/** Who made a document and its comment, per source table of the ledger. */
const DOCUMENT_INFO: Record<string, string> = {
  supplier_incomings: "SELECT id, COALESCE(NULLIF(accepted_by, ''), initiator) AS who, comment FROM supplier_incomings WHERE id = ANY(@ids::int[])",
  supplier_returns: "SELECT id, added_by AS who, reason AS comment FROM supplier_returns WHERE id = ANY(@ids::int[])",
  write_offs: "SELECT id, creator AS who, comment FROM write_offs WHERE id = ANY(@ids::int[])",
  internal_transfers: "SELECT id, created_by AS who, comment FROM internal_transfers WHERE id = ANY(@ids::int[])",
  stock_inventories: "SELECT id, created_by AS who, comment FROM stock_inventories WHERE id = ANY(@ids::int[])",
  orders: "SELECT id, COALESCE(NULLIF(to_jsonb(o) ->> 'created_by', ''), agent) AS who, to_jsonb(o) ->> 'comment' AS comment FROM orders o WHERE id = ANY(@ids::int[])",
  client_returns: "SELECT id, created_by AS who, comment FROM client_returns WHERE id = ANY(@ids::int[])",
  production_movements: "SELECT id, user_name AS who, comment, party_id FROM production_movements WHERE id = ANY(@ids::int[])",
}

async function loadMoves(context: RunContext, byParty: boolean): Promise<Move[]> {
  const { db, dir } = context
  const { sql, params } = await stockMovementsSql({}, db)
  // «Остаток партий»: the movements of production batches, in the period by the batch's own day.
  const rows = (await db
    .prepare(
      byParty
        ? `SELECT m.day, m.warehouse, m.item_key, m.qty, m.kind, m.doc_type, m.doc_id
             FROM (${sql}) m
             JOIN production_movements pm ON m.doc_type = 'production_movements' AND pm.id = m.doc_id
             JOIN production_parties pp ON pp.id = pm.party_id
            WHERE fin_ts(NULLIF(pp.date, ''))::date BETWEEN @from::date AND @to::date`
        : `SELECT m.day, m.warehouse, m.item_key, m.qty, m.kind, m.doc_type, m.doc_id FROM (${sql}) m WHERE m.day BETWEEN @from AND @to`,
    )
    .all({ ...params, from: context.from, to: context.to })) as Record<string, unknown>[]
  if (!rows.length) return []
  const [catalog, products, warehouseBranches] = await Promise.all([getStockCatalog(db), dir.products(), dir.warehouseBranches()])
  const itemByKey = new Map(catalog.map((item) => [item.key, item]))

  // The documents' author, comment and batch: asked per source table, only when a field needs them.
  const info = new Map<string, { who: string; comment: string; party: number | null }>()
  if (byParty || context.wants("user_name", "comment", "party_id", "manufacture_party")) {
    const idsByType = new Map<string, Set<number>>()
    for (const row of rows) {
      const type = str(row.doc_type)
      if (!DOCUMENT_INFO[type]) continue
      const ids = idsByType.get(type) ?? new Set<number>()
      ids.add(Number(row.doc_id))
      idsByType.set(type, ids)
    }
    for (const [type, ids] of idsByType) {
      const found = (await db.prepare(DOCUMENT_INFO[type]).all({ ids: [...ids] }).catch(() => [])) as Record<string, unknown>[]
      for (const doc of found) info.set(`${type}:${doc.id}`, { who: str(doc.who), comment: str(doc.comment), party: doc.party_id === null || doc.party_id === undefined ? null : Number(doc.party_id) })
    }
  }

  const ledger = context.wants(...COST_FIELDS) ? await loadCostLedger(db) : null
  const moved = ledger ? documentLineValues(ledger) : null
  const costsByDay = new Map<string, Map<string, number>>()
  const moves: Move[] = []
  for (const row of rows) {
    const warehouse = str(row.warehouse)
    if (context.branch && nameKey(warehouseBranches.get(nameKey(warehouse))) !== nameKey(context.branch)) continue
    const key = str(row.item_key)
    const item = itemByKey.get(key)
    const product = key.startsWith("product:") ? products.get(Number(key.slice(8))) : undefined
    const day = str(row.day)
    const docType = str(row.doc_type)
    const docId = Number(row.doc_id)
    let cost = 0
    if (ledger && moved) {
      let unit = documentLineUnit(moved, docType, docId, key)
      if (unit === undefined) {
        let costs = costsByDay.get(day)
        if (!costs) costsByDay.set(day, (costs = costsFromLedger(ledger, day)))
        unit = costs.get(key)
      }
      cost = unit ?? 0
    }
    const doc = info.get(`${docType}:${docId}`)
    moves.push({
      day,
      warehouse,
      key,
      name: item?.name ?? product?.name ?? key.replace(/^name:/, ""),
      item,
      product,
      qty: Number(row.qty) || 0,
      cost,
      type: TYPE_LABEL[str(row.kind)] ?? str(row.kind),
      docId,
      user: doc?.who ?? "",
      comment: doc?.comment ?? "",
      party: doc?.party ?? null,
      box: product?.box || item?.boxSize || 0,
      kg: product?.kg || item?.weight || 0,
    })
  }
  return moves
}

type M = Move
const days = dayGroups<M>((move) => move.day)
const text = (pick: (move: M) => string | number | null | undefined): GroupDef<M> => ({ label: pick })
/** Movements of this app's stock ledger carry no series and no production / expiry dates of their own. */
const none = text(() => "")

const GROUPS: Record<string, GroupDef<M>> = {
  product_id: text((move) => move.name),
  stock_id: text((move) => move.warehouse),
  created_date_day: days.byDay,
  created_date_week: days.byWeek,
  created_date_month: days.byMonth,
  created_date_year: days.byYear,
  content_type_id: text((move) => move.type),
  user_name: text((move) => move.user),
  comment: text((move) => move.comment),
  manufacture_date: none,
  expiration_date: none,
  series_number: none,
  party_id: text((move) => move.party ?? ""),
  net_cost_id: text((move) => plain(move.cost, 2)),
  net_cost_id_real: text((move) => plain(move.cost, 2)),
  product_stock_number: text((move) => move.product?.orderNumber ?? ""),
}

const plus = (move: M) => (move.qty > 0 ? move.qty : 0)
const minus = (move: M) => (move.qty < 0 ? -move.qty : 0)
const blocks = (move: M, qty: number) => (move.box > 0 ? qty / move.box : 0)

const MEASURES: Record<string, MeasureFn<M>> = {
  d_net_cost_sum: sum((move) => move.cost * move.qty, 2),
  d_net_cost_min: min((move) => (move.cost > 0 ? move.cost : null), 2),
  d_net_cost_max: max((move) => (move.cost > 0 ? move.cost : null), 2),
  amount_sum: sum((move) => move.qty),
  amount_sum_box: sum((move) => blocks(move, move.qty)),
  plus_amount: sum(plus),
  kg_prixod: sum((move) => move.kg * plus(move)),
  plus_box_amount: sum((move) => blocks(move, plus(move))),
  minus_amount: sum(minus),
  // As the reference counts it: the weight of the issues with their sign.
  kg_rasxod: (records) => round(-Number(sum<M>((move) => move.kg * minus(move))(records))),
  minus_box_amount: sum((move) => blocks(move, minus(move))),
  kg_total: sum((move) => move.kg * Math.abs(move.qty)),
}

const eq = (pick: FilterDef<M>["value"], options?: FilterDef<M>["options"]): FilterDef<M> => ({ value: pick, options })
const FILTERS: Record<string, FilterDef<M>> = {
  product_name: eq((move) => move.name),
  stock_name: eq((move) => move.warehouse),
  stock_types_name: eq((move) => move.type, () => TYPE_OPTIONS),
  boolean_filter_use_expiration: eq((move) => yesNo(move.product?.trackExpiry), () => YES_NO),
  manufacture_party: eq((move) => move.party ?? ""),
  product_type_name: eq((move) => move.product?.type ?? move.item?.type),
}

const model = (byParty: boolean): ModelImpl<M> =>
  defineModel<M>({ access: "any", load: (context) => loadMoves(context, byParty), groups: GROUPS, measures: MEASURES, filters: FILTERS, cost: COST_FIELDS })

export const stockTransactionModel = model(false)
export const stockTransactionPartyModel = model(true)
