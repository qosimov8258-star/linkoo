"use client"

import { Loader2, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { RefEmpty } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  RESTRICTION_PAGE_SIZES,
  RESTRICTION_PICKER_PAGE_SIZE,
  type RestrictionFilters,
  type RestrictionItem,
  type RestrictionOptionsResponse,
  type RestrictionTab,
} from "@/lib/product-restrictions-types"

import { apiErrorText, DemoCheckbox, rangeOf, TAB_COPY, useEscapeLayer, type ApiErrorBody } from "./product-restrictions-shared"

// The picker "Добавление продуктов" (demo UserProductAddCreateForm): a full-screen page of 50
// live products (filters by type / brand / organization and a search) or product types (search
// only). Checked items persist across pages and searches; "Сохранить" hands them back to the
// dialog (no request is sent).

const ARROW_PREV = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z"
const ARROW_NEXT = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z"

const EMPTY_FILTERS: RestrictionFilters = { types: [], brands: [], organizations: [] }

export function RestrictionPicker({
  tab,
  initial,
  onClose,
  onSave,
}: {
  tab: RestrictionTab
  initial: RestrictionItem[]
  onClose: () => void
  onSave: (items: RestrictionItem[]) => void
}) {
  const { t } = useLanguage()
  const copy = TAB_COPY[tab]
  const [selected, setSelected] = useState<Map<number, RestrictionItem>>(() => new Map(initial.map((item) => [item.id, item])))
  const [searchText, setSearchText] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  // Linko opens the picker with pdPageSize=50 and lets the pager change it.
  const [pageSize, setPageSize] = useState<number>(RESTRICTION_PICKER_PAGE_SIZE)
  const [typeId, setTypeId] = useState("")
  const [brandId, setBrandId] = useState("")
  const [organizationId, setOrganizationId] = useState("")
  const [filters, setFilters] = useState<RestrictionFilters>(EMPTY_FILTERS)
  const [data, setData] = useState<RestrictionOptionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEscapeLayer(onClose)

  // The search applies 300 ms after typing stops (Enter applies it at once).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchText.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchText])

  useEffect(() => {
    if (tab !== "product") return
    let cancelled = false
    fetch("/api/product-restrictions/filters", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<RestrictionFilters>) : EMPTY_FILTERS))
      .then((body) => {
        if (!cancelled) setFilters({ types: body.types ?? [], brands: body.brands ?? [], organizations: body.organizations ?? [] })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tab])

  const query = useMemo(() => {
    const params = new URLSearchParams({ kind: tab, page: String(page), pageSize: String(pageSize) })
    if (search) params.set("search", search)
    if (tab === "product") {
      if (typeId) params.set("type", typeId)
      if (brandId) params.set("brand", brandId)
      if (organizationId) params.set("organization", organizationId)
    }
    return params.toString()
  }, [tab, page, pageSize, search, typeId, brandId, organizationId])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/product-restrictions/options?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (RestrictionOptionsResponse & ApiErrorBody) | null
        if (controller.signal.aborted) return
        if (!response.ok || !body) throw new Error(apiErrorText(body, "Не удалось загрузить данные", t))
        setData(body)
        setError("")
        if (body.page !== page) setPage(body.page)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setData(null)
        setError(reason instanceof Error && reason.message ? reason.message : t("Не удалось загрузить данные"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [query, page, t])

  const rows = data?.results ?? []
  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / pageSize))
  const range = rangeOf(page, pageSize, count)
  const allOnPage = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const someOnPage = rows.some((row) => selected.has(row.id))

  function toggle(item: RestrictionItem, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current)
      if (checked) next.set(item.id, item)
      else next.delete(item.id)
      return next
    })
  }

  function togglePage(checked: boolean) {
    setSelected((current) => {
      const next = new Map(current)
      for (const row of rows) {
        if (checked) next.set(row.id, row)
        else next.delete(row.id)
      }
      return next
    })
  }

  // Linko's search fields: 240 x 36 with the label as the placeholder (13 px semibold) and a grey caret.
  function filterSelect(label: string, value: string, onChange: (value: string) => void, options: RestrictionItem[]) {
    return (
      <label className="relative flex h-[36px] w-full items-center border-b border-[#e8e8e8] focus-within:border-[#5d6474] sm:w-[240px]">
        <select
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setPage(1)
          }}
          aria-label={t(label)}
          className={`h-full w-full appearance-none bg-transparent pr-6 text-[13px] outline-none ${value ? "text-[#333]" : "font-semibold text-black"}`}
        >
          <option value="">{t(label)}</option>
          {options.map((option) => (
            <option key={option.id} value={String(option.id)}>
              {option.name}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="pointer-events-none absolute right-[10px] top-[21px] h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-[#999]" />
      </label>
    )
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t(copy.picker)} className="fixed inset-0 z-[120] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-4 pr-[10px] sm:pl-[30px]">
        <h2 className="truncate text-[13px] font-bold uppercase">{t(copy.picker)}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center rounded-full text-[#666] hover:bg-slate-100">
          <X className="h-6 w-6" />
        </button>
      </header>

      {/* Linko: the three filters (product tab), the grey search box and the pager spread across a 56 px bar. */}
      <div className="flex min-h-[56px] shrink-0 flex-wrap items-center justify-between gap-x-[25px] gap-y-3 border-b border-[#efefef] px-4 py-[6px] sm:px-[30px] lg:py-0">
        {tab === "product" && (
          <div className="grid w-full grid-cols-1 gap-x-[25px] gap-y-3 sm:flex sm:w-auto lg:mt-[10px]">
            {filterSelect("Фильтр по типу", typeId, setTypeId, filters.types)}
            {filterSelect("Фильтр по бренду", brandId, setBrandId, filters.brands)}
            {filterSelect("Фильтр по организацию", organizationId, setOrganizationId, filters.organizations)}
          </div>
        )}
        <label className="relative flex h-[42px] w-full items-center rounded-[2px] border border-[#d9e0e5] bg-[#f2f5f8] pl-[10px] pr-[35px] sm:w-[280px]">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setSearch(searchText.trim())
                setPage(1)
              }
            }}
            maxLength={200}
            placeholder={t(copy.search)}
            aria-label={t(copy.search)}
            className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-black/30"
          />
          <Search className="absolute right-[9px] h-[22px] w-[22px] text-[#bac6ce]" />
        </label>
        <div className="flex items-center whitespace-nowrap text-[#5d6474]">
          <div className="relative mr-[27px]">
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
              aria-label={t("Количество строк")}
              className="h-12 w-[40px] appearance-none bg-transparent text-[13px] text-[#333] outline-none"
            >
              {RESTRICTION_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30" aria-hidden="true"><path d="M7 10l5 5 5-5z" /></svg>
          </div>
          <span className="mr-[5px]">
            {range.from} - {range.to} {t("из")} {count}
          </span>
          <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label={t("Назад")} className="px-[5px]">
            <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`} aria-hidden="true"><path d={ARROW_PREV} /></svg>
          </button>
          <button type="button" onClick={() => setPage(Math.min(pageCount, page + 1))} disabled={page >= pageCount} aria-label={t("Вперед")}>
            <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`} aria-hidden="true"><path d={ARROW_NEXT} /></svg>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid h-[50px] grid-cols-[minmax(0,8fr)_minmax(0,4fr)] items-center border-b border-[#efefef] px-4 font-semibold sm:px-[30px]">
          <span>{t("Наименование")}</span>
          <span className="flex items-center gap-[10px] pl-2">
            <DemoCheckbox checked={allOnPage} partial={!allOnPage && someOnPage} onChange={togglePage} label={t("Выбрать все")} disabled={!rows.length} />
            {t("Статус")}
          </span>
        </div>
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[#586174]">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
          </div>
        ) : error ? (
          <p className="py-10 text-center text-[#e53935]">{error}</p>
        ) : rows.length === 0 ? (
          <RefEmpty text="По вашему запросу ничего не найдено..." />
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              onClick={() => toggle(row, !selected.has(row.id))}
              className={`grid h-[40px] cursor-pointer grid-cols-[minmax(0,8fr)_minmax(0,4fr)] items-center px-4 transition-colors hover:bg-[#f2f5f8] sm:px-[30px] ${loading ? "opacity-60" : ""}`}
            >
              <span className="truncate pr-3" title={row.name}>
                {row.name}
              </span>
              <span className="pl-2">
                <DemoCheckbox checked={selected.has(row.id)} onChange={(checked) => toggle(row, checked)} label={row.name} />
              </span>
            </div>
          ))
        )}
      </div>

      <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#efefef] px-[10px]">
        <button
          type="button"
          onClick={() => onSave([...selected.values()])}
          className="rounded-[2px] px-[16px] py-[8px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#ececec]"
        >
          {t("Сохранить")}
        </button>
      </footer>
    </div>,
    document.body,
  )
}
