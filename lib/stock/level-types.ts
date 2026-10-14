// Types of the "Остаток" page (GET /api/stock/balances, /sum, /[key]) shared
// by the server (lib/stock/level.ts) and the client views (stock-level-*.tsx).

/** Demo toggle: КОЛ-ВО | СЕБЕСТОИМОСТЬ | ПРАЙС ЛИСТ (api show_in=amount|net_cost|price). */
export type StockLevelMode = "amount" | "net_cost" | "price"
/** Demo "Показать": Количество | Блок | Объем | Вес. */
export type StockLevelUnit = "amount" | "box" | "capacity" | "weight"

export const STOCK_LEVEL_MODES: StockLevelMode[] = ["amount", "net_cost", "price"]
export const STOCK_LEVEL_UNITS: StockLevelUnit[] = ["amount", "box", "capacity", "weight"]
export const STOCK_LEVEL_SORT_KEYS = ["name", "article", "type", "total", "reserved", "transit", "available", "cost", "price", "value"] as const
export type StockLevelSortKey = (typeof STOCK_LEVEL_SORT_KEYS)[number]

export type StockLevelFilters = {
  warehouse: string[]
  branch: string[]
  type: string[]
  subcategory: string[]
  brand: string[]
  supplier: string[]
  organization: string[]
  /** "Только продукты в наличии": on hand > 0. */
  onlyHas: boolean
}

export type StockLevelQuery = StockLevelFilters & {
  mode: StockLevelMode
  unit: StockLevelUnit
  priceList: string
  search: string
  /** "name", "-total", … (STOCK_LEVEL_SORT_KEYS, "-" = descending). */
  ordering: string
  /** 1-based. */
  page: number
  /** 0 = every row (Excel "Скачать все"). */
  pageSize: number
}

/** Quantities in the display unit (Всего = on hand incl. defects). */
export type StockLevelQty = {
  total: number
  reserved: number
  transit: number
  defects: number
  /** Доступно = total − reserved − defects. */
  available: number
}

export type StockLevelStock = StockLevelQty & {
  warehouse: string
  branch: string
  /** Сумма of the available quantity in the selected mode. */
  value: number
}

export type StockLevelRow = StockLevelQty & {
  key: string
  kind: "product" | "raw_material" | null
  id: number | null
  name: string
  article: string
  barcode: string
  type: string
  subcategory: string
  brand: string
  supplier: string
  organization: string
  /** Display unit (catalog unit, or кг / м³ / блок for the "Показать" modes). */
  unit: string
  /** Average unit cost (base currency). */
  cost: number
  /** Price of the selected price list (price mode), else null. */
  price: number | null
  /** Сумма: available × cost (net_cost) or × price (price); 0 in amount mode. */
  value: number
  /** Per-warehouse breakdown (only warehouses with movements or pending quantities). */
  stocks: StockLevelStock[]
}

export type StockLevelMoney = { count: number; price: number }

/** Demo stats/stock/balances_sum. `price` is in `currency` (cost: base; price mode: the price list's). */
export type StockLevelSum = {
  total: StockLevelMoney
  reserved: StockLevelMoney
  defected: StockLevelMoney
  available: StockLevelMoney
  /** В пути (count). */
  given: number
  currency: string
}

export type StockLevelList = {
  count: number
  page: number
  pageSize: number
  baseCurrency: string
  /** Currency of `value` / `price` (base, or the price list's in price mode). */
  currency: string
  rows: StockLevelRow[]
  sum: StockLevelSum
}

export type StockReceipt = {
  day: string
  kind: string
  docType: string
  docId: number
  warehouse: string
  qty: number
  /** Unit cost of the receipt (0 when the document has none). */
  unitCost: number
  isDefect: boolean
}

export type StockItemDetail = {
  key: string
  name: string
  unit: string
  article: string
  type: string
  brand: string
  /** Average unit cost (base currency) and the catalog fallback. */
  cost: number
  fallbackCost: number
  baseCurrency: string
  total: StockLevelQty
  warehouses: StockLevelStock[]
  /** Latest receipts (supplies, production, transfers in, inventory surplus…), newest first. */
  receipts: StockReceipt[]
}

export const STOCK_CHECK_NET_COST = {
  text: "Проверка себестоимости отключено с настроек системы, обратитесь к тех.поддержке чтобы включит проверку",
  text_color: "#2e2d2c",
}
