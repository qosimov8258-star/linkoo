"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { useSearchParams } from "next/navigation"

import { BatchDetail } from "@/components/analytics/production/batch-detail"
import { MaterialBody, MaterialDate, MaterialDialog, MaterialFooter, MaterialTextArea } from "@/components/analytics/cash-material"
import { FilterToggle } from "@/components/analytics/internal-transfers-filter"
import { api, formatDate, formatDateTime, PRODUCTION_WRITE, STATUS_DOT, STATUS_LABELS, type CatalogItem, type PartyStatus, type Stage } from "@/components/analytics/production/production-ui"
import { useCanManage } from "@/components/analytics/cash-management-shared"
import { FilterDate, FilterMultiSelect, FilterSearchSelect, RI, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefTabs, RefTable, RefToolbar, type FilterOption } from "@/components/ref/list-kit"
import { DOC_DATE_FUTURE, DOC_DATE_INVALID, docDateError, docYearOk } from "@/lib/document-dates"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatDayMonth, isIsoDay, monthEndIso, monthStartIso, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

type Party = {
  id: number
  stageId: number | null
  stageName: string
  date: string
  comment: string
  status: PartyStatus
  userName: string
  createdAt: string
  finishedAt: string
}

/** One page of the list as the API serves it (the reference pages on the server). */
type PartyPage = { count: number; page: number; pageSize: number; results: Party[] }

type Tab = "" | "pending" | "finished"
type Ordering = "" | "id" | "-id" | "status" | "-status"

/** The filter panel's fields: products by id (the reference's madeProduct / rawProduct), Mezon's own raw materials by
 * id (a norm's raw line may be one; the reference has none), the stage, two day ranges. */
type Filters = { made: number[]; raw: number[]; rawMaterial: number[]; stageId: string; createdFrom: string; createdTo: string; finishedFrom: string; finishedTo: string }

type ListState = Filters & {
  status: Tab
  page: number
  pageSize: number
  search: string
  ordering: Ordering
  /** The open batch (the reference's #/party/<id>). */
  party: number | null
  filterOpen: boolean
  createOpen: boolean
}

const EMPTY_FILTERS: Filters = { made: [], raw: [], rawMaterial: [], stageId: "", createdFrom: "", createdTo: "", finishedFrom: "", finishedTo: "" }

// The list's state lives in the URL with the reference's own names (#/party?status=…&page=…&pageSize=…&search=…
// &ordering=…&madeProduct=171-189&rawProduct=…&manufacture=…&fromDate=…&toDate=…&fromDateSecond=…&toDateSecond=…
// &openFilterDialog=true&openCreateDialog=true): a reload restores the view, a link carries it, and Back / Forward step
// through tabs, pages, sorts and filters. ?party=<id> is the open batch. rawMaterial=5-7 is Mezon's own: the raw
// materials picked in «Сырье» (rawProduct keeps the products, as the reference). Other parameters (the batch detail's
// own tab and dialogs) are kept as they are.
const PARAM = {
  status: "status",
  page: "page",
  pageSize: "pageSize",
  search: "search",
  ordering: "ordering",
  made: "madeProduct",
  raw: "rawProduct",
  rawMaterial: "rawMaterial",
  stageId: "manufacture",
  createdFrom: "fromDate",
  createdTo: "toDate",
  finishedFrom: "fromDateSecond",
  finishedTo: "toDateSecond",
  party: "party",
  filterOpen: "openFilterDialog",
  createOpen: "openCreateDialog",
} as const

const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]
const ORDERINGS: Ordering[] = ["id", "-id", "status", "-status"]
const MAX_ID = 2_147_483_647
/** The history entry a panel / dialog was opened with (Back then closes it; its X goes back instead of adding a step). */
const OPENED = "productionBatchesOpened"

type Params = { get(name: string): string | null }

const positiveId = (value: string | null): number | null => {
  const text = (value ?? "").trim()
  if (!/^[1-9]\d{0,9}$/.test(text)) return null
  const id = Number(text)
  return id <= MAX_ID ? id : null
}
const idList = (value: string | null): number[] =>
  [...new Set((value ?? "").split(/[-,]/).map(positiveId).filter((id): id is number => id !== null))].slice(0, 100)
const dayParam = (value: string | null): string => (value && isIsoDay(value) && docYearOk(value) ? value : "")
function rangeParams(params: Params, from: string, to: string): [string, string] {
  let start = dayParam(params.get(from))
  let end = dayParam(params.get(to))
  if (start && end && start > end) [start, end] = [end, start]
  return [start, end]
}

function stateFromParams(params: Params): ListState {
  const status = params.get(PARAM.status)
  const size = Number(params.get(PARAM.pageSize))
  const ordering = (params.get(PARAM.ordering) ?? "") as Ordering
  const [createdFrom, createdTo] = rangeParams(params, PARAM.createdFrom, PARAM.createdTo)
  const [finishedFrom, finishedTo] = rangeParams(params, PARAM.finishedFrom, PARAM.finishedTo)
  return {
    status: status === "pending" || status === "finished" ? status : "",
    page: positiveId(params.get(PARAM.page)) ?? 1,
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
    search: (params.get(PARAM.search) ?? "").trim(),
    ordering: ORDERINGS.includes(ordering) ? ordering : "",
    made: idList(params.get(PARAM.made)),
    raw: idList(params.get(PARAM.raw)),
    rawMaterial: idList(params.get(PARAM.rawMaterial)),
    stageId: String(positiveId(params.get(PARAM.stageId)) ?? ""),
    createdFrom,
    createdTo,
    finishedFrom,
    finishedTo,
    party: positiveId(params.get(PARAM.party)),
    filterOpen: params.get(PARAM.filterOpen) === "true",
    createOpen: params.get(PARAM.createOpen) === "true",
  }
}

/** `base` with the list's parameters set from `state` (defaults are left out); every other parameter stays. */
function writeState(base: URLSearchParams, state: ListState): URLSearchParams {
  const params = new URLSearchParams(base)
  const put = (name: string, value: string) => (value ? params.set(name, value) : params.delete(name))
  put(PARAM.status, state.status)
  put(PARAM.page, state.page > 1 ? String(state.page) : "")
  put(PARAM.pageSize, state.pageSize !== DEFAULT_PAGE_SIZE ? String(state.pageSize) : "")
  put(PARAM.search, state.search)
  put(PARAM.ordering, state.ordering)
  put(PARAM.made, state.made.join("-"))
  put(PARAM.raw, state.raw.join("-"))
  put(PARAM.rawMaterial, state.rawMaterial.join("-"))
  put(PARAM.stageId, state.stageId)
  put(PARAM.createdFrom, state.createdFrom)
  put(PARAM.createdTo, state.createdTo)
  put(PARAM.finishedFrom, state.finishedFrom)
  put(PARAM.finishedTo, state.finishedTo)
  put(PARAM.party, state.party ? String(state.party) : "")
  put(PARAM.filterOpen, state.filterOpen ? "true" : "")
  put(PARAM.createOpen, state.createOpen ? "true" : "")
  return params
}

/** The API request of the list's current page. */
function listRequest(state: ListState): string {
  const params = new URLSearchParams()
  params.set("page", String(state.page))
  params.set("pageSize", String(state.pageSize))
  if (state.status) params.set("status", state.status)
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  if (state.made.length) params.set("madeKey", state.made.map((id) => `product:${id}`).join(","))
  const rawKeys = rawValues(state)
  if (rawKeys.length) params.set("rawKey", rawKeys.join(","))
  if (state.stageId) params.set("stageId", state.stageId)
  // Business days (Asia/Tashkent): the server turns them into the day's bounds, the same for every viewer.
  if (state.createdFrom) params.set("createdFrom", state.createdFrom)
  if (state.createdTo) params.set("createdTo", state.createdTo)
  if (state.finishedFrom) params.set("finishedFrom", state.finishedFrom)
  if (state.finishedTo) params.set("finishedTo", state.finishedTo)
  return `/api/production/parties?${params}`
}

/** The same request with another page (the page the server answered with). */
function withPage(url: string, page: number): string {
  const [path, query = ""] = url.split("?")
  const params = new URLSearchParams(query)
  params.set("page", String(page))
  return `${path}?${params}`
}

/** «Сырье»'s picks as item keys ("product:171", "raw_material:5"): the values of its options and the API's rawKey. */
function rawValues(filters: Pick<Filters, "raw" | "rawMaterial">): string[] {
  return [...filters.raw.map((id) => `product:${id}`), ...filters.rawMaterial.map((id) => `raw_material:${id}`)]
}
/** «Сырье»'s item keys back to the product ids and the raw material ids. */
function rawPicks(values: string[]): Pick<Filters, "raw" | "rawMaterial"> {
  const ids = (kind: string) => values.flatMap((value) => (value.startsWith(`${kind}:`) ? [positiveId(value.slice(kind.length + 1))] : [])).filter((id): id is number => id !== null)
  return { raw: ids("product"), rawMaterial: ids("raw_material") }
}

/** A name compared as the catalog's namesakes are (case, spaces and Unicode form aside). */
const nameKey = (name: string) => name.normalize("NFC").trim().toLocaleLowerCase("ru").replace(/\s+/g, " ")

/** «Фильтр: N элемента»: each range, the stage and each product field count once (the reference's getCount). */
const filterCount = (filters: Filters) =>
  [filters.createdFrom || filters.createdTo, filters.finishedFrom || filters.finishedTo, filters.stageId, filters.made.length, filters.raw.length + filters.rawMaterial.length].filter(Boolean).length

const filtersOf = (state: ListState): Filters => ({
  made: state.made,
  raw: state.raw,
  rawMaterial: state.rawMaterial,
  stageId: state.stageId,
  createdFrom: state.createdFrom,
  createdTo: state.createdTo,
  finishedFrom: state.finishedFrom,
  finishedTo: state.finishedTo,
})

/** Like the reference, an opened filter shows the current month (Asia/Tashkent) in a range that is not set (the × of
 * its picker clears it again). */
function withMonth(filters: Filters): Filters {
  const today = todayIso()
  const month = { from: monthStartIso(today), to: monthEndIso(today) }
  const created = filters.createdFrom || filters.createdTo ? { from: filters.createdFrom, to: filters.createdTo } : month
  const finished = filters.finishedFrom || filters.finishedTo ? { from: filters.finishedFrom, to: filters.finishedTo } : month
  return { ...filters, createdFrom: created.from, createdTo: created.to, finishedFrom: finished.from, finishedTo: finished.to }
}

const TABS: Array<[Tab, string]> = [
  ["pending", "В процессе"],
  ["finished", "Завершенные"],
  ["", "Все"],
]
const HEADERS = ["№", "Дата начала", "Дата завершения", "Дата партии", "Этап производства", "Пользователь", "Статус"]
const NO_STAGES: Stage[] = []
const NO_ITEMS: CatalogItem[] = []
const EMPTY_PAGE: PartyPage = { count: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE, results: [] }

/** GET once per url; `loaded` tells "nothing yet" from "an empty answer". */
function useJson<T>(url: string | null, empty: T) {
  const [state, setState] = useState<{ url: string; data: T } | null>(null)
  useEffect(() => {
    if (!url) return
    let cancelled = false
    api<T>(url)
      .then((data) => !cancelled && setState({ url, data }))
      .catch((error: Error) => {
        if (cancelled) return
        notify(error.message)
        setState({ url, data: empty })
      })
    return () => {
      cancelled = true
    }
  }, [url, empty])
  return { data: state?.data ?? empty, loaded: state !== null && state.url === url }
}

/** `request`: what was asked; `url`: the same request with the page the server answered (they differ for a linked
 * batch's page, or a page past the last one). */
type Loaded = { request: string; url: string; version: number; data: PartyPage }

/** The list's page. Rows belong to the request they were loaded for: a new request (tab, page, search, filter) shows
 * the loader instead of the previous rows; a reload of the same request keeps them until the answer. `focus` (read
 * once): the first request asks for the page that holds that batch. */
function usePartyPage(url: string, focus: RefObject<number | null>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [version, setVersion] = useState(0)
  const last = useRef<Loaded | null>(null)
  useEffect(() => {
    const current = last.current
    if (current && current.url === url && current.version === version) return
    let cancelled = false
    const focusId = focus.current
    api<PartyPage>(focusId ? `${url}&focus=${focusId}` : url)
      .then((data) => {
        if (cancelled) return
        focus.current = null
        const next = { request: url, url: withPage(url, data.page), version, data }
        last.current = next
        setLoaded(next)
      })
      .catch((error: Error) => {
        if (cancelled) return
        focus.current = null
        notify(error.message)
        const next = { request: url, url, version, data: EMPTY_PAGE }
        last.current = next
        setLoaded(next)
      })
    return () => {
      cancelled = true
    }
  }, [url, version, focus])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { loaded, loading: !loaded || loaded.url !== url, reload }
}

export function ProductionBatchesView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const state = useMemo(() => stateFromParams(searchParams), [searchParams])
  // «Добавление партии» only for a production writer (the server refuses anyone else with 403). It is false until
  // /api/auth/me answers, for a writer too: it gates what is drawn only, so ?openCreateDialog=true stays in the URL.
  const canWrite = useCanManage(PRODUCTION_WRITE)

  /** Moves the list to a new state: a new history entry (tab, page, sort, filter, batch), or the same one (typing). */
  const navigate = useCallback((patch: Partial<ListState>, options: { replace?: boolean; opened?: string } = {}) => {
    const current = new URLSearchParams(window.location.search)
    const next = writeState(current, { ...stateFromParams(current), ...patch })
    if (next.toString() === current.toString()) return
    const query = next.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`
    const data = options.opened ? { [OPENED]: options.opened } : null
    if (options.replace) window.history.replaceState(data, "", url)
    else window.history.pushState(data, "", url)
  }, [])
  /** Closes the filter panel / the create dialog: back to the entry before it when this page opened it, else in place. */
  const closeOpened = useCallback(
    (kind: "filter" | "create") => {
      const flag = kind === "filter" ? PARAM.filterOpen : PARAM.createOpen
      if (new URLSearchParams(window.location.search).get(flag) !== "true") return
      if ((window.history.state as Record<string, unknown> | null)?.[OPENED] === kind) window.history.back()
      else navigate(kind === "filter" ? { filterOpen: false } : { createOpen: false }, { replace: true })
    },
    [navigate],
  )

  // A link to a batch (?party=<id> without a page) opens the list on the page that holds it.
  const focus = useRef<number | null>(state.party && !searchParams.has(PARAM.page) ? state.party : null)
  const listUrl = useMemo(() => listRequest(state), [state])
  const { loaded, loading, reload } = usePartyPage(listUrl, focus)
  const { data: stages, loaded: stagesLoaded } = useJson<Stage[]>("/api/production/stages", NO_STAGES)
  const [catalogWanted, setCatalogWanted] = useState(state.filterOpen)
  const { data: catalog, loaded: catalogLoaded } = useJson<CatalogItem[]>(catalogWanted ? "/api/production/items" : null, NO_ITEMS)

  // The server answered the current request with another page (the page of a linked batch, or the last page instead of
  // one past it): the URL follows, in the same history entry.
  useEffect(() => {
    if (!loaded || loaded.request !== listUrl || loaded.data.page === state.page) return
    navigate({ page: loaded.data.page }, { replace: true })
  }, [loaded, listUrl, state.page, navigate])

  // Search: typed text goes to the URL after a pause (same history entry); a URL change (Back) refills the field.
  const [searchDraft, setSearchDraft] = useState(state.search)
  const committedSearch = useRef(state.search)
  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => {
      committedSearch.current = value
      navigate({ search: value, page: 1 }, { replace: true })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search, navigate])
  useEffect(() => {
    if (state.search === committedSearch.current) return
    committedSearch.current = state.search
    setSearchDraft(state.search)
  }, [state.search])

  // The filter panel edits a draft; ПРИМЕНИТЬ puts it in the URL.
  const [draft, setDraft] = useState<Filters>(() => withMonth(filtersOf(state)))
  const wasOpen = useRef(state.filterOpen)
  useEffect(() => {
    // Opened by Back / Forward: start from the applied filters, like the toggle does.
    if (state.filterOpen && !wasOpen.current) {
      setDraft(withMonth(filtersOf(state)))
      setCatalogWanted(true)
    }
    wasOpen.current = state.filterOpen
  }, [state])

  const applied = filtersOf(state)
  const activeFilters = filterCount(applied)
  const openFilter = () => {
    setDraft(withMonth(applied))
    setCatalogWanted(true)
    navigate({ filterOpen: true }, { opened: "filter" })
  }
  const closeFilter = () => closeOpened("filter")
  const applyFilters = () => navigate({ ...draft, page: 1, filterOpen: false }, { replace: true })
  // «×» of «Фильтр: N элемента»: every filter of the panel goes (the tab and the search stay as they are).
  const clearFilters = () => {
    setDraft(EMPTY_FILTERS)
    navigate({ ...EMPTY_FILTERS, page: 1, filterOpen: false })
  }

  const products = useMemo<FilterOption[]>(() => catalog.filter((item) => item.kind === "product").map((item) => ({ value: String(item.id), label: item.name })), [catalog])
  // «Сырье»: the products (the reference's list), then Mezon's own raw materials, which a norm's raw line may use. A raw
  // material named like a product is left out (the Linko copy made one for many products, and the product stands for
  // it), unless it is already picked (a link), so that its chip reads.
  const pickedRawMaterials = draft.rawMaterial
  const rawOptions = useMemo<FilterOption[]>(() => {
    const productNames = new Set(catalog.filter((item) => item.kind === "product").map((item) => nameKey(item.name)))
    const picked = new Set(pickedRawMaterials)
    return [
      ...catalog.filter((item) => item.kind === "product").map((item) => ({ value: `product:${item.id}`, label: item.name })),
      ...catalog
        .filter((item) => item.kind === "raw_material" && (!productNames.has(nameKey(item.name)) || picked.has(item.id)))
        .map((item) => ({ value: `raw_material:${item.id}`, label: item.name })),
    ]
  }, [catalog, pickedRawMaterials])
  const stageOptions = useMemo<FilterOption[]>(() => stages.map((stage) => ({ value: String(stage.id), label: stage.name })), [stages])

  const page = loaded?.data ?? EMPTY_PAGE
  const rows = loading ? [] : page.results
  const pageCount = Math.max(1, Math.ceil(page.count / page.pageSize))
  const first = page.count ? (page.page - 1) * page.pageSize + 1 : 0
  const last = (page.page - 1) * page.pageSize + page.results.length

  // The open batch is drawn in place of its own row, only while that row is listed (a search or a filter that leaves it
  // out shows the list without it, as the reference does); ?party stays, so clearing the search brings it back.
  const openIndex = state.party === null ? -1 : rows.findIndex((party) => party.id === state.party)
  const openParty = openIndex >= 0 ? rows[openIndex] : null
  const before = openParty ? rows.slice(0, openIndex) : rows
  const after = openParty ? rows.slice(openIndex + 1) : []

  const rowHref = (party: Party) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set(PARAM.party, String(party.id))
    return `?${params}`
  }

  function exportExcel() {
    // As the reference exports: the rows of the page on screen, the dates without the time, «Не указано» for no value.
    const none = t("Не указано")
    const day = (value: string) => {
      const local = value ? parseAnyDay(value) : null
      return local ? formatDate(local, language) : none
    }
    const body = rows.map((party) => [
      party.id,
      day(party.createdAt),
      day(party.finishedAt),
      party.date ? formatDate(party.date, language) : none,
      party.stageName || none,
      party.userName || none,
      t(STATUS_LABELS[party.status]),
    ])
    const name = t("Производственные заявки")
    downloadExcelTable(name, [HEADERS.map((header) => t(header)), ...body], { sheetName: name })
  }

  // Like the reference, only № and Статус sort (on the server, over the whole list): ascending, descending, off.
  const sortHead = (key: "id" | "status", label: string, className = "") => {
    const direction = state.ordering === key ? "asc" : state.ordering === `-${key}` ? "desc" : null
    return (
      <button
        key={key}
        type="button"
        onClick={() => navigate({ ordering: direction === null ? key : direction === "asc" ? (`-${key}` as Ordering) : "", page: 1 })}
        className={`text-left font-semibold hover:opacity-80 ${className}`}
      >
        {t(label)}
        {direction && <span className="ml-1 text-[10px]">{direction === "desc" ? "▼" : "▲"}</span>}
      </button>
    )
  }
  const tableHeads = [
    sortHead("id", "№", "-ml-2"),
    ...HEADERS.slice(1, -1).map((header) => <span key={header}>{t(header)}</span>),
    sortHead("status", "Статус"),
  ]
  const tableProps = {
    // The reference's bootstrap row: № and Статус one twelfth each, the five others two twelfths (any width).
    cols: "minmax(0,1fr) repeat(5,minmax(0,2fr)) minmax(0,1fr)",
    rowKey: (party: Party) => party.id,
    minWidth: 1100,
    onRowClick: (party: Party) => navigate({ party: state.party === party.id ? null : party.id }),
    rowHref,
    rowLabel: (party: Party) => `${t("Партия №")} ${party.id}`,
    render: (party: Party) => [
      party.id,
      formatDateTime(party.createdAt, language),
      party.finishedAt ? formatDateTime(party.finishedAt, language) : "",
      formatDate(party.date, language),
      // Stored names: the page translator leaves them as they are («этап 1» is not «stage 1»).
      <span key="stage" data-no-translate>
        {party.stageName}
      </span>,
      <span key="user" data-no-translate>
        {party.userName}
      </span>,
      <span key="status">
        <span className={`mr-[6px] inline-block h-[7px] w-[7px] shrink-0 rounded-full align-middle ${STATUS_DOT[party.status]}`} />{" "}
        {t(STATUS_LABELS[party.status])}
      </span>,
    ],
  }

  return (
    <RefPage>
      <RefHeader title="Партии" favorites={{ toggle: true, portal: true }}>
        {canWrite && (
          <button
            type="button"
            onClick={() => navigate({ createOpen: true }, { opened: "create" })}
            title={t("Добавить партию")}
            aria-label={t("Добавить партию")}
            className="flex h-10 w-10 items-center justify-center rounded-[3px] bg-[#1E4A9A] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          </button>
        )}
      </RefHeader>

      <RefTabs
        separate
        labels={TABS.map(([, label]) => label)}
        value={TABS.find(([value]) => value === state.status)?.[1] ?? "Все"}
        onChange={(label) => navigate({ status: TABS.find(([, tabLabel]) => tabLabel === label)?.[0] ?? "", page: 1, party: null })}
      />

      <RefCard className="mt-5 bg-white">
        <RefToolbar
          filterOpen={state.filterOpen}
          leftSlot={
            activeFilters > 0 ? (
              <FilterToggle count={activeFilters} open={state.filterOpen} onOpen={openFilter} onClose={closeFilter} onClear={clearFilters} />
            ) : (
              <button type="button" onClick={() => (state.filterOpen ? closeFilter() : openFilter())} className="text-[13px] text-[#1E4A9A]">
                {state.filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")} ⌄
              </button>
            )
          }
          filterPanel={
            <RefFilterPanel narrow className="!w-[300px]" onClose={closeFilter} onApply={applyFilters} applyClassName="mt-[10px]">
              {/* Picks from a link (ids) are named once the catalog / the stages have loaded; until then they read
                  «Загрузка...», never the bare id, and an id the catalog does not hold reads «Товар не найден». */}
              <FilterMultiSelect label="Готовый продукт" rawLabels value={draft.made.map(String)} options={products} loading={!catalogLoaded} missingLabel={catalogLoaded ? "Товар не найден" : "Загрузка..."} onChange={(made) => setDraft({ ...draft, made: made.map(Number) })} />
              <FilterMultiSelect label="Сырье" rawLabels value={rawValues(draft)} options={rawOptions} loading={!catalogLoaded} missingLabel={catalogLoaded ? "Товар не найден" : "Загрузка..."} onChange={(values) => setDraft({ ...draft, ...rawPicks(values) })} />
              <FilterSearchSelect label="Этап производства" rawLabels value={draft.stageId} options={stageOptions} loading={!stagesLoaded} missingLabel={stagesLoaded ? "Этап не найден" : "Загрузка..."} onChange={(stageId) => setDraft({ ...draft, stageId })} />
              <FilterDate label={t("Дата доставки")} words clearable independentMonths begin={draft.createdFrom} end={draft.createdTo} onChange={(createdFrom, createdTo) => setDraft({ ...draft, createdFrom, createdTo })} />
              <FilterDate label={t("Период сдачи")} words clearable independentMonths begin={draft.finishedFrom} end={draft.finishedTo} onChange={(finishedFrom, finishedTo) => setDraft({ ...draft, finishedFrom, finishedTo })} />
            </RefFilterPanel>
          }
          query={searchDraft}
          onQuery={setSearchDraft}
          pageSize={state.pageSize}
          onPageSize={(size) => navigate({ pageSize: size, page: 1 })}
          pageSizeMenu
          from={first}
          to={last}
          total={page.count}
          page={page.page}
          pageCount={pageCount}
          onPage={(next) => navigate({ page: next })}
          icons={<RefIconButton path={RI.download} label="Скачать Excel" onClick={exportExcel} color="#5d6474" />}
        />
        <RefTable
          {...tableProps}
          heads={tableHeads}
          rows={before}
          loading={loading}
          hideBody={openParty !== null && openIndex === 0}
          empty={t("По вашему запросу ничего не найдено...")}
        />
      </RefCard>

      {openParty && (
        <>
          <BatchDetail partyId={openParty.id} stages={stages} onChanged={reload} onClose={() => navigate({ party: null })} />
          {after.length > 0 && (
            <RefCard className="bg-white">
              <RefTable {...tableProps} heads={tableHeads} rows={after} hideHead />
            </RefCard>
          )}
        </>
      )}

      {state.createOpen && canWrite && (
        <CreatePartyDialog
          stages={stages}
          stagesLoaded={stagesLoaded}
          onClose={() => closeOpened("create")}
          onCreated={() => {
            // Like the reference: the dialog closes and the list is read again on the same tab and page.
            closeOpened("create")
            reload()
          }}
        />
      )}
    </RefPage>
  )
}

// «Добавление партии»: the reference's limits and messages (the server checks the same: lib/production-api.ts).
const COMMENT_MAX = 500
const COMMENT_TOO_LONG = "Убедитесь, что в этом поле не больше 500 символов."
const STAGE_REQUIRED = "Необходимо выбрать цех"
/** Server refusals that belong under the stage field (the stage is gone, its warehouse cannot take stock). */
const STAGE_ERRORS = new Set([STAGE_REQUIRED, "Этап не найден", "У этапа не указан склад", "Склад не найден", "Склад неактивен"])

type FieldErrors = { stage?: string; date?: string; comment?: string }

/** "17 ноября 2026 г." (ru), "17 noyabr 2026" (uz): a chosen batch date, as the reference's date field prints it. */
function longDay(day: string, language: string): string {
  return `${formatDayMonth(day, language)} ${day.slice(0, 4)}${language === "ru" ? " г." : ""}`
}

async function postParty(body: { stageId: number; date: string; comment: string }): Promise<{ ok: true } | { ok: false; error: string; field: string }> {
  try {
    const response = await fetch("/api/production/parties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    if (response.ok) return { ok: true }
    const data = (await response.json().catch(() => ({}))) as { error?: unknown; field?: unknown }
    return { ok: false, error: typeof data.error === "string" && data.error ? data.error : "Не удалось выполнить запрос", field: typeof data.field === "string" ? data.field : "" }
  } catch {
    return { ok: false, error: "Сервер недоступен, попробуйте ещё раз", field: "" }
  }
}

function CreatePartyDialog({ stages, stagesLoaded, onClose, onCreated }: { stages: Stage[]; stagesLoaded: boolean; onClose: () => void; onCreated: () => void }) {
  const { t, language } = useLanguage()
  const [stageId, setStageId] = useState("")
  // Empty, as in the reference: an untouched date saves today (Asia/Tashkent).
  const [date, setDate] = useState("")
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  // As the reference: a stage chosen with the mouse moves on to «Дата партии» and opens its calendar.
  const [datePicking, setDatePicking] = useState(false)
  // One batch per click: a second click while the first is saving is ignored, and so is one after a save (the dialog
  // closes through the history, a moment later).
  const busy = useRef(false)
  const options = useMemo<FilterOption[]>(() => stages.map((stage) => ({ value: String(stage.id), label: stage.name })), [stages])
  const clear = (field: keyof FieldErrors) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  async function save() {
    if (busy.current) return
    const next: FieldErrors = {}
    if (!stageId) next.stage = STAGE_REQUIRED
    const dateError = date ? docDateError(date) : null
    if (dateError) next.date = dateError
    if (comment.trim().length > COMMENT_MAX) next.comment = COMMENT_TOO_LONG
    setErrors(next)
    if (next.stage || next.date || next.comment) return
    busy.current = true
    setSaving(true)
    let created = false
    try {
      const result = await postParty({ stageId: Number(stageId), date: date || todayIso(), comment })
      if (result.ok) {
        // Stays locked until the dialog is gone: Сохранить or Enter in that moment would create a second batch.
        created = true
        onCreated()
        return
      }
      const field =
        result.field === "stageId" || STAGE_ERRORS.has(result.error)
          ? "stage"
          : result.field === "date" || result.error === DOC_DATE_FUTURE || result.error === DOC_DATE_INVALID
            ? "date"
            : result.field === "comment"
              ? "comment"
              : null
      if (field) setErrors({ [field]: result.error })
      else notify(result.error)
    } finally {
      if (!created) {
        busy.current = false
        setSaving(false)
      }
    }
  }

  return (
    <MaterialDialog
      title={t("Добавление партии")}
      onClose={onClose}
      width={700}
      top={64}
      closeOnBackdrop={false}
      closeOnEscape
      bodyOverflow="visible"
      onSubmit={() => void save()}
      footer={<MaterialFooter label={t("Сохранить")} busy={saving} />}
    >
      <MaterialBody className="pb-[40px] pt-[40px]">
        {stagesLoaded && !stages.length && <p className="mb-2 text-sm text-amber-600">{t("Сначала создайте этап в разделе «Этапы производства».")}</p>}
        <FilterSearchSelect
          compact
          required
          rawLabels
          label="Этап производства"
          value={stageId}
          options={options}
          loading={!stagesLoaded}
          error={errors.stage}
          onChange={(value) => {
            setStageId(value)
            clear("stage")
          }}
          onPick={(_, source) => {
            if (source === "pointer" && !date) setDatePicking(true)
          }}
        />
        <MaterialDate
          calendar
          open={datePicking}
          onOpenChange={setDatePicking}
          required
          label={t("Дата партии")}
          value={date}
          display={date ? longDay(date, language) : undefined}
          error={errors.date ? t(errors.date) : undefined}
          onChange={(value) => {
            setDate(value)
            clear("date")
          }}
          className={errors.date ? "mb-[18px] mt-[16px]" : "mt-[16px]"}
        />
        <MaterialTextArea
          label={`${t("Комментарий")}...`}
          value={comment}
          error={errors.comment ? t(errors.comment) : undefined}
          onChange={(value) => {
            setComment(value)
            if (value.trim().length <= COMMENT_MAX) clear("comment")
          }}
          className="mt-[10px]"
        />
      </MaterialBody>
    </MaterialDialog>
  )
}
