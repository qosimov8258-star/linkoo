"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Columns3, X } from "lucide-react"

import { currencyLabel } from "@/lib/finance/currency"
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
  return (
    <div className="absolute left-0 right-0 top-0 z-[40] px-3 pt-2 md:px-6">
      <div className="rounded-md border border-[#e1e5eb] bg-white px-5 py-5 shadow-xl md:px-8">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#586174]">{t("Фильтр")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#9aa3b6] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-medium text-[#586174]">{t("Период")}</span>
            <span className="flex items-center gap-2 border-b border-[#dbe0e8]">
              <input
                type="date"
                value={draft.from}
                onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
                aria-label={t("С")}
                className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              />
              <span className="text-[#9aa3b6]">—</span>
              <input
                type="date"
                value={draft.to}
                onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
                aria-label={t("По")}
                className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              />
            </span>
          </div>
          <OptionMultiSelect
            label="Организация"
            options={options.organizations.map((name) => ({ value: name, label: name }))}
            value={draft.organizations}
            onChange={(next) => setDraft((current) => ({ ...current, organizations: next }))}
          />
          <OptionMultiSelect
            label="Филиалы"
            options={options.branches.map((name) => ({ value: name, label: name }))}
            value={draft.branches}
            onChange={(next) => setDraft((current) => ({ ...current, branches: next }))}
          />
          <OptionMultiSelect
            label="Поставщик"
            options={options.suppliers.map((supplier) => ({ value: String(supplier.id), label: supplier.name }))}
            value={draft.suppliers}
            onChange={(next) => setDraft((current) => ({ ...current, suppliers: next }))}
          />
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-medium text-[#586174]">{t("Валюта")}</span>
            <select
              value={draft.currency}
              onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))}
              className="h-10 border-b border-[#dbe0e8] bg-transparent text-[15px] outline-none"
            >
              <option value="">{t("Все")}</option>
              {[...new Set([...options.currencies, ...(draft.currency ? [draft.currency] : [])])].map((code) => (
                <option key={code} value={code}>
                  {currencyLabel(code)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" onClick={apply} className="mt-6 h-10 rounded-md bg-[#4f70e7] px-8 text-sm font-semibold uppercase tracking-wide text-white hover:brightness-95">
          {t("Применить")}
        </button>
      </div>
    </div>
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
        className={`flex h-10 w-10 items-center justify-center rounded-md hover:bg-[#f2f5f8] ${hidden.length ? "text-[#4f70e7]" : "text-[#586174]"}`}
      >
        <Columns3 className="h-5 w-5" />
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
