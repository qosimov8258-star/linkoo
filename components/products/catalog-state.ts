"use client"

import { buildCashQuery, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CATALOG_API, EMPTY_CATALOG_FILTERS, type CatalogFilters, type CatalogKind, type CatalogTab } from "@/lib/products-types"

// URL state of the catalog pages (demo filter keys: status, search, ordering, page,
// pageSize, typeParent, typeChild, canSell, measurement, brand, provider, color, division,
// supply, isMML, isGear, isPerfectStore; id = the opened item) and the list query.

export type CatalogViewState = {
  tab: CatalogTab
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: CatalogFilters
  detailId: number | null
}

export const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

const positiveInt = (value: string | null) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

export function stateFromParams(params: URLSearchParams, kind: CatalogKind): CatalogViewState {
  const list = (name: string) => [
    ...new Set(
      params
        .getAll(name)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  const flag = (name: string) => ["1", "true"].includes(params.get(name) ?? "")
  const status = params.get("status") ?? ""
  const tabs = kind === "product" ? ["1", "2", "3", "", "4"] : ["", "4"]
  const canSell = params.get("canSell")
  return {
    tab: (tabs.includes(status) ? status : "") as CatalogTab,
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: {
      typeParent: params.get("typeParent") ?? "",
      typeChild: params.get("typeChild") ?? "",
      canSell: canSell === "1" || canSell === "2" ? canSell : "",
      measurement: list("measurement"),
      brand: list("brand"),
      provider: list("provider"),
      color: list("color"),
      division: list("division"),
      supply: params.get("supply") ?? "",
      isMML: flag("isMML"),
      isGear: flag("isGear"),
      isPerfectStore: flag("isPerfectStore"),
    },
    detailId: positiveInt(params.get("id")),
  }
}

function filterQuery(filters: CatalogFilters): CashQuery {
  return {
    typeParent: filters.typeParent,
    typeChild: filters.typeChild,
    canSell: filters.canSell,
    measurement: filters.measurement,
    brand: filters.brand,
    provider: filters.provider,
    color: filters.color,
    division: filters.division,
    supply: filters.supply,
    isMML: filters.isMML,
    isGear: filters.isGear,
    isPerfectStore: filters.isPerfectStore,
  }
}

export function stateToSearch(state: CatalogViewState): string {
  return buildCashQuery({
    status: state.tab,
    search: state.search,
    ordering: state.ordering,
    page: state.page > 1 ? state.page : "",
    pageSize: state.pageSize !== 25 ? state.pageSize : "",
    ...filterQuery(state.filters),
    id: state.detailId ?? "",
  })
}

/** GET {api}?view=list&… (pageSize 0 = every row; ids = only those). */
export function listUrl(kind: CatalogKind, state: CatalogViewState, override: { pageSize?: number; ids?: number[] } = {}): string {
  const pageSize = override.pageSize ?? state.pageSize
  return `${CATALOG_API[kind]}?${buildCashQuery({
    view: "list",
    status: state.tab,
    search: state.search,
    ordering: state.ordering,
    page: pageSize ? state.page : 1,
    pageSize: String(pageSize),
    ...filterQuery(state.filters),
    ids: override.ids?.length ? override.ids.join(",") : "",
  })}`
}

export function filterCount(filters: CatalogFilters): number {
  return [
    Boolean(filters.typeParent),
    Boolean(filters.typeChild),
    Boolean(filters.canSell),
    filters.measurement.length > 0,
    filters.brand.length > 0,
    filters.provider.length > 0,
    filters.color.length > 0,
    filters.division.length > 0,
    Boolean(filters.supply),
    filters.isMML,
    filters.isGear,
    filters.isPerfectStore,
  ].filter(Boolean).length
}

export { EMPTY_CATALOG_FILTERS }
