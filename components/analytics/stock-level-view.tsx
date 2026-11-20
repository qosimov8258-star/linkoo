"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronDown, Search } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { BALANCE_PAGE_SIZES } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { StockItemDialog } from "@/components/analytics/stock-level-detail"
import { StockReservedDialog } from "@/components/analytics/stock-level-reserved"
import { movementLink } from "@/components/analytics/stock-movement-link"
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
// the item detail. Everything is kept in the URL. A product's name opens its «Движение товаров»
// (Linko: #/stock-receives/product-move?pageSize=25&product=<id>); an old ?item= link still opens
// the item card.

const LIST_URL = "/api/stock/balances"
const COLUMNS_KEY = "stockLevelColumns"

const MODES: Array<{ mode: StockLevelMode; label: string }> = [
  { mode: "amount", label: "Кол-во" },
  { mode: "net_cost", label: "Себестоимость" },
  { mode: "price", label: "Прайс лист" },
]

/** Per-unit totals of the counts (GET /api/stock/balances `sum.byUnit`, lib/stock/level.ts). */
type UnitTotal = { unit: string; total: number; reserved: number; defects: number; available: number; transit: number }
type UnitPart = "total" | "reserved" | "defects" | "available" | "transit"

const UNITS: Array<{ unit: StockLevelUnit; label: string }> = [
  { unit: "amount", label: "Количество" },
  { unit: "box", label: "Блок" },
  { unit: "capacity", label: "Объем" },
  { unit: "weight", label: "Вес" },
]

export function StockLevelView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [state, setState] = useState<StockLevelState>(() => stockStateFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [hidden, setHidden] = useState<StockColumnId[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  const needsPriceList = state.mode === "price" && !state.priceList
  // ПРАЙС ЛИСТ without a list: Linko shows «Пожалуйста выберите прайс лист» but still counts the rows in the pager.
  const list = useCashJson<StockLevelList>(`${LIST_URL}?${stockListQuery(needsPriceList ? { ...state, mode: "amount" } : state)}`)
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
  // «Список»: Linko's client-side sheet of the page (its file is named «Прогноз по поставщикам» there too): Товар, Тип
  // товара, «Всего / Забронировано / В пути» in one cell (no В пути outside КОЛ-ВО), Доступно, Цена, Валюта.
  const pageSheet = (data: StockLevelRow[]) => {
    const quantity = state.mode === "amount"
    return [
      [t("Товар"), t("Тип товара"), t(quantity ? "Всего / Забронировано / В пути" : "Всего / Забронировано"), t("Доступно"), t("Цена"), t("Валюта")],
      ...data.map((row) => [
        row.name,
        row.type,
        quantity ? `${formatQty(row.total + row.defects)} / ${formatQty(row.reserved)} / ${formatQty(row.transit)}` : `${formatQty(row.total + row.defects)} / ${formatQty(row.reserved)}`,
        row.total - row.reserved,
        state.mode === "net_cost" ? row.value : state.mode === "price" ? (row.price ?? 0) : 0,
        currencyLabel(currency),
      ]),
    ]
  }
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
  // Counts are never added up across units: one unit → "1 234 dona"; mixed units
  // (kg, litre, pieces…) → one total per unit ("12 dona", "3,5 kg").
  const byUnit = ((sum as { byUnit?: UnitTotal[] } | undefined)?.byUnit ?? []).filter((line) => line && typeof line.unit === "string")
  const mixedUnits = !sum?.unit && byUnit.length > 1
  const pcs = sum?.unit ? ` ${t(sum.unit)}` : ""
  const unitCounts = (part: UnitPart) =>
    byUnit.filter((line) => Math.abs(line[part]) > 1e-9).map((line) => `${formatQty(line[part])}${line.unit ? ` ${t(line.unit)}` : ""}`)
  const count = (value: number, part: UnitPart) => {
    if (!mixedUnits) return `${formatQty(value)}${pcs}`
    const parts = unitCounts(part)
    return parts.length ? parts.join(", ") : formatQty(0)
  }
  const bigCount = (value: number, part: UnitPart, className: string) =>
    mixedUnits && unitCounts(part).length > 1 ? (
      <ul className={className}>
        {unitCounts(part).map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
    ) : (
      <p className={className}>{count(value, part)}</p>
    )
  const money = (value: number) => `${formatMoney(value, 2)} ${currencyLabel(currency)}`
  const card = (label: string, amount: number, value: number, part: UnitPart) => (
    <div key={label}>
      <p className="text-[13px] leading-[16.3px]">{t(label)}</p>
      {state.mode === "amount" ? (
        bigCount(amount, part, "text-[16px] font-semibold leading-[20px] text-[#333]")
      ) : (
        <>
          <p className="text-[16px] font-semibold leading-[20px] text-[#333]">{money(value)}</p>
          <p className="text-[13px] text-[#586174]">({count(amount, part)})</p>
        </>
      )}
    </div>
  )

  const total = list.data?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / state.pageSize))
  const currentPage = Math.min(list.data?.page ?? state.page, lastPage)
  const from = (currentPage - 1) * state.pageSize + 1
  const to = Math.min(currentPage * state.pageSize, total)
  return (
    <RefPage>
      <div className="pl-[2px]"><RefHeader title={t("Остаток")} /></div>
      <div className="-mx-7 -mb-7 min-h-[calc(100vh-111px)] border-t border-[#e8eaee] bg-white px-[30px] pb-[30px] pt-[20px]">
        <section className="flex h-[34px] items-center justify-between">
          <StockFilterButton filters={state.filters} onOpen={() => setFilterOpen(true)} />
          <BalanceDownloadMenu
            label="Скачать"
            disabled={exporting || needsPriceList}
            items={[
              { label: "Список", onClick: () => downloadExcelTable(t("Прогноз по поставщикам"), pageSheet(rows)) },
              { label: "Скачать все", onClick: () => void exportAll() },
            ]}
          />
        </section>
        {exportError && <p className="pt-2 text-[13px] text-[#e5484d]">{t(exportError)}</p>}

        <section className={`flex justify-between border-b border-[#efefef] text-[#666] ${needsPriceList ? "" : "pb-[14px] pt-[14px]"} ${list.loading ? "opacity-60" : ""}`}>
          {needsPriceList ? (
            // Linko's miniError: 20px semibold in the brand colour, centred in an 80px band.
            <p className="flex h-[80px] w-full items-center justify-center text-[20px] font-semibold text-[#1E4A9A]">{t("Пожалуйста выберите прайс лист")}</p>
          ) : (
            <>
              {card("Общая сумма", sum?.total.count ?? 0, sum?.total.price ?? 0, "total")}
              {card("Сумма забронированных", sum?.reserved.count ?? 0, sum?.reserved.price ?? 0, "reserved")}
              {/* Linko (В пути on): the third card is «В пути» in КОЛ-ВО and nothing in СЕБЕСТОИМОСТЬ / ПРАЙС ЛИСТ. */}
              {state.mode === "amount" && (
                <div>
                  <p className="text-[13px] leading-[16.3px]">{t("В пути")}</p>
                  {bigCount(sum?.given ?? 0, "transit", "text-[16px] font-semibold leading-[20px] text-[#333]")}
                </div>
              )}
              {card("Сумма доступных", sum?.available.count ?? 0, sum?.available.price ?? 0, "available")}
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
                style={{ minWidth: [82, 142, 112][index] }}
                className={`h-[32px] px-[16px] text-[13px] uppercase first:rounded-l-[5px] last:rounded-r-[5px] ${state.mode === item.mode ? "bg-[#1E4A9A] text-white [box-shadow:0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" : "bg-white text-black [box-shadow:inset_0_0_2px_rgba(0,0,0,0.12)]"}`}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          {state.mode === "price" && (
            // Linko: a 250px field right of the toggles (their wrapper is 30% wide); empty, its label sits in the field.
            <label style={{ left: "calc(30% + 7px)" }} className="absolute top-[8px] flex w-[250px] flex-col text-[10px] font-semibold text-black">
              <span className={state.priceList ? "" : "invisible"}>{t("Прайс лист")}</span>
              <span className="relative mt-1 flex h-9 items-center border-b border-[#e0e0e0]">
                <select value={state.priceList} onChange={(event) => update({ priceList: event.target.value, page: 1 })} className={`h-full w-full appearance-none bg-transparent pr-7 text-[13px] outline-none ${state.priceList ? "text-[#333]" : "font-semibold text-black"}`}>
                  <option value="">{t("Прайс лист")}</option>
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
          {/* Linko's search form is a quarter of the row, its magnifier button (40px) inside it. */}
          <label style={{ left: "calc(546.2px + (100% - 1236px) * 0.603)", width: "calc(25% - 40px)" }} className="absolute top-[22px] block h-[36px] border-b border-[#e0e0e0]">
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
          <label style={{ left: "calc(818px + (100% - 1236px))" }} className="absolute top-[5px] block w-[200px] text-[10px] font-semibold leading-[12.2px] text-black" title={t("Показать в сгруппированном виде (блоки, коробки и т. д.)")}>
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
              {from} - {to} {t("из")} {total}
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
          <p className="flex h-[400px] items-center justify-center border-t border-[#efefef] text-[20px] font-semibold text-[#1E4A9A]">{t("Пожалуйста выберите прайс лист")}</p>
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
            onOpenItem={(row) => router.push(movementLink(row.key))}
            onOpenReserved={(row) => update({ reserved: row.key })}
            warehouses={data?.warehouses ?? []}
            loading={list.loading}
          />
        )}
      </div>

      <StockFilterDialog open={filterOpen} filters={state.filters} options={options} onApply={(filters) => update({ filters, page: 1 })} onClose={() => setFilterOpen(false)} />
      {state.reserved && (
        <StockReservedDialog
          itemKey={state.reserved}
          name={rows.find((row) => row.key === state.reserved)?.name ?? ""}
          warehouses={state.filters.warehouse}
          onClose={() => update({ reserved: "" })}
        />
      )}
      {state.item && <StockItemDialog itemKey={state.item} scope={stockScopeQuery(state.filters)} fallbackName="" onClose={() => update({ item: "" })} />}
    </RefPage>
  )
}
