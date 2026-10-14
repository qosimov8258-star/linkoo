// Shared (client + server) shapes of "Категории приходов" (demo #/income-category,
// API finance/income_category: {id, name, options[], created_date, is_other}).
// Storage rules: lib/income-categories-repo.ts + lib/categories-common.ts.

import type { CategoryOptionKey } from "@/lib/cash/types"

/** Element of GET /api/income-categories (plain array for the selects of other pages) and of the paged list. */
export type IncomeCategory = {
  id: number
  name: string
  /** Russian title of the chosen option ('' = none), kept for older readers. */
  parameter: string
  /** Option keys (lib/cash/types.ts CATEGORY_OPTIONS); the dialog edits the first one. */
  options: CategoryOptionKey[]
  /** "Прочий приход" (demo is_other). */
  otherIncome: boolean
  /** Local "YYYY-MM-DDTHH:mm:ss" of the creation ('' = unknown). */
  createdDate: string
}

/** GET /api/income-categories?page=&pageSize=&search=&ordering= (demo {count, results}). */
export type IncomeCategoryListResult = { count: number; results: IncomeCategory[] }

export const INCOME_CATEGORIES_API = "/api/income-categories"

/** Header sorting: only "Дата создания" is sortable in the demo grid; default = name. */
export type IncomeCategoryOrdering = "" | "created_date" | "-created_date"
