// Shared types of the stock core (lib/stock): one signed movement per document
// line, read by "Остаток", "Остаток на определенную дату", "Инвентаризация",
// "Рекомендованный запас" and production's available quantities.

export type StockItemKind = "product" | "raw_material"

/** Movement kinds = the columns of the demo "Остаток на определенную дату"
 * report (api v2 stats/stock/products: supply, supply_return, order, return,
 * writeoff, in/out_inventory, in/out_manufacture, in/out_transfer, in/out_none). */
export type StockMoveKind =
  | "supply" //          Поставки за период         (+) supplier_incomings accepted
  | "supply_return" //   Возврат по поставкам        (−) supplier_returns completed
  | "order" //           Выдано по заказу            (−) orders shipped
  | "return" //          Возврат                     (+) client returns
  | "writeoff" //        Списано за период           (−) write_offs
  | "inventory_in" //    Приход инвентаризация       (+) confirmed stock inventory, counted > system
  | "inventory_out" //   Расход инвентаризация       (−) confirmed stock inventory, counted < system
  | "manufacture_in" //  Приход производства         (+) production output
  | "manufacture_out" // Расход производства         (−) production raw-material use
  | "transfer_in" //     Приход между складами       (+) internal transfer, target warehouse
  | "transfer_out" //    Расход между складами       (−) internal transfer, source warehouse
  | "none_in" //         Прочий приход               (+) other adjustments
  | "none_out" //        Прочий расход               (−) other adjustments

export const STOCK_MOVE_KINDS: StockMoveKind[] = [
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
]

/** "product:12" | "raw_material:3", or "name:<lower-cased trimmed name>" for a
 * document line whose name matches no catalog item. */
export type StockItemKey = string

/** One catalog item (products + raw materials) as the stock pages show it. */
export type StockCatalogItem = {
  key: StockItemKey
  kind: StockItemKind
  id: number
  name: string
  article: string
  type: string
  brand: string
  unit: string
  organization: string
  supplier: string
  /** products.cost / initial cost, used when nothing was received yet. */
  fallbackCost: number
  /** Price per price-list name (products.price_lists). */
  prices: Record<string, number>
  minStock: number
  weight: number
  /** Подкатегория (products and raw materials; always filled by getStockCatalog, '' when none). */
  subcategory?: string
  /** Штрихкод / код (always filled by getStockCatalog, '' when none). */
  barcode?: string
  /** Volume of one unit, m³ (products.volume; 0 when unknown). */
  volume?: number
  /** Units per block / box (leading number of sub_unit; 0 when unknown). */
  boxSize?: number
}

/** On-hand state of one item in one warehouse at a moment. */
export type StockBalance = {
  key: StockItemKey
  warehouse: string
  /** Всего (on hand) = sum of all signed movements. */
  qty: number
  /** Value at average cost of everything received up to the moment. */
  value: number
  /** Average unit cost (falls back to the catalog cost). */
  cost: number
  /** Брак — defective units included in qty (production defects). */
  defects: number
}

/** Not-yet-shipped and on-the-way quantities (they do not change qty). */
export type StockPending = {
  key: StockItemKey
  warehouse: string
  /** Забронировано: ordered, still in the warehouse. */
  reserved: number
  /** В пути: internal transfers sent but not yet accepted (towards `warehouse`). */
  transit: number
}

export type StockBalanceQuery = {
  /** Warehouse names; empty / undefined = all warehouses. */
  warehouses?: string[]
  /** Balance at the END of this local day (YYYY-MM-DD); default today. */
  date?: string
  /** Balance at the START of `date` instead (= end of the previous day). */
  startOfDay?: boolean
  /** Leave one confirmed stock inventory out (recomputing its own difference). */
  excludeInventoryId?: number
}
