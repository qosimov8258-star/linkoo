"use client"

import { useState } from "react"
import { createPortal } from "react-dom"

import { SALARY_MONTHS, SalaryMonthSelect, SalaryYearField } from "@/components/analytics/salary-fields"
import { RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

function Check({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-[40px] items-center text-left text-[13px] font-semibold text-[#333]">
      <span className={`mr-[14px] flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 ${checked ? "border-[#5d6474] bg-[#5d6474]" : "border-[#5d6474]"}`}>
        {checked && <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" /></svg>}
      </span>
      {label}
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
      <div role="dialog" aria-modal="true" className="w-[450px] max-w-full bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[27px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{t("Дублировать с месяца")} {t(SALARY_MONTHS[month]).toUpperCase()} {year}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg></button>
        </header>
        <div className="px-[30px] pt-[5px]">
          <SalaryMonthSelect value={toMonth} onChange={setToMonth} />
          <SalaryYearField className="mt-[20px]" value={toYear} onChange={setToYear} />
          <div className="mt-[24px]">
            <Check checked={copyKpi} label={t("Копировать KPI")} onClick={() => setCopyKpi((current) => !current)} />
            <Check checked={copySalary} label={t("Копировать зарплату")} onClick={() => setCopySalary((current) => !current)} />
          </div>
          <div className="mt-[14px] flex h-[57px] items-center justify-end border-t border-[#efefef]">
            <button type="button" disabled={saving} onClick={() => void save()} className="pr-[27px] text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
