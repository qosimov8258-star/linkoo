// Client-safe types and constants of "Передачи между складами" (demo
// stock/stock_transfer, chunk c7). Stored statuses are Russian text:
//   'ожидает'    pending   draft, editable, no stock effect
//   'потвержден' approved  planned, no stock effect
//   'в пути'     given     − at from_warehouse (given day); transit towards to_warehouse
//   'принят'     accepted  − at from (given day), + at to_warehouse (accepted day)
//   'отменен'    cancelled no stock effect
// The stock core (lib/stock/sources.ts) reads the legs from these statuses.

export type TransferStatus = "ожидает" | "потвержден" | "в пути" | "принят" | "отменен"

export const TRANSFER_STATUSES: TransferStatus[] = ["ожидает", "потвержден", "в пути", "принят", "отменен"]

/** Demo status codes (STOCK_TRANSFER_TYPE_*). */
export const TRANSFER_STATUS_CODES: Record<TransferStatus, "pending" | "approved" | "given" | "accepted" | "cancelled"> = {
  ожидает: "pending",
  потвержден: "approved",
  "в пути": "given",
  принят: "accepted",
  отменен: "cancelled",
}

/** List dots (demo waiting / begin / given / success / error). */
export const TRANSFER_STATUS_COLORS: Record<TransferStatus, string> = {
  ожидает: "#f0ad4e",
  потвержден: "#64b5f6",
  "в пути": "#f0ad4e",
  принят: "#81c784",
  отменен: "#e57373",
}

/** List labels (lower case, as the demo list shows them). The stored status keeps the
 * legacy spelling 'потвержден'; only the label is spelled correctly. */
export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  ожидает: "ожидает",
  потвержден: "подтвержден",
  "в пути": "в пути",
  принят: "принят",
  отменен: "отменен",
}

/** Status word of the transfer card: the card prints «В пути» in green (the list keeps its yellow dot). */
export const TRANSFER_CARD_STATUS_COLORS: Record<TransferStatus, string> = { ...TRANSFER_STATUS_COLORS, "в пути": "#81c784" }

/** Detail / log labels (capitalised in the demo detail), spelled like TRANSFER_STATUS_LABELS. */
export const TRANSFER_STATUS_TITLES: Record<TransferStatus, string> = {
  ожидает: "Ожидает",
  потвержден: "Подтвержден",
  "в пути": "В пути",
  принят: "Принят",
  отменен: "Отменен",
}

export type TransferAction = "approve" | "give" | "cancel_given" | "accept" | "cancel_accepted" | "cancel"

export const TRANSFER_ACTIONS: TransferAction[] = ["approve", "give", "cancel_given", "accept", "cancel_accepted", "cancel"]

/** The state machine of POST /api/internal-transfers/[id]/action. */
export const TRANSFER_TRANSITIONS: Record<TransferAction, { from: TransferStatus[]; to: TransferStatus }> = {
  approve: { from: ["ожидает"], to: "потвержден" },
  give: { from: ["потвержден"], to: "в пути" },
  cancel_given: { from: ["в пути"], to: "потвержден" },
  accept: { from: ["в пути"], to: "принят" },
  cancel_accepted: { from: ["принят"], to: "в пути" },
  cancel: { from: ["ожидает", "потвержден"], to: "отменен" },
}

/** Statuses without a stock effect yet: «Подтвержденный» of the edit form switches between them (any status may be
 * edited; a transfer that moved keeps its status, see updateTransfer). */
export const TRANSFER_EDITABLE: TransferStatus[] = ["ожидает", "потвержден"]

/** Log actions (demo STOCK_TRANSFER_ACTION_* plus "approved"). */
export type TransferLogAction = "created" | "updated" | "approved" | "given" | "cancel_given" | "accepted" | "cancel_accepted" | "canceled"

export const TRANSFER_LOG_LABELS: Record<TransferLogAction, string> = {
  created: "Создан",
  updated: "Изменен",
  approved: "Подтвержден",
  given: "Передан со склада",
  cancel_given: "Отмена передачи",
  accepted: "Принять на склад",
  cancel_accepted: "Отмена приемки",
  canceled: "Отменен",
}

export const TRANSFER_LOG_COLORS: Record<TransferLogAction, string> = {
  created: "#81c784",
  updated: "#64b5f6",
  approved: "#64b5f6",
  given: "#64b5f6",
  cancel_given: "#e57373",
  accepted: "#81c784",
  cancel_accepted: "#e57373",
  canceled: "#e57373",
}

/** One product line (stored in internal_transfers.items as JSON). The stock
 * core reads `product` (name) and `quantity`; `price` is the price-list price. */
export type TransferItem = {
  id: number
  /** Stock item key ("product:12"), when known. */
  key: string
  product: string
  article: string
  unit: string
  quantity: number
  price: number
  /** Weight of one unit, kg. */
  weight: number
  /** Display name of the line's series (Серия): the stock_series number, or a legacy text. */
  series: string
  /** The stock_series row of the line (one series per line, as Linko's stock_transfer_product.series). */
  seriesId?: number
  /** The series was set by «Авто распределение по сериям»; «Отменить автораспределение» undoes it. */
  seriesAuto?: boolean
  /** With seriesAuto: the series the line had before the distribution (chosen in the form or copied from Linko),
   * which «Отменить автораспределение» puts back. */
  seriesPrev?: TransferSeriesPrev
  /** "100 block": the line's quantity in the product's box unit (reference display data). */
  boxLabel?: string
  /** Read-time product facts (GET /api/internal-transfers/[id]; never stored): the product keeps an expiry
   * (Серия column) and its box (Группа: units per box and the box unit). */
  trackExpiry?: boolean
  boxAmount?: number
  boxUnit?: string
  /** Defective units (Брак): taken from the source's defects and kept as defects at the target. */
  defect?: boolean
  /** "cost": no price list, `price` is the cost of goods when the goods left. */
  priced?: "cost"
}

/** A line's series before «Авто распределение по сериям» replaced it: its stock_series id (when it had one) and name. */
export type TransferSeriesPrev = { id?: number; series: string }

export type Transfer = {
  id: number
  fromWarehouse: string
  toWarehouse: string
  createdBy: string
  /** "Дата создания" (document date-time, local). */
  createdAt: string
  /** "Дата доставки" (YYYY-MM-DD). */
  deliveredAt: string
  /** Σ quantity × price. */
  amount: number
  /** Σ quantity × unit weight, kg. */
  weight: number
  status: TransferStatus
  priceList: string
  currency: string
  organization: string
  invoiceNumber: string
  transportNumber: string
  driver: string
  comment: string
  items: TransferItem[]
  givenAt: string
  givenBy: string
  acceptedAt: string
  acceptedBy: string
  cancelledAt: string
  cancelledBy: string
  updatedAt: string
}

export type TransferListResult = { count: number; page: number; pageSize: number; results: Transfer[] }

export type TransferLog = {
  id: number
  action: TransferLogAction
  /** Status after the action. */
  status: TransferStatus
  userName: string
  fromWarehouse: string
  toWarehouse: string
  comment: string
  currency: string
  /** Snapshot of the lines after the action. */
  items: TransferItem[]
  createdAt: string
}

export type TransferWarehouse = { name: string; address: string; manager: string; active: boolean }

export type TransferOptions = {
  warehouses: TransferWarehouse[]
  users: string[]
  priceLists: string[]
  priceListCurrency: Record<string, string>
  currencies: string[]
  baseCurrency: string
  organizations: string[]
}

/** A row of the product pickers (available balance of the source warehouse). */
export type StockPickRow = {
  key: string
  name: string
  article: string
  type: string
  brand: string
  unit: string
  weight: number
  boxSize: number
  /** On hand (incl. defects). */
  qty: number
  defects: number
  /** Defective units that may leave (lines flagged "Брак"). */
  defectsAvailable: number
  reserved: number
  /** qty − defects − reserved. */
  available: number
  /** Average unit cost (Себестоимость). */
  cost: number
  /** Price in the requested price list (0 without one). */
  price: number
  /** The product keeps an expiry: its lines take a series (Серия). */
  trackExpiry?: boolean
  /** Units in one box of the product and the box unit (Группа); 0 / '' without a box. */
  boxAmount?: number
  boxUnit?: string
}

/** A series of a product (the Серия pickers of the transfer form; Linko's stock/series_balance/). */
export type TransferSeriesOption = { id: number; productId: number; number: string; expirationDate: string | null; displayName: string }

/** «Авто распределение по сериям»: FIFO = the earliest expiry first, LIFO = the latest. */
export type TransferSeriesAutoType = "fifo" | "lifo"

export type StockPickResult = { warehouse: string; priceList: string; rows: StockPickRow[] }

/** A line that cannot be given / written off (409 body `shortages`). */
export type StockShortage = { key: string; product: string; unit: string; required: number; available: number; defect?: boolean }

/** Kilograms in one unit of `unit` when the unit itself is a weight ("kg", "gramm",
 * "tonna", "qop (50 kg)"); null otherwise. */
export function unitKilograms(unit: string): number | null {
  const text = String(unit ?? "").trim().toLowerCase()
  if (/^(kg|кг|kilo|kilogramm?|килограмм?)\.?$/.test(text)) return 1
  if (/^(g|г|гр|gr|gramm?|грамм?)\.?$/.test(text)) return 0.001
  if (/^(t|т|tn|тн|tonna|тонна)\.?$/.test(text)) return 1000
  const inner = /(\d+(?:[.,]\d+)?)\s*(?:kg|кг)(?![a-zа-я])/.exec(text)
  if (inner) return Number(inner[1].replace(",", ".")) || null
  return null
}

/** Weight of one unit, kg: the item's own weight (mass), else what a weight unit implies. */
export function unitWeightKg(unit: string, weight: number): number {
  return Number(weight) > 0 ? Number(weight) : (unitKilograms(unit) ?? 0)
}

/** Body of a successful POST action / create / update. */
export type TransferMutationResult = Transfer
