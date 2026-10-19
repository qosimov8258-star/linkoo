"use client"

import { useState, type ReactNode } from "react"
import { Filter, X } from "lucide-react"

import { MultiSelect } from "@/components/analytics/client-balance-filters"
import { countStockFilters, emptyStockFilters } from "@/components/analytics/stock-level-state"
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
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" onClick={onOpen} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
        <Filter className="h-4 w-4" /> {t("Фильтр")} / {countStockFilters(filters)}
      </button>
      <span className="font-semibold text-[#4f70e7]">{scope.length ? scope.join(", ") : t("Во всей организации")}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-[#586174]">{t(label)}</span>
      {children}
    </div>
  )
}

const names = (values: string[]) => values.map((value) => ({ value, label: value }))

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
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={onClose}>
      <div className="w-full max-w-[760px] rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e1e5eb] px-6 py-4">
          <h2 className="text-lg font-bold text-[#17233b]">{t("Фильтр")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2">
          <Field label="Филиалы">
            <MultiSelect value={draft.branch} options={names(options?.branches ?? [])} onChange={(value) => set("branch", value)} />
          </Field>
          <Field label="Склад">
            <MultiSelect value={draft.warehouse} options={names(warehouses.map((warehouse) => warehouse.name))} onChange={(value) => set("warehouse", value)} />
          </Field>
          <Field label="Поставщик">
            <MultiSelect value={draft.supplier} options={names(options?.suppliers ?? [])} onChange={(value) => set("supplier", value)} />
          </Field>
          <Field label="Бренд">
            <MultiSelect value={draft.brand} options={names(options?.brands ?? [])} onChange={(value) => set("brand", value)} />
          </Field>
          <Field label="Организация">
            <MultiSelect value={draft.organization} options={names(options?.organizations ?? [])} onChange={(value) => set("organization", value)} />
          </Field>
          <Field label="Тип товара">
            <MultiSelect value={draft.type} options={names(options?.types ?? [])} onChange={(value) => set("type", value)} />
          </Field>
          <Field label="Подкатегория">
            <MultiSelect value={draft.subcategory} options={names(options?.subcategories ?? [])} onChange={(value) => set("subcategory", value)} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-[#17233b]">
            <input type="checkbox" checked={draft.onlyHas} onChange={(event) => set("onlyHas", event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
            {t("Только продукты в наличии")}
          </label>
        </div>
        <div className="flex justify-between gap-3 border-t border-[#e1e5eb] px-6 py-4">
          <button type="button" onClick={() => setDraft(emptyStockFilters())} className="h-10 rounded-md border border-[#dbe0e8] px-5 font-semibold text-[#586174]">
            {t("Очистить")}
          </button>
          <button type="button" onClick={apply} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white">
            {t("Применить")}
          </button>
        </div>
      </div>
    </div>
  )
}
