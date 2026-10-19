import type { PriceListEntry } from "./products-data"

export type { PriceListEntry }

// Shape of GET /api/raw-materials (the default array: raw materials not deleted) kept for
// its existing consumers (supplier incomings / returns / reserve, invoice incomings).
// The catalog pages use lib/products-types.ts (CatalogItem, opt-in ?view=list).

export type RawMaterial = {
  id: number
  name: string
  fullName: string
  barcode: string
  article: string
  type: string
  organization: string
  unit: string
  subUnit: string
  createdDate: string
  orderNumber: string
  supplier: string
  brand: string
  minStock: string
  color: string
  integrationCode: string
  mass: string
  netWeight: string
  volume: string
  description: string
  canSell: boolean
  onlyMml: boolean
  perfectStore: boolean
  showAsInventory: boolean
  groupOnly: boolean
  showInBot: boolean
  trackExpiry: boolean
  markedProduct: boolean
  limitPrice: boolean
  group: string
  ikpu: string
  invoiceUnitCode: string
  vat: string
  salePoints: string
  priceLists: PriceListEntry[]
  priceMin: number
  priceMax: number
  /** Soft-deleted ("Удалённые"); only present on ?includeDeleted=1. */
  deleted?: boolean
}
