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
 * Options offered per kind, in the demo list order (demo ids descending), followed
 * by the two options our cash core supports that the demo list lacks:
 *   staff_income  "Возврат от сотрудников" (income) — staff allocations of an income;
 *   amortization  "Амортизация" (both kinds) — amortization period of the operation.
 * Both are offered only for the kinds CATEGORY_OPTIONS marks applicable, otherwise
 * no category could ever switch those cash dialog panels on.
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
    "amortization",
  ],
  income: ["transaction_child", "client", "provider", "order", "staff_income", "amortization"],
}

/** Tooltip of an option chip (Russian i18n keys). The first four are the demo's
 * descriptions ("Может укзать клиента" with its typo fixed); the demo has none for
 * the others, so ours describe what the cash dialog then asks for. */
export const CATEGORY_OPTION_DESCRIPTIONS: Record<CategoryOptionKey, string> = {
  transaction_child: "Может добавить детализацию",
  client: "Может указать клиента",
  provider: "Может выбрать поставщика",
  supply: "Пользователь может выбрать поставку",
  client_card_out: "Может выбрать клиента и выдать деньги с его карты",
  client_contract: "Может выбрать клиента и договор для выдачи кэшбека",
  staff_expense: "Может распределить сумму между сотрудниками",
  supply_expense: "Может выбрать доп. расход поставки",
  order: "Может выбрать заказ",
  staff_income: "Может указать сотрудников, вернувших деньги",
  amortization: "Может указать период амортизации",
}

export type CategoryOptionItem = { key: CategoryOptionKey; title: string; description: string }

/** Russian title (i18n key) of an option. */
export function categoryOptionTitle(key: CategoryOptionKey): string {
  return CATEGORY_OPTIONS[key]?.title ?? key
}

export function categoryOptionItem(key: CategoryOptionKey): CategoryOptionItem {
  return { key, title: categoryOptionTitle(key), description: CATEGORY_OPTION_DESCRIPTIONS[key] ?? "" }
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
