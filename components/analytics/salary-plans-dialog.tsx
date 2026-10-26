"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { SALARY_MONTHS, SalaryMonthSelect, SalaryYearField } from "@/components/analytics/salary-fields"
import { FilterSelect, RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

export type SalaryKpi = { id: number; name: string; planType: string }
export type PlanTarget = { userId: number; name: string; plans: Record<number, number> }
export type PlanSavePayload = { month: number; year: number; users: Array<{ userId: number; plans: Array<{ id: number; name: string; planType: string; plan: number }> }>; replaceAll: boolean; columnIds: number[] }

const RADIO_ON = "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
const RADIO_OFF = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"

function Radio({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-6 items-center text-left text-[13px] text-[#333]">
      <svg viewBox="0 0 24 24" className="mr-[16px] h-6 w-6 fill-[#333]"><path d={checked ? RADIO_ON : RADIO_OFF} /></svg>
      {label}
    </button>
  )
}

function formatDigits(raw: string) {
  if (!raw) return ""
  const [int, frac] = raw.split(".")
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

/** KPI multi-select of the "Выбранные KPI" step. */
function KpiMultiSelect({ options, value, onChange }: { options: SalaryKpi[]; value: number[]; onChange: (value: number[]) => void }) {
  const [open, setOpen] = useState(false)
  const names = options.filter((item) => value.includes(item.id)).map((item) => item.name)
  return (
    <div className="relative h-[62px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute inset-x-0 top-[18px] h-[36px] border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black">
        {names.length ? (
          <>
            <span className="absolute left-0 top-[-8px] text-[10px] font-bold leading-3">KPI</span>
            <span className="absolute inset-x-0 top-[10px] truncate pr-8">{names.join(", ")}</span>
          </>
        ) : (
          <span className="absolute left-0 top-[13px] leading-4">KPI</span>
        )}
      </button>
      <svg viewBox="0 0 10 7" className="pointer-events-none absolute right-[14px] top-[36px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-[54px] z-50 max-h-[205px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            {options.map((item) => {
              const checked = value.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChange(checked ? value.filter((id) => id !== item.id) : [...value, item.id])}
                  className="flex h-9 w-full items-center gap-[10px] px-[10px] text-left text-[13px] text-[#333] hover:bg-[#f2f5f8]"
                >
                  <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 ${checked ? "border-[#5d6474] bg-[#5d6474]" : "border-[#5d6474]"}`}>
                    {checked && <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" /></svg>}
                  </span>
                  <span className="truncate">{item.name}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * "Изменить планы": step one asks what to set (KPI plans / salary) and for which KPIs; step two is the reference's full-screen
 * table with one plan input per employee and KPI.
 */
export function SalaryPlansDialog({
  month,
  year,
  targets,
  kpis,
  currencies,
  onClose,
  onSavePlans,
  onSaveSalary,
}: {
  month: number
  year: number
  targets: PlanTarget[]
  kpis: SalaryKpi[]
  currencies: string[]
  onClose: () => void
  onSavePlans: (payload: PlanSavePayload) => Promise<void>
  onSaveSalary: (salary: number, currency: string) => Promise<void>
}) {
  const { t } = useLanguage()
  const [kind, setKind] = useState<"kpi" | "salary">("kpi")
  const [scope, setScope] = useState<"all" | "selected">("all")
  const [picked, setPicked] = useState<number[]>([])
  const [step, setStep] = useState<1 | 2>(1)
  const [salary, setSalary] = useState("")
  const [currency, setCurrency] = useState("")
  const [targetMonth, setTargetMonth] = useState<number | null>(month)
  const [targetYear, setTargetYear] = useState(year)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const tableRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(() => (scope === "all" ? kpis : kpis.filter((item) => picked.includes(item.id))), [scope, kpis, picked])
  const title = `${t("Изменить зарплату выбранных сотрудников на")} ${t(SALARY_MONTHS[month]).toUpperCase()} ${year}`

  function next() {
    if (kind === "salary") {
      void save()
      return
    }
    const initial: Record<string, string> = {}
    for (const target of targets) for (const kpi of kpis) {
      const plan = target.plans[kpi.id]
      if (plan) initial[`${target.userId}:${kpi.id}`] = String(plan)
    }
    setValues(initial)
    setStep(2)
  }

  async function save() {
    setSaving(true)
    try {
      if (kind === "salary") {
        await onSaveSalary(Number(salary.replace(/\s/g, "")) || 0, currency)
        return
      }
      const users = targets.map((target) => {
        const kept = kpis
          .filter((kpi) => !columns.some((column) => column.id === kpi.id) && target.plans[kpi.id])
          .map((kpi) => ({ id: kpi.id, name: kpi.name, planType: kpi.planType, plan: target.plans[kpi.id] }))
        const set = columns
          .map((kpi) => ({ id: kpi.id, name: kpi.name, planType: kpi.planType, plan: Number(values[`${target.userId}:${kpi.id}`] ?? "") || 0 }))
          .filter((item) => item.plan > 0)
        return { userId: target.userId, plans: scope === "all" ? set : [...kept, ...set] }
      })
      await onSavePlans({ month: (targetMonth ?? month) + 1, year: targetYear, users, replaceAll: scope === "all", columnIds: columns.map((item) => item.id) })
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  if (typeof document === "undefined") return null

  if (step === 2) {
    return createPortal(
      <div className="fixed inset-0 z-[1400] flex flex-col bg-white font-sans text-[13px] text-[#333]">
        <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#eee] pl-[24px] pr-[26px]">
          <div className="flex items-center">
            <button type="button" onClick={() => setStep(1)} aria-label={t("Назад")} className="mr-[10px] flex h-6 w-6 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
            </button>
            <span className="text-[13px] font-bold uppercase text-[#333]">{title}</span>
          </div>
          <button type="button" disabled={saving} onClick={() => void save()} className="text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
        </div>
        <div className="flex h-[70px] shrink-0 items-start gap-[10px] px-[15px] pt-[8px]">
          <SalaryMonthSelect className="w-[200px]" value={targetMonth} onChange={setTargetMonth} />
          <SalaryYearField className="w-[150px]" value={targetYear} onChange={setTargetYear} />
        </div>
        <div ref={tableRef} className="min-h-0 flex-1 overflow-auto">
          <table className="border-collapse text-[13px]" style={{ minWidth: 258 + 250 * columns.length }}>
            <thead>
              <tr className="h-[50px]">
                <th className="w-[258px] min-w-[258px] border-b border-[#f1f1f1] pl-[10px] pr-[8px] text-left font-semibold text-[#333]">{t("Сотрудник")}</th>
                {columns.map((kpi) => <th key={kpi.id} className="w-[250px] min-w-[250px] max-w-[250px] border-b border-[#f1f1f1] pr-[16px] text-left align-middle font-semibold leading-[16px] text-[#333]"><span className="block break-words">{kpi.name}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => (
                <tr key={target.userId} className="h-[50px]">
                  <td className="w-[258px] min-w-[258px] border-b border-[#f1f1f1] pl-[10px] pr-[8px]">{target.name}</td>
                  {columns.map((kpi) => {
                    const key = `${target.userId}:${kpi.id}`
                    return (
                      <td key={kpi.id} className="border-b border-[#f1f1f1] pr-[16px]">
                        <input
                          value={formatDigits(values[key] ?? "")}
                          inputMode="decimal"
                          onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value.replace(/[^\d.]/g, "") }))}
                          className="mt-[4px] h-[36px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold text-black outline-none focus:border-[#5d6474]"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {columns.length > 4 && (
          <button
            type="button"
            aria-label=">>"
            onClick={() => tableRef.current?.scrollBy({ left: 750, behavior: "smooth" })}
            className="fixed right-0 top-[265px] flex h-[60px] w-[40px] items-center justify-center rounded-l-full bg-[#ccc] pl-[6px] text-[22px] font-bold leading-none text-white"
          >
            »
          </button>
        )}
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[1400] flex items-start justify-center bg-black/[0.54] pt-[64px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-[600px] max-w-full bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[30px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{title}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg></button>
        </header>
        <div className="h-[300px] px-[30px] pt-[26px]">
          <div className="grid grid-cols-[270px_1fr]">
            <Radio checked={kind === "kpi"} label={t("Установить KPI")} onClick={() => setKind("kpi")} />
            <Radio checked={kind === "salary"} label={t("Установить зарплату")} onClick={() => setKind("salary")} />
          </div>
          {kind === "kpi" ? (
            <>
              <div className="mt-[20px] grid grid-cols-[270px_1fr]">
                <Radio checked={scope === "all"} label={t("Все активные KPI")} onClick={() => setScope("all")} />
                <Radio checked={scope === "selected"} label={t("Выбранные KPI")} onClick={() => setScope("selected")} />
              </div>
              {scope === "selected" && <div className="mt-[20px]"><KpiMultiSelect options={kpis} value={picked} onChange={setPicked} /></div>}
            </>
          ) : (
            <div className="mt-[16px]">
              <label className="relative block h-[50px]">
                <span className="absolute left-0 top-[8px] text-[13px] font-bold text-black">{salary ? "" : t("Зарплата")}</span>
                {salary && <span className="absolute left-0 top-[-2px] text-[10px] font-bold leading-3 text-black">{t("Зарплата")}</span>}
                <input value={formatDigits(salary)} inputMode="decimal" onChange={(event) => setSalary(event.target.value.replace(/[^\d.]/g, ""))} className="absolute inset-x-0 top-[16px] h-[36px] border-b border-[#e8e8e8] bg-transparent text-[13px] font-semibold text-black outline-none focus:border-[#5d6474]" />
              </label>
              <FilterSelect className="mt-[15px]" label={t("Валюта")} value={currency} onChange={setCurrency} options={currencies} />
            </div>
          )}
        </div>
        <footer className={`flex h-[57px] items-center justify-end border-t border-[#efefef] ${kind === "salary" ? "pr-[26px]" : "pr-[33px]"}`}>
          <button type="button" disabled={saving} onClick={next} className="text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{kind === "salary" ? t("Сохранить") : t("Далее")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
