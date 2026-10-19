import type { DictionaryUsage } from "./dictionaries-data"

// "Бренд" (demo #/brand, API main/brand/?thumbnail_type=large). Products store the brand
// NAME in products.brand / raw_materials.brand.

export const BRANDS_API = "/api/brands"

/** The first five fields are the original GET /api/brands array shape. */
export type Brand = {
  id: number
  name: string
  /** Организация (demo division), a name; "" = not set. */
  organization: string
  /** "08 окт. 2026". */
  createdDate: string
  /** Picture URL (GET /api/brands/[id]/image?v=…) or null. */
  photoUrl: string | null
  /** Local ISO "YYYY-MM-DDTHH:MM:SS". */
  createdAt: string
}

/** GET /api/brands?page=… — the grid of the page. */
export type BrandListResult = { count: number; results: Brand[] }

/** GET /api/brands/[id] (?usage=1 adds `usage`). */
export type BrandDetail = Brand & { usage?: DictionaryUsage[] }

/** POST / PUT body. `image`: a data URL = new picture, null = remove, omitted = keep. */
export type BrandPayload = { name: string; organization: string; image?: string | null }

export const BRAND_ORDERINGS = ["id", "image", "name", "division", "created_date"] as const
export type BrandOrderingField = (typeof BRAND_ORDERINGS)[number]
