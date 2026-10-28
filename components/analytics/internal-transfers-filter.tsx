"use client"

import { useEffect, useState, type ReactNode } from "react"
import { X } from "lucide-react"

import { FormField, MultiPick, inputClass } from "@/components/analytics/cash-management-shared"
import { FilterCheck, FilterDate, FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"
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
export function FilterToggle({ count, open, onOpen, onClose, onClear, barWidth = 346.5 }: { count: number; open: boolean; onOpen: () => void; onClose: () => void; onClear: () => void; barWidth?: number }) {
  const { t } = useLanguage()
  // The reference's applied-filter bar: a 347x48 grey block flush with the toolbar's left edge,
  // the text 30px in, then two 48px icon buttons (edit, clear) at its right end.
  if (count > 0)
    return (
      <div style={{ width: barWidth }} className="-ml-[5px] flex h-12 items-center bg-[#efefef] pl-[30px] text-[13px] text-[#666]">
        <span className="whitespace-nowrap">
          {t("Фильтр")}: {count} {t("элемента")}
        </span>
        <button type="button" onClick={onOpen} aria-label={t("Изменить фильтр")} title={t("Изменить фильтр")} className="ml-auto flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]">
            <path d="M17.75 7L14 3.25l-10 10V17h3.75l10-10zm2.96-2.96c.39-.39.39-1.02 0-1.41L18.37.29c-.39-.39-1.02-.39-1.41 0L15 2.25 18.75 6l1.96-1.96z" />
            <path fillOpacity=".36" d="M0 20h24v4H0z" />
          </svg>
        </button>
        <button type="button" onClick={onClear} aria-label={t("Очистить фильтр")} title={t("Очистить фильтр")} className="flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]">
            <path d="M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        </button>
      </div>
    )
  return (
    <button type="button" onClick={open ? onClose : onOpen} className="flex h-[16.3px] w-fit items-center whitespace-nowrap text-[13px] text-[#4f71dc]">
      {t("Показать фильтр")}
      <svg viewBox="6 2 12 20" className={`ml-px h-5 w-[13px] translate-y-[1.9px] fill-[#4f71dc] transition ${open ? "rotate-180" : ""}`}>
        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
      </svg>
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
      <PeriodField label="Период приемки" from={draft.acceptedFrom} to={draft.acceptedTo} onChange={(acceptedFrom, acceptedTo) => set({ acceptedFrom, acceptedTo })} />
      <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
        <input type="checkbox" checked={draft.withCancelled} onChange={(event) => set({ withCancelled: event.target.checked })} className="h-4 w-4 accent-[rgb(79,113,220)]" />
        {t("Показать отмененные передачи")}
      </label>
    </FilterPopup>
  )
}

/** The reference's 300px "Фильтр" drawer of the transfers list (rendered through RefToolbar's `filterPanel`). */
export function TransferFilterPanel({ filters, warehouses, onClose, onApply }: { filters: TransferFilters; warehouses: string[]; onClose: () => void; onApply: (filters: TransferFilters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<TransferFilters>(filters)
  const set = (patch: Partial<TransferFilters>) => setDraft((current) => ({ ...current, ...patch }))
  const submit = () => {
    const [createdFrom, createdTo] = orderedPeriod(draft.createdFrom, draft.createdTo)
    const [deliveryFrom, deliveryTo] = orderedPeriod(draft.deliveryFrom, draft.deliveryTo)
    const [acceptedFrom, acceptedTo] = orderedPeriod(draft.acceptedFrom, draft.acceptedTo)
    onApply({ ...draft, createdFrom, createdTo, deliveryFrom, deliveryTo, acceptedFrom, acceptedTo })
  }
  return (
    <RefFilterPanel className="!w-[300px]" applyClassName="mt-[25px]" onClose={onClose} onApply={submit}>
      <FilterSelect label={t("Со склада")} value={draft.fromWarehouses[0] ?? ""} onChange={(value) => set({ fromWarehouses: value ? [value] : [] })} options={warehouses} />
      <FilterSelect label={t("На склад")} value={draft.toWarehouses[0] ?? ""} onChange={(value) => set({ toWarehouses: value ? [value] : [] })} options={warehouses} />
      <FilterDate mui label={t("Период создания")} begin={draft.createdFrom} end={draft.createdTo} onChange={(createdFrom, createdTo) => set({ createdFrom, createdTo })} />
      <FilterDate mui label={t("Период доставки")} begin={draft.deliveryFrom} end={draft.deliveryTo} onChange={(deliveryFrom, deliveryTo) => set({ deliveryFrom, deliveryTo })} />
      <FilterDate mui label={t("Период приемки")} begin={draft.acceptedFrom} end={draft.acceptedTo} onChange={(acceptedFrom, acceptedTo) => set({ acceptedFrom, acceptedTo })} />
      <FilterCheck compact label="Показать отмененные передачи" checked={draft.withCancelled} onChange={(withCancelled) => set({ withCancelled })} className="mt-[10px]" />
    </RefFilterPanel>
  )
}
