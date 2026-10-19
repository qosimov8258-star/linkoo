"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown, Pencil, X } from "lucide-react"

import { FormField, MultiPick, inputClass } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"

// Demo StockTransfersFilter (c7 module 4340): "Показать фильтр" → popup with
// Со склада, На склад, Период создания, Период доставки, Период приемки,
// "Показать отмененные передачи" and "Применить"; once applied
// "Фильтр: N элемента" + edit + clear. Also reused by "Списание" (its own fields).

export type TransferFilters = {
  fromWarehouses: string[]
  toWarehouses: string[]
  createdFrom: string
  createdTo: string
  deliveryFrom: string
  deliveryTo: string
  acceptedFrom: string
  acceptedTo: string
  withCancelled: boolean
}

export const EMPTY_TRANSFER_FILTERS: TransferFilters = {
  fromWarehouses: [],
  toWarehouses: [],
  createdFrom: "",
  createdTo: "",
  deliveryFrom: "",
  deliveryTo: "",
  acceptedFrom: "",
  acceptedTo: "",
  withCancelled: false,
}

export function transferFilterCount(filters: TransferFilters): number {
  return [
    filters.fromWarehouses.length > 0,
    filters.toWarehouses.length > 0,
    Boolean(filters.createdFrom || filters.createdTo),
    Boolean(filters.deliveryFrom || filters.deliveryTo),
    Boolean(filters.acceptedFrom || filters.acceptedTo),
    filters.withCancelled,
  ].filter(Boolean).length
}

/** "Показать фильтр" / "Фильтр: N элемента" toggle shared by both pages. */
export function FilterToggle({ count, open, onOpen, onClose, onClear }: { count: number; open: boolean; onOpen: () => void; onClose: () => void; onClear: () => void }) {
  const { t } = useLanguage()
  if (count > 0)
    return (
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
    )
  return (
    <button type="button" onClick={open ? onClose : onOpen} className="flex items-center gap-1 whitespace-nowrap font-medium text-[rgb(79,113,220)]">
      {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
    </button>
  )
}

/** Popup shell (Escape / outside click closes, "Применить" submits). */
export function FilterPopup({ onClose, onSubmit, children }: { onClose: () => void; onSubmit: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-[55]" onMouseDown={onClose} aria-hidden />
      <form
        className="absolute left-0 top-0 z-[60] w-[min(320px,calc(100vw-2rem))] bg-white px-5 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[15px] text-[#5d6474]">{t("Фильтр")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#8f8f8f] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col gap-3">{children}</div>
        <button type="submit" className="mt-4 h-9 rounded-sm bg-[rgb(79,113,220)] px-5 text-[13px] font-semibold uppercase text-white shadow hover:brightness-95">
          {t("Применить")}
        </button>
      </form>
    </>
  )
}

/** From–to day inputs of a period field. */
export function PeriodField({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useLanguage()
  return (
    <FormField label={label}>
      <span className="flex items-center gap-2">
        <input type="date" value={from} onChange={(event) => onChange(event.target.value, to)} aria-label={`${label}: ${t("С")}`} className={`${inputClass} px-2`} />
        <span>—</span>
        <input type="date" value={to} onChange={(event) => onChange(from, event.target.value)} aria-label={`${label}: ${t("По")}`} className={`${inputClass} px-2`} />
      </span>
    </FormField>
  )
}

/** Swaps a reversed period. */
export function orderedPeriod(from: string, to: string): [string, string] {
  return from && to && from > to ? [to, from] : [from, to]
}

export function TransferFilterBar({
  filters,
  open,
  onOpen,
  onClose,
  onClear,
  onApply,
  warehouses,
}: {
  filters: TransferFilters
  open: boolean
  onOpen: () => void
  onClose: () => void
  onClear: () => void
  onApply: (filters: TransferFilters) => void
  warehouses: string[]
}) {
  return (
    <div className="relative">
      <FilterToggle count={transferFilterCount(filters)} open={open} onOpen={onOpen} onClose={onClose} onClear={onClear} />
      {open && <TransferFilterPopup filters={filters} warehouses={warehouses} onClose={onClose} onApply={onApply} />}
    </div>
  )
}

function TransferFilterPopup({ filters, warehouses, onClose, onApply }: { filters: TransferFilters; warehouses: string[]; onClose: () => void; onApply: (filters: TransferFilters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<TransferFilters>(filters)
  const options = warehouses.map((name) => ({ value: name, label: name }))
  const set = (patch: Partial<TransferFilters>) => setDraft((current) => ({ ...current, ...patch }))
  const submit = () => {
    const [createdFrom, createdTo] = orderedPeriod(draft.createdFrom, draft.createdTo)
    const [deliveryFrom, deliveryTo] = orderedPeriod(draft.deliveryFrom, draft.deliveryTo)
    const [acceptedFrom, acceptedTo] = orderedPeriod(draft.acceptedFrom, draft.acceptedTo)
    onApply({ ...draft, createdFrom, createdTo, deliveryFrom, deliveryTo, acceptedFrom, acceptedTo })
  }
  return (
    <FilterPopup onClose={onClose} onSubmit={submit}>
      <MultiPick label={t("Со склада")} options={options} value={draft.fromWarehouses} onChange={(fromWarehouses) => set({ fromWarehouses })} />
      <MultiPick label={t("На склад")} options={options} value={draft.toWarehouses} onChange={(toWarehouses) => set({ toWarehouses })} />
      <PeriodField label={t("Период создания")} from={draft.createdFrom} to={draft.createdTo} onChange={(createdFrom, createdTo) => set({ createdFrom, createdTo })} />
      <PeriodField label={t("Период доставки")} from={draft.deliveryFrom} to={draft.deliveryTo} onChange={(deliveryFrom, deliveryTo) => set({ deliveryFrom, deliveryTo })} />
      <PeriodField label={t("Период приемки")} from={draft.acceptedFrom} to={draft.acceptedTo} onChange={(acceptedFrom, acceptedTo) => set({ acceptedFrom, acceptedTo })} />
      <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
        <input type="checkbox" checked={draft.withCancelled} onChange={(event) => set({ withCancelled: event.target.checked })} className="h-4 w-4 accent-[rgb(79,113,220)]" />
        {t("Показать отмененные передачи")}
      </label>
    </FilterPopup>
  )
}
