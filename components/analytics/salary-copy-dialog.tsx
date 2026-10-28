"use client"

import { useState } from "react"
import { createPortal } from "react-dom"

import { SALARY_MONTHS, SalaryMonthSelect, SalaryYearField } from "@/components/analytics/salary-fields"
import { RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

function Check({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-[40px] items-center text-left text-[13px] font-semibold text-black">
      <svg viewBox="0 0 24 24" className="mr-[6px] h-5 w-5 shrink-0 fill-[#666]"><path d={checked ? "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" : "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"} /></svg>
      <span className="relative top-[0.7px]">{label}</span>
    </button>
  )
}

/** "ДУБЛИРОВАТЬ С МЕСЯЦА …": copies the KPI plans and/or the salaries of the selected employees (all when none) to another month. */
export function SalaryCopyDialog({
  month,
  year,
  onClose,
  onSave,
}: {
  month: number
  year: number
  onClose: () => void
  onSave: (to: { month: number; year: number }, options: { copyKpi: boolean; copySalary: boolean }) => Promise<void>
}) {
  const { t } = useLanguage()
  // The reference pre-fills the target with the current month and year.
  const today = new Date()
  const nextMonth = today.getMonth()
  const [toMonth, setToMonth] = useState<number | null>(nextMonth)
  const [toYear, setToYear] = useState(today.getFullYear())
  const [copyKpi, setCopyKpi] = useState(false)
  const [copySalary, setCopySalary] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await onSave({ month: (toMonth ?? nextMonth) + 1, year: toYear }, { copyKpi, copySalary })
    } finally {
      setSaving(false)
    }
  }

  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[1400] flex items-start justify-center bg-black/[0.54] pt-[64px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-[450px] max-w-full bg-white shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{t("Дублировать с месяца")} {t(SALARY_MONTHS[month]).toUpperCase()} {year}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={RI.close} /></svg></button>
        </header>
        <div className="px-[30px] pt-[5px]">
          <SalaryMonthSelect rs value={toMonth} onChange={setToMonth} />
          <SalaryYearField rs lower className="mt-[20px]" value={toYear} onChange={setToYear} />
          <div className="mt-[24px]">
            <Check checked={copyKpi} label={t("Копировать KPI")} onClick={() => setCopyKpi((current) => !current)} />
            <Check checked={copySalary} label={t("Копировать зарплату")} onClick={() => setCopySalary((current) => !current)} />
          </div>
          <div className="mt-[14px] flex h-[57px] items-center justify-end border-t border-[#efefef]">
            <button type="button" disabled={saving} onClick={() => void save()} className="relative top-[0.7px] pr-[26px] text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
