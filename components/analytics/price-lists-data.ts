// Client-safe types and constants of "Прайс-листы" (demo #/price-list-setting, API sales/price_list/)
// and of the price-setting grid "Установить цену в прайс-лист" (demo c9 module 4389).
// Server side: lib/price-lists-repo.ts, lib/price-lists-refs.ts, lib/price-lists-grid.ts.

export const PRICE_LISTS_API = "/api/price-lists"

/**
 * Row of GET /api/price-lists (plain array, the shape the pickers of other pages use) and of the
 * paged list. `linkedList` / `calcMethod` stay display strings ("Не указано" when unset) for the
 * older readers; the structured fields follow the demo item.
 */
export type PriceList = {
  id: number
  name: string
  currency: string
  /** "26 дек. 2024" */
  createdDate: string
  /** Local ISO date-time of creation. */
  createdAt: string
  linkedList: string
  calcMethod: string
  position: number
  isActive: boolean
  isDefaultForOrder: boolean
  connectedPriceList: { id: number; name: string } | null
  calcMethodId: string
  methodValues: PriceListMethodValue[]
}

export type PriceListMethodValue = { methodKey: string; value: number }

export type PriceListListResult = { count: number; results: PriceList[] }

export type PriceListUsage = { table: string; label: string; count: number }

export type PriceListErrorBody = { error?: string; fields?: Record<string, string>; usage?: PriceListUsage[] }

/** Body of POST / PUT /api/price-lists (the older {name, currency, linkedList, calcMethod} still works). */
export type PriceListInputBody = {
  name: string
  currency: string
  position?: number
  isActive?: boolean
  isDefaultForOrder?: boolean
  connectedPriceListId?: number | null
  calcMethodId?: string | null
  methodValues?: PriceListMethodValue[]
}

// --- calculation methods of a linked price list ("Связать прайс-лист" → "Метод расчета") ---

export type CalcMethodKey = { id: string; name: string }
export type CalcMethod = { id: string; name: string; keys: CalcMethodKey[] }

/** Rounding steps of the demo RoundSearchField (module 3496). */
export const PRICE_ROUND_STEPS = [1, 10, 100, 1000] as const

/**
 * How a linked price list derives its price from the connected list's price (demo
 * sales/price_list/calc_method/ + method_values [{method_key, value}]). Every method may round
 * the result up to a step ("Округление": 1 / 10 / 100 / 1000; empty = 2 decimals).
 */
export const PRICE_LIST_CALC_METHODS: CalcMethod[] = [
  { id: "percent", name: "Наценка в процентах", keys: [{ id: "percent", name: "Процент" }, { id: "round", name: "Округление" }] },
  { id: "amount", name: "Фиксированная наценка", keys: [{ id: "amount", name: "Сумма" }, { id: "round", name: "Округление" }] },
  { id: "rate", name: "Умножить на курс", keys: [{ id: "rate", name: "Курс" }, { id: "round", name: "Округление" }] },
  { id: "same", name: "Как в связанном прайс-листе", keys: [] },
]

export function calcMethodById(id: string | null | undefined): CalcMethod | null {
  return PRICE_LIST_CALC_METHODS.find((method) => method.id === id) ?? null
}

/** Rounds up to a multiple of `step` (step ≤ 0 → 2 decimals). */
export function roundPriceUp(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0
  if (!(step > 0)) return Math.round(value * 100) / 100
  return Math.ceil(Math.round((value / step) * 1e6) / 1e6) * step
}

/** Price of a linked list from the connected list's price; null when the method is unknown. */
export function calcLinkedPrice(source: number, methodId: string, values: PriceListMethodValue[]): number | null {
  const method = calcMethodById(methodId)
  if (!method) return null
  const value = (key: string) => values.find((item) => item.methodKey === key)?.value ?? 0
  let price: number
  if (method.id === "percent") price = source * (1 + value("percent") / 100)
  else if (method.id === "amount") price = source + value("amount")
  else if (method.id === "rate") price = source * (value("rate") || 1)
  else price = source
  return Math.max(0, roundPriceUp(price, method.keys.some((key) => key.id === "round") ? value("round") : 0))
}

// --- price-setting grid ---

export type PriceGridKind = "product" | "raw_material"

export type PriceGridEntry = { cash: number; nonCash: number; min: number; max: number; currency: string; nonCashCurrency: string }

export type PriceGridRow = {
  kind: PriceGridKind
  id: number
  /** "product:12" */
  key: string
  name: string
  article: string
  barcode: string
  type: string
  brand: string
  unit: string
  /** Average cost (stock) or the catalog cost — base for "Наценка". */
  cost: number
  /** Entry per requested price-list id (absent = no price yet). */
  prices: Record<string, PriceGridEntry>
}

export type PriceGridResult = {
  count: number
  results: PriceGridRow[]
  priceLists: Array<{ id: number; name: string; currency: string }>
  types: string[]
  brands: string[]
}

/** POST /api/price-lists/prices body. */
export type PriceGridSaveBody = {
  rows: Array<{ kind: PriceGridKind; id: number; prices: Array<{ priceListId: number; cash?: number; nonCash?: number; min?: number; max?: number }> }>
  cashCurrency: string
  nonCashCurrency?: string
}

export type PriceGridSaveResult = { updated: number; skipped: Array<{ kind: PriceGridKind; id: number }> }

/** "1 234 567,5" (space thousands, comma decimals). */
export function formatPrice(value: number, digits = 2): string {
  const factor = 10 ** digits
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits })
    .format(Math.round((Number.isFinite(value) ? value : 0) * factor) / factor)
    .replace(/[\u00a0\u202f]/g, " ")
}

// --- client mutations (the error body keeps `fields` / `usage` / `conflicts`) ---

export type JsonMutation<T> = { ok: true; data: T } | { ok: false; status: number; error: string; body: Record<string, unknown> | null }

/** POST / PUT / DELETE returning the parsed body; never throws (status 0 = network error). */
export async function mutateJson<T = unknown>(method: "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<JsonMutation<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok) return { ok: false, status: response.status, error: typeof json?.error === "string" ? json.error : `HTTP ${response.status}`, body: json }
    return { ok: true, data: json as T }
  } catch (reason) {
    return { ok: false, status: 0, error: reason instanceof Error ? reason.message : String(reason), body: null }
  }
}

/** Russian message of a failed mutation (render with t()). */
export function mutationMessage(result: JsonMutation<unknown>): string {
  if (result.ok) return ""
  if (result.status === 403) return "Недостаточно прав"
  if (result.status === 0) return "Сервер недоступен, попробуйте ещё раз"
  if (result.status === 400 && result.error === "Ma'lumotlar noto'g'ri") return "Проверьте правильность заполнения полей"
  return result.error
}
