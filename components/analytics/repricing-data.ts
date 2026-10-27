// Client-safe types of "Переоценка" (demo #/revaluation, chunk c143, API main/reprice/).
// Server side: lib/repricings-repo.ts (+ lib/repricings-api.ts, lib/repricings-items.ts).

export const REPRICINGS_API = "/api/repricings"

/** Demo REVALUATION_TYPE_FINISHED / _CANCELLED (stored as 'проведен' / 'отменен'). */
export type RepricingStatus = "finished" | "canceled"
export const REPRICING_STATUSES: RepricingStatus[] = ["finished", "canceled"]
/** Russian i18n keys of the statuses (demo REVALUATION_STATUS_ITEMS). */
export const REPRICING_STATUS_LABELS: Record<RepricingStatus, string> = { finished: "проведен", canceled: "отменен" }

export type RepricingItemKind = "product" | "raw_material"

/** Where a document came from: the page, "Переоценку связанных" / linked lists of a saved one, or a supply's "Наценка". */
export type RepricingSource = "manual" | "connected" | "supplier_incoming"

/** List row (demo main/reprice/ result). */
export type Repricing = {
  id: number
  createdBy: string
  /** Local ISO date-time. */
  createdAt: string
  priceListId: number | null
  priceList: string
  currency: string
  comment: string
  status: RepricingStatus
  /** "Сумма переоценки" = Σ (new − old) × qty. */
  total: number
  totalOld: number
  totalNew: number
  lineCount: number
  source: RepricingSource
  /** The repricing whose save created this linked one. */
  parentId: number | null
  canceledAt: string
  canceledBy: string
  recalculatedAt: string
}

/** Product line of a repricing (demo item `products[]`). */
/** Line of a document; totalOld / totalNew / diff are in the document currency (the old price is
 * converted from oldCurrency when its entry was kept in another currency). */
export type RepricingLine = {
  kind: RepricingItemKind
  id: number
  key: string
  name: string
  unit: string
  /** Кол-во: available stock when saved (or at the last "Перерасчет по текущей дате"). */
  amount: number
  /** null = unknown (documents written by a supply's "Наценка" before old prices were kept). */
  oldPrice: number | null
  oldCurrency: string
  price: number
  totalOld: number
  totalNew: number
  diff: number
}

export type RepricingDetail = Repricing & { lines: RepricingLine[]; children: number[] }

export type RepricingListResult = { count: number; results: Repricing[] }

export type RepricingOptions = {
  priceLists: Array<{ id: number; name: string; currency: string; isActive: boolean; linked: boolean; dependents: number }>
  users: string[]
  products: Array<{ key: string; name: string }>
}

/** Row of the product picker (GET /api/repricings/products?priceList=…). */
export type RepricingPickRow = {
  kind: RepricingItemKind
  id: number
  key: string
  name: string
  article: string
  barcode: string
  unit: string
  /** Доступно = on hand − defects − reserved, over every warehouse. */
  available: number
  /** Current cash price in the price list (null = none), in its entry's currency `currency`. */
  price: number | null
  currency: string
  /** The same price in the price list's currency (null = none, or no rate to convert it). */
  listPrice: number | null
}

export type RepricingCreateBody = {
  priceListId: number
  /** Must be the price list's currency (400 "Валюта переоценки должна совпадать с валютой прайс-листа"). */
  currency: string
  comment?: string
  products: Array<{ kind: RepricingItemKind; id: number; price: number }>
  /** "Создать переоценку для связанных прайс-листов": also reprice the lists linked to this one. */
  connected?: boolean
}

/** Result of POST /api/repricings and /api/repricings/connected. */
export type RepricingCreateResult = { repricing: RepricingDetail | null; linked: RepricingDetail[]; skipped: Array<{ priceList: string; reason: string }> }

export type RepricingErrorBody = { error?: string; conflicts?: number[]; missing?: string[]; currency?: string }
