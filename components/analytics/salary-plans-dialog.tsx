"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { SALARY_MONTHS, SalaryMonthSelect, SalaryYearField } from "@/components/analytics/salary-fields"
import { RefSelect } from "@/components/analytics/ref-select"
import { RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

export type SalaryKpi = { id: number; name: string; planType: string }
export type PlanTarget = { userId: number; name: string; plans: Record<number, number> }
export type PlanSavePayload = { month: number; year: number; users: Array<{ userId: number; plans: Array<{ id: number; name: string; planType: string; plan: number }> }>; replaceAll: boolean; columnIds: number[] }

const RADIO_ON = "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
const RADIO_OFF = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"

function Radio({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-6 items-center text-left text-[13px] text-black">
      <svg viewBox="0 0 24 24" className={`mr-[16px] h-6 w-6 ${checked ? "fill-[#5d6474]" : "fill-[#333]"}`}><path d={checked ? RADIO_ON : RADIO_OFF} /></svg>
      <span className="leading-6">{label}</span>
    </button>
  )
}

function formatDigits(raw: string) {
  if (!raw) return ""
  const [int, frac] = raw.split(".")
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

const CHEVRONS = "M6.41 6L5 7.41 9.58 12 5 16.59 6.41 18l6-6zM13 6l-1.41 1.41L16.17 12l-4.58 4.59L13 18l6-6z"

/** The reference's "»" / "«" tabs: they scroll the table sideways while the pointer rests on them (about 1800px per second). */
function ScrollArrow({ side, scroller }: { side: "left" | "right"; scroller: React.RefObject<HTMLDivElement | null> }) {
  const [hover, setHover] = useState(false)
  const [state, setState] = useState({ canLeft: false, canRight: false })
  const frame = useRef(0)

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const update = () => setState({ canLeft: element.scrollLeft > 1, canRight: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 })
    update()
    element.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => {
      element.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      observer.disconnect()
    }
  }, [scroller])

  useEffect(() => {
    if (!hover) return
    let last = performance.now()
    const tick = (now: number) => {
      const element = scroller.current
      if (element) element.scrollLeft += (side === "right" ? 1 : -1) * (now - last) * 1.8
      last = now
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [hover, scroller, side])

  const visible = side === "right" ? state.canRight || hover : state.canLeft
  if (!visible && !(side === "right" && state.canLeft)) return null
  const dim = side === "right" && !state.canRight
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`fixed flex items-center justify-center bg-black/[0.31] transition-all duration-150 ${side === "right" ? "right-0 rounded-l-[60px] pl-[2px]" : "left-0 rounded-r-[60px] pr-[2px]"} top-[265px] h-[60px] w-[40px] ${dim ? "opacity-30" : "opacity-80"}`}
    >
      <svg viewBox="0 0 24 24" className={`h-6 w-6 fill-white ${side === "left" ? "-scale-x-100" : ""}`}><path d={CHEVRONS} /></svg>
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
  const [salaryFocused, setSalaryFocused] = useState(false)
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
        <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8e8e8] pl-[10px] pr-[10px]">
          <div className="flex items-center">
            <button type="button" onClick={() => setStep(1)} aria-label={t("Назад")} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
            </button>
            <span className="text-[13px] font-bold uppercase text-[#333]">{title}</span>
          </div>
          <button type="button" disabled={saving} onClick={() => void save()} className="mr-[16px] h-9 pt-[2px] text-[13px] font-bold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
        </div>
        <div className="flex h-[72px] shrink-0 items-start gap-[10px] px-[15px] pt-[7.5px]">
          <SalaryMonthSelect rs className="w-[200px]" value={targetMonth} onChange={setTargetMonth} />
          <SalaryYearField rs className="w-[151px]" lower value={targetYear} onChange={setTargetYear} />
        </div>
        <div ref={tableRef} className="min-h-0 flex-1 overflow-auto">
          <div style={{ width: 250 * (1 + columns.length) }}>
            <div className="flex h-[50px] border-b border-[#f2f5f8] font-semibold text-[#333]">
              <div className="flex w-[250px] shrink-0 items-center pl-[10px]">{t("Сотрудник")}</div>
              {columns.map((kpi) => <div key={kpi.id} className="flex w-[250px] shrink-0 items-center px-[8px] leading-[16.25px]"><span className="block break-words">{kpi.name}</span></div>)}
            </div>
            {targets.map((target) => (
              <div key={target.userId} className="flex h-[50px] border-b border-[#f2f5f8]">
                <div className="flex w-[250px] shrink-0 items-center pl-[10px] font-semibold">{target.name}</div>
                {columns.map((kpi) => {
                  const key = `${target.userId}:${kpi.id}`
                  return (
                    <div key={kpi.id} className="relative mt-[5.5px] h-[45px] w-[250px] shrink-0 px-[8px]">
                      <input
                        value={formatDigits(values[key] ?? "")}
                        inputMode="decimal"
                        onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value.replace(/[^\d.]/g, "") }))}
                        className="peer block h-[45px] w-full bg-transparent text-[13px] font-semibold leading-6 text-black outline-none"
                      />
                      <span className="pointer-events-none absolute inset-x-[8px] top-[36.5px] h-px bg-[#e0e0e0] peer-focus:h-[2px] peer-focus:bg-[#5d6474]" />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <ScrollArrow side="right" scroller={tableRef} />
        <ScrollArrow side="left" scroller={tableRef} />
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[1400] flex items-start justify-center bg-black/[0.54] pt-[64px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-[600px] max-w-full bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[27px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{title}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={RI.close} /></svg></button>
        </header>
        <div className="h-[300px] overflow-hidden px-[30px] pt-[25px]">
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
              {scope === "selected" && <div className="mt-[10px]"><RefSelect multi label="KPI" options={kpis.map((item) => ({ key: item.id, label: item.name }))} value={picked} onChange={(next) => setPicked(next as number[])} /></div>}
            </>
          ) : (
            <div className="pt-[25px]">
              <label className="group relative mt-[7px] block h-[45px]">
                <span className={`pointer-events-none absolute left-0 origin-top-left text-[13px] font-semibold leading-[18px] text-black transition-all duration-200 ${salary || salaryFocused ? "top-[-7.25px] scale-75" : "top-[13px]"}`}>{t("Зарплата")}</span>
                <input
                  value={formatDigits(salary)}
                  inputMode="decimal"
                  onFocus={() => setSalaryFocused(true)}
                  onBlur={() => setSalaryFocused(false)}
                  onChange={(event) => setSalary(event.target.value.replace(/[^\d.]/g, ""))}
                  className="block h-[45px] w-full bg-transparent text-[13px] font-semibold text-black outline-none"
                />
                <span className="pointer-events-none absolute inset-x-0 top-[36px] h-px bg-[#e0e0e0]" />
                <span className={`pointer-events-none absolute inset-x-0 top-[35px] h-[2px] origin-center bg-[#5d6474] transition-transform duration-200 ${salaryFocused ? "scale-x-100" : "scale-x-0"}`} />
              </label>
              <RefSelect label={t("Валюта")} options={currencies.map((name) => ({ key: name, label: name }))} value={currency ? [currency] : []} onChange={(next) => setCurrency(String(next[0] ?? ""))} />
            </div>
          )}
        </div>
        <footer className={`flex h-[57px] items-center justify-end border-t border-[#efefef] pt-[2px] ${kind === "salary" ? "pr-[26px]" : "pr-[33px]"}`}>
          <button type="button" disabled={saving} onClick={next} className="text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{kind === "salary" ? t("Сохранить") : t("Далее")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
