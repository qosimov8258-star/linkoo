import "server-only"

import { NextResponse } from "next/server"

import { canReadCompanyMoney, canReadPurchases } from "@/lib/company-money"
import type { CurrentUser } from "@/lib/current-user"
import { parseDocDay } from "@/lib/document-dates"
import { fieldScopeOf, forbiddenResponse, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { selectedBranchName } from "@/lib/selected-branch"

import type { ModelAccess } from "./context"
import { describeOldModel, isCompareOperation, oldReportAccess, oldReportFilterOptions, oldReportModels, oldReportStrayIds, runOldReport, type OldReportInput } from "./index"

// The old report builder behind /api/report-builder (kind "old"): who may open which model, and the checks of what
// the page sends. A model follows the rule of the pages that show the same data: field models (visits, tasks,
// refusals) the field scope of Активность — an agent gets their own; purchase models the readers of purchases;
// money models the readers of company money; every other model any signed-in user. What the goods cost (cost
// price, profit, markup) is left out of every model for a reader who may not see purchases.

const BAD_DATA = "Неверные данные"
const UNKNOWN_MODEL = "Неизвестная модель отчета"
const MAX_NAMES = 200
const MAX_FILTERS = 100
const MAX_VALUES = 500
const MAX_TEXT = 300

const fail = (error: string, field?: string) => NextResponse.json({ error, ...(field ? { field } : {}) }, { status: 400 })

type Grant = { ok: true; employeeIds?: number[] } | { ok: false }

/** May the user open a model of this access rule, and with which field scope? */
async function grant(user: CurrentUser, access: ModelAccess): Promise<Grant> {
  if (access === "purchases") return canReadPurchases(user) ? { ok: true } : { ok: false }
  if (access === "money") return canReadCompanyMoney(user) ? { ok: true } : { ok: false }
  if (access === "field") {
    const scope = await fieldScopeOf(user)
    return scope ? { ok: true, employeeIds: scopedEmployeeIds(scope, undefined) } : { ok: false }
  }
  return { ok: true }
}

function names(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_NAMES) return null
  return value.every((item) => typeof item === "string" && item.length > 0 && item.length <= MAX_TEXT) ? [...new Set(value as string[])] : null
}

/** {filter id: chosen values}: missing → {}; a single text counts as one value; empty lists are dropped. */
function quickFilters(value: unknown): Record<string, string[]> | null {
  if (value === undefined || value === null) return {}
  if (typeof value !== "object" || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_FILTERS) return null
  const filters: Record<string, string[]> = {}
  for (const [key, item] of entries) {
    const list = typeof item === "string" ? [item] : item
    if (list === undefined || list === null) continue
    if (key.length > MAX_TEXT || !Array.isArray(list) || list.length > MAX_VALUES) return null
    if (!list.every((entry) => typeof entry === "string" && entry.length <= MAX_TEXT)) return null
    const chosen = (list as string[]).map((entry) => entry.trim()).filter(Boolean)
    if (chosen.length) filters[key] = chosen
  }
  return filters
}

function compareFilters(value: unknown): OldReportInput["compare"] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_FILTERS) return null
  const out: OldReportInput["compare"] = []
  for (const item of value) {
    if (!item || typeof item !== "object") return null
    const { field, op, value: typed } = item as Record<string, unknown>
    if (typeof field !== "string" || !field || field.length > MAX_TEXT || !isCompareOperation(op) || typeof typed !== "string" || typed.length > MAX_TEXT) return null
    if (typed.trim()) out.push({ field, op, value: typed })
  }
  return out
}

function period(from: unknown, to: unknown): { from: string; to: string } | NextResponse {
  if (typeof from !== "string" || !from.trim() || typeof to !== "string" || !to.trim()) return fail("Укажите период", typeof from === "string" && from.trim() ? "to" : "from")
  const first = parseDocDay(from, { allowFuture: true })
  if (!first.ok) return fail(first.error, "from")
  const last = parseDocDay(to, { allowFuture: true })
  if (!last.ok) return fail(last.error, "to")
  if (first.date > last.date) return fail(FIELD_MESSAGES.badRange, "from")
  return { from: first.date, to: last.date }
}

/** POST {kind: "old", model, from, to, columns[], vertical[], horizontal[], filters{}, compare[], showTotals} → the table. */
export async function oldReportPost(user: CurrentUser, data: Record<string, unknown>): Promise<NextResponse> {
  if (typeof data.model !== "string") return fail(UNKNOWN_MODEL, "model")
  const access = oldReportAccess(data.model)
  if (!access) return fail(UNKNOWN_MODEL, "model")
  const allowed = await grant(user, access)
  if (!allowed.ok) return forbiddenResponse()
  const range = period(data.from, data.to)
  if (range instanceof NextResponse) return range
  const columns = names(data.columns)
  const vertical = names(data.vertical)
  const horizontal = names(data.horizontal)
  if (!columns) return fail(BAD_DATA, "columns")
  if (!vertical) return fail(BAD_DATA, "vertical")
  if (!horizontal) return fail(BAD_DATA, "horizontal")
  if (!columns.length) return fail("Выберите хотя бы одну колонку", "columns")
  const filters = quickFilters(data.filters)
  if (!filters) return fail(BAD_DATA, "filters")
  const compare = compareFilters(data.compare)
  if (!compare) return fail(BAD_DATA, "compare")
  if (data.showTotals !== undefined && typeof data.showTotals !== "boolean") return fail(BAD_DATA, "showTotals")
  return NextResponse.json(
    await runOldReport({
      model: data.model,
      ...range,
      columns,
      vertical,
      horizontal,
      filters,
      compare,
      showTotals: data.showTotals !== false,
      branch: await selectedBranchName(),
      employeeIds: allowed.employeeIds,
      canSeeCost: canReadPurchases(user),
    }),
  )
}

/** GET ?kind=old → the models the user may open; &model=… → its panel lists; &model=…&filter=…&from=…&to=… → the
 * options of a quick filter. */
export async function oldReportGet(user: CurrentUser, params: URLSearchParams): Promise<NextResponse> {
  const model = params.get("model")
  if (!model) {
    const models = []
    for (const item of oldReportModels()) if ((await grant(user, item.access)).ok) models.push({ key: item.key, name: item.name })
    return NextResponse.json({ models })
  }
  const access = oldReportAccess(model)
  if (!access) return fail(UNKNOWN_MODEL, "model")
  const allowed = await grant(user, access)
  if (!allowed.ok) return forbiddenResponse()
  const filter = params.get("filter")
  if (!filter) {
    const info = await describeOldModel(model, { canSeeCost: canReadPurchases(user) })
    if (!info) return fail(UNKNOWN_MODEL, "model")
    // Outside production the answer also names the implemented ids the catalog does not list (scripts check it).
    return NextResponse.json(process.env.NODE_ENV === "production" ? info : { ...info, stray: oldReportStrayIds(model) })
  }
  if (filter.length > MAX_TEXT) return fail(BAD_DATA, "filter")
  const range = period(params.get("from"), params.get("to"))
  if (range instanceof NextResponse) return range
  const options = await oldReportFilterOptions({ model, filter, ...range, branch: await selectedBranchName(), employeeIds: allowed.employeeIds })
  return options ? NextResponse.json({ options }) : fail(BAD_DATA, "filter")
}
