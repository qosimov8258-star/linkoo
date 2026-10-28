"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, X } from "lucide-react"

import { FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"
import { ReportMultiChipField } from "@/components/ref/report-kit"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { formatRangeLabel, parseISODate } from "@/lib/dashboard-date-range"
import { currencyLabel } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Pieces of "Оплаты поставщикам" (demo #/provider-transaction): the filter
// paper (module 4382 ProviderTransactionFilterForm: Период, Организация,
// Филиалы, Поставщик, Валюта + "Применить") and the "Вкл/Выкл колонки" chooser.

export type SupplierPaymentsFilterValues = {
  from: string
  to: string
  organizations: string[]
  branches: string[]
  /** suppliers.id as strings. */
  suppliers: string[]
  currency: string
}

export const EMPTY_SUPPLIER_PAYMENTS_FILTER: SupplierPaymentsFilterValues = { from: "", to: "", organizations: [], branches: [], suppliers: [], currency: "" }

type Option = { value: string; label: string }

function useOutsideClose(open: boolean, setOpen: (value: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handle = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [open, setOpen])
  return ref
}

/** Checkbox dropdown over {value, label} options (values kept even when the option list lacks them). */
export function OptionMultiSelect({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, setOpen)
  const all = [...value.filter((item) => !options.some((option) => option.value === item)).map((item) => ({ value: item, label: item })), ...options]
  const labelOf = (item: string) => all.find((option) => option.value === item)?.label ?? item
  const toggle = (item: string) => onChange(value.includes(item) ? value.filter((current) => current !== item) : [...value, item])
  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-[#586174]">{t(label)}</span>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 min-w-0 items-center justify-between gap-2 border-b border-[#dbe0e8] text-left text-[15px] text-[#17233b]"
      >
        <span className={`truncate ${value.length ? "" : "text-[#9aa3b6]"}`}>{value.length ? value.map(labelOf).join(", ") : t("Все")}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[5] mt-1 max-h-64 overflow-y-auto rounded-md border border-[#e1e5eb] bg-white py-1 shadow-lg">
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] text-[#4f70e7] hover:bg-[#f2f5f8]">
              <X className="h-3.5 w-3.5" /> {t("Очистить")}
            </button>
          )}
          {!all.length && <p className="px-3 py-2 text-sm text-[#9aa3b6]">{t("Нет данных")}</p>}
          {all.map((option) => (
            <button key={option.value} type="button" onClick={() => toggle(option.value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-[#f2f5f8]">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${value.includes(option.value) ? "border-[#4f70e7] bg-[#4f70e7] text-white" : "border-[#c4cbd6]"}`}>
                {value.includes(option.value) && <Check className="h-3 w-3" />}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SupplierPaymentsFilterPanel({
  open,
  values,
  options,
  onApply,
  onClose,
}: {
  open: boolean
  /** Applied values (the panel edits a draft copy). */
  values: SupplierPaymentsFilterValues
  options: { organizations: string[]; branches: string[]; suppliers: Array<{ id: number; name: string }>; currencies: string[] }
  onApply: (next: SupplierPaymentsFilterValues) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(values)
  const [lastOpen, setLastOpen] = useState(open)
  const [pickerOpen, setPickerOpen] = useState(false)
  if (open !== lastOpen) {
    // Re-seed the draft each time the panel opens.
    setLastOpen(open)
    if (open) setDraft(values)
  }
  if (!open) return null
  const apply = () => {
    const period = draft.from && draft.to && draft.from > draft.to ? { from: draft.to, to: draft.from } : { from: draft.from, to: draft.to }
    onApply({ ...draft, ...period })
  }
  const periodLabel = draft.from && draft.to ? formatRangeLabel(parseISODate(draft.from), parseISODate(draft.to)).toLowerCase() : t("Укажите дату")
  const supplierName = (id: string) => options.suppliers.find((supplier) => String(supplier.id) === id)?.name ?? id
  return (
    <RefFilterPanel onClose={onClose} onApply={apply}>
      <div className="flex items-start">
        <div className="relative h-[62px] w-[256px] shrink-0">
          <span className="absolute left-0 top-[8px] text-[10px] font-bold leading-3 text-black">{t("Период")}</span>
          <button type="button" onClick={() => setPickerOpen((open) => !open)} className="absolute inset-x-0 top-[22px] h-[36px] border-b border-[#e8e8e8] text-left text-[13px] text-black">
            {periodLabel}
          </button>
          {pickerOpen && (
            <DateRangePicker
              positionClassName="left-0 top-[58px]"
              begin={draft.from || todayIso()}
              end={draft.to || todayIso()}
              onClose={() => setPickerOpen(false)}
              onApply={(from, to) => {
                setDraft((current) => ({ ...current, from, to }))
                setPickerOpen(false)
              }}
            />
          )}
        </div>
        <div className="relative ml-[98px] h-[62px] w-[342px] shrink-0">
          <ReportMultiChipField label={t("Организация")} values={draft.organizations} options={options.organizations} onChange={(next) => setDraft((current) => ({ ...current, organizations: next }))} />
        </div>
        <div className="relative ml-[11px] h-[62px] w-[345px] shrink-0">
          <ReportMultiChipField label={t("Филиалы")} values={draft.branches} options={options.branches} onChange={(next) => setDraft((current) => ({ ...current, branches: next }))} />
        </div>
        <div className="relative ml-[8px] h-[62px] w-[344px] shrink-0">
          <ReportMultiChipField
            label={t("Поставщик")}
            values={draft.suppliers.map(supplierName)}
            options={options.suppliers.map((supplier) => supplier.name)}
            onChange={(next) => setDraft((current) => ({ ...current, suppliers: next.map((name) => String(options.suppliers.find((supplier) => supplier.name === name)?.id ?? name)) }))}
          />
        </div>
      </div>
      <div className="mt-[10px] w-[344px]">
        <FilterSelect label={t("Валюта")} value={draft.currency} onChange={(value) => setDraft((current) => ({ ...current, currency: value }))} options={[...new Set([...options.currencies, ...(draft.currency ? [draft.currency] : [])])]} />
      </div>
    </RefFilterPanel>
  )
}

/** "Вкл/Выкл колонки": checkbox list of the table columns (hidden ids are kept by the page). */
export function ColumnChooser({ columns, hidden, onChange }: { columns: Array<{ id: string; label: string }>; hidden: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, setOpen)
  const toggle = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id]
    // At least one column stays visible.
    if (next.length < columns.length) onChange(next)
  }
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={t("Вкл/Выкл колонки")}
        aria-label={t("Вкл/Выкл колонки")}
        className="flex h-12 w-12 items-center justify-center hover:bg-[#f2f5f8]"
      >
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${hidden.length ? "fill-[#4f71dc]" : "fill-[#333]"}`}><path d="M3 21h18v-2H3v2zm4-4h10v-2H7v2zm-4-4h18v-2H3v2zm4-4h10V7H7v2zM3 3v2h18V3H3z" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-[60] mt-1 w-[240px] overflow-hidden rounded-md border border-[#e1e5eb] bg-white py-1 shadow-lg">
          <p className="px-4 py-2 text-xs font-semibold uppercase text-[#9aa3b6]">{t("Вкл/Выкл колонки")}</p>
          {columns.map((column) => (
            <label key={column.id} className="flex cursor-pointer items-center gap-2 px-4 py-2 text-[14px] text-[#17233b] hover:bg-[#f2f5f8]">
              <input type="checkbox" checked={!hidden.includes(column.id)} onChange={() => toggle(column.id)} className="h-4 w-4 accent-[#4f70e7]" />
              {t(column.label)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
