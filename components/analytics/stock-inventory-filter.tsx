"use client"

import { useEffect, useState } from "react"
import { ChevronDown, Pencil, X } from "lucide-react"

import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { FilterDate, RefFilterPanel } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  STOCK_INVENTORY_STATUSES,
  STOCK_INVENTORY_STATUS_FILTER_LABELS,
  type StockInventoryOptions,
  type StockInventoryStatus,
} from "@/lib/stock-inventories-types"

// Linko's inventory filter (#/inventory?openFilterDialog=true): the 310px "Фильтр" panel over the
// list's top-left corner with Склад (one warehouse), Создал (several users), Статус (В ожидании /
// Подтвержденный / Отменено), «Период создания» — the range picker (presets and two months) behind
// "Укажите дату" — and "Применить". A click outside leaves it open; once applied the toolbar shows
// "Фильтр: N элемента" (the period counts as two: its start and its end) with edit and clear.

export type InventoryFilters = {
  warehouses: string[]
  createdBy: string[]
  status: StockInventoryStatus | ""
  fromDate: string
  toDate: string
}

export const EMPTY_INVENTORY_FILTERS: InventoryFilters = { warehouses: [], createdBy: [], status: "", fromDate: "", toDate: "" }

export function inventoryFilterCount(filters: InventoryFilters): number {
  return [filters.warehouses.length > 0, filters.createdBy.length > 0, Boolean(filters.status), Boolean(filters.fromDate), Boolean(filters.toDate)].filter(Boolean).length
}

/** The toolbar's left slot: "Показать фильтр ⌄", or the applied filter's chip. */
export function InventoryFilterBar({ filters, open, onOpen, onClose, onClear }: { filters: InventoryFilters; open: boolean; onOpen: () => void; onClose: () => void; onClear: () => void }) {
  const { t } = useLanguage()
  const count = inventoryFilterCount(filters)
  if (count > 0)
    return (
      <div className="flex w-fit items-center gap-2 rounded-md bg-[#efefef] px-4 py-1.5 text-[#666]">
        <span className="whitespace-nowrap">
          {t("Фильтр")}: {count} {t("элемента")}
        </span>
        <button type="button" onClick={onOpen} aria-label={t("Изменить фильтр")} title={t("Изменить фильтр")} className="border-l border-white pl-2 text-[#8f8f8f] hover:text-[#17233b]">
          <Pencil className="h-4 w-4" />
        </button>
        <button type="button" onClick={onClear} aria-label={t("Очистить фильтр")} title={t("Очистить фильтр")} className="border-l border-white pl-2 text-[#8f8f8f] hover:text-[#17233b]">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  return (
    <button type="button" onClick={open ? onClose : onOpen} className="flex items-center gap-[2px] whitespace-nowrap pl-[5px] text-[13px] text-[#1E4A9A]">
      {t("Показать фильтр")} <ChevronDown className={`mt-[2px] h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
    </button>
  )
}

const named = (values: string[]): RefSelectItem[] => values.map((value) => ({ value, label: value }))

/** Mounted only while open: the draft starts from the applied filters. */
export function InventoryFilterPanel({
  filters,
  options,
  onClose,
  onApply,
}: {
  filters: InventoryFilters
  options: StockInventoryOptions | null
  onClose: () => void
  onApply: (filters: InventoryFilters) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<InventoryFilters>(filters)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  const set = <K extends keyof InventoryFilters>(key: K, value: InventoryFilters[K]) => setDraft((current) => ({ ...current, [key]: value }))
  // A value of the URL no longer offered (a renamed warehouse, a removed user) stays choosable.
  const withChosen = (list: string[], chosen: string[]) => named([...chosen.filter((value) => !list.includes(value)), ...list])
  const warehouseItems = withChosen(options?.warehouses ?? [], draft.warehouses)
  const userItems = withChosen(options?.users ?? [], draft.createdBy)
  const statusItems = STOCK_INVENTORY_STATUSES.map((status) => ({ value: status, label: t(STOCK_INVENTORY_STATUS_FILTER_LABELS[status]) }))
  const apply = () => {
    const swap = draft.fromDate && draft.toDate && draft.fromDate > draft.toDate
    onApply(swap ? { ...draft, fromDate: draft.toDate, toDate: draft.fromDate } : draft)
  }
  return (
    <RefFilterPanel narrow onClose={onClose} onApply={apply} applyClassName="mt-[15px]">
      <RefSearchSelect
        label={t("Склад")}
        rowHeight={32}
        items={warehouseItems}
        selected={warehouseItems.filter((item) => draft.warehouses.includes(item.value)).slice(0, 1)}
        onChange={(next) => set("warehouses", next.slice(-1).map((item) => item.value))}
      />
      <RefSearchSelect
        multi
        label={t("Создал")}
        rowHeight={32}
        items={userItems}
        selected={userItems.filter((item) => draft.createdBy.includes(item.value))}
        onChange={(next) => set("createdBy", next.map((item) => item.value))}
      />
      <RefSearchSelect
        searchable={false}
        rowHeight={32}
        label={t("Статус")}
        items={statusItems}
        selected={statusItems.filter((item) => item.value === draft.status)}
        onChange={(next) => set("status", (next[0]?.value ?? "") as StockInventoryStatus | "")}
      />
      <FilterDate
        words
        className="mt-[3px]"
        iconLeft={188}
        label={t("Период создания")}
        begin={draft.fromDate}
        end={draft.toDate}
        onChange={(fromDate, toDate) => setDraft((current) => ({ ...current, fromDate, toDate }))}
      />
    </RefFilterPanel>
  )
}
