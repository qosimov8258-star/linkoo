// Shared (client + server) shapes of "Категории расходов" (demo #/expensive-category,
// API finance/expense_category: {id, name, internal_transfer, options[], created_date,
// parent: {id, name} | null, disable_pl}). Storage rules: lib/expense-categories-repo.ts
// + lib/categories-common.ts.

import type { CategoryOptionKey } from "@/lib/cash/types"

/** Element of GET /api/expense-categories (plain array) and of the paged list. */
export type ExpenseCategory = {
  id: number
  name: string
  /** Russian title of the chosen option ('' = none), kept for older readers. */
  parameter: string
  /** Option keys (lib/cash/types.ts CATEGORY_OPTIONS); the dialog edits the first one. */
  options: CategoryOptionKey[]
  /** "Родительская категория" (null = "Не указано"). */
  parentId: number | null
  parentName: string
  /** Demo internal_transfer: "Прямой расход на товар" / "Косвенный расход". */
  direct: boolean
  /** Demo disable_pl: "Не учитывать в отчёте P&L". */
  excludeFromPnl: boolean
  /** Local "YYYY-MM-DDTHH:mm:ss" of the creation ('' = unknown). */
  createdDate: string
}

/** GET /api/expense-categories?page=&pageSize=&search=&ordering= (demo {count, results}). */
export type ExpenseCategoryListResult = { count: number; results: ExpenseCategory[] }

export const EXPENSE_CATEGORIES_API = "/api/expense-categories"

/** Header sorting: "Дата создания" (demo) and "Внутренний расход" (by direct); default = name. */
export type ExpenseCategoryOrdering = "" | "created_date" | "-created_date" | "direct" | "-direct"
