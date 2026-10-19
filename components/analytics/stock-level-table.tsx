"use client"

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Settings2 } from "lucide-react"

import { formatQty, qtyWithUnit } from "@/components/analytics/stock-level-state"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockLevelMode, StockLevelRow, StockLevelStock } from "@/lib/stock/level-types"

// The "Остаток" grid (demo m3871): Товар | Артикул | Тип товара | Всего |
// Забронировано | В пути (КОЛ-ВО only) | Доступно, plus Себестоимость / Сумма
// (СЕБЕСТОИМОСТЬ) or Цена / Сумма (ПРАЙС ЛИСТ). The arrow expands the
// per-warehouse lines under the row; the name opens the item detail.

export type StockColumnId = "article" | "type" | "total" | "reserved" | "transit" | "available" | "cost" | "price" | "value"

type Column = { id: StockColumnId; label: string; sortKey?: string; align?: "right"; modes?: StockLevelMode[] }

export const STOCK_COLUMNS: Column[] = [
  { id: "article", label: "Артикул" },
  { id: "type", label: "Тип товара" },
  { id: "total", label: "Всего", sortKey: "total", align: "right" },
  { id: "reserved", label: "Забронировано", sortKey: "reserved", align: "right" },
  { id: "transit", label: "В пути", sortKey: "transit", align: "right", modes: ["amount"] },
  { id: "available", label: "Доступно", sortKey: "available", align: "right" },
  { id: "cost", label: "Себестоимость", sortKey: "cost", align: "right", modes: ["net_cost"] },
  { id: "price", label: "Цена", sortKey: "price", align: "right", modes: ["price"] },
  { id: "value", label: "Сумма", sortKey: "value", align: "right", modes: ["net_cost", "price"] },
]

export function visibleStockColumns(mode: StockLevelMode, hidden: StockColumnId[]): Column[] {
  return STOCK_COLUMNS.filter((column) => (!column.modes || column.modes.includes(mode)) && !hidden.includes(column.id))
}

/** "Показать" gear: which columns of the grid are visible (kept per browser). */
export function StockColumnSettings({ mode, hidden, onChange }: { mode: StockLevelMode; hidden: StockColumnId[]; onChange: (next: StockColumnId[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} title={t("Настройки таблицы")} aria-label={t("Настройки таблицы")} className="p-1 text-[#586174] hover:text-[#4f70e7]">
        <Settings2 className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 z-[60] mt-1 w-60 rounded-md border border-[#e1e5eb] bg-white py-2 shadow-lg">
          {STOCK_COLUMNS.filter((column) => !column.modes || column.modes.includes(mode)).map((column) => (
            <label key={column.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[#17233b] hover:bg-[#f2f5f8]">
              <input
                type="checkbox"
                checked={!hidden.includes(column.id)}
                onChange={() => onChange(hidden.includes(column.id) ? hidden.filter((id) => id !== column.id) : [...hidden, column.id])}
                className="h-4 w-4 accent-[#4f70e7]"
              />
              {t(column.label)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if ((ordering || "name") === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

type Line = Pick<StockLevelStock, "total" | "reserved" | "transit" | "defects" | "available" | "value">

export function StockLevelTable({
  rows,
  mode,
  hidden,
  currency,
  ordering,
  onSort,
  onOpenItem,
  loading,
}: {
  rows: StockLevelRow[]
  mode: StockLevelMode
  hidden: StockColumnId[]
  currency: string
  ordering: string
  onSort: (key: string) => void
  onOpenItem: (row: StockLevelRow) => void
  loading: boolean
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const columns = visibleStockColumns(mode, hidden)
  const money = (value: number) => `${formatMoney(value, 2)} ${currencyLabel(currency)}`

  const cell = (row: StockLevelRow, line: Line, id: StockColumnId, sub: boolean): ReactNode => {
    const unit = row.unit
    switch (id) {
      case "article":
        return sub ? "" : row.article || "-"
      case "type":
        return sub ? "" : row.type || "-"
      case "total":
        return <b>{qtyWithUnit(line.total, unit, t)}</b>
      case "reserved":
        return <span className="font-semibold" style={{ color: line.reserved > 0 ? "#129fdd" : "#90a4ae" }}>{qtyWithUnit(line.reserved, unit, t)}</span>
      case "transit":
        return <b className="text-[#f0ad4e]">{qtyWithUnit(line.transit, unit, t)}</b>
      case "available":
        return (
          <span title={line.defects ? `${t("Брак")}: ${qtyWithUnit(line.defects, unit, t)}` : undefined}>
            {qtyWithUnit(line.available, unit, t)}
            {line.defects > 0 && <span className="ml-1 text-xs text-[#e57373]">({t("Брак")}: {formatQty(line.defects)})</span>}
          </span>
        )
      case "cost":
        return money(row.cost)
      case "price":
        return money(row.price ?? 0)
      case "value":
        return (
          <span title={mode === "net_cost" ? `${t("Цена доступных товаров")}\n${t("Себестоимость")}: ${money(row.cost)}` : `${t("Цена доступных товаров")}\n${t("Цена")}: ${money(row.price ?? 0)}`}>
            {money(line.value)}
          </span>
        )
    }
  }

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] border-collapse text-[14px]">
        <thead className="bg-[#edf1f6] text-[#263653]">
          <tr>
            <th className="border border-[#dfe4ea] px-3 py-3 text-left font-semibold">
              <button type="button" onClick={() => onSort("name")} className="flex items-center gap-1">
                {t("Товар")} <SortIcon ordering={ordering} sortKey="name" />
              </button>
            </th>
            {columns.map((column) => (
              <th key={column.id} className={`border border-[#dfe4ea] px-3 py-3 font-semibold ${column.align === "right" ? "text-right" : "text-left"}`}>
                {column.sortKey ? (
                  <button type="button" onClick={() => onSort(column.sortKey!)} className={`inline-flex items-center gap-1 ${column.align === "right" ? "flex-row-reverse" : ""}`}>
                    {t(column.label)} <SortIcon ordering={ordering} sortKey={column.sortKey} />
                  </button>
                ) : (
                  t(column.label)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={loading ? "opacity-60" : ""}>
          {rows.map((row, index) => {
            const open = expanded.has(row.key)
            return (
              <Fragment key={row.key}>
                <tr className={index % 2 ? "bg-[#f0f5fa]" : "bg-white"}>
                  <td className="border border-[#e1e5e9] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggle(row.key)}
                        disabled={!row.stocks.length}
                        aria-label={t(open ? "Свернуть" : "Развернуть")}
                        className="text-[#586174] disabled:opacity-30"
                      >
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => onOpenItem(row)} className="text-left hover:text-[#4f71dc]">
                        {row.name}
                      </button>
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td key={column.id} className={`whitespace-nowrap border border-[#e1e5e9] px-3 py-2.5 ${column.align === "right" ? "text-right" : ""}`}>
                      {cell(row, row, column.id, false)}
                    </td>
                  ))}
                </tr>
                {open &&
                  row.stocks.map((stock, stockIndex) => (
                    <tr key={stock.warehouse} className={stockIndex % 2 ? "bg-[#dce8f5]" : "bg-[#e8f1fb]"}>
                      <td className="border border-[#d9e2ec] py-2 pl-12 pr-3 text-[#3b4a66]">
                        {stock.warehouse}
                        {stock.branch && <span className="ml-2 text-xs text-[#7a8599]">{stock.branch}</span>}
                      </td>
                      {columns.map((column) => (
                        <td key={column.id} className={`whitespace-nowrap border border-[#d9e2ec] px-3 py-2 ${column.align === "right" ? "text-right" : ""}`}>
                          {cell(row, stock, column.id, true)}
                        </td>
                      ))}
                    </tr>
                  ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {!rows.length && <div className="p-16 text-center text-[#8b95a5]">{loading ? t("Загрузка...") : t("Нет данных")}</div>}
    </div>
  )
}
