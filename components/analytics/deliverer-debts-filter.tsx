"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, X } from "lucide-react"

import type { DelivererDebtsOptions } from "@/lib/finance-deliverer-debts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Filter popup of "Долги доставщиков" (demo module 4438, PlanningFilterForm):
// a 310 px panel under the toolbar with the fields of the active tab and
// "Применить". Deliverers tab: Организация · Тип оплаты · Филиалы; agents tab
// (isDebt): Филиалы · Организация · Тип оплаты · Тип клиента · "Учитывать
// только реализованных заказов". Values live in the URL (demo PLANNING_FILTER_KEY:
// division, paymentType, branch, marketType, releasedOrders).

export type DelivererDebtsTab = "prediction" | "record"

export type DelivererDebtsFilters = {
  /** "Организация" (demo division). */
  division: string[]
  /** "Тип оплаты". */
  paymentType: "" | "cash" | "bank"
  /** "Филиалы": deliverer (employee) branch / client branch on the agents tab. */
  branch: string[]
  /** "Тип клиента" (agents tab, demo marketType). */
  marketType: string[]
  /** "Учитывать только реализованных заказов" (agents tab). */
  releasedOrders: boolean
}

export const EMPTY_FILTERS: DelivererDebtsFilters = { division: [], paymentType: "", branch: [], marketType: [], releasedOrders: false }

/** Demo getCount: number of filter keys with a value. */
export function countDelivererDebtsFilters(filters: DelivererDebtsFilters): number {
  return [filters.division.length, filters.paymentType, filters.branch.length, filters.marketType.length, filters.releasedOrders].filter(Boolean).length
}

const fieldClass = "flex h-10 w-full items-center justify-between gap-2 border-b border-[#dbe0e8] bg-transparent text-left text-[13px] text-[#17233b] outline-none focus:border-[#4f70e7]"

function MultiSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (next: string[]) => void }) {
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
  const toggle = (option: string) => onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])
  return (
    <div ref={ref} className="relative mt-2">
      <span className="text-[12px] text-[#9aa3b6]">{t(label)}</span>
      <button type="button" onClick={() => setOpen((current) => !current)} className={fieldClass}>
        <span className="truncate">{value.length ? value.join(", ") : <span className="text-[#9aa3b6]">{t("Все")}</span>}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-[70] mt-1 max-h-[240px] overflow-y-auto rounded-md border border-[#e1e5eb] bg-white py-1 shadow-lg">
          {options.length === 0 && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{t("Нет данных")}</p>}
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-[#17233b] hover:bg-[#f2f5f8]"
            >
              <span className="truncate">{option}</span>
              {value.includes(option) && <Check className="h-4 w-4 shrink-0 text-[#4f70e7]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function DelivererDebtsFilterPanel({
  tab,
  value,
  options,
  onApply,
  onClose,
}: {
  tab: DelivererDebtsTab
  /** Applied filters (the panel edits a draft copy). */
  value: DelivererDebtsFilters
  options: DelivererDebtsOptions | null
  onApply: (next: DelivererDebtsFilters) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<DelivererDebtsFilters>(value)
  const set = (patch: Partial<DelivererDebtsFilters>) => setDraft((current) => ({ ...current, ...patch }))
  const isDebt = tab === "record"

  const organization = <MultiSelect key="division" label="Организация" options={options?.organizations ?? []} value={draft.division} onChange={(division) => set({ division })} />
  const paymentType = (
    <label key="paymentType" className="relative mt-2 block">
      <span className="text-[12px] text-[#9aa3b6]">{t("Тип оплаты")}</span>
      <select value={draft.paymentType} onChange={(event) => set({ paymentType: event.target.value as DelivererDebtsFilters["paymentType"] })} className={`${fieldClass} appearance-none pr-6`}>
        <option value="">{t("Все")}</option>
        <option value="cash">{t("Наличные")}</option>
        <option value="bank">{t("Перечисление")}</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
    </label>
  )
  const branch = <MultiSelect key="branch" label="Филиалы" options={options?.branches ?? []} value={draft.branch} onChange={(next) => set({ branch: next })} />

  return (
    <div className="absolute right-6 top-full z-[60] mt-2 w-[310px] rounded-sm bg-white px-5 pb-4 pt-2.5 shadow-[0_2px_10px_rgba(0,0,0,0.2)] md:right-9">
      <div className="flex items-center justify-between">
        <span className="text-[15px] text-[#5d6474]">{t("Фильтр")}</span>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="-mr-2 rounded-full p-2 text-[#8f8f8f] hover:bg-[#f2f5f8]">
          <X className="h-5 w-5" />
        </button>
      </div>
      {isDebt ? (
        <>
          {branch}
          {organization}
          {paymentType}
          <MultiSelect label="Тип клиента" options={options?.clientTypes ?? []} value={draft.marketType} onChange={(marketType) => set({ marketType })} />
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-[13px] text-[#17233b]">
            <input type="checkbox" checked={draft.releasedOrders} onChange={(event) => set({ releasedOrders: event.target.checked })} className="mt-0.5 h-4 w-4 accent-[#4f70e7]" />
            {t("Учитывать только реализованных заказов")}
          </label>
        </>
      ) : (
        <>
          {organization}
          {paymentType}
          {branch}
        </>
      )}
      <button
        type="button"
        onClick={() => {
          onApply(isDebt ? draft : { ...draft, marketType: [], releasedOrders: false })
          onClose()
        }}
        className="mt-4 h-9 rounded-sm bg-[#4f70e7] px-4 text-[13px] font-semibold uppercase text-white hover:bg-[#3f5fd6]"
      >
        {t("Применить")}
      </button>
    </div>
  )
}
