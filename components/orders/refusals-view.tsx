"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { ActivityPhotoViewer } from "@/components/analytics/activity-dialogs"
import { SortHead } from "@/components/analytics/settings-list-kit"
import { RefusalMultiField, RefusalPeriodField, type MultiOption } from "@/components/orders/refusals-filter"
import { RefAppliedFilter, RefCard, RefFilterPanel, RefHeader, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
import type { FieldRecordFacets, FieldRecordPage, FieldRecordRow } from "@/lib/field-activity/record-list-types"
import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// "Отказы" (Продажи, Linko #/reject): the visit refusals the agents record in the mobile app — the field data of
// Активность / Отслеживание (lib/field-activity, GET /api/field-activity/refusals), paged, sorted and filtered on the
// server. As Linko:
// - the list state lives in the URL: ?pageSize &page &search &ordering (a header click: key, then -key, then none)
//   &fromDate &toDate &agent (ids, "-" joined) &rejectType (type names, "-" joined) &openFilterDialog &image;
// - the filter card (Период, Агент, Тип отказа) offers the current month but the list stays unfiltered until
//   «Применить»; then «Фильтр: N элемента» with ✎ (open it again) and ⊗ (back to the bare list) replaces
//   «Показать фильтр» (N counts the period, the agents and the types in use);
// - Тип отказа filters by type NAME (types sharing a name are one option, in the types' order);
// - a row click opens the refusal under its place (/analytics/refusals/<id>, «Отказ: №<id>» with its photos; the
//   title closes it).
// Kept on purpose: Linko's page never loads its list (market/rejection is cancelled) and its agent search finds no
// one in this account; here the list shows the refusals and Агент offers the employees who have refusals.
// A field employee sees their own refusals.

const PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]
const ORDER_KEYS = ["id", "createdDate", "name", "market", "comment"] as const
type OrderKey = (typeof ORDER_KEYS)[number]
type Ordering = { key: OrderKey; desc: boolean } | null

type Filters = { from: string; to: string; agents: number[]; types: string[] }
const NO_FILTERS: Filters = { from: "", to: "", agents: [], types: [] }

/** The current month in the business time zone (Asia/Tashkent): the filter card's default period. */
function currentMonth() {
  const today = todayIso()
  return { from: monthStartIso(today), to: monthEndIso(today) }
}

/** Linko's «Фильтр: N элемента»: the period, the agents and the types that are set. */
const filterCount = (filters: Filters) => (filters.to || filters.from ? 1 : 0) + (filters.agents.length ? 1 : 0) + (filters.types.length ? 1 : 0)

const isoDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "")

/** Linko joins the picked type names with "-": a name that has a "-" itself is put back together from the known names. */
function splitNames(raw: string, known: Set<string>): string[] {
  const parts = raw.split("-")
  const names: string[] = []
  for (let start = 0; start < parts.length; ) {
    let end = parts.length
    while (end > start + 1 && !known.has(parts.slice(start, end).join("-"))) end -= 1
    const name = parts.slice(start, end).join("-").trim()
    if (name && !names.includes(name)) names.push(name)
    start = end
  }
  return names
}

function refusalIdFromPath(): number | null {
  const match = /\/analytics\/refusals\/(\d{1,10})\/?$/.exec(window.location.pathname)
  const id = Number(match?.[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

export function RefusalsView({ initialId }: { initialId?: number } = {}) {
  const { t, language } = useLanguage()
  // URL state is read once on mount (the server render has no URL query); nothing is fetched or written before.
  const [ready, setReady] = useState(false)
  const [applied, setApplied] = useState<Filters>(NO_FILTERS)
  /** ?rejectType of the URL until the type names are known (a name may hold a "-"). */
  const [pendingTypes, setPendingTypes] = useState<string | null>(null)
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  /** Linko writes openFilterDialog=false once the card was closed by «Применить» / ×. */
  const [filterTouched, setFilterTouched] = useState(false)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  // Linko writes pageSize / page only once they were in the link (its menu opens #/reject?pageSize=25), picked or applied:
  // a card's own link (#/reject/142) stays bare.
  const [pageSizeInUrl, setPageSizeInUrl] = useState(false)
  const [pageInUrl, setPageInUrl] = useState(false)
  const [ordering, setOrdering] = useState<Ordering>(null)
  const [selectedId, setSelectedId] = useState<number | null>(Number.isInteger(initialId) && (initialId ?? 0) > 0 ? (initialId as number) : null)
  const [imageId, setImageId] = useState<number | null>(null)
  const [result, setResult] = useState<{ count: number; rows: FieldRecordRow[] }>({ count: 0, rows: [] })
  const [facets, setFacets] = useState<FieldRecordFacets | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const size = Number(params.get("pageSize"))
    if (PAGE_SIZES.includes(size)) setPageSize(size)
    if (params.has("pageSize") || (!refusalIdFromPath() && ![...params.keys()].length)) setPageSizeInUrl(true)
    const pageParam = Number(params.get("page"))
    if (Number.isInteger(pageParam) && pageParam > 1) setPage(pageParam)
    if (params.has("page")) setPageInUrl(true)
    const text = params.get("search") ?? ""
    setQuery(text)
    setSearch(text.trim())
    const order = params.get("ordering") ?? ""
    const key = (order.startsWith("-") ? order.slice(1) : order) as OrderKey
    if (ORDER_KEYS.includes(key)) setOrdering({ key, desc: order.startsWith("-") })
    const agents = (params.get("agent") ?? "").split("-").map(Number).filter((id) => Number.isInteger(id) && id > 0)
    const fromUrl: Filters = { from: isoDay(params.get("fromDate")), to: isoDay(params.get("toDate")), agents, types: [] }
    setApplied(fromUrl)
    const types = params.get("rejectType")
    if (types) setPendingTypes(types)
    if (params.get("openFilterDialog") === "true") {
      // An open card shows what the link applies, or the current month (the types follow once their names are known).
      setDraft(filterCount(fromUrl) || types ? fromUrl : { ...NO_FILTERS, ...currentMonth() })
      setFilterOpen(true)
    }
    if (params.get("openFilterDialog") === "false") setFilterTouched(true)
    const image = Number(params.get("image"))
    if (Number.isInteger(image) && image > 0) setImageId(image)
    const pathId = refusalIdFromPath()
    if (pathId) setSelectedId(pathId)
    setReady(true)
  }, [])

  // The search goes to the server (it spans every page), a moment after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  // The filter options (employees with refusals, every refusal type).
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/field-activity/refusals?facets=true&pageSize=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as FieldRecordPage | null
        if (!response.ok || !body?.facets) throw new Error("facets")
        setFacets(body.facets)
      })
      .catch((cause: Error) => {
        if (cause.name !== "AbortError") setFacets({ employees: [], clients: [], refusalTypes: [] })
      })
    return () => controller.abort()
  }, [])

  // Types sharing a name are one option (Linko filters by the name), in the order the types were made.
  const typeIdsByName = useMemo(() => {
    const byName = new Map<string, number[]>()
    for (const option of [...(facets?.refusalTypes ?? [])].sort((a, b) => a.id - b.id)) byName.set(option.name, [...(byName.get(option.name) ?? []), option.id])
    return byName
  }, [facets])
  const typeOptions: MultiOption[] = useMemo(() => [...typeIdsByName.keys()].map((name) => ({ value: name, label: name })), [typeIdsByName])
  const agentOptions: MultiOption[] = useMemo(() => (facets?.employees ?? []).map((option) => ({ value: String(option.id), label: option.name })), [facets])

  useEffect(() => {
    if (pendingTypes === null || !facets) return
    const types = splitNames(pendingTypes, new Set(typeIdsByName.keys()))
    setApplied((current) => ({ ...current, types }))
    setDraft((current) => ({ ...current, types }))
    setPendingTypes(null)
  }, [pendingTypes, facets, typeIdsByName])

  const typesReady = pendingTypes === null && (applied.types.length === 0 || facets !== null)
  const typeIds = useMemo(() => applied.types.flatMap((name) => typeIdsByName.get(name) ?? []).join(","), [applied.types, typeIdsByName])
  useEffect(() => {
    if (!ready || !typesReady) return
    // Only unknown type names: no refusal can match.
    if (applied.types.length && !typeIds) {
      setResult({ count: 0, rows: [] })
      setError("")
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search) params.set("q", search)
    if (applied.from) params.set("from", applied.from)
    if (applied.to) params.set("to", applied.to)
    if (applied.agents.length) params.set("employeeId", applied.agents.join(","))
    if (typeIds) params.set("refusalTypeId", typeIds)
    if (ordering) params.set("ordering", `${ordering.desc ? "-" : ""}${ordering.key}`)
    setLoading(true)
    fetch(`/api/field-activity/refusals?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (FieldRecordPage & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error || "Не удалось загрузить данные")
        setResult({ count: body.count, rows: body.rows })
        setError("")
        setLoading(false)
      })
      .catch((cause: Error) => {
        if (cause.name === "AbortError") return
        setResult({ count: 0, rows: [] })
        setError(cause.message || "Не удалось загрузить данные")
        setLoading(false)
      })
    return () => controller.abort()
  }, [ready, typesReady, page, pageSize, search, applied, ordering, typeIds])

  // The URL follows the state: the open refusal is a path of its own (pushed, so Back closes it), the rest is query.
  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams()
    if (applied.from) params.set("fromDate", applied.from)
    if (applied.to) params.set("toDate", applied.to)
    if (applied.agents.length) params.set("agent", applied.agents.join("-"))
    const types = pendingTypes ?? applied.types.join("-")
    if (types) params.set("rejectType", types)
    if (filterOpen) params.set("openFilterDialog", "true")
    else if (filterTouched) params.set("openFilterDialog", "false")
    if (page > 1 || pageInUrl) params.set("page", String(page))
    if (pageSizeInUrl || pageSize !== 25) params.set("pageSize", String(pageSize))
    if (search) params.set("search", search)
    if (ordering) params.set("ordering", `${ordering.desc ? "-" : ""}${ordering.key}`)
    if (imageId) params.set("image", String(imageId))
    params.sort()
    const path = selectedId ? `/analytics/refusals/${selectedId}` : "/analytics/refusals"
    const next = `${path}?${params.toString()}`
    if (next === window.location.pathname + window.location.search) return
    if (path !== window.location.pathname) window.history.pushState(null, "", next)
    else window.history.replaceState(window.history.state, "", next)
  }, [ready, applied, pendingTypes, filterOpen, filterTouched, page, pageSize, pageInUrl, pageSizeInUrl, search, ordering, imageId, selectedId])

  useEffect(() => {
    const onPop = () => {
      setSelectedId(refusalIdFromPath())
      setImageId(null)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  const openFilter = useCallback(() => {
    // The card shows what is applied, or Linko's default period (the current month) when nothing is.
    setDraft(filterCount(applied) ? applied : { ...NO_FILTERS, ...currentMonth() })
    setFilterOpen(true)
  }, [applied])

  const closeFilter = () => {
    setFilterOpen(false)
    setFilterTouched(true)
  }

  const sortBy = (key: OrderKey) => {
    // Linko: ordering=<key>, then -<key>, then none.
    setOrdering((current) => (current?.key !== key ? { key, desc: false } : current.desc ? null : { key, desc: true }))
    setPage(1)
  }
  const head = (key: OrderKey, label: string, className = "") => (
    <SortHead
      label={t(label)}
      field={key}
      ordering={ordering ? [`${ordering.desc ? "-" : ""}${ordering.key}`] : []}
      onSort={() => sortBy(key)}
      className={`!font-semibold leading-[18px] ${className}`}
    />
  )

  const count = filterCount(applied)
  const pageCount = Math.max(1, Math.ceil(result.count / pageSize))
  const start = (page - 1) * pageSize
  const selectedRow = selectedId ? result.rows.find((row) => row.id === selectedId) : undefined
  const viewerPhotos = selectedRow?.photos ?? []
  const viewerStart = imageId ? viewerPhotos.findIndex((photo) => photo.id === imageId) : -1

  return (
    <RefPage>
      <RefHeader title={t("Отказы")} />
      <RefCard>
        <RefToolbar
          linkFilter="flush"
          thinChevron
          pageSizeMenu
          // Linko: the search starts 430 px from the window edge (300 px wide), with or without the applied filter bar.
          filterWidth={379.5}
          searchWidth={300}
          filterOpen={filterOpen}
          onToggleFilter={() => (filterOpen ? closeFilter() : openFilter())}
          leftSlot={
            count > 0 && !filterOpen ? (
              // Linko's afterFilter bar sticks out 23 px left of the card (margin-left -30px) and is 370 px wide.
              <div className="-ml-[28px] [&>div]:!w-[369.5px] [&>div]:!pl-[28px]">
                <RefAppliedFilter
                  count={count}
                  onEdit={openFilter}
                  onClear={() => {
                    // ⊗ goes back to Linko's bare #/reject: no filter, search, sort or page.
                    setApplied(NO_FILTERS)
                    setPendingTypes(null)
                    setQuery("")
                    setSearch("")
                    setOrdering(null)
                    setPage(1)
                    setPageSize(25)
                    setPageInUrl(false)
                    setPageSizeInUrl(false)
                    setFilterTouched(false)
                  }}
                />
              </div>
            ) : undefined
          }
          filterPanel={
            <RefFilterPanel
              narrow
              className="!w-[300px]"
              applyClassName="mt-[21px]"
              onClose={closeFilter}
              onApply={() => {
                setApplied(draft)
                setPendingTypes(null)
                setPage(1)
                // Linko's «Применить» writes openFilterDialog=false&page=1&pageSize=25.
                setPageInUrl(true)
                setPageSizeInUrl(true)
                closeFilter()
              }}
            >
              <RefusalPeriodField label="Период" begin={draft.from} end={draft.to} onChange={(from, to) => setDraft((current) => ({ ...current, from, to }))} />
              <RefusalMultiField
                label="Агент"
                options={agentOptions}
                value={draft.agents.map(String)}
                onChange={(next) => setDraft((current) => ({ ...current, agents: next.map(Number) }))}
              />
              <RefusalMultiField label="Тип отказа" options={typeOptions} value={draft.types} onChange={(next) => setDraft((current) => ({ ...current, types: next }))} />
            </RefFilterPanel>
          }
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setPage(1)
          }}
          pageSize={pageSize}
          onPageSize={(size) => {
            setPageSize(size)
            setPageSizeInUrl(true)
            setPage(1)
          }}
          from={start + 1}
          to={Math.min(start + result.rows.length, result.count)}
          total={result.count}
          page={Math.min(page, pageCount)}
          pageCount={pageCount}
          onPage={setPage}
        />
        <RefTable
          cols="minmax(0,1fr) minmax(0,3fr) minmax(0,3fr) minmax(0,3fr) minmax(0,2fr)"
          heads={[
            // Linko's first column has no inner padding: № and the numbers start 8 px left of the other columns.
            head("id", "№", "-ml-2"),
            head("createdDate", "Дата создания"),
            head("name", "Агент"),
            head("market", "Клиент"),
            head("comment", "Причина"),
          ]}
          rows={result.rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => {
            setSelectedId((current) => (current === row.id ? null : row.id))
            setImageId(null)
          }}
          rowClass={(row) => (row.id === selectedId ? "!hidden" : "")}
          expanded={
            selectedRow
              ? (row) =>
                  row.id === selectedRow.id ? (
                    <RefusalDetail
                      row={row}
                      onClose={() => {
                        setSelectedId(null)
                        setImageId(null)
                      }}
                      onOpenImage={setImageId}
                    />
                  ) : null
              : undefined
          }
          render={(row) => [
            <span key="id" className="-ml-2">
              {row.id}
            </span>,
            // Linko prints the day only ("10 мар. 2026").
            formatDateText(row.at, language, { withTime: false }),
            row.employeeName || `#${row.employeeId}`,
            row.clientName || `#${row.clientId}`,
            <span key="reason" title={row.reason && row.comment ? row.comment : undefined}>
              {row.reason || row.comment || "—"}
            </span>,
          ]}
          empty={loading ? t("Загрузка...") : error ? t(error) : t("Ничего не найдено")}
        />
      </RefCard>
      {viewerStart >= 0 && <ActivityPhotoViewer photos={viewerPhotos} start={viewerStart} onClose={() => setImageId(null)} />}
    </RefPage>
  )
}

/** Linko's refusal card in the list (its RejectDetails): «Отказ: №<id>» (a click closes it), the facts on the left (35%)
 * and the refusal's photos as 150 px tiles on the right; a photo opens the viewer (?image=<photo id>). */
function RefusalDetail({ row, onClose, onOpenImage }: { row: FieldRecordRow; onClose: () => void; onOpenImage: (photoId: number) => void }) {
  const { t, language } = useLanguage()
  const facts: [string, string][] = [
    ["Дата создания", formatDateText(row.at, language, { withTime: false })],
    ["Агент", row.employeeName || `#${row.employeeId}`],
    ["Клиент", row.clientName || `#${row.clientId}`],
    ["Причина", row.reason || row.comment],
  ]
  return (
    <div className="-mx-[15px] my-5">
      <div className="relative max-h-[930px] overflow-hidden bg-white text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <div role="button" tabIndex={0} onClick={onClose} onKeyDown={(event) => event.key === "Enter" && onClose()} className="flex h-[65px] cursor-pointer items-center border-b border-[#efefef] px-[30px]">
          <span className="text-[18px] font-semibold text-[#333]">
            {t("Отказ")}: №{row.id}
          </span>
        </div>
        <div className="flex w-full">
          <div className="relative max-w-[35%] basis-[35%] border-r border-[#efefef] px-[30px] py-5">
            <ul>
              {facts.map(([label, value]) => (
                <li key={label} className="relative flex w-full flex-wrap justify-between leading-[25px]">
                  <span>{t(label)}:</span>
                  <span className="max-w-[50%] truncate text-right font-semibold">{value}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative max-w-[65%] basis-[65%] px-[30px] py-5">
            <div className="grid gap-[10px] [grid-template-columns:repeat(auto-fit,150px)]">
              {row.photos.map((photo) => (
                <button key={photo.id} type="button" onClick={() => onOpenImage(photo.id)} className="cursor-pointer" aria-label={t("Фото")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="" loading="lazy" className="w-full" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
