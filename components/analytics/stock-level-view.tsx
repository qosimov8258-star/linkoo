"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronDown, Search } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { BALANCE_PAGE_SIZES } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { StockItemDialog } from "@/components/analytics/stock-level-detail"
import { StockFilterButton, StockFilterDialog } from "@/components/analytics/stock-level-filters"
import {
  formatQty,
  stockListQuery,
  stockScopeQuery,
  stockStateFromParams,
  stockStateToSearch,
  type StockLevelState,
} from "@/components/analytics/stock-level-state"
import { StockLevelTable, visibleStockColumns, type StockColumnId } from "@/components/analytics/stock-level-table"
import { RefHeader, RefPage } from "@/components/ref/list-kit"
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
  const pcs = state.unit === "amount" ? ` ${t("шт")}` : ""
  const count = (value: number) => `${formatQty(value)}${pcs}`
  const money = (value: number) => `${formatMoney(value, 2)} ${currencyLabel(currency)}`
  const card = (label: string, amount: number, value: number) => (
    <div key={label}>
      <p className="text-[13px] leading-[16.3px]">{t(label)}</p>
      {state.mode === "amount" ? (
        <p className="text-[16px] font-semibold leading-[20px] text-[#333]">{count(amount)}</p>
      ) : (
        <>
          <p className="text-[16px] font-semibold leading-[20px] text-[#333]">{money(value)}</p>
          <p className="text-[13px] text-[#586174]">({count(amount)})</p>
        </>
      )}
    </div>
  )

  const lastPage = Math.max(1, Math.ceil((data?.count ?? 0) / state.pageSize))
  const currentPage = Math.min(data?.page ?? state.page, lastPage)
  const from = data?.count ? (currentPage - 1) * state.pageSize + 1 : 0
  const to = Math.min(currentPage * state.pageSize, data?.count ?? 0)
  return (
    <RefPage>
      <RefHeader title={t("Остаток")} />
      <div className="-mx-7 -mb-7 min-h-[calc(100vh-111px)] border-t border-[#e8eaee] bg-white px-[30px] pb-[30px] pt-[20px]">
        <section className="flex h-[34px] items-center justify-between">
          <StockFilterButton filters={state.filters} onOpen={() => setFilterOpen(true)} />
          <BalanceDownloadMenu
            label="Скачать"
            disabled={exporting || needsPriceList}
            items={[
              { label: "Список", onClick: () => downloadExcelTable(t("Прогноз по поставщикам"), sheet(rows)) },
              { label: "Скачать все", onClick: () => void exportAll() },
            ]}
          />
        </section>
        {exportError && <p className="pt-2 text-[13px] text-[#e5484d]">{t(exportError)}</p>}

        <section className={`flex justify-between border-b border-[#efefef] pb-[14px] pt-[14px] text-[#666] ${list.loading ? "opacity-60" : ""}`}>
          {needsPriceList ? (
            <p className="text-[13px] font-semibold text-[#e57373]">{t("Пожалуйста выберите прайс лист")}</p>
          ) : (
            <>
              {card("Общая сумма", sum?.total.count ?? 0, sum?.total.price ?? 0)}
              {card("Сумма забронированных", sum?.reserved.count ?? 0, sum?.reserved.price ?? 0)}
              {state.mode === "amount" ? (
                <div>
                  <p className="text-[13px] leading-[16.3px]">{t("В пути")}</p>
                  <p className="text-[16px] font-semibold leading-[20px] text-[#333]">{count(sum?.given ?? 0)}</p>
                </div>
              ) : (
                card("Сумма забракованных", sum?.defected.count ?? 0, sum?.defected.price ?? 0)
              )}
              {card("Сумма доступных", sum?.available.count ?? 0, sum?.available.price ?? 0)}
            </>
          )}
        </section>

        <section className="relative h-[67px]">
          <div className="absolute left-0 top-[25px] flex h-[32px]">
            {MODES.map((item, index) => (
              <button
                key={item.mode}
                type="button"
                onClick={() => update({ mode: item.mode, page: 1, ordering: "" })}
                style={{ minWidth: [70, 90.7, 146.7][index] }}
                className={`h-[32px] px-[16px] text-[13px] uppercase first:rounded-l-[5px] last:rounded-r-[5px] ${state.mode === item.mode ? "bg-[#4f71dc] text-white [box-shadow:0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" : "bg-white text-black [box-shadow:inset_0_0_2px_rgba(0,0,0,0.12)]"}`}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          {state.mode === "price" && (
            <label className="absolute left-[330px] top-[19px] flex w-[200px] flex-col text-[10px] font-semibold text-black">
              {t("Прайс лист")}
              <span className="relative mt-1 flex h-9 items-center border-b border-[#e0e0e0]">
                <select value={state.priceList} onChange={(event) => update({ priceList: event.target.value, page: 1 })} className="h-full w-full appearance-none bg-transparent pr-7 text-[13px] text-[#333] outline-none">
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
          <label className="absolute left-[546.2px] top-[22px] block h-[36px] w-[245.7px] border-b border-[#e0e0e0]">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") update({ search: searchDraft.trim(), page: 1 })
              }}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="h-[31px] w-full bg-transparent pt-[13px] text-[13px] font-semibold leading-[18px] outline-none placeholder:font-semibold placeholder:text-black"
            />
            <Search className="pointer-events-none absolute left-[calc(100%+0px)] top-[8px] h-[22px] w-[22px] -translate-x-[3px] text-[#5d6474]" />
          </label>
          <label className="absolute left-[818px] top-[5px] block w-[200px] text-[10px] font-semibold leading-[12.2px] text-black" title={t("Покаазать в сгруппированном виде (блоки, коробки и тд.)")}>
            {t("Показать")}
            <span className="relative mt-[6px] flex h-[36px] items-center border-b border-[#e8e8e8]">
              <select value={state.unit} onChange={(event) => update({ unit: event.target.value as StockLevelUnit })} className="h-full w-full appearance-none bg-transparent pt-[8px] text-[13px] font-semibold text-[#333] outline-none">
                {UNITS.map((item) => (
                  <option key={item.unit} value={item.unit}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[21px] h-[5px] w-[10px] fill-[#333]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
              <span aria-hidden className="pointer-events-none absolute left-[161px] top-[14px] text-[18px] leading-[18px] text-[#999]">×</span>
            </span>
          </label>
          <div className="absolute right-0 top-[13px] flex h-[56px] items-center">
            <label className="relative flex h-[56px] w-[56px] items-center justify-center text-[13px] text-[#333]">
              <select value={state.pageSize} onChange={(event) => update({ page: 1, pageSize: Number(event.target.value) })} aria-label={t("Количество строк")} className="h-full w-full appearance-none bg-transparent text-[13px] outline-none">
                {BALANCE_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 10 5" className="pointer-events-none absolute left-[23px] top-[26px] h-[5px] w-[10px] fill-[#333]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
            </label>
            <span className="ml-[11px] whitespace-nowrap text-[13px] text-[#5d6474]">
              {from} - {to} {t("из")} {data?.count ?? 0}
            </span>
            <button type="button" disabled={currentPage <= 1} onClick={() => update({ page: currentPage - 1 })} aria-label={t("Назад")} className="pl-[10px] pr-[5px] disabled:opacity-30">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-black/60" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-5l-3-3 3-3v6z" /></svg>
            </button>
            <button type="button" disabled={currentPage >= lastPage} onClick={() => update({ page: currentPage + 1 })} aria-label={t("Вперед")} className="disabled:opacity-30">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-black/60" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-11l3 3-3 3V9z" /></svg>
            </button>
          </div>
        </section>

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
      </div>

      <StockFilterDialog open={filterOpen} filters={state.filters} options={options} onApply={(filters) => update({ filters, page: 1 })} onClose={() => setFilterOpen(false)} />
      {state.item && <StockItemDialog itemKey={state.item} scope={stockScopeQuery(state.filters)} fallbackName={itemName} onClose={() => update({ item: "" })} />}
    </RefPage>
  )
}
