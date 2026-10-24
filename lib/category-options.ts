// Shared (client + server) option metadata of the "Категории приходов" /
// "Категории расходов" settings pages (demo #/income-category, #/expensive-category;
// option list = demo GET main/options/?use=income|expense).
//
// A category stores its options in `options` (JSON array of keys, read by the cash
// core through lib/cash/common.ts loadCategories) and, for older readers, the Russian
// title of the chosen option in `parameter`. Like the demo the pages offer ONE option
// per category (radio list). Titles come from CATEGORY_OPTIONS (lib/cash/types.ts);
// the tooltip descriptions live here.

import { CATEGORY_OPTIONS, normalizeOptions, optionsOfParameter, type CategoryOptionKey } from "@/lib/cash/types"

export type CategoryKind = "income" | "expense"

/**
 * Options offered per kind, exactly the demo list (main/options/?use=income|expense, ids
 * descending). The cash core also understands staff_income and amortization, but the
 * demo offers neither, so the dialog does not either.
 */
export const CATEGORY_KIND_OPTIONS: Record<CategoryKind, readonly CategoryOptionKey[]> = {
  expense: [
    "client_card_out",
    "client_contract",
    "transaction_child",
    "staff_expense",
    "client",
    "provider",
    "supply",
    "supply_expense",
  ],
  income: ["transaction_child", "client", "provider", "order"],
}

/** Tooltip of an option chip (Russian i18n keys). The first four are the demo's
 * descriptions ("Может укзать клиента" with its typo fixed); the demo has none for
 * the others, so ours describe what the cash dialog then asks for. */
export const CATEGORY_OPTION_DESCRIPTIONS: Record<CategoryOptionKey, string> = {
  transaction_child: "Может добавить детализацию",
  client: "Может указать клиента",
  provider: "Может выбрать поставщика",
  supply: "Пользователь может выбрать поставку",
  client_card_out: "client_card_out",
  client_contract: "Выдача денег для Кэшбек",
  staff_expense: "Расход на сотрудников",
  supply_expense: "Доп. расход",
  order: "Заказ",
  staff_income: "Может указать сотрудников, вернувших деньги",
  amortization: "Может указать период амортизации",
}

export type CategoryOptionItem = { key: CategoryOptionKey; title: string; description: string }

/** Russian title (i18n key) of an option. */
export function categoryOptionTitle(key: CategoryOptionKey): string {
  return CATEGORY_OPTIONS[key]?.title ?? key
}

export function categoryOptionItem(key: CategoryOptionKey): CategoryOptionItem {
  // the demo lists this option under its raw key
  return { key, title: key === "client_card_out" ? key : categoryOptionTitle(key), description: CATEGORY_OPTION_DESCRIPTIONS[key] ?? "" }
}

/** The radio list of the dialog. */
export function categoryOptionItems(kind: CategoryKind): CategoryOptionItem[] {
  return CATEGORY_KIND_OPTIONS[kind].map(categoryOptionItem)
}

export function isOfferedOption(kind: CategoryKind, key: string): key is CategoryOptionKey {
  return (CATEGORY_KIND_OPTIONS[kind] as readonly string[]).includes(key)
}

/** Options of a stored row: `options` when set (JSON text / array), else derived from the
 * legacy `parameter` label — the same rule as lib/cash/common.ts toCategory(). */
export function storedCategoryOptions(options: unknown, parameter: string | null | undefined): CategoryOptionKey[] {
  if (options === null || options === undefined) return optionsOfParameter(parameter)
  return normalizeOptions(options)
}

/** The dialog's single choice for stored options: the first one offered for the kind ("" = none). */
export function primaryCategoryOption(kind: CategoryKind, options: readonly CategoryOptionKey[]): CategoryOptionKey | "" {
  return options.find((key) => isOfferedOption(kind, key)) ?? ""
}

/** Option of a free-text "Параметры" cell (Excel import): a title or a key, offered for the kind. */
export function optionOfParameter(kind: CategoryKind, parameter: string | null | undefined): CategoryOptionKey | "" | null {
  const text = String(parameter ?? "").trim()
  if (!text) return ""
  return primaryCategoryOption(kind, optionsOfParameter(text)) || null
}
