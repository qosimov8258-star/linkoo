"use client"

import { useState } from "react"

import { countStockFilters } from "@/components/analytics/stock-level-state"
import { RI } from "@/components/ref/list-kit"
import { ReportFilterPanel, ReportMultiChipField } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockLevelFilters } from "@/lib/stock/level-types"
import type { StockOptions } from "@/lib/stock/options"

// Filter header and popup of "Остаток" (demo m3869 fields, in its order):
// Филиалы, Склад, Поставщик, Бренд, Организация, Тип товара, Подкатегория,
// "Только продукты в наличии". No date: the page shows the current balance.

/** Blue "Фильтр / N" + the scope text ("Во всей организации" or the chosen
 * organizations / branches / warehouses). */
export function StockFilterButton({ filters, onOpen }: { filters: StockLevelFilters; onOpen: () => void }) {
  const { t } = useLanguage()
  const scope = [...filters.organization, ...filters.branch, ...filters.warehouse]
  return (
    <div className="flex h-[34px] items-center">
      <button type="button" onClick={onOpen} className="flex h-[34px] w-[88px] items-center rounded-[5px] bg-[#4f71dc] pl-[12.8px] text-[13px] font-semibold text-white hover:brightness-95">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden>
          <path d={RI.filter} />
        </svg>
        <span className="pl-2">{t("Фильтр")}{countStockFilters(filters) > 0 ? ` / ${countStockFilters(filters)}` : ""}</span>
      </button>
      <span className="ml-[14px] whitespace-nowrap text-[13px] font-semibold text-[#4f71dc]">{scope.length ? scope.join(", ") : t("Во всей организации")}</span>
    </div>
  )
}

export function StockFilterDialog({
  open,
  filters,
  options,
  onApply,
  onClose,
}: {
  open: boolean
  filters: StockLevelFilters
  options: StockOptions | null
  onApply: (filters: StockLevelFilters) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    // Re-seed the draft each time the dialog opens.
    setLastOpen(open)
    if (open) setDraft(filters)
  }
  if (!open) return null
  const set = <K extends keyof StockLevelFilters>(name: K, value: StockLevelFilters[K]) => setDraft((current) => ({ ...current, [name]: value }))
  // Warehouses of the chosen branches only (demo StockMultiSearchField follows the branch).
  const branchKeys = new Set(draft.branch.map((name) => name.trim().toLowerCase()))
  const warehouses = (options?.warehouses ?? []).filter((warehouse) => !branchKeys.size || branchKeys.has(warehouse.branch.trim().toLowerCase()))
  const apply = () => {
    onApply(draft)
    onClose()
  }
  return (
    <ReportFilterPanel title="Фильтр" normalCase outline onClose={onClose} onApply={apply}>
      <ReportMultiChipField label="Филиалы" values={draft.branch} options={options?.branches ?? []} onChange={(value) => set("branch", value)} />
      <ReportMultiChipField label="Склад" values={draft.warehouse} options={warehouses.map((warehouse) => warehouse.name)} onChange={(value) => set("warehouse", value)} />
      <ReportMultiChipField label="Поставщик" values={draft.supplier} options={options?.suppliers ?? []} onChange={(value) => set("supplier", value)} />
      <ReportMultiChipField label="Бренд" values={draft.brand} options={options?.brands ?? []} onChange={(value) => set("brand", value)} />
      <ReportMultiChipField label="Организация" values={draft.organization} options={options?.organizations ?? []} onChange={(value) => set("organization", value)} />
      <ReportMultiChipField label="Тип товара" values={draft.type} options={options?.types ?? []} onChange={(value) => set("type", value)} />
      <label className="flex h-[54px] cursor-pointer items-center gap-[10px] pt-[8px] text-[13px] font-semibold text-black">
        <input type="checkbox" checked={draft.onlyHas} onChange={(event) => set("onlyHas", event.target.checked)} className="h-4 w-4 accent-[#4f71dc]" />
        {t("Только продукты в наличии")}
      </label>
    </ReportFilterPanel>
  )
}
