// Client-safe types and constants of the catalog pages "Продукты" (/analytics/products)
// and "Сырье" (/analytics/raw-materials). The demo keeps both in one product table
// (main/product/, raw = is_raw); here they are two tables (products, raw_materials)
// served by one implementation (lib/products-*.ts) that takes the kind.

export type CatalogKind = "product" | "raw_material"

export const CATALOG_KINDS: CatalogKind[] = ["product", "raw_material"]

/** API base of each kind. */
export const CATALOG_API: Record<CatalogKind, string> = { product: "/api/products", raw_material: "/api/raw-materials" }

/** One entry of the item's price_lists JSON (= PriceListEntry of components/analytics/products-data.ts). */
export type CatalogPrice = { name: string; cash: number; nonCash: number; min: number; max: number; currency?: string; nonCashCurrency?: string }

/** "ДОП. параметры" box sizes (demo box_sizes). */
export type CatalogBoxSize = { unit: string; height: number; width: number; length: number }

export type CatalogImage = { id: number; isPrimary: boolean; createdAt: string }

/** Agent sale limit (demo limits: agent, amount, real_amount). */
export type CatalogLimit = { id: number; agent: string; amount: number; realized: number; createdAt: string }

export type CatalogItem = {
  kind: CatalogKind
  id: number
  name: string
  fullName: string
  barcodes: string[]
  /** Артикул (demo vendor_code). */
  article: string
  /** Код для интеграции (demo code). */
  code: string
  /** Тип продукта (parent type). */
  type: string
  /** Подкатегория (child type). */
  subcategory: string
  /** Организация (demo division). */
  organization: string
  /** Мера (demo measurement). */
  unit: string
  /** "Указать группу": group unit (demo box_measurement) and its amount in base units (box_amount). */
  boxUnit: string
  boxAmount: number
  /** Порядковый номер (demo stock_number). */
  orderNumber: string
  /** Поставщик (demo provider). */
  supplier: string
  brand: string
  color: string
  description: string
  /** Минимальный остаток (demo min_amount). */
  minStock: number
  /** Масса - кг (demo kg_value). */
  weight: number
  netWeight: number
  /** Объем (demo capacity). */
  volume: number
  ikpu: string
  /** Код ед.изм. в фактуре (demo factura_package_code). */
  invoiceUnitCode: string
  /** НДС (demo vat_percent; stored as text, "Без НДС" = none). */
  vat: string
  canSell: boolean
  isMml: boolean
  perfectStore: boolean
  /** "Показывать этот товар в качестве тип инвентаря" (demo is_gear). */
  isInventory: boolean
  /** "Продать только в группе" (demo sell_only_box). */
  sellOnlyBox: boolean
  /** "Показывать в боте" (demo show_in_market). */
  showInBot: boolean
  trackExpiry: boolean
  trackSeries: boolean
  expirationDays: number | null
  notifyExpireDays: number | null
  /** "Маркировочный товар" (demo use_mark). */
  markedProduct: boolean
  /** "Можно дать ручную скидку" (demo use_discount_percent). */
  manualDiscount: boolean
  /** "Скрыть из списка заказов для агента" (demo is_promo). */
  hideFromAgent: boolean
  /** "Установить минимальную и максимальную цену для продажи" (demo min_price / max_price / currency). */
  limitPrice: boolean
  saleMinPrice: number
  saleMaxPrice: number
  salePriceCurrency: string
  /** "Можно продать за кол-во балов" (demo ball). */
  salePoints: number
  boxSizes: CatalogBoxSize[]
  priceLists: CatalogPrice[]
  /** Derived from priceLists on every price write (lib/item-prices.ts). */
  priceMin: number
  priceMax: number
  priceUpdatedDate: string
  cost: number
  deleted: boolean
  deletedAt: string
  /** "08 окт. 2026" label as stored. */
  createdDate: string
  createdAt: string
  primaryImageId: number | null
  imageCount: number
}

export type CatalogDetail = CatalogItem & { images: CatalogImage[]; limits: CatalogLimit[] }

export type CatalogListResult = { results: CatalogItem[]; count: number }

/** Where an item is used (hard-delete check). */
export type CatalogUsage = { table: string; label: string; count: number }

/** Demo tabs (filter "status"): 1 Можно продавать, 2 Инвентари, 3 Сняты с продажи, "" Все, 4 Удалённые. */
export type CatalogTab = "1" | "2" | "3" | "" | "4"

export const PRODUCT_TABS: Array<{ value: CatalogTab; label: string }> = [
  { value: "1", label: "Можно продавать" },
  { value: "2", label: "Инвентари" },
  { value: "3", label: "Сняты с продажи" },
  { value: "", label: "Все" },
  { value: "4", label: "Удалённые" },
]

/** Raw materials have no tabs in the demo; the deleted ones still need a place. */
export const RAW_TABS: Array<{ value: CatalogTab; label: string }> = [
  { value: "", label: "Все" },
  { value: "4", label: "Удалённые" },
]

export const CATALOG_ORDERINGS = ["name", "barcode", "vendor_code", "type", "division__name", "created_date", "stock_number", "id"] as const
export type CatalogOrdering = (typeof CATALOG_ORDERINGS)[number]

/** List filters (URL / API query names follow the demo filter keys). */
export type CatalogFilters = {
  typeParent: string
  typeChild: string
  /** "1" Можно продать, "2" Нельзя продать. */
  canSell: "" | "1" | "2"
  measurement: string[]
  brand: string[]
  provider: string[]
  color: string[]
  division: string[]
  /** Supplier incoming id ("Поставка"). */
  supply: string
  isMML: boolean
  isGear: boolean
  isPerfectStore: boolean
}

export const EMPTY_CATALOG_FILTERS: CatalogFilters = {
  typeParent: "",
  typeChild: "",
  canSell: "",
  measurement: [],
  brand: [],
  provider: [],
  color: [],
  division: [],
  supply: "",
  isMML: false,
  isGear: false,
  isPerfectStore: false,
}

export type CatalogOptions = {
  priceLists: Array<{ name: string; currency: string }>
  currencies: string[]
  baseCurrency: string
  units: string[]
  types: Array<{ name: string; children: string[] }>
  brands: string[]
  suppliers: string[]
  organizations: string[]
  colors: string[]
  agents: string[]
  supplies: Array<{ id: number; label: string }>
}

export const VAT_OPTIONS = ["Без НДС", "0%", "12%", "15%"]

export type CatalogImportMode = "create" | "update"

export type CatalogImportError = { row: number; error: string }

export type CatalogImportResult = { created: number; updated: number; errors: CatalogImportError[] }

/** Fields of POST /api/{products|raw-materials}/bulk ("Изменить выбранные продукты"). */
export type CatalogBulkChanges = {
  type?: string
  unit?: string
  brand?: string
  organization?: string
  supplier?: string
  color?: string
  canSell?: boolean
  showInBot?: boolean
  isMml?: boolean
  manualDiscount?: boolean
  hideFromAgent?: boolean
  /** true = delete (soft), false = restore. */
  deleted?: boolean
}

/** JS twin of the SQL fin_key(): lower-case, trimmed, whitespace (NBSP too) collapsed. */
export function catalogKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Placeholder texts the old forms stored instead of an empty value. */
const PLACEHOLDERS = new Set(["", "-", "—", "не указано", "не указан", "no brand", "не установлен", "не установлена", "неизвестно", "не указано м³."])

/** Stored text → clean value ("" for the old placeholders). */
export function cleanText(value: unknown): string {
  const text = String(value ?? "").trim()
  return PLACEHOLDERS.has(catalogKey(text)) ? "" : text
}

/** Leading number of a free-text quantity ("12,5 шт." → 12.5, "Не указано" → 0). */
export function leadingNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const match = /-?\d[\d\s ]*(?:[.,]\d+)?/.exec(String(value ?? ""))
  if (!match) return 0
  const parsed = Number(match[0].replace(/[\s ]/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}
