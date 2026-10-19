"use client"

import { useEffect, useMemo, useState } from "react"
import { Search, X } from "lucide-react"

import { MiniPager, PrimaryButton, SearchSelect, formatCashDate, inputClass, parseAmount } from "@/components/analytics/cash-management-shared"
import { diffColor, formatDiff, formatQty } from "@/components/analytics/stock-inventory-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockInventoryBalanceRow, StockInventoryBalances, StockInventoryType } from "@/lib/stock-inventories-types"

// Demo "Добавить товары" (module 4759, fromAllBalances): full-screen list of
// the warehouse's items with their system balance — "Фильтр по типу",
// "Фильтр по бренду", "Поиск товаров...", 25 per page; columns Наименование |
// Артикул | Серия | Остаток | Фактический остаток | Разница | Доступно (до/после).
// "Сохранить" adds / updates every item with an entered amount.

const PAGE_SIZE = 25

const valid = (value: string) => {
  const text = value.replace(/[\s  ]/g, "").replace(",", ".")
  return text !== "" && Number.isFinite(Number(text)) && Number(text) >= 0
}

export function InventoryProductPicker({
  balances,
  type,
  initial,
  onClose,
  onSubmit,
}: {
  balances: StockInventoryBalances
  type: StockInventoryType
  /** Amounts already in the form (prefilled). */
  initial: Map<string, string>
  onClose: () => void
  onSubmit: (entries: Array<{ row: StockInventoryBalanceRow; amount: string }>) => void
}) {
  const { t, language } = useLanguage()
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(initial))
  const [search, setSearch] = useState("")
  const [productType, setProductType] = useState("")
  const [brand, setBrand] = useState("")
  const [inStockOnly, setInStockOnly] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")).map((value) => ({ value, label: value }))
  const types = useMemo(() => distinct(balances.rows.map((row) => row.type)), [balances.rows])
  const brands = useMemo(() => distinct(balances.rows.map((row) => row.brand)), [balances.rows])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return balances.rows.filter(
      (row) =>
        (!productType || row.type === productType) &&
        (!brand || row.brand === brand) &&
        (!inStockOnly || row.qty !== 0) &&
        (!needle || `${row.name} ${row.article}`.toLowerCase().includes(needle)),
    )
  }, [balances.rows, productType, brand, inStockOnly, search])
  const lastPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, lastPage)
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const save = () => {
    const entries = balances.rows.filter((row) => valid(amounts[row.key] ?? "")).map((row) => ({ row, amount: (amounts[row.key] ?? "").trim() }))
    onSubmit(entries)
  }

  const subtitle = type === "custom_date" ? `${balances.forDayEnd ? t("Остаток на конец дня") : t("Остаток на начало дня")} ${formatCashDate(balances.date, language, false)}` : ""
  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-white text-[14px] text-[#333]" role="dialog" aria-modal="true">
      <div className="flex min-h-[60px] items-center justify-between border-b border-[#efefef] px-4 md:px-[30px]">
        <div>
          <span className="font-bold uppercase">{t("Добавить товары")}</span>
          <span className="ml-3 text-[13px] text-[#586174]">
            {balances.warehouse}
            {subtitle && ` · ${subtitle}`}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666] hover:text-[#17233b]">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-[#efefef] px-4 py-3 md:px-[30px]">
        <div className="w-[220px]">
          <SearchSelect value={productType} options={types} placeholder={t("Фильтр по типу")} onChange={(value) => { setProductType(value); setPage(1) }} />
        </div>
        <div className="w-[220px]">
          <SearchSelect value={brand} options={brands} placeholder={t("Фильтр по бренду")} onChange={(value) => { setBrand(value); setPage(1) }} />
        </div>
        <label className="relative w-[280px] max-w-full">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder={`${t("Поиск товаров")}...`}
            aria-label={t("Поиск товаров")}
            className={`${inputClass} bg-[#f2f5f8] pr-9`}
          />
          <Search className="pointer-events-none absolute right-2.5 top-2.5 h-5 w-5 text-[#bac6ce]" />
        </label>
        <label className="flex h-10 items-center gap-2 text-[13px] text-[#586174]">
          <input type="checkbox" checked={inStockOnly} onChange={(event) => { setInStockOnly(event.target.checked); setPage(1) }} className="h-4 w-4 accent-[rgb(79,113,220)]" />
          {t("Только продукты в наличии")}
        </label>
        <div className="ml-auto">
          <MiniPager page={current} pageSize={PAGE_SIZE} count={filtered.length} onPage={setPage} />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 md:px-[30px]">
        {visible.length ? (
          <table className="w-full min-w-[900px] border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#efefef] text-left font-semibold">
                <th className="w-[26%] py-3 pr-3">{t("Наименование")}</th>
                <th className="py-3 pr-3">{t("Артикул")}</th>
                <th className="py-3 pr-3">{t("Серия")}</th>
                <th className="py-3 pr-3 text-right">{t("Остаток")}</th>
                <th className="py-3 pr-3">{t("Фактический остаток")}</th>
                <th className="py-3 pr-3 text-right">{t("Разница")}</th>
                <th className="py-3 text-right">{t("Доступно (до/после)")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const text = amounts[row.key] ?? ""
                const entered = valid(text)
                const amount = parseAmount(text)
                const diff = amount - row.qty
                const after = entered ? amount : row.qty
                return (
                  <tr key={row.key} className="h-[50px] border-b border-[#f2f5f8] hover:bg-[#f2f5f8]">
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 pr-3 text-[#586174]">{row.article || "-"}</td>
                    <td className="py-2 pr-3">-</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatQty(row.qty, row.unit)}</td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <input
                          value={text}
                          inputMode="decimal"
                          aria-label={`${t("Фактический остаток")}: ${row.name}`}
                          onChange={(event) => setAmounts((current) => ({ ...current, [row.key]: event.target.value }))}
                          className={`h-9 w-[90px] border-b bg-transparent px-1 outline-none ${text && !entered ? "border-[#e57373]" : "border-[#5d6474]"}`}
                        />
                        <span>{row.unit}</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold" title={t("остаток")} style={{ color: entered ? diffColor(diff) : undefined }}>
                      {entered ? formatDiff(diff, row.unit) : "-"}
                    </td>
                    <td className={`whitespace-nowrap py-2 text-right ${after < 0 ? "font-bold text-[#e57373]" : ""}`}>
                      {formatQty(row.qty)} / {formatQty(after, row.unit)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="py-24 text-center text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено")}...</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-[#efefef] px-4 py-3 md:px-[30px]">
        <span className="mr-auto text-[13px] text-[#586174]">
          {t("Выбрано")}: {balances.rows.filter((row) => valid(amounts[row.key] ?? "")).length}
        </span>
        <PrimaryButton onClick={save}>{t("Сохранить")}</PrimaryButton>
      </div>
    </div>
  )
}
