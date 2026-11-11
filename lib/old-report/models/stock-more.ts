import "server-only"

import { normCurrency } from "@/lib/finance/currency"
import { getStockBalances, getStockCatalog, getStockPending } from "@/lib/stock/ledger"
import type { StockCatalogItem } from "@/lib/stock/types"

import { defineModel, type FilterDef, type ModelImpl, type RunContext } from "../context"
import { nameKey, type ProductInfo } from "../directory"
import { dayGroups, distinct, dmy, perKey, plain, round, sum, yesNo, type GroupDef, type MeasureFn } from "../pivot"

// More stock models of the old report builder:
//   product_balances / product_series_balances  «Текущий остаток (по сериям)»: what every warehouse holds now,
//                                                whatever the period;
//   manufacture_writeoff / manufacture_return    «Производство расход / приход»: the raw material a production
//                                                batch used and what it made, on the day of the line or
//                                                («… по дате партии») on the day of the batch;
//   stock_transfer_product                       «Продукт передач со склада»: the lines of the transfers between
//                                                warehouses that are not cancelled;
//   supply_expense                               «Доп. расход поставок»: the additional expenses of the supplier
//                                                incomings (for the readers of purchases).

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const num = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}
const none = { label: () => "" }

// ---------------------------------------------------------------- Текущий остаток

type Balance = { warehouse: string; key: string; item?: StockCatalogItem; product?: ProductInfo; name: string; qty: number; reserved: number; box: number; kg: number; min: number }
type B = Balance
const b = (pick: (row: B) => string | number | null | undefined): GroupDef<B> => ({ label: pick })
const be = (pick: FilterDef<B>["value"]): FilterDef<B> => ({ value: pick })

const BALANCE_GROUPS: Record<string, GroupDef<B>> = {
  stock_id: b((row) => row.warehouse),
  product_id: b((row) => row.name),
  vendor_code: b((row) => row.product?.article ?? row.item?.article),
  barcode: b((row) => row.product?.barcode ?? row.item?.barcode),
  product_code: b((row) => row.product?.code),
  product_type_id: b((row) => row.product?.type ?? row.item?.type),
  brand_name: b((row) => row.product?.brand ?? row.item?.brand),
  product_min_amount: b((row) => plain(row.min)),
  type_parent_id: b((row) => row.product?.parentType),
  product_unique_id: b((row) => row.product?.id ?? row.item?.id),
  box_amount: b((row) => (row.box > 0 ? plain(row.box) : "")),
  // The stock ledger of this app keeps no series.
  series_number: none,
  series_expiration_date: none,
}

const BALANCE_MEASURES: Record<string, MeasureFn<B>> = {
  box_count: sum((row) => (row.qty > 0 && row.box > 0 ? row.qty / row.box : 0)),
  balance: sum((row) => row.qty),
  reserved: sum((row) => row.reserved),
  kg_balance: sum((row) => row.kg * row.qty),
  // The balance of the products of the cell over their minimum balances (each product's minimum once).
  min_amount_diff: (records) => round(Number(sum<B>((row) => row.qty)(records)) - Number(perKey<B>((row) => row.key, (row) => row.min)(records))),
  kg_reserved: sum((row) => row.kg * row.reserved),
  sku_count: distinct((row) => row.key),
}

const BALANCE_FILTERS: Record<string, FilterDef<B>> = {
  product_name: be((row) => row.name),
  stock_name: be((row) => row.warehouse),
  product_type_name: be((row) => row.product?.type ?? row.item?.type),
  Brand: be((row) => row.product?.brand ?? row.item?.brand),
  Division: be((row) => row.product?.organization ?? row.item?.organization),
  min_balance: be((row) => row.qty - row.min),
  min_balance_filter: be((row) => row.min),
}

async function loadBalances(context: RunContext): Promise<Balance[]> {
  const { db, dir } = context
  const [balances, pending, catalog, products, warehouseBranches] = await Promise.all([
    getStockBalances({}, db),
    context.wants("reserved", "kg_reserved") ? getStockPending({}, db) : Promise.resolve([]),
    getStockCatalog(db),
    dir.products(),
    dir.warehouseBranches(),
  ])
  const itemByKey = new Map(catalog.map((item) => [item.key, item]))
  const reserved = new Map(pending.map((row) => [`${row.key}\u0001${nameKey(row.warehouse)}`, row.reserved]))
  const rows: Balance[] = []
  for (const balance of balances) {
    if (context.branch && nameKey(warehouseBranches.get(nameKey(balance.warehouse))) !== nameKey(context.branch)) continue
    const item = itemByKey.get(balance.key)
    const product = balance.key.startsWith("product:") ? products.get(Number(balance.key.slice(8))) : undefined
    rows.push({
      warehouse: balance.warehouse,
      key: balance.key,
      item,
      product,
      name: item?.name ?? product?.name ?? balance.key.replace(/^name:/, ""),
      qty: balance.qty,
      reserved: reserved.get(`${balance.key}\u0001${nameKey(balance.warehouse)}`) ?? 0,
      box: product?.box || item?.boxSize || 0,
      kg: product?.kg || item?.weight || 0,
      min: item?.minStock ?? 0,
    })
  }
  return rows
}

const balanceModel = (): ModelImpl<B> => defineModel<B>({ access: "any", load: loadBalances, groups: BALANCE_GROUPS, measures: BALANCE_MEASURES, filters: BALANCE_FILTERS })
export const productBalancesModel = balanceModel()
export const productSeriesBalancesModel = balanceModel()

// ---------------------------------------------------------------- Производство

type Made = { day: string; party: number | null; partyDay: string; partyComment: string; stage: string; name: string; user: string; defect: boolean; qty: number; kg: number }
type P = Made
const madeDays = dayGroups<P>((row) => row.day)
const p = (pick: (row: P) => string | number | null | undefined): GroupDef<P> => ({ label: pick })

const MADE_GROUPS: Record<string, GroupDef<P>> = {
  manufacture_party_id: p((row) => row.party ?? ""),
  manufacture_party_date: { label: (row) => dmy(row.partyDay), sort: (row) => row.partyDay },
  manufacture_party_comment: p((row) => row.partyComment),
  product: p((row) => row.name),
  user_id: p((row) => row.user),
  created_date_day: madeDays.byDay,
  created_date_week: madeDays.byWeek,
  created_date_month: madeDays.byMonth,
  is_defect: p((row) => yesNo(row.defect)),
}
const MADE_MEASURES: Record<string, MeasureFn<P>> = {
  amount: sum((row) => (row.defect ? 0 : row.qty)),
  defect_amount: sum((row) => (row.defect ? row.qty : 0)),
  kg_amount: sum((row) => (row.defect ? 0 : row.kg * row.qty)),
  defect_kg_amount: sum((row) => (row.defect ? row.kg * row.qty : 0)),
}
const MADE_FILTERS: Record<string, FilterDef<P>> = {
  manufacturing: { value: (row) => row.stage },
  manufacture_party: { value: (row) => row.party ?? "" },
  product_name: { value: (row) => row.name },
}

function productionModel(direction: "raw" | "made", byParty: boolean): ModelImpl<P> {
  return defineModel<P>({
    access: "any",
    async load(context) {
      const own = "COALESCE(fin_ts(NULLIF(m.date, '')), fin_ts(m.created_at, true))"
      const party = "fin_ts(NULLIF(p.date, ''))"
      const dayTs = byParty ? party : own
      const rows = (await context.db
        .prepare(
          `SELECT m.party_id, m.item_kind, m.item_id, m.item_name, m.amount, COALESCE(m.is_defect, 0) AS is_defect, m.user_name, m.warehouse,
                  to_char((${dayTs})::date, 'YYYY-MM-DD') AS day, to_char((${party})::date, 'YYYY-MM-DD') AS party_day, p.comment AS party_comment, p.stage_name
             FROM production_movements m
             LEFT JOIN production_parties p ON p.id = m.party_id
            WHERE m.direction = @direction AND (p.id IS NULL OR p.status <> 'cancelled') ${byParty ? "AND p.id IS NOT NULL" : ""}
              AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
        )
        .all({ direction, from: context.from, to: context.to })) as Record<string, unknown>[]
      if (!rows.length) return []
      const [products, catalog, warehouseBranches] = await Promise.all([context.dir.products(), getStockCatalog(context.db), context.dir.warehouseBranches()])
      const itemByKey = new Map(catalog.map((item) => [item.key, item]))
      return rows.flatMap((row) => {
        if (context.branch && nameKey(warehouseBranches.get(nameKey(row.warehouse))) !== nameKey(context.branch)) return []
        const key = row.item_id === null ? "" : `${str(row.item_kind)}:${row.item_id}`
        const product = str(row.item_kind) === "product" && row.item_id !== null ? products.get(Number(row.item_id)) : undefined
        return [
          {
            day: str(row.day),
            party: row.party_id === null ? null : Number(row.party_id),
            partyDay: str(row.party_day),
            partyComment: str(row.party_comment),
            stage: str(row.stage_name),
            name: product?.name ?? itemByKey.get(key)?.name ?? str(row.item_name),
            user: str(row.user_name),
            defect: Number(row.is_defect) === 1,
            qty: num(row.amount),
            kg: product?.kg || itemByKey.get(key)?.weight || 0,
          },
        ]
      })
    },
    groups: MADE_GROUPS,
    measures: MADE_MEASURES,
    filters: MADE_FILTERS,
  })
}
export const manufactureWriteoffModel = productionModel("raw", false)
export const manufactureReturnModel = productionModel("made", false)
export const manufactureWriteoffPartyDateModel = productionModel("raw", true)
export const manufactureReturnPartyDateModel = productionModel("made", true)

// ---------------------------------------------------------------- Продукт передач со склада

type TransferLine = { id: number; day: string; status: string; from: string; to: string; fromBranch: string; toBranch: string; givenBy: string; acceptedBy: string; comment: string; name: string; series: string; qty: number; price: number; box: number; kg: number }
type T = TransferLine
const transferDays = dayGroups<T>((row) => row.day)
const t = (pick: (row: T) => string | number | null | undefined): GroupDef<T> => ({ label: pick })
/** The stored statuses in the builder's words. */
const TRANSFER_STATUS: Record<string, string> = { ожидает: "Ожидает", потвержден: "Подтвержден", подтвержден: "Подтвержден", "в пути": "В пути", принят: "Принят" }

export const stockTransferProductModel = defineModel<T>({
  access: "any",
  async load(context) {
    const dayTs = "fin_ts(d.created_at, true)"
    const rows = (await context.db
      .prepare(
        `SELECT d.id, d.from_warehouse, d.to_warehouse, d.status, d.comment, d.items, d.currency, d.created_at, to_jsonb(d) ->> 'given_by' AS given_by,
                to_jsonb(d) ->> 'accepted_by' AS accepted_by, d.created_by, to_char((${dayTs})::date, 'YYYY-MM-DD') AS day
           FROM internal_transfers d
          WHERE d.status NOT IN ('отменен', 'cancelled') AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
      )
      .all({ from: context.from, to: context.to })) as Record<string, unknown>[]
    if (!rows.length) return []
    const [products, productsByName, branches] = await Promise.all([context.dir.products(), context.dir.productsByName(), context.dir.warehouseBranches()])
    const lines: T[] = []
    for (const row of rows) {
      const fromBranch = branches.get(nameKey(row.from_warehouse)) ?? ""
      const toBranch = branches.get(nameKey(row.to_warehouse)) ?? ""
      if (context.branch && nameKey(fromBranch) !== nameKey(context.branch) && nameKey(toBranch) !== nameKey(context.branch)) continue
      const fx = context.money.rate(normCurrency(str(row.currency), context.money.code), str(row.created_at))
      let items: Record<string, unknown>[] = []
      try {
        const parsed = JSON.parse(str(row.items) || "[]") as unknown
        if (Array.isArray(parsed)) items = parsed.filter((item) => item && typeof item === "object") as Record<string, unknown>[]
      } catch {
        items = []
      }
      for (const item of items) {
        const key = str(item.key)
        const product = (key.startsWith("product:") ? products.get(Number(key.slice(8))) : undefined) ?? productsByName.get(nameKey(item.product))
        lines.push({
          id: Number(row.id),
          day: str(row.day),
          status: TRANSFER_STATUS[str(row.status).toLowerCase()] ?? str(row.status),
          from: str(row.from_warehouse),
          to: str(row.to_warehouse),
          fromBranch,
          toBranch,
          givenBy: str(row.given_by) || str(row.created_by),
          acceptedBy: str(row.accepted_by),
          comment: str(row.comment),
          name: product?.name ?? str(item.product),
          series: str(item.series),
          qty: num(item.quantity ?? item.qty),
          price: num(item.price) * fx.own,
          box: product?.box ?? 0,
          kg: product?.kg ?? 0,
        })
      }
    }
    return lines
  },
  groups: {
    status: t((row) => row.status),
    stock_transfer_id: t((row) => row.id),
    product_name: t((row) => row.name),
    from_stock_name: t((row) => row.from),
    to_stock_name: t((row) => row.to),
    from_stock_branch: t((row) => row.fromBranch),
    to_stock_branch: t((row) => row.toBranch),
    created_date_day: transferDays.byDay,
    created_date_week: transferDays.byWeek,
    created_date_month: transferDays.byMonth,
    given_by_name: t((row) => row.givenBy),
    acccepted_by_name: t((row) => row.acceptedBy),
    comment: t((row) => row.comment),
    price: t((row) => plain(row.price)),
    series_number: t((row) => row.series),
  },
  measures: {
    amount_sum: sum((row) => row.qty),
    box_amount_sum: sum((row) => (row.box > 0 ? row.qty / row.box : 0)),
    total_price: sum((row) => row.qty * row.price, 2),
    kg_total: sum((row) => row.kg * Math.abs(row.qty)),
  },
  filters: {
    Product: { value: (row) => row.name },
    from_stock: { value: (row) => row.from },
    to_stock: { value: (row) => row.to },
    status_filter_stock_transfer: { value: (row) => row.status, options: () => ["Ожидает", "Подтвержден", "В пути", "Принят"] },
  },
})

// ---------------------------------------------------------------- Доп. расход поставок

type Expense = { id: number; supplyId: number; day: string; supplier: string; organization: string; comment: string; currency: string; amount: number }
type E = Expense
const expenseDays = dayGroups<E>((row) => row.day)
const e = (pick: (row: E) => string | number | null | undefined): GroupDef<E> => ({ label: pick })

export const supplyExpenseModel = defineModel<E>({
  access: "purchases",
  async load(context) {
    const dayTs = "COALESCE(fin_ts(NULLIF(d.accepted_at, '')), fin_ts(NULLIF(d.date, '')), fin_ts(d.created_at, true))"
    const rows = (await context.db
      .prepare(
        `SELECT x.id, x.incoming_id, x.description, x.amount, x.currency, d.supplier, d.organization, to_jsonb(d) ->> 'branch' AS branch,
                to_char((${dayTs})::date, 'YYYY-MM-DD') AS day
           FROM supplier_incoming_expenses x
           JOIN supplier_incomings d ON d.id = x.incoming_id
          WHERE d.status <> 'отменен' AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
      )
      .all({ from: context.from, to: context.to })) as Record<string, unknown>[]
    return rows.flatMap((row) => {
      if (context.branch && nameKey(row.branch) !== nameKey(context.branch)) return []
      const fx = context.money.rate(normCurrency(str(row.currency), context.money.code), str(row.day))
      return [{ id: Number(row.id), supplyId: Number(row.incoming_id), day: str(row.day), supplier: str(row.supplier), organization: str(row.organization), comment: str(row.description), currency: fx.name, amount: num(row.amount) * fx.own }]
    })
  },
  groups: {
    provider_id: e((row) => row.supplier),
    supply_id: e((row) => row.supplyId),
    id: e((row) => row.id),
    comment: e((row) => row.comment),
    created_date_2: expenseDays.byDay,
    division_id: e((row) => row.organization),
    created_date_day: expenseDays.byDay,
    created_date_week: expenseDays.byWeek,
    created_date_month: expenseDays.byMonth,
    currency_id: e((row) => row.currency),
  },
  measures: { cost: sum((row) => row.amount, 2) },
  filters: { provider_name: { value: (row) => row.supplier }, division_name: { value: (row) => row.organization } },
})
