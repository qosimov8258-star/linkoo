import "server-only"

import { getDb } from "@/lib/db"
import type { BuilderResult } from "@/lib/report-builder-repo"

import { OLD_REPORT_CATALOG, type CatalogField, type CatalogModel } from "./catalog"
import { createRunContext, PASS, type AnyModel, type FilterDef, type ModelAccess, type ModelImpl, type RunContext } from "./context"
import { Directory, type ClientInfo } from "./directory"
import { clientGroups } from "./facets"
import { pivot, type GroupDef } from "./pivot"
import { OLD_REPORT_MODELS } from "./registry"

// «Конструктор отчетов» (the old report builder): the models, what each lists in its panels, and the report of a
// model — its records (lib/old-report/models/*) filtered, grouped and measured (lib/old-report/pivot.ts). The lists
// are the reference's (lib/old-report/catalog.ts); a listed field this app has no data for is marked unsupported:
// the page greys it out, and a report that still asks for it (a saved one) names it in `unsupported`.

export const COMPARE_OPERATIONS = [
  { id: "contains", name: "содержит" },
  { id: "not_equal", name: "не равен" },
  { id: "gte", name: "больше чем или равен" },
  { id: "lte", name: "менее чем или равен" },
  { id: "gt", name: "больше чем" },
  { id: "lt", name: "меньше чем" },
  { id: "exclude", name: "исключить" },
] as const
export type CompareOperation = (typeof COMPARE_OPERATIONS)[number]["id"]
export const isCompareOperation = (value: unknown): value is CompareOperation => COMPARE_OPERATIONS.some((item) => item.id === value)

/** Prefix of the id of a client-attribute grouping ("attr:<attribute name>"). */
const ATTRIBUTE = "attr:"

export type OldReportInput = {
  model: string
  from: string
  to: string
  columns: string[]
  vertical: string[]
  horizontal: string[]
  /** «Быстрый фильтр»: filter id → the chosen values (any of them). */
  filters: Record<string, string[]>
  /** «Фильтры»: field, operation, typed value (all of them). */
  compare: { field: string; op: CompareOperation; value: string }[]
  showTotals: boolean
  branch: string
  employeeIds?: number[]
  /** The reader may see what the goods cost (lib/company-money.ts canReadPurchases). */
  canSeeCost: boolean
}

export type OldFieldInfo = { id: string; name: string; hint?: string; supported: boolean }
export type OldModelInfo = {
  key: string
  name: string
  columns: OldFieldInfo[]
  groups: OldFieldInfo[]
  filters: OldFieldInfo[]
  compare: OldFieldInfo[]
  operations: { id: string; name: string }[]
}

const catalogOf = (key: string): CatalogModel | undefined => OLD_REPORT_CATALOG.find((model) => model.key === key)
const implOf = (key: string): AnyModel | undefined => OLD_REPORT_MODELS[key]

/** The models the builder offers: the reference's list, the ones this app has data for, in its order. */
export function oldReportModels(): { key: string; name: string; access: ModelAccess }[] {
  return OLD_REPORT_CATALOG.filter((model) => implOf(model.key)).map((model) => ({ key: model.key, name: model.name, access: (implOf(model.key) as AnyModel).access }))
}

export function oldReportAccess(key: string): ModelAccess | null {
  return implOf(key)?.access ?? null
}

/** Is the model named in the catalog (also one this app has no data for: a saved report may name it)? */
export function oldReportModelName(key: string): string | null {
  return catalogOf(key)?.name ?? null
}

/** Development aid: the field ids a model implements that its catalog entry does not list (a mistyped id). */
export function oldReportStrayIds(key: string): string[] {
  const catalog = catalogOf(key)
  const impl = implOf(key) as ModelImpl<unknown> | undefined
  if (!catalog || !impl) return []
  const listed = (fields: CatalogField[]) => new Set(fields.map((field) => field[0]))
  const stray = (kind: string, ids: string[], known: Set<string>) => ids.filter((id) => !known.has(id)).map((id) => `${kind}:${id}`)
  return [
    ...stray("column", Object.keys(impl.measures), listed(catalog.columns)),
    ...stray("group", Object.keys(impl.groups), listed(catalog.groups)),
    ...stray("filter", Object.keys(impl.filters), listed([...catalog.filters, ...catalog.compare])),
  ]
}

/** The panel lists of a model. */
export async function describeOldModel(key: string, options: { canSeeCost: boolean }): Promise<OldModelInfo | null> {
  const catalog = catalogOf(key)
  const impl = implOf(key) as ModelImpl<unknown> | undefined
  if (!catalog || !impl) return null
  const hidden = new Set(options.canSeeCost ? [] : (impl.cost ?? []))
  const info = (field: CatalogField, supported: boolean): OldFieldInfo => ({ id: field[0], name: field[1], ...(field[2] ? { hint: field[2] } : {}), supported })
  const groups = catalog.groups.map((field) => info(field, field[0] in impl.groups && !hidden.has(field[0])))
  if (catalog.clientAttributes !== undefined) {
    const attributes = await new Directory(getDb()).reportAttributes()
    groups.splice(catalog.clientAttributes, 0, ...attributes.map((name) => ({ id: `${ATTRIBUTE}${name}`, name, supported: true })))
  }
  return {
    key: catalog.key,
    name: catalog.name,
    columns: catalog.columns.map((field) => info(field, field[0] in impl.measures && !hidden.has(field[0]))),
    groups,
    filters: catalog.filters.map((field) => info(field, field[0] in impl.filters)),
    compare: catalog.compare.map((field) => info(field, field[0] in impl.filters)),
    operations: COMPARE_OPERATIONS.map((item) => ({ ...item })),
  }
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const NUMERIC = /^-?\d+(?:[.,]\d+)?$/
const number = (value: string) => Number(value.replace(/\s/g, "").replace(",", "."))

/** Does a record's value pass a comparison filter? Numbers compare as numbers, anything else as text. */
function compares(actual: unknown, op: CompareOperation, typed: string): boolean {
  const wanted = typed.trim()
  const values = Array.isArray(actual) ? actual.map(text) : [text(actual)]
  const one = (value: string) => {
    const numeric = NUMERIC.test(wanted.replace(/\s/g, "")) && (typeof actual === "number" || NUMERIC.test(value.replace(/\s/g, "")))
    if (numeric) {
      const a = number(value || "0")
      const b = number(wanted)
      switch (op) {
        case "contains": return Math.abs(a - b) < 1e-9
        case "not_equal":
        case "exclude": return Math.abs(a - b) >= 1e-9
        case "gte": return a >= b
        case "lte": return a <= b
        case "gt": return a > b
        case "lt": return a < b
      }
    }
    const a = value.toLocaleLowerCase("ru")
    const b = wanted.toLocaleLowerCase("ru")
    switch (op) {
      case "contains": return a.includes(b)
      case "exclude": return !a.includes(b)
      case "not_equal": return a !== b
      case "gte": return a >= b
      case "lte": return a <= b
      case "gt": return a > b
      case "lt": return a < b
    }
  }
  // A list (the products of an order) passes when one of its values does; an exclusion when none fails.
  return op === "exclude" || op === "not_equal" ? values.every(one) : values.some(one)
}

/** The option list of a quick filter: the filter's own list, else the values the records of the period have. */
export async function oldReportFilterOptions(input: { model: string; filter: string; from: string; to: string; branch: string; employeeIds?: number[] }): Promise<string[] | null> {
  const impl = implOf(input.model) as ModelImpl<unknown> | undefined
  const filter = impl?.filters[input.filter]
  if (!impl || !filter) return null
  const context = await createRunContext(getDb(), { ...input, requested: [input.filter] })
  if (filter.options) return [...new Set((await filter.options(context)).map(text).filter(Boolean))]
  const seen = new Set<string>()
  for (const record of await impl.load(context)) {
    const value = filter.value(record)
    if (value === PASS) continue
    for (const item of Array.isArray(value) ? value : [value]) if (text(item)) seen.add(text(item))
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
}

export async function runOldReport(input: OldReportInput): Promise<BuilderResult> {
  const catalog = catalogOf(input.model)
  const impl = implOf(input.model) as ModelImpl<unknown> | undefined
  if (!catalog || !impl) return { headers: [], rows: [], totals: null, unsupported: [], count: 0 }
  const hidden = new Set(input.canSeeCost ? [] : (impl.cost ?? []))
  const unsupported: string[] = []
  const nameOf = (list: CatalogField[], id: string) => list.find((field) => field[0] === id)?.[1] ?? id

  const columns = input.columns.flatMap((id) => {
    const fn = hidden.has(id) ? undefined : impl.measures[id]
    if (!fn) unsupported.push(nameOf(catalog.columns, id))
    return fn ? [{ name: nameOf(catalog.columns, id), fn }] : []
  })
  // Client attributes («attr:<name>»): of the record's client (every model that lists them keeps it in `client`).
  const attributes = clientGroups<unknown>((record) => (record as { client?: ClientInfo }).client, () => "")
  const groupOf = (id: string): { name: string; def: GroupDef<unknown> } | null => {
    if (id.startsWith(ATTRIBUTE) && catalog.clientAttributes !== undefined) return { name: id.slice(ATTRIBUTE.length), def: attributes.attribute(id.slice(ATTRIBUTE.length)) }
    const def = hidden.has(id) ? undefined : impl.groups[id]
    if (!def) {
      unsupported.push(nameOf(catalog.groups, id))
      return null
    }
    return { name: nameOf(catalog.groups, id), def }
  }
  const pick = (ids: string[]) => ids.map(groupOf).filter((group): group is { name: string; def: GroupDef<unknown> } => group !== null)
  // A grouping chosen for both directions splits the rows only.
  const vertical = pick(input.vertical)
  const horizontal = pick(input.horizontal.filter((id) => !input.vertical.includes(id)))

  const quick = Object.entries(input.filters).filter(([, values]) => values.length)
  const filterIds = [...quick.map(([id]) => id), ...input.compare.map((item) => item.field)]
  for (const id of filterIds) if (!impl.filters[id]) unsupported.push(nameOf([...catalog.filters, ...catalog.compare], id))
  const context: RunContext = await createRunContext(getDb(), {
    from: input.from,
    to: input.to,
    branch: input.branch,
    employeeIds: input.employeeIds,
    requested: [...input.columns, ...input.vertical, ...input.horizontal, ...filterIds],
  })
  let records = await impl.load(context)
  const applied: { def: FilterDef<unknown>; test: (value: unknown) => boolean }[] = []
  for (const [id, values] of quick) {
    const def = impl.filters[id]
    if (!def) continue
    const wanted = new Set(values.map((value) => value.trim()))
    applied.push({ def, test: (value) => (Array.isArray(value) ? value.some((item) => wanted.has(text(item))) : wanted.has(text(value))) })
  }
  for (const item of input.compare) {
    const def = impl.filters[item.field]
    if (!def || !item.value.trim()) continue
    applied.push({ def, test: (value) => compares(value, item.op, item.value) })
  }
  if (applied.length) {
    records = records.filter((record) =>
      applied.every((filter) => {
        const value = filter.def.value(record)
        return value === PASS || filter.test(value)
      }),
    )
  }

  const result = pivot({ records, vertical, horizontal, columns, showTotals: input.showTotals })
  result.unsupported = [...new Set(unsupported)]
  if (context.money.missing.size) result.missingRates = [...context.money.missing].sort()
  result.currency = context.money.code
  return result
}
