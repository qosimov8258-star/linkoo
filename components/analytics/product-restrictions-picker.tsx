"use client"

import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"
import {
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
    const params = new URLSearchParams({ kind: tab, page: String(page), pageSize: String(RESTRICTION_PICKER_PAGE_SIZE) })
    if (search) params.set("search", search)
    if (tab === "product") {
      if (typeId) params.set("type", typeId)
      if (brandId) params.set("brand", brandId)
      if (organizationId) params.set("organization", organizationId)
    }
    return params.toString()
  }, [tab, page, search, typeId, brandId, organizationId])

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
  const pageCount = Math.max(1, Math.ceil(count / RESTRICTION_PICKER_PAGE_SIZE))
  const range = rangeOf(page, RESTRICTION_PICKER_PAGE_SIZE, count)
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

  function filterSelect(label: string, value: string, onChange: (value: string) => void, options: RestrictionItem[]) {
    return (
      <label className="flex w-full flex-col sm:w-[240px]">
        <span className="text-[10px] font-bold leading-3 text-[#333]">{t(label)}</span>
        <select
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setPage(1)
          }}
          className="h-[30px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none focus:border-[#5d6474]"
        >
          <option value="">{t("Все")}</option>
          {options.map((option) => (
            <option key={option.id} value={String(option.id)}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t(copy.picker)} className="fixed inset-0 z-[120] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-4 pr-3 sm:pl-[30px] sm:pr-[22px]">
        <h2 className="truncate text-[13px] font-bold uppercase">{t(copy.picker)}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800">
          <X className="h-6 w-6" />
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-end gap-x-[20px] gap-y-3 border-b border-[#e8ebf0] px-4 py-3 sm:px-[30px]">
        {tab === "product" && (
          <div className="grid w-full grid-cols-1 gap-x-[20px] gap-y-3 sm:flex sm:w-auto">
            {filterSelect("Фильтр по типу", typeId, setTypeId, filters.types)}
            {filterSelect("Фильтр по бренду", brandId, setBrandId, filters.brands)}
            {filterSelect("Фильтр по организации", organizationId, setOrganizationId, filters.organizations)}
          </div>
        )}
        <label className="relative flex h-[36px] w-full items-center rounded-[3px] bg-[#f2f5f8] pl-3 pr-9 sm:w-[280px]">
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
            className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-[#9aa1ad]"
          />
          <Search className="absolute right-2 h-[18px] w-[18px] text-[#9aa1ad]" />
        </label>
        <div className="ml-auto flex items-center gap-2 whitespace-nowrap">
          <span>
            {range.from} - {range.to} {t("из")} {count}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label={t("Назад")}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-400 text-slate-600 disabled:border-slate-200 disabled:text-slate-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
            aria-label={t("Вперед")}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-400 text-slate-600 disabled:border-slate-200 disabled:text-slate-300"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-[30px]">
        <div className="grid h-[50px] grid-cols-[minmax(0,8fr)_minmax(0,4fr)] items-center border-b border-[#e8ebf0] font-bold">
          <span>{t("Наименование")}</span>
          <span className="flex items-center gap-[10px]">
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
          <p className="py-16 text-center text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              onClick={() => toggle(row, !selected.has(row.id))}
              className={`grid h-[50px] cursor-pointer grid-cols-[minmax(0,8fr)_minmax(0,4fr)] items-center border-b border-dashed border-[#dfe3ea] hover:bg-[#f2f5f8] ${loading ? "opacity-60" : ""}`}
            >
              <span className="truncate pr-3" title={row.name}>
                {row.name}
              </span>
              <span>
                <DemoCheckbox checked={selected.has(row.id)} onChange={(checked) => toggle(row, checked)} label={row.name} />
              </span>
            </div>
          ))
        )}
      </div>

      <footer className="flex h-[57px] shrink-0 items-center justify-between border-t border-[#e8ebf0] px-4 sm:px-[30px]">
        <span className="text-[#586174]">
          {t("Выбрано")}: {selected.size}
        </span>
        <button
          type="button"
          onClick={() => onSave([...selected.values()])}
          className="rounded-[3px] px-[16px] py-[8px] text-[13px] font-bold uppercase text-[#0a9bd9] hover:bg-[#ececec]"
        >
          {t("Сохранить")}
        </button>
      </footer>
    </div>,
    document.body,
  )
}
