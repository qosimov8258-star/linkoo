"use client"

import { useEffect, useState } from "react"
import { ChevronDown, Pencil, X } from "lucide-react"

import { FormField, MultiPick, SearchSelect, inputClass } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  STOCK_INVENTORY_STATUSES,
  STOCK_INVENTORY_STATUS_FILTER_LABELS,
  type StockInventoryOptions,
  type StockInventoryStatus,
} from "@/lib/stock-inventories-types"

// Demo InventoryFilter (module 4373): "Показать фильтр" → 310px popup with
// Склад, Создал (users), Статус (В ожидании / Подтвержденный / Отменено),
// Период создания and "Применить"; once applied "Фильтр: N элемента" + edit + clear.

export type InventoryFilters = {
  warehouses: string[]
  createdBy: string[]
  status: StockInventoryStatus | ""
  fromDate: string
  toDate: string
}

export const EMPTY_INVENTORY_FILTERS: InventoryFilters = { warehouses: [], createdBy: [], status: "", fromDate: "", toDate: "" }

export function inventoryFilterCount(filters: InventoryFilters): number {
  return [filters.warehouses.length > 0, filters.createdBy.length > 0, Boolean(filters.status), Boolean(filters.fromDate || filters.toDate)].filter(Boolean).length
}

export function InventoryFilterBar({
  filters,
  open,
  onOpen,
  onClose,
  onClear,
  onApply,
  options,
}: {
  filters: InventoryFilters
  open: boolean
  onOpen: () => void
  onClose: () => void
  onClear: () => void
  onApply: (filters: InventoryFilters) => void
  options: StockInventoryOptions | null
}) {
  const { t } = useLanguage()
  const count = inventoryFilterCount(filters)
  return (
    <div className="relative">
      {count > 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-[#efefef] px-4 py-1.5 text-[#666]">
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
      ) : (
        <button type="button" onClick={open ? onClose : onOpen} className="flex items-center gap-1 whitespace-nowrap font-medium text-[rgb(79,113,220)]">
          {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {open && <FilterPopup filters={filters} options={options} onClose={onClose} onApply={onApply} />}
    </div>
  )
}

function FilterPopup({
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
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  const named = (values: string[]) => values.map((value) => ({ value, label: value }))
  const statusOptions = STOCK_INVENTORY_STATUSES.map((status) => ({ value: status, label: t(STOCK_INVENTORY_STATUS_FILTER_LABELS[status]) }))
  return (
    <>
      <div className="fixed inset-0 z-[55]" onMouseDown={onClose} aria-hidden />
      <form
        className="absolute left-0 top-0 z-[60] w-[min(310px,calc(100vw-2rem))] bg-white px-5 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
        onSubmit={(event) => {
          event.preventDefault()
          const swap = draft.fromDate && draft.toDate && draft.fromDate > draft.toDate
          onApply(swap ? { ...draft, fromDate: draft.toDate, toDate: draft.fromDate } : draft)
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[15px] text-[#5d6474]">{t("Фильтр")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#8f8f8f] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <MultiPick label={t("Склад")} options={named(options?.warehouses ?? [])} value={draft.warehouses} onChange={(warehouses) => setDraft((current) => ({ ...current, warehouses }))} />
          <MultiPick label={t("Создал")} options={named(options?.users ?? [])} value={draft.createdBy} onChange={(createdBy) => setDraft((current) => ({ ...current, createdBy }))} />
          <FormField label={t("Статус")}>
            <SearchSelect
              value={draft.status}
              options={statusOptions}
              placeholder={t("Все")}
              onChange={(status) => setDraft((current) => ({ ...current, status: status as StockInventoryStatus | "" }))}
            />
          </FormField>
          <FormField label={t("Период создания")}>
            <span className="flex items-center gap-2">
              <input type="date" value={draft.fromDate} onChange={(event) => setDraft((current) => ({ ...current, fromDate: event.target.value }))} aria-label={t("С")} className={`${inputClass} px-2`} />
              <span>—</span>
              <input type="date" value={draft.toDate} onChange={(event) => setDraft((current) => ({ ...current, toDate: event.target.value }))} aria-label={t("По")} className={`${inputClass} px-2`} />
            </span>
          </FormField>
        </div>
        <button type="submit" className="mt-4 h-9 rounded-sm bg-[rgb(79,113,220)] px-5 text-[13px] font-semibold uppercase text-white shadow hover:brightness-95">
          {t("Применить")}
        </button>
      </form>
    </>
  )
}
