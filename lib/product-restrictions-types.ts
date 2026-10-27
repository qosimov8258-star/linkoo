// Shared shapes of "Ограничение продуктов" (demo #/user_product): the API answers of
// /api/product-restrictions/** and their limits. No server-only imports: the view uses them too.
//
// A restriction is a whitelist per employee (agent): with a product list and / or a product
// type list the agent may sell only those products ("Агент только будет продавать товары в
// этом списке"); with neither list ("Не установлено") the agent is not restricted.

export const RESTRICTION_TABS = ["product", "product_type"] as const
export type RestrictionTab = (typeof RESTRICTION_TABS)[number]

/** ADD = union with the current list, REMOVE = subtract, SET = replace exactly ("Стереть и добавить"). */
export const RESTRICTION_MODES = ["add", "remove", "set"] as const
export type RestrictionMode = (typeof RESTRICTION_MODES)[number]

export const RESTRICTION_PAGE_SIZES = [10, 25, 50, 100] as const
export const RESTRICTION_DEFAULT_PAGE_SIZE = 25
/** The picker ("Добавление продуктов") pages by 50, like the demo. */
export const RESTRICTION_PICKER_PAGE_SIZE = 50

/** Limits of one write: employees, items and employees × items (rows written at most). */
export const MAX_RESTRICTION_EMPLOYEES = 500
export const MAX_RESTRICTION_ITEMS = 5000
export const MAX_RESTRICTION_PAIRS = 100_000
export const MAX_RESTRICTION_SEARCH = 200

export type RestrictionOrdering = "id" | "-id"

/** GET /api/product-restrictions row: an employee and the size of both lists. */
export type RestrictionListRow = {
  id: number
  name: string
  active: boolean
  productCount: number
  productTypeCount: number
}

export type RestrictionListResponse = {
  count: number
  page: number
  pageSize: number
  results: RestrictionListRow[]
}

/** A product or product type of a list / the picker. `name` of a child type is "Parent / Child". */
export type RestrictionItem = { id: number; name: string; deleted?: boolean }

/** GET /api/product-restrictions/:employeeId */
export type RestrictionDetail = {
  id: number
  name: string
  active: boolean
  products: RestrictionItem[]
  productTypes: RestrictionItem[]
}

/** GET /api/product-restrictions/options (the picker's page). */
export type RestrictionOptionsResponse = {
  count: number
  page: number
  pageSize: number
  results: RestrictionItem[]
}

/** GET /api/product-restrictions/filters: the picker's "Фильтр по типу / бренду / организации". */
export type RestrictionFilters = {
  types: RestrictionItem[]
  brands: RestrictionItem[]
  organizations: RestrictionItem[]
}

/** POST /api/product-restrictions answer. `changed` = rows added + removed. */
export type RestrictionApplyResult = { employees: number; changed: number }

/** GET /api/product-restrictions/allowed (for the mobile agent app and the order forms). */
export type AllowedProducts = {
  employeeId: number
  name: string
  /** False: no list, every product may be sold (`allowedProductIds` is then null). */
  restricted: boolean
  productIds: number[]
  productTypeIds: number[]
  /** Live products the employee may sell (by the product list or the type list), or null when not restricted. */
  allowedProductIds: number[] | null
}

/** Detail of the order refusal "Агенту запрещено продавать товар" (409 body `productRestriction`). */
export type ProductRestrictionViolation = {
  employeeId: number
  agent: string
  products: Array<{ id: number; name: string }>
}
