// API contract of /api/income-categories and /api/expense-categories: request
// schemas (zod v4) and the error / usage shapes. Client code imports only the
// types from here; the schemas run in the route handlers.
//
// Bodies (our field names, plus the demo serializer names as aliases):
//   income  {name, option | options[] | parameter, otherIncome | is_other}
//   expense {name, option | options[] | parameter, parentId | parent, direct | internal_transfer,
//            excludeFromPnl | disable_pl}
// The option is a single key (demo radio list); `parameter` (a Russian title or a key)
// is accepted for older clients and the Excel import.

import { z } from "zod"

import { isOfferedOption, optionOfParameter, type CategoryKind } from "@/lib/category-options"
import { normalizeOptions, type CategoryOptionKey } from "@/lib/cash/types"

/** Where a category is referenced (label = Russian i18n key of the section). */
export type CategoryUsage = { table: string; label: string; count: number }

/** Error body of the category endpoints. `fields` = inline errors of the dialog. */
export type CategoryErrorBody = {
  error?: string
  fields?: Partial<Record<"name" | "options" | "parentId", string>>
  usage?: CategoryUsage[]
  details?: { fieldErrors?: Record<string, string[] | undefined> }
}

export const CATEGORY_NAME_MAX = 255

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value)
const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value)

const nameField = z.string({ error: "Обязательное поле" }).trim().min(1, "Обязательное поле").max(CATEGORY_NAME_MAX, "Не более 255 символов")
const optionField = z.preprocess(emptyToUndefined, z.string().trim().max(60).optional())
const optionsField = z.array(z.union([z.string(), z.number(), z.object({ key_name: z.string().optional(), key: z.string().optional() })])).max(20).nullable().optional()
const parameterField = z.string().trim().max(120).optional()

type OptionFields = { option?: string; options?: Array<string | number | { key_name?: string; key?: string }> | null; parameter?: string }

/** Single option key of a body ("" = none) or an error message. */
function resolveOption(kind: CategoryKind, body: OptionFields): { key: CategoryOptionKey | "" } | { error: string } {
  if (body.option !== undefined) {
    const [key] = normalizeOptions([body.option])
    return key && isOfferedOption(kind, key) ? { key } : { error: "Недопустимый параметр" }
  }
  if (body.options !== undefined && body.options !== null) {
    if (!body.options.length) return { key: "" }
    if (body.options.length > 1) return { error: "Можно выбрать только один параметр" }
    const [key] = normalizeOptions(body.options)
    return key && isOfferedOption(kind, key) ? { key } : { error: "Недопустимый параметр" }
  }
  if (body.parameter !== undefined) {
    const key = optionOfParameter(kind, body.parameter)
    return key === null ? { error: "Недопустимый параметр" } : { key }
  }
  return { key: "" }
}

function optionCheck(kind: CategoryKind) {
  return (body: OptionFields, ctx: z.RefinementCtx) => {
    const resolved = resolveOption(kind, body)
    if ("error" in resolved) ctx.addIssue({ code: "custom", message: resolved.error, path: ["options"] })
  }
}

function optionOf(kind: CategoryKind, body: OptionFields): CategoryOptionKey | "" {
  const resolved = resolveOption(kind, body)
  return "error" in resolved ? "" : resolved.key
}

// --- income ------------------------------------------------------------------------

export type IncomeCategoryInput = { name: string; option: CategoryOptionKey | ""; otherIncome: boolean }

export const incomeCategoryInputSchema = z
  .object({
    name: nameField,
    option: optionField,
    options: optionsField,
    parameter: parameterField,
    otherIncome: z.boolean().optional(),
    is_other: z.boolean().optional(),
  })
  .superRefine(optionCheck("income"))
  .transform(
    (body): IncomeCategoryInput => ({
      name: body.name,
      option: optionOf("income", body),
      otherIncome: body.otherIncome ?? body.is_other ?? false,
    }),
  )

// --- expense -----------------------------------------------------------------------

export type ExpenseCategoryInput = {
  name: string
  option: CategoryOptionKey | ""
  parentId: number | null
  /** Demo internal_transfer: "Это прямой расход на товар …". */
  direct: boolean
  /** Demo disable_pl: "Не учитывать в отчёте P&L" (always false for a direct expense). */
  excludeFromPnl: boolean
}

const idField = z.preprocess(emptyToNull, z.coerce.number().int("Неверное значение").positive("Неверное значение").max(2_147_483_647).nullable()).optional()

export const expenseCategoryInputSchema = z
  .object({
    name: nameField,
    option: optionField,
    options: optionsField,
    parameter: parameterField,
    parentId: idField,
    parent: idField,
    direct: z.boolean().optional(),
    internal_transfer: z.boolean().optional(),
    excludeFromPnl: z.boolean().optional(),
    disable_pl: z.boolean().optional(),
  })
  .superRefine(optionCheck("expense"))
  .transform((body): ExpenseCategoryInput => {
    const direct = body.direct ?? body.internal_transfer ?? false
    return {
      name: body.name,
      option: optionOf("expense", body),
      parentId: body.parentId !== undefined ? body.parentId : (body.parent ?? null),
      direct,
      // The checkbox is hidden while "прямой расход" is checked: such a category is never excluded.
      excludeFromPnl: direct ? false : (body.excludeFromPnl ?? body.disable_pl ?? false),
    }
  })

// --- list query --------------------------------------------------------------------

const text = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional())
const int = (min: number, max: number) => z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).optional())

export const categoryListQuerySchema = z.object({
  search: text(200),
  /** name | -name | created_date | -created_date | id | -id (+ direct | -direct for expense). */
  ordering: text(40),
  page: int(1, 1_000_000),
  pageSize: int(1, 2000),
})
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>

export function searchParamsObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of params) out[key] = value
  if (out.pageSize === undefined && out.page_size !== undefined) out.pageSize = out.page_size
  return out
}

/** The paged {count, results} shape is opt-in (?page / ?pageSize / ?page_size / ?paged=1):
 * the selects of the other pages keep receiving the plain array. */
export function wantsPagedList(params: URLSearchParams): boolean {
  return params.has("page") || params.has("pageSize") || params.has("page_size") || params.get("paged") === "1"
}

export function parseCategoryId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null
}
