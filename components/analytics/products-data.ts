// Shape of GET /api/products (the default array) kept for its existing consumers
// (price formation, repricing, supplier incomings / returns / reserve, invoice incomings).
// The catalog pages use lib/products-types.ts (CatalogItem, opt-in ?view=list).

/** One entry of products.price_lists / raw_materials.price_lists (JSON TEXT). */
export type PriceListEntry = { name: string; cash: number; nonCash: number; min: number; max: number; currency?: string; nonCashCurrency?: string }
export type ProductTab = "sellable" | "inventory" | "delisted" | "all" | "deleted"

export type Product = {
  id: number
  name: string
  fullName: string
  /** Barcodes joined with ", " ("не установлен" when none). */
  barcode: string
  article: string
  type: string
  organization: string
  unit: string
  subUnit: string
  createdDate: string
  orderNumber: string
  hasPhoto: boolean
  canSell: boolean
  isInventory: boolean
  deleted: boolean
  onlyMml: boolean
  perfectStore: boolean
  groupOnly: boolean
  trackExpiry: boolean
  manualDiscount: boolean
  hideFromAgent: boolean
  trackSeries: boolean
  showInBot: boolean
  markedProduct: boolean
  limitPrice: boolean
  group: string
  ikpu: string
  invoiceUnitCode: string
  vat: string
  salePoints: string
  subcategory: string
  brand: string
  minStock: string
  description: string
  supplier: string
  integrationCode: string
  volume: string
  weight: string
  netWeight: string
  color: string
  priceLists: PriceListEntry[]
  cost: number
  /** Derived: min / max of every positive price of priceLists. */
  priceMin: number
  priceMax: number
  priceUpdatedDate: string
}
