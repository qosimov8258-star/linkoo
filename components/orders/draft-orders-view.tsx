"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { ListBTable } from "@/components/analytics/list-b-table"
import { sortByOrdering, toggleOrdering } from "@/components/analytics/list-url-state"
import { DraftImportDialog } from "@/components/orders/draft-import-dialog"
import { DraftOrderDetail, clientHref, type DraftOrderLine } from "@/components/orders/draft-order-detail"
import { GridSortHead } from "@/components/ref/grid-sort-head"
import { LinkoMultiField, LinkoPeriodField, LinkoSingleField, type LinkoOption } from "@/components/ref/linko-select-fields"
import { RI, RefAppliedFilter, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefNothingFound, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { askCancel, askDelete } from "@/lib/ask-confirm"
import { useLanguage } from "@/lib/i18n/language-context"
import { useRefRecords } from "@/lib/use-ref-records"

// "Интеграция" of the "Продажи" menu: orders that arrived from an external integration and wait to be turned into real
// orders (the reference's #/draft/order). Each person column shows, in bold, the record the draft is linked to here
// (market / deliveryMan / user, «Не указано» while none is) and under it the name and id the integration sent
// (clientName / delivererName / agentName). The linked records and the card's product lines come from
// scripts/linko-sync/import-draft-orders.mjs; a row without them has none.
//
// The address is the list's state, with the reference's names and order (keys sorted, as its router writes them):
// search (typed: updated in place), page / pageSize, ordering (a header click: field, then -field, then dropped; several
// fields in click order, Linko's GridList), openFilterDialog and the filter (deliveryMan, product, productType,
// marketTypeParent, marketType, branch, division: ids joined with "-"; fromDate / toDate; marketIsNull / userIsNull /
// deliveryManIsNull; «Применить» rebuilds the query with page=1 and openFilterDialog=false), showCheckboxes / select
// (ticked ids joined with "-"), openBulkDeleteDialog and excelImportCreateDialog. A row opens the draft's card at
// /analytics/draft-orders/<id> with the list's query kept (the reference's #/draft/order/<id>?…); the client cell is
// above the row's link, so a click there does not open it.
export type DraftOrder = {
  id: number
  type: string
  serviceId?: string | null
  /** The linked client: its name links to the Клиенты page (the reference's #/shop/<id>?search=<name>). */
  market?: { id: number; name: string } | null
  /** The linked delivery man and agent (full names). */
  deliveryMan?: string | null
  user?: string | null
  clientName: string
  clientId: string
  createdAt: string
  delivererName: string
  delivererId: string
  deliveryDate: string
  agentName: string
  agentId: string
  total: string
  /** Raw values of the header sort: Linko's created_date, date_delivery (null = «Самовывоз») and total_price. */
  createdDate?: string
  dateDelivery?: string | null
  totalPrice?: number
  comment?: string
  /** The card's product lines. */
  products?: DraftOrderLine[]
}

const BASE = "/analytics/draft-orders"
const MONTH_PREFIX = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

/** "04 сент. 2026" -> "2026-09-04" */
function toIso(text: string) {
  const match = text.trim().toLowerCase().match(/^(\d{1,2})\s+([а-я]+)\.?\s+(\d{4})/)
  if (!match) return ""
  const month = MONTH_PREFIX.findIndex((prefix) => match[2].startsWith(prefix))
  return month < 0 ? "" : `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`
}

/** The draft's delivery day: the raw field, else the printed one. */
const deliveryIso = (row: DraftOrder) => (row.dateDelivery !== undefined ? (row.dateDelivery ?? "") : toIso(row.deliveryDate))
/** "4,14221 SUM" -> 4.14221 (rows imported before totalPrice was kept). */
const totalOf = (row: DraftOrder) => (typeof row.totalPrice === "number" ? row.totalPrice : Number(row.total.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0)
/** Linko's type values: "order" sorts before "order_return". */
const typeCode = (row: DraftOrder) => (row.type === "Возврат" ? "order_return" : "order")

/** Linko's sortable columns (its GridList header: id, type, createdDate, dateDelivery, totalPrice). */
const ORDERINGS = ["id", "type", "createdDate", "dateDelivery", "totalPrice"] as const
const COMPARE: Record<string, (a: DraftOrder, b: DraftOrder) => number> = {
  id: (a, b) => a.id - b.id,
  type: (a, b) => typeCode(a).localeCompare(typeCode(b)),
  createdDate: (a, b) => (a.createdDate ?? "").localeCompare(b.createdDate ?? ""),
  // Postgres puts a missing day last going up (and first going down).
  dateDelivery: (a, b) => {
    const x = deliveryIso(a)
    const y = deliveryIso(b)
    return x === y ? 0 : !x ? 1 : !y ? -1 : x.localeCompare(y)
  },
  totalPrice: (a, b) => totalOf(a) - totalOf(b),
}

/** The filter as the address holds it (ids joined with "-", "true" / "false", ISO days). */
type Filters = {
  deliveryMan: string
  product: string
  productType: string
  marketTypeParent: string
  marketType: string
  branch: string
  division: string
  fromDate: string
  toDate: string
  marketIsNull: string
  userIsNull: string
  deliveryManIsNull: string
}
const FILTER_KEYS = ["deliveryMan", "product", "productType", "marketTypeParent", "marketType", "branch", "division", "fromDate", "toDate", "marketIsNull", "userIsNull", "deliveryManIsNull"] as const
/** The keys the reference counts in «Фильтр: N элемента» (its delivery date counts once, by toDate). */
const COUNTED_KEYS = ["product", "productType", "marketTypeParent", "marketType", "branch", "division", "toDate", "deliveryMan", "marketIsNull", "userIsNull", "deliveryManIsNull"]

const readFilters = (params: URLSearchParams): Filters => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ""])) as Filters
const idList = (value: string) => value.split("-").filter((id) => /^\d+$/.test(id))
const idSet = (value: string) => new Set(idList(value).map(Number))

type Named = { id: number; name: string; parentId: number | null }
type Lists = { deliverers: Named[]; products: (Named & { type: string })[]; productTypes: Named[]; clientTypes: Named[]; branches: Named[]; organizations: Named[] }
const EMPTY_LISTS: Lists = { deliverers: [], products: [], productTypes: [], clientTypes: [], branches: [], organizations: [] }

function namedRows(data: unknown, nameOf: (row: Record<string, unknown>) => unknown = (row) => row.name): Named[] {
  if (!Array.isArray(data)) return []
  return (data as Record<string, unknown>[]).flatMap((row) => {
    const id = Number(row.id)
    const name = String(nameOf(row) ?? "").trim()
    const parent = Number(row.parentId)
    return Number.isSafeInteger(id) && id > 0 && name ? [{ id, name, parentId: Number.isSafeInteger(parent) && parent > 0 ? parent : null }] : []
  })
}

const options = (list: Named[]): LinkoOption[] => list.map((item) => ({ value: String(item.id), label: item.name }))

/** The reference's query string: keys in alphabetical order, empty values left out. */
function linkSearch(params: URLSearchParams): string {
  return [...new Set(params.keys())]
    .sort()
    .flatMap((key) => params.getAll(key).filter(Boolean).map((value) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`))
    .join("&")
}

/** Writes the address; the router is told (no state passed), so the page's pathname and query follow it. */
function writeLink(path: string, params: URLSearchParams, mode: "push" | "replace") {
  const search = linkSearch(params)
  const url = `${path}${search ? `?${search}` : ""}`
  if (mode === "push") window.history.pushState(null, "", url)
  else window.history.replaceState(null, "", url)
}

// Material icons of Linko's GridList (check boxes, select-all and the bar's «Снять выделение»).
const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const BOX_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const BOX_CHECKED = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"

/** The list's 12 grid units (Linko's xs 1 / 1 / 2 / 1 / 2 / 2 / 2 / 1). */
const COLS = "minmax(0,1fr) minmax(0,1fr) minmax(0,2fr) minmax(0,1fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,1fr)"

export function DraftOrdersView() {
  const { t } = useLanguage()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { rows, loading, remove } = useRefRecords<DraftOrder>("draft-order")
  const [typing, setTyping] = useState<string | null>(null)
  const [draft, setDraft] = useState<Filters | null>(null)
  const [snack, setSnack] = useState("")
  const [lists, setLists] = useState<Lists>(EMPTY_LISTS)
  const [listsReady, setListsReady] = useState(false)
  const asking = useRef(false)

  useEffect(() => {
    const load = (url: string) =>
      fetch(url)
        .then((response) => (response.ok ? response.json() : []))
        .catch(() => []) as Promise<unknown>
    void Promise.all([load("/api/employees"), load("/api/orders/form-options"), load("/api/products"), load("/api/product-types"), load("/api/client-types"), load("/api/branches"), load("/api/organizations")]).then(
      ([employees, formOptions, products, productTypes, clientTypes, branches, organizations]) => {
        const productRows = Array.isArray(products) ? (products as Record<string, unknown>[]) : []
        const typeOf = new Map(productRows.map((row) => [Number(row.id), String(row.type ?? "")]))
        const people = namedRows(Array.isArray(employees) ? (employees as Record<string, unknown>[]).filter((row) => row.active !== false) : [], (row) => row.name ?? `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`)
        // Linko's Доставщик lists its delivery group (main/crud/for_select/?group=delivery): here the order form's
        // deliverers (the employees whose access right carries the «Доставщик» capability), by id.
        const delivererNames = (formOptions as { deliverers?: unknown } | null)?.deliverers
        const deliverers = Array.isArray(delivererNames) ? delivererNames.flatMap((name) => people.filter((person) => person.name === name).slice(0, 1)) : []
        setLists({
          deliverers: deliverers.sort((a, b) => a.id - b.id),
          products: namedRows(productRows).map((item) => ({ ...item, type: typeOf.get(item.id) ?? "" })),
          productTypes: namedRows(productTypes),
          clientTypes: namedRows(clientTypes),
          branches: namedRows(branches),
          organizations: namedRows(organizations),
        })
        setListsReady(true)
      },
    )
  }, [])

  useEffect(() => {
    if (!snack) return
    const timer = window.setTimeout(() => setSnack(""), 4000)
    return () => window.clearTimeout(timer)
  }, [snack])

  // The typed search goes into the address in place, a moment after the last key (the reference's search field).
  useEffect(() => {
    if (typing === null) return
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search)
      if (typing.trim()) params.set("search", typing)
      else params.delete("search")
      writeLink(window.location.pathname, params, "replace")
      setTyping(null)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [typing])

  const query = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const detailId = Number(pathname.match(/\/analytics\/draft-orders\/(\d+)\/?$/)?.[1] ?? 0) || null
  const urlSearch = query.get("search") ?? ""
  const applied = useMemo(() => readFilters(query), [query])
  const filterOpen = query.get("openFilterDialog") === "true"
  const importOpen = query.get("excelImportCreateDialog") === "true"
  const bulkDeleteOpen = query.get("openBulkDeleteDialog") === "true"
  const selectMode = query.get("showCheckboxes") === "true"
  const selected = useMemo(() => idList(query.get("select") ?? "").map(Number), [query])
  const ordering = useMemo(() => (query.get("ordering") ?? "").split(",").filter((item) => (ORDERINGS as readonly string[]).includes(item.replace(/^-/, ""))), [query])
  const pageSizeParam = Number(query.get("pageSize"))
  const pageSize = Number.isSafeInteger(pageSizeParam) && pageSizeParam > 0 ? pageSizeParam : 25
  const pageParam = Number(query.get("page"))
  const appliedCount = COUNTED_KEYS.filter((key) => query.get(key)).length

  const visible = useMemo(() => {
    const term = urlSearch.trim().toLowerCase()
    const products = idSet(applied.product)
    // A chosen product type takes in its sub-types (the field lists the top-level ones).
    const typeIds = idSet(applied.productType)
    const typeNames = new Set(lists.productTypes.filter((item) => typeIds.has(item.id) || (item.parentId !== null && typeIds.has(item.parentId))).map((item) => item.name))
    const productTypeOf = new Map(lists.products.map((item) => [item.id, item.type]))
    const deliverers = new Set(lists.deliverers.filter((item) => idSet(applied.deliveryMan).has(item.id)).map((item) => item.name))
    // Linko: end_date = toDate, or fromDate when only the start is set (one day).
    const toDate = applied.toDate || applied.fromDate
    const isNull = (flag: string, linked: unknown) => (flag === "true" ? !linked : flag === "false" ? Boolean(linked) : true)
    const found = rows.filter((row) => {
      // The reference's search: the draft's id, its number and the client name the integration sent.
      if (term && String(row.id) !== term && !String(row.serviceId ?? "").toLowerCase().includes(term) && !row.clientName.toLowerCase().includes(term)) return false
      if (applied.deliveryMan && !deliverers.has(row.deliveryMan ?? "")) return false
      if (applied.product && !(row.products ?? []).some((line) => line.productId !== null && products.has(line.productId))) return false
      if (applied.productType && !(row.products ?? []).some((line) => line.productId !== null && typeNames.has(productTypeOf.get(line.productId) ?? ""))) return false
      // Client type, branch and organization are the linked client's: a draft without one never matches them.
      if ((applied.marketTypeParent || applied.marketType || applied.branch || applied.division) && !row.market) return false
      // «Дата доставки» filters the delivery day (Linko's API answers by the creation day: its begin_date / end_date).
      const iso = deliveryIso(row)
      if (applied.fromDate && (!iso || iso < applied.fromDate)) return false
      if (toDate && (!iso || iso > toDate)) return false
      // "не указан" = no linked record (the reference's market_is_null / user_is_null / delivery_man_is_null).
      return isNull(applied.marketIsNull, row.market) && isNull(applied.userIsNull, row.user) && isNull(applied.deliveryManIsNull, row.deliveryMan)
    })
    return sortByOrdering(found, ordering, COMPARE)
  }, [rows, urlSearch, applied, lists, ordering])

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const page = Math.min(Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1, pageCount)
  const start = (page - 1) * pageSize
  const end = Math.min(start + pageSize, visible.length)
  const pageRows = visible.slice(start, end)
  const detail = detailId ? (rows.find((row) => row.id === detailId) ?? null) : null
  const detailInPage = detail !== null && pageRows.some((row) => row.id === detail.id)
  const allOnPage = pageRows.length > 0 && pageRows.every((row) => selected.includes(row.id))

  /** Changes keys of the query and keeps the others (a new history entry, or in place). */
  const patch = (changes: Record<string, string | null>, mode: "push" | "replace" = "push") => {
    const params = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    writeLink(window.location.pathname, params, mode)
  }
  const openDetail = (id: number | null, mode: "push" | "replace" = "push") => writeLink(id ? `${BASE}/${id}` : BASE, new URLSearchParams(window.location.search), mode)
  const setSelected = (ids: number[]) => patch({ select: ids.length ? ids.join("-") : null })
  const toggleRow = (id: number) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  const toggleAll = () => setSelected(allOnPage ? selected.filter((id) => !pageRows.some((row) => row.id === id)) : [...new Set([...selected, ...pageRows.map((row) => row.id)])])
  const sort = (field: string) => patch({ ordering: toggleOrdering(ordering, field).join(",") || null })

  const values: Filters = draft ?? applied
  const setValue = (key: keyof Filters, value: string) => setDraft({ ...values, [key]: value })
  const openFilter = () => {
    setDraft(null)
    patch({ openFilterDialog: "true" }, "replace")
  }
  const closeFilter = () => {
    setDraft(null)
    patch({ openFilterDialog: "false" }, "replace")
  }
  const applyFilter = () => {
    const params = new URLSearchParams({ openFilterDialog: "false", page: "1", pageSize: String(pageSize) })
    for (const key of FILTER_KEYS) if (values[key]) params.set(key, values[key])
    // Подкатегория belongs to the chosen client types: none chosen, none kept.
    if (!values.marketTypeParent) params.delete("marketType")
    setDraft(null)
    writeLink(window.location.pathname, params, "push")
  }
  const clearFilter = () => {
    setDraft(null)
    writeLink(window.location.pathname, new URLSearchParams({ pageSize: String(pageSize) }), "replace")
  }

  async function deleteDraft(order: DraftOrder) {
    if (!(await askCancel(`${t("Заказ")}№ ${order.serviceId ?? order.id}`))) return
    if (!(await remove(order.id))) return
    // The deleted draft leaves the list, so its card closes (the reference reloads the list and the card).
    openDetail(null, "replace")
    setSnack(t("Успешно удалено"))
  }

  // «Удалить» of the select bar (Linko's ?openBulkDeleteDialog=true): «Выбранные заказы: <ids>», then every ticked draft
  // goes; the ones deleted leave the selection.
  useEffect(() => {
    if (!bulkDeleteOpen || asking.current || loading) return
    const ids = selected.filter((id) => rows.some((row) => row.id === id))
    if (!ids.length) {
      patch({ openBulkDeleteDialog: "false" }, "replace")
      return
    }
    asking.current = true
    void (async () => {
      try {
        if (!(await askDelete(`${t("Выбранные заказы")}: ${ids.join(", ")}`))) return
        const done: number[] = []
        for (const id of ids) if (await remove(id)) done.push(id)
        const left = selected.filter((id) => !done.includes(id))
        patch({ openBulkDeleteDialog: "false", select: left.length ? left.join("-") : null }, "replace")
        if (done.length) setSnack(t("Успешно удалено"))
        return
      } finally {
        asking.current = false
        if (new URLSearchParams(window.location.search).get("openBulkDeleteDialog") === "true") patch({ openBulkDeleteDialog: "false" }, "replace")
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkDeleteOpen, rows, loading])

  const flagOptions: LinkoOption[] = [
    { value: "true", label: t("Да") },
    { value: "false", label: t("Нет") },
  ]
  const multi = (label: string, key: keyof Filters, list: Named[]) => (
    <LinkoMultiField key={key} label={label} options={listsReady ? options(list) : null} value={idList(values[key])} onChange={(next) => setValue(key, next.join("-"))} />
  )
  const flag = (label: string, key: "marketIsNull" | "userIsNull" | "deliveryManIsNull") => <LinkoSingleField label={label} options={flagOptions} value={values[key]} onChange={(next) => setValue(key, next)} />
  const chosenParents = idSet(values.marketTypeParent)

  const sortHead = (label: string, field: string, className = "") => <GridSortHead key={field} label={t(label)} field={field} ordering={ordering} onSort={sort} className={className} />
  const plainHead = (label: string) => <span key={label}>{t(label)}</span>
  const numberHead: ReactNode = selectMode ? (
    <span key="id" className="relative -ml-2 inline-flex">
      <button type="button" aria-label={t("Выбрать все")} onClick={toggleAll} className="absolute -left-[30px] top-1/2 flex -translate-y-1/2">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden>
          <path d={allOnPage ? BOX_CHECKED : SELECT_ALL} />
        </svg>
      </button>
      {sortHead("№", "id")}
    </span>
  ) : (
    sortHead("№", "id", "-ml-2")
  )

  /** A person column: the linked record in bold (or «Не указано»), then the integration's name and id. */
  const person = (linked: string | null | undefined, name: string, id: string) => (
    <>
      <b className="font-semibold">{linked || t("Не указано")}</b>
      <br />
      {name} ({id})
    </>
  )
  /** The client column: a linked client is a link to the Клиенты page searched by its name. The cell lies above the
   * row's link (the reference's z-index 2), so a click in it never opens the draft. */
  const client = (row: DraftOrder) => (
    <div onClick={(event) => event.stopPropagation()} className="relative z-[2] cursor-auto">
      {row.market ? (
        <Link href={clientHref(row.market)} className="font-semibold text-[#129fdd]">
          {row.market.name}
        </Link>
      ) : (
        <b className="font-semibold">{t("Не указано")}</b>
      )}
      <br />
      {row.clientName} ({row.clientId})
    </div>
  )
  const card = (order: DraftOrder) => <DraftOrderDetail order={order} onClose={() => openDetail(null)} onDelete={() => void deleteDraft(order)} />
  const lastRowId = pageRows[pageRows.length - 1]?.id

  return (
    <RefPage>
      <RefHeader title={t("Интеграция")}>
        {/* Linko's excelButton prints its label at 12 px. */}
        <span className="[&_span]:text-[12px]">
          <RefButton icon={RI.chart} label={t("Импортировать")} onClick={() => patch({ excelImportCreateDialog: "true" })} />
        </span>
      </RefHeader>
      <RefCard>
        <RefToolbar
          fluid
          filterWidth={303.5}
          filterOpen={filterOpen && !selected.length}
          onToggleFilter={() => (filterOpen ? closeFilter() : openFilter())}
          hideSearch={selected.length > 0}
          leftSlot={
            selected.length > 0 ? (
              <span className="text-[13px] font-semibold text-[#333]">
                {t("Выбрано:")} {selected.length}
              </span>
            ) : !filterOpen && appliedCount > 0 ? (
              <RefAppliedFilter count={appliedCount} onEdit={openFilter} onClear={clearFilter} width={371.5} shift={30} />
            ) : undefined
          }
          filterPanel={
            <RefFilterPanel narrow onClose={closeFilter} onApply={applyFilter} applyClassName="mt-[15px]">
              <div>
                {multi("Доставщик", "deliveryMan", lists.deliverers)}
                {multi("Товар", "product", lists.products)}
                {multi("Тип товара", "productType", lists.productTypes.filter((item) => item.parentId === null))}
                {multi("Тип клиента", "marketTypeParent", lists.clientTypes.filter((item) => item.parentId === null))}
                {chosenParents.size > 0 && multi("Подкатегория", "marketType", lists.clientTypes.filter((item) => item.parentId !== null && chosenParents.has(item.parentId)))}
                {multi("Филиалы", "branch", lists.branches)}
                {multi("Организация", "division", lists.organizations)}
                {/* Linko's date field: a 67 px block (7 px margin, 60 px field), 5 px before the next one. */}
                <div className="h-[72px] pt-[4px]">
                  <LinkoPeriodField label="Дата доставки" begin={values.fromDate} end={values.toDate} onChange={(begin, finish) => setDraft({ ...values, fromDate: begin, toDate: finish })} />
                </div>
                {flag("Клиент не указан", "marketIsNull")}
                {flag("Агент не указано", "userIsNull")}
                {flag("Доставщик не указано", "deliveryManIsNull")}
              </div>
            </RefFilterPanel>
          }
          query={typing ?? urlSearch}
          onQuery={setTyping}
          pageSize={pageSize}
          onPageSize={(size) => patch({ pageSize: String(size), page: "1" })}
          from={visible.length ? start + 1 : 0}
          to={end}
          total={visible.length}
          page={page}
          pageCount={pageCount}
          onPage={(next) => patch({ page: String(next) })}
          icons={
            selected.length > 0 ? (
              <>
                <RefIconButton path={RI.trash} label={t("Удалить")} color="#666" onClick={() => patch({ openBulkDeleteDialog: "true" })} />
                <RefIconButton path={MINUS_BOX} label={t("Снять выделение")} color="#333" onClick={() => setSelected([])} />
              </>
            ) : selectMode ? (
              <RefIconButton path={RI.eyeOff} label={t("Спрятать флажки")} color="#5d6474" onClick={() => patch({ showCheckboxes: null, select: null })} />
            ) : (
              <RefIconButton path={RI.checklist} label={t("Выбрать из списка")} color="#5d6474" onClick={() => patch({ showCheckboxes: "true" })} />
            )
          }
        />
        {detail && !detailInPage && card(detail)}
        <ListBTable
          // Linko's GridList: 30 px inset, 8 px cells; the select mode moves the grid 20 px right for the check boxes,
          // and its rows (not the header) keep 48 px free at the right end.
          inset={selectMode ? 50 : 30}
          insetRight={30}
          cols={selectMode ? `${COLS} 48px` : COLS}
          headCols={COLS}
          minWidth={1100}
          heads={[numberHead, sortHead("Тип", "type"), plainHead("Клиент"), sortHead("Дата создания", "createdDate"), plainHead("Доставщик"), sortHead("Дата доставки", "dateDelivery"), plainHead("Агент"), sortHead("Сумма заказа", "totalPrice", "-mr-2")]}
          rows={pageRows}
          rowKey={(row) => row.id}
          empty={loading ? "" : <div className="-mx-4 -my-16"><RefNothingFound /></div>}
          onRowClick={(row) => openDetail(row.id)}
          // Linko's rows have no vertical padding (three lines still fit in 50 px), the last one no dotted line under it
          // (its .listRow:last-child); a ticked row turns grey.
          rowClass={(row) => `!py-0 ${row.id === lastRowId ? "after:hidden" : ""} ${selected.includes(row.id) ? "!bg-[#f2f5f8]" : ""}`}
          replaceRow={(row) => detailInPage && row.id === detailId}
          expanded={(row) => (detailInPage && row.id === detailId ? card(row) : null)}
          render={(row) => [
            <span key="id" className="relative block">
              {selectMode && (
                <button
                  type="button"
                  aria-label={t("Выбрать")}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleRow(row.id)
                  }}
                  className="absolute -left-[38px] top-1/2 flex -translate-y-1/2"
                >
                  <svg viewBox="0 0 24 24" className={`h-6 w-6 ${selected.includes(row.id) ? "fill-[#5d6474]" : "fill-[#333]"}`} aria-hidden>
                    <path d={selected.includes(row.id) ? BOX_CHECKED : BOX_EMPTY} />
                  </svg>
                </button>
              )}
              {row.serviceId ?? row.id}
            </span>,
            row.type === "Возврат" ? (
              <span key="type" className="font-semibold text-[#ff5e5e]">{t(row.type)}</span>
            ) : (
              <span key="type" className="font-medium">{t(row.type)}</span>
            ),
            client(row),
            row.createdAt,
            person(row.deliveryMan, row.delivererName, row.delivererId),
            row.deliveryDate === "Самовывоз" ? t(row.deliveryDate) : row.deliveryDate,
            person(row.user, row.agentName, row.agentId),
            row.total,
            ...(selectMode ? [""] : []),
          ]}
        />
      </RefCard>
      {importOpen && <DraftImportDialog onClose={() => patch({ excelImportCreateDialog: "false" }, "replace")} />}
      {snack && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[1600] -translate-x-1/2 rounded-[2px] bg-[#323232] px-6 py-[14px] text-[14px] text-white shadow-lg">
          {snack}
        </div>
      )}
    </RefPage>
  )
}
