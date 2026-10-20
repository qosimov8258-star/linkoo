"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronDown, RefreshCw, Search } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CheckNetCostDialog, StockItemDialog } from "@/components/analytics/stock-level-detail"
import { StockFilterButton, StockFilterDialog } from "@/components/analytics/stock-level-filters"
import {
  formatQty,
  stockListQuery,
  stockScopeQuery,
  stockStateFromParams,
  stockStateToSearch,
  type StockLevelState,
} from "@/components/analytics/stock-level-state"
import { StockColumnSettings, StockLevelTable, visibleStockColumns, type StockColumnId } from "@/components/analytics/stock-level-table"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockLevelList, StockLevelMode, StockLevelRow, StockLevelUnit } from "@/lib/stock/level-types"
import type { StockOptions } from "@/lib/stock/options"

// "Остаток" (demo #/statistics/remainder, modules m2192 / m3869 / m3871):
// current balance of every catalog item with reserved / in-transit /
// available quantities, cards, КОЛ-ВО / СЕБЕСТОИМОСТЬ / ПРАЙС ЛИСТ modes,
// filters, search, "Показать" units, column settings, pagination, Excel and
// the item detail. Everything is kept in the URL.

const LIST_URL = "/api/stock/balances"
const COLUMNS_KEY = "stockLevelColumns"

const MODES: Array<{ mode: StockLevelMode; label: string }> = [
  { mode: "amount", label: "Кол-во" },
  { mode: "net_cost", label: "Себестоимость" },
  { mode: "price", label: "Прайс лист" },
]

const UNITS: Array<{ unit: StockLevelUnit; label: string }> = [
  { unit: "amount", label: "Количество" },
  { unit: "box", label: "Блок" },
  { unit: "capacity", label: "Объем" },
  { unit: "weight", label: "Вес" },
]

export function StockLevelView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<StockLevelState>(() => stockStateFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [checkOpen, setCheckOpen] = useState(false)
  const [hidden, setHidden] = useState<StockColumnId[]>([])
  const [itemName, setItemName] = useState("")
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  const needsPriceList = state.mode === "price" && !state.priceList
  const list = useCashJson<StockLevelList>(needsPriceList ? null : `${LIST_URL}?${stockListQuery(state)}`)
  const options = useCashJson<StockOptions>("/api/stock/options").data
  const data = needsPriceList ? null : list.data
  const rows = data?.rows ?? []
  const sum = data?.sum
  const currency = data?.currency ?? "SUM"

  // URL ⇄ state.
  useEffect(() => {
    const search = stockStateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`)
  }, [state])

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? "[]") as unknown
      if (Array.isArray(saved)) setHidden(saved.filter((id): id is StockColumnId => typeof id === "string"))
    } catch {
      setHidden([])
    }
  }, [])
  const changeHidden = (next: StockColumnId[]) => {
    setHidden(next)
    try {
      window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: keep the in-memory choice
    }
  }

  // Search: applied 400 ms after typing stops.
  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  const update = (patch: Partial<StockLevelState>) => setState((current) => ({ ...current, ...patch }))
  // Header click: asc → desc → default (name asc); "" means name ascending.
  const sort = (key: string) => {
    const current = state.ordering || "name"
    update({ ordering: current === key ? `-${key}` : current === `-${key}` ? "" : key, page: 1 })
  }

  // --- excel ----------------------------------------------------------------------------
  const sheet = (data: StockLevelRow[]) => {
    const columns = visibleStockColumns(state.mode, [])
    const money = columns.filter((column) => column.id === "cost" || column.id === "price" || column.id === "value")
    return [
      [t("Товар"), t("Артикул"), t("Тип товара"), t("Всего"), t("Забронировано"), t("В пути"), t("Брак"), t("Доступно"), t("Ед. изм."), ...money.map((column) => t(column.label)), ...(money.length ? [t("Валюта")] : [])],
      ...data.map((row) => [
        row.name,
        row.article,
        row.type,
        row.total,
        row.reserved,
        row.transit,
        row.defects,
        row.available,
        row.unit ? t(row.unit) : "",
        ...money.map((column) => (column.id === "cost" ? row.cost : column.id === "price" ? (row.price ?? 0) : row.value)),
        ...(money.length ? [currencyLabel(currency)] : []),
      ]),
    ]
  }
  const exportAll = async () => {
    setExporting(true)
    setExportError("")
    try {
      const response = await fetch(`${LIST_URL}?${stockListQuery(state, { page: 1, pageSize: 0 })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (StockLevelList & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(t("Остаток"), sheet(body.rows))
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExporting(false)
    }
  }

  // --- cards ----------------------------------------------------------------------------
  // The unit only when every counted row shares it (kg, litre and pieces are never added up under one label).
  const pcs = sum?.unit ? ` ${t(sum.unit)}` : ""
  const count = (value: number) => `${formatQty(value)}${pcs}`
  const money = (value: number) => `${formatMoney(value, 2)} ${currencyLabel(currency)}`
  const card = (label: string, amount: number, value: number) => (
    <div key={label}>
      <p className="text-[#586174]">{t(label)}</p>
      {state.mode === "amount" ? (
        <p className="text-lg font-semibold text-[#17233b]">{count(amount)}</p>
      ) : (
        <>
          <p className="text-lg font-semibold text-[#17233b]">{money(value)}</p>
          <p className="text-sm text-[#586174]">({count(amount)})</p>
        </>
      )}
    </div>
  )

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Остаток")}</h1>
        </div>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-3 px-4 pt-5 md:px-9">
        <StockFilterButton filters={state.filters} onOpen={() => setFilterOpen(true)} />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setCheckOpen(true)} className="flex h-11 items-center rounded-md bg-[#4f71dc] px-5 font-semibold text-white">
            {t("Проверить себестоимость")}
          </button>
          <BalanceDownloadMenu
            label="Скачать"
            disabled={exporting || needsPriceList}
            items={[
              { label: "Список", onClick: () => downloadExcelTable(t("Прогноз по поставщикам"), sheet(rows)) },
              { label: "Скачать все", onClick: () => void exportAll() },
            ]}
          />
        </div>
      </section>
      {exportError && <p className="px-4 pt-2 text-sm text-[#e5484d] md:px-9">{t(exportError)}</p>}

      <section className={`grid grid-cols-1 gap-6 border-b border-[#e1e5eb] px-4 py-5 sm:grid-cols-2 md:px-9 lg:grid-cols-4 ${list.loading ? "opacity-60" : ""}`}>
        {needsPriceList ? (
          <p className="font-semibold text-[#e57373] sm:col-span-2 lg:col-span-4">{t("Пожалуйста выберите прайс лист")}</p>
        ) : (
          <>
            {card("Общая сумма", sum?.total.count ?? 0, sum?.total.price ?? 0)}
            {card("Сумма забронированных", sum?.reserved.count ?? 0, sum?.reserved.price ?? 0)}
            {state.mode === "amount" ? (
              <div>
                <p className="text-[#586174]">{t("В пути")}</p>
                <p className="text-lg font-semibold text-[#f0ad4e]">{count(sum?.given ?? 0)}</p>
              </div>
            ) : (
              card("Сумма забракованных", sum?.defected.count ?? 0, sum?.defected.price ?? 0)
            )}
            <div className="lg:text-right">{card("Сумма доступных", sum?.available.count ?? 0, sum?.available.price ?? 0)}</div>
          </>
        )}
      </section>

      <section className="flex flex-wrap items-end gap-4 px-4 py-4 md:px-9">
        <div className="flex">
          {MODES.map((item) => (
            <button
              key={item.mode}
              type="button"
              onClick={() => update({ mode: item.mode, page: 1, ordering: "" })}
              className={`h-10 border px-4 text-[13px] font-semibold uppercase first:rounded-l-md last:rounded-r-md ${state.mode === item.mode ? "border-[#4f70e7] bg-[#4f70e7] text-white" : "border-[#d8dde5] bg-white text-[#17233b]"}`}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        {state.mode === "price" && (
          <label className="flex min-w-[220px] flex-col text-xs text-[#586174]">
            {t("Прайс лист")}
            <span className="relative mt-1 flex h-10 items-center border-b border-[#ccd3dc]">
              <select value={state.priceList} onChange={(event) => update({ priceList: event.target.value, page: 1 })} className="h-full w-full appearance-none bg-transparent pr-7 text-[15px] text-[#17233b] outline-none">
                <option value="">{t("Не выбрано")}</option>
                {(options?.priceLists ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-[#9aa3b6]" />
            </span>
          </label>
        )}
        <label className="relative min-w-[200px] flex-1 border-b border-[#ccd3dc] pb-1.5 md:max-w-[360px]">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") update({ search: searchDraft.trim(), page: 1 })
            }}
            placeholder={t("Поиск")}
            aria-label={t("Поиск")}
            className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
          />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <label className="flex min-w-[170px] flex-col text-xs text-[#586174]" title={t("Показать в сгруппированном виде (блоки, коробки и т. д.)")}>
          {t("Показать")}
          <span className="relative mt-1 flex h-10 items-center border-b border-[#ccd3dc]">
            <select value={state.unit} onChange={(event) => update({ unit: event.target.value as StockLevelUnit })} className="h-full w-full appearance-none bg-transparent pr-7 text-[15px] font-semibold text-[#17233b] outline-none">
              {UNITS.map((item) => (
                <option key={item.unit} value={item.unit}>
                  {t(item.label)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-[#9aa3b6]" />
          </span>
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <BalancePagination page={data?.page ?? state.page} pageSize={state.pageSize} count={data?.count ?? 0} onChange={({ page, pageSize }) => update({ page, pageSize })} />
          <StockColumnSettings mode={state.mode} hidden={hidden} onChange={changeHidden} />
          <button type="button" onClick={list.reload} title={t("Обновить список")} aria-label={t("Обновить список")} className="p-1 text-[#586174] hover:text-[#4f70e7]">
            <RefreshCw className={`h-5 w-5 ${list.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      <section className="px-4 pb-8 md:px-9">
        {needsPriceList ? (
          <p className="p-16 text-center font-semibold text-[#e57373]">{t("Пожалуйста выберите прайс лист")}</p>
        ) : list.error && !data ? (
          <p className="p-16 text-center text-[#e5484d]">{t(list.error)}</p>
        ) : (
          <StockLevelTable
            rows={rows}
            mode={state.mode}
            hidden={hidden}
            currency={currency}
            ordering={state.ordering}
            onSort={sort}
            onOpenItem={(row) => {
              setItemName(row.name)
              update({ item: row.key })
            }}
            loading={list.loading}
          />
        )}
      </section>

      <StockFilterDialog open={filterOpen} filters={state.filters} options={options} onApply={(filters) => update({ filters, page: 1 })} onClose={() => setFilterOpen(false)} />
      {state.item && <StockItemDialog itemKey={state.item} scope={stockScopeQuery(state.filters)} fallbackName={itemName} onClose={() => update({ item: "" })} />}
      {checkOpen && <CheckNetCostDialog onClose={() => setCheckOpen(false)} />}
    </main>
  )
}
