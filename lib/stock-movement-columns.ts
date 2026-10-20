import type { StockMoveKind } from "@/lib/stock/types"

// Client-safe constants of "Остаток на определенную дату" (demo
// #/statistics/product-move, modules m3875 / m3876 / m3877): the report
// fields, the column sets of the table / Excel, the group-by options and the
// labels of the movement kinds and source documents. Used by the API
// (lib/stock-movement-report.ts) and the page (components/analytics/stock-move-*).

/** begin, the 13 ledger kinds, the two "Прочие" totals, the revaluation (cost mode) and end. */
export type MoveField = "begin" | StockMoveKind | "other_in" | "other_out" | "revaluation" | "end"

export const MOVE_FIELDS: MoveField[] = [
  "begin",
  "supply",
  "supply_return",
  "order",
  "return",
  "writeoff",
  "inventory_in",
  "inventory_out",
  "manufacture_in",
  "manufacture_out",
  "transfer_in",
  "transfer_out",
  "none_in",
  "none_out",
  "other_in",
  "other_out",
  "revaluation",
  "end",
]

/** Signed numbers of one row (outflows are negative, as in the ledger). */
export type MoveNumbers = Record<MoveField, number>

/** Demo toggle: Кол-во | Себестоимость | Прайс лист (URL `toggle=quantity|price|priceList`). */
export type MoveMode = "quantity" | "cost" | "price"
export type MoveGroupBy = "product" | "brand" | "type" | "stock" | "branch"
/** "Движение за период" / "Остаток за период": Есть | Нет. */
export type MovePresence = "" | "exist" | "not_exist"

export const MOVE_GROUP_BY: Array<{ id: MoveGroupBy; label: string }> = [
  { id: "product", label: "По продукту" },
  { id: "brand", label: "По бренду" },
  { id: "type", label: "По типу" },
  { id: "stock", label: "По складу" },
  { id: "branch", label: "По филиалу" },
]

export type MoveColumn = {
  field: MoveField
  /** Russian i18n key. */
  label: string
  /** Outflow: shown as a positive number (the demo multiplies by −1). */
  out?: boolean
  /** Value only (no quantity): "Переоценка". */
  valueOnly?: boolean
}

const BEGIN: MoveColumn = { field: "begin", label: "Остаток на начало периода" }
const END: MoveColumn = { field: "end", label: "Остаток на конец" }
const MAIN: MoveColumn[] = [
  { field: "supply", label: "Поставки за период" },
  { field: "supply_return", label: "Возврат по поставкам за период", out: true },
  { field: "return", label: "Возврат" },
  { field: "order", label: "Выдано по заказу", out: true },
  { field: "writeoff", label: "Списано за период", out: true },
]

/** "Обычный вид": Прочий приход / расход = inventory + production + transfers + other. */
export const MOVE_COLUMNS_NORMAL: MoveColumn[] = [
  BEGIN,
  ...MAIN,
  { field: "other_in", label: "Прочий приход" },
  { field: "other_out", label: "Прочий расход", out: true },
  END,
]

/** "Показать прочие": the "Прочие" columns split by source (demo m3876 showOthers);
 * the remaining production corrections stay in Прочий приход / расход. */
export const MOVE_COLUMNS_OTHERS: MoveColumn[] = [
  BEGIN,
  ...MAIN,
  { field: "transfer_in", label: "Приход между складами" },
  { field: "inventory_in", label: "Приход инвентаризация" },
  { field: "manufacture_in", label: "Приход производства" },
  { field: "transfer_out", label: "Расход между складами", out: true },
  { field: "inventory_out", label: "Расход инвентаризация", out: true },
  { field: "manufacture_out", label: "Расход производства", out: true },
  { field: "none_in", label: "Прочий приход" },
  { field: "none_out", label: "Прочий расход", out: true },
  END,
]

/** Cost mode only: the change of value of the stock on hand when its moving-average
 * cost changes (a receipt at another cost, a manual cost entry). With it
 * begin + Σ columns = end in value, per warehouse as well as per item. */
export const MOVE_REVALUATION_COLUMN: MoveColumn = { field: "revaluation", label: "Переоценка", valueOnly: true }

export function moveColumns(showOthers: boolean, mode?: MoveMode): MoveColumn[] {
  const columns = showOthers ? MOVE_COLUMNS_OTHERS : MOVE_COLUMNS_NORMAL
  return mode === "cost" ? [...columns.slice(0, -1), MOVE_REVALUATION_COLUMN, columns[columns.length - 1]] : columns
}

/** Value as the table shows it (outflows positive). */
export function shownMoveValue(column: Pick<MoveColumn, "out">, value: number): number {
  const shown = column.out ? -value : value
  return Object.is(shown, -0) ? 0 : shown
}

/** Labels of the ledger kinds (item detail, documents). */
export const MOVE_KIND_LABELS: Record<StockMoveKind, string> = {
  supply: "Поставки за период",
  supply_return: "Возврат по поставкам за период",
  order: "Выдано по заказу",
  return: "Возврат",
  writeoff: "Списано за период",
  inventory_in: "Приход инвентаризация",
  inventory_out: "Расход инвентаризация",
  manufacture_in: "Приход производства",
  manufacture_out: "Расход производства",
  transfer_in: "Приход между складами",
  transfer_out: "Расход между складами",
  none_in: "Прочий приход",
  none_out: "Прочий расход",
}

/** Source documents of the ledger (doc_type → label, page). */
export const MOVE_DOC_TYPES: Record<string, { label: string; href: string }> = {
  supplier_incomings: { label: "Приход от поставщиков", href: "/analytics/supplier-incomings" },
  supplier_returns: { label: "Возврат поставщиков", href: "/analytics/supplier-returns" },
  write_offs: { label: "Списание", href: "/analytics/write-offs" },
  internal_transfers: { label: "Передачи между складами", href: "/analytics/internal-transfers" },
  production_movements: { label: "Производство", href: "/analytics/production-batches" },
  stock_inventories: { label: "Инвентаризация", href: "/analytics/inventory" },
  orders: { label: "Заказ", href: "/analytics/sales" },
}

export function emptyMoveNumbers(): MoveNumbers {
  return Object.fromEntries(MOVE_FIELDS.map((field) => [field, 0])) as MoveNumbers
}

/** First column title per grouping. */
export const MOVE_GROUP_TITLES: Record<MoveGroupBy, string> = {
  product: "Товар",
  brand: "Бренд",
  type: "Тип продукта",
  stock: "Склад",
  branch: "Филиал",
}
