import type { DictionaryUsage } from "./dictionaries-data"

// "Типы продуктов" (demo #/product-type, API main/product_type/ and the tree
// main/product_type/as_menu/). Two levels: a top-level type is stored in
// products.type / raw_materials.type, a child ("Подкатегория") in .subcategory.

export const PRODUCT_TYPES_API = "/api/product-types"

/**
 * One type. The first six fields are the original GET /api/product-types array shape
 * (kept for its callers); the rest were added with the demo fields.
 */
export type ProductType = {
  id: number
  name: string
  /** Организация (demo division), a name; "" = not set. */
  organization: string
  parentId: number | null
  /** "Показывать в боте" (demo show_in_market). */
  showInBot: boolean
  /** "08 окт. 2026". */
  createdDate: string
  /** Порядок (demo order). */
  position: number
  /** GET /api/product-types/[id]/image?v=… or null. */
  imageUrl: string | null
  /** Local ISO "YYYY-MM-DDTHH:MM:SS". */
  createdAt: string
}

/** Row of the tree grid (demo as_menu item with nested children). */
export type ProductTypeNode = ProductType & { parentName: string; children: ProductTypeNode[] }

/** GET /api/product-types?view=tree … — top-level types (paged) with their children. */
export type ProductTypeTreeResult = { count: number; results: ProductTypeNode[] }

/** GET /api/product-types/[id] (?usage=1 adds `usage`). */
export type ProductTypeDetail = ProductType & { parentName: string; childCount: number; usage?: DictionaryUsage[] }

/** POST / PUT body. `image`: a data URL = new picture, null = remove, omitted = keep. */
export type ProductTypePayload = {
  name: string
  organization: string
  parentId: number | null
  showInBot: boolean
  position: number
  image?: string | null
}

/** Sortable columns (demo ordering names). */
export const PRODUCT_TYPE_ORDERINGS = ["name", "division", "created_date"] as const
export type ProductTypeOrderingField = (typeof PRODUCT_TYPE_ORDERINGS)[number]

/** The demo lists every type on one page. */
export const PRODUCT_TYPE_PAGE_SIZE = 2000
