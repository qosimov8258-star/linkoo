"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { RefSelect } from "@/components/analytics/ref-select"
import { SALARY_MONTHS, SalaryMonthSelect, SalaryYearField } from "@/components/analytics/salary-fields"
import { RI, RefCard, RefHeader, RefImportDialog, RefNothingFound, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
import { RefTip } from "@/components/ref/ref-tip"
import { downloadExcelTable } from "@/lib/excel-export"
import { readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// «План опроса» (Продажи → Маркетинг), the reference's #/plan-questionnaire/: the employees that have a survey plan in
// the month, each with its surveys as "name: N" chips (ordered by the survey's id).
//   * Месяц / Год (link: month, year), «Поиск» (search), 25 per page;
//   * the list icon switches the row checkboxes on (showCheckboxes); «Изменить планы» needs at least one ticked employee
//     («Выберите хотя бы один сотрудник !») and opens the reference's two steps: «Все активные опросы» / «Выбранные
//     опросы», then one number per employee and survey;
//   * «Дублировать» copies the month's plan (of the ticked employees, else of everyone) to another month;
//   * «Установить с EXCEL» imports a month from an Excel file (Сотрудник, Опрос, План).
// The plans are kept per month ("Апрель-2025") with the employee's and the survey's names (lib/survey-plans-repo.ts).

type PlanEntry = { employee: string; survey: string; plan: number | null }
type PlanRow = { employee: string; plans: Array<{ survey: string; plan: number | null }> }
type SurveyOption = { id: number; name: string; active: boolean }

const PAGE_SIZE = 25
const EDIT = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const COPY = "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
const BOX_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const BOX_OFF = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const DONE_ALL = "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"
const RADIO_ON = "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
const RADIO_OFF = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"

function periodKey(month: number, year: number) {
  return `${SALARY_MONTHS[month]}-${year}`
}

/** A planned number typed or imported (non-negative), else null. */
function planValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.trim().replace(",", ".")) : NaN
  return Number.isFinite(number) && number >= 0 ? number : null
}

/** Excel rows: employee, survey, planned number (a header row is skipped). */
function parseImportedRows(rows: string[][]) {
  const entries: PlanEntry[] = []
  rows.forEach(([employee, survey, plan], index) => {
    if (!employee || !survey) return
    if (index === 0 && /сотрудник/i.test(employee)) return
    entries.push({ employee: employee.trim(), survey: survey.trim(), plan: planValue(plan) })
  })
  return entries
}

function readLink() {
  const params = new URLSearchParams(window.location.search)
  const today = new Date()
  const month = Number(params.get("month"))
  const year = Number(params.get("year"))
  return {
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : today.getMonth(),
    year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : today.getFullYear(),
    search: params.get("search") ?? "",
    showCheckboxes: params.get("showCheckboxes") === "true",
  }
}

function Box({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} onClick={onClick} className="flex h-6 w-6 shrink-0 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={checked ? BOX_ON : BOX_OFF} /></svg>
    </button>
  )
}

function Radio({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-6 items-center text-left text-[13px] text-black">
      <svg viewBox="0 0 24 24" className={`mr-[16px] h-6 w-6 ${checked ? "fill-[#5d6474]" : "fill-[#333]"}`}><path d={checked ? RADIO_ON : RADIO_OFF} /></svg>
      <span className="leading-6">{label}</span>
    </button>
  )
}

/** The reference's chip: the survey's name, then its planned number in the brand colour. */
function PlanChip({ survey, plan }: { survey: string; plan: number | null }) {
  return (
    <div className="my-[5px] mr-[10px] inline-flex h-[28px] items-center rounded-[2px] bg-[#e9ecef] px-[10px] leading-none text-[#333]">
      {survey}:<span className="ml-[4px] font-semibold text-[#1E4A9A]">{plan ?? 0}</span>
    </div>
  )
}

/** «Изменить планы опросов на …»: step 1 picks the surveys (all active / chosen), step 2 one number per employee and survey. */
function PlansDialog({
  month,
  year,
  employees,
  plans,
  surveys,
  onClose,
  onSave,
}: {
  month: number
  year: number
  employees: string[]
  plans: PlanEntry[]
  surveys: SurveyOption[]
  onClose: () => void
  onSave: (entries: PlanEntry[]) => Promise<boolean>
}) {
  const { t } = useLanguage()
  const [scope, setScope] = useState<"all" | "selected">("all")
  const [picked, setPicked] = useState<number[]>([])
  const [step, setStep] = useState<1 | 2>(1)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const title = `${t("Изменить планы опросов на")} ${t(SALARY_MONTHS[month])} ${year}`
  const columns = useMemo(() => (scope === "all" ? surveys.filter((survey) => survey.active) : surveys.filter((survey) => picked.includes(survey.id))), [scope, surveys, picked])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && (step === 2 ? setStep(1) : onClose())
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose, step])

  function next() {
    const initial: Record<string, string> = {}
    for (const entry of plans) if (employees.includes(entry.employee) && entry.plan) initial[`${entry.employee}\u0000${entry.survey}`] = String(entry.plan)
    setValues(initial)
    setStep(2)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const shown = new Set(columns.map((survey) => survey.name))
      const others = plans.filter((entry) => !employees.includes(entry.employee))
      // «Все активные опросы» sets the whole plan of the ticked employees; «Выбранные опросы» only those columns.
      const kept = scope === "all" ? [] : plans.filter((entry) => employees.includes(entry.employee) && !shown.has(entry.survey))
      const set = employees.flatMap((employee) =>
        columns.flatMap((survey) => {
          const plan = planValue(values[`${employee}\u0000${survey.name}`] ?? "")
          return plan ? [{ employee, survey: survey.name, plan }] : []
        }),
      )
      if (await onSave([...others, ...kept, ...set])) onClose()
    } finally {
      setSaving(false)
    }
  }

  if (typeof document === "undefined") return null
  if (step === 2) {
    return createPortal(
      <div className="fixed inset-0 z-[1400] flex flex-col bg-white text-[13px] text-[#333]">
        <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] px-[10px]">
          <div className="flex items-center">
            <button type="button" onClick={() => setStep(1)} aria-label={t("Назад")} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
            </button>
            <span className="text-[13px] font-bold uppercase text-[#333]">{title}</span>
          </div>
          <button type="button" disabled={saving} onClick={() => void save()} className="mr-[16px] h-9 text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-[30px]">
          <div className="grid h-[50px] items-center border-b border-dotted border-[#ccc] font-semibold" style={{ gridTemplateColumns: `repeat(${1 + columns.length}, minmax(160px, 1fr))` }}>
            <span>{t("Сотрудник")}</span>
            {columns.map((survey) => <span key={survey.id} className="truncate pr-[8px]">{survey.name}</span>)}
          </div>
          {employees.map((employee) => (
            <div key={employee} className="grid min-h-[50px] items-center border-b border-dotted border-[#ccc]" style={{ gridTemplateColumns: `repeat(${1 + columns.length}, minmax(160px, 1fr))` }}>
              <span className="truncate pr-[8px] font-semibold">{employee}</span>
              {columns.map((survey) => {
                const key = `${employee}\u0000${survey.name}`
                return (
                  <label key={survey.id} className="relative mr-[8px] block h-[45px]">
                    <span className="sr-only">{`${employee} — ${survey.name}`}</span>
                    <input
                      value={values[key] ?? ""}
                      inputMode="decimal"
                      placeholder={t("Количество")}
                      onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value.replace(/[^\d.]/g, "") }))}
                      className="peer block h-[45px] w-full bg-transparent text-[13px] font-semibold text-black outline-none placeholder:font-normal placeholder:text-black/30"
                    />
                    <span className="pointer-events-none absolute inset-x-0 top-[36px] h-px bg-[#e0e0e0] peer-focus:h-[2px] peer-focus:bg-[#5d6474]" />
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </div>,
      document.body,
    )
  }
  return createPortal(
    <div className="fixed inset-0 z-[1400] flex items-start justify-center bg-black/[0.54] pt-[64px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-[600px] max-w-full bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{title}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={RI.close} /></svg></button>
        </header>
        <div className="h-[300px] px-[30px] pt-[25px]">
          <div className="grid grid-cols-[270px_1fr]">
            <Radio checked={scope === "all"} label={t("Все активные опросы")} onClick={() => setScope("all")} />
            <Radio checked={scope === "selected"} label={t("Выбранные опросы")} onClick={() => setScope("selected")} />
          </div>
          {scope === "selected" && (
            <div className="mt-[10px]">
              <RefSelect multi label={t("Опросы")} options={surveys.map((survey) => ({ key: survey.id, label: survey.name }))} value={picked} onChange={(next) => setPicked(next as number[])} />
            </div>
          )}
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] pr-[33px]">
          <button type="button" disabled={scope === "selected" && !picked.length} onClick={next} className="text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Далее")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** «Дублировать с месяца …»: the target month and year (the reference pre-fills the current ones). */
function CopyDialog({ month, year, onClose, onSave }: { month: number; year: number; onClose: () => void; onSave: (toMonth: number, toYear: number) => Promise<void> }) {
  const { t } = useLanguage()
  const today = new Date()
  const [toMonth, setToMonth] = useState<number | null>(today.getMonth())
  const [toYear, setToYear] = useState(today.getFullYear())
  const [saving, setSaving] = useState(false)
  if (typeof document === "undefined") return null
  return createPortal(
    <div className="fixed inset-0 z-[1400] flex items-start justify-center bg-black/[0.54] pt-[64px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-[450px] max-w-full bg-white shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{t("Дублировать с месяца")} {t(SALARY_MONTHS[month]).toUpperCase()} {year}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={RI.close} /></svg></button>
        </header>
        {/* The reference: the two fields, then the footer line inset by the dialog's 30 px padding. */}
        <div className="px-[30px] pt-[5px]">
          <div className="h-[196px]">
            <SalaryMonthSelect rs value={toMonth} onChange={setToMonth} />
            <SalaryYearField rs lower className="mt-[20px]" value={toYear} onChange={setToYear} />
          </div>
          <div className="flex h-[57px] items-center justify-end border-t border-[#efefef]">
            <button
              type="button"
              disabled={saving || toMonth == null}
              onClick={async () => {
                if (toMonth == null) return
                setSaving(true)
                try {
                  await onSave(toMonth, toYear)
                } finally {
                  setSaving(false)
                }
              }}
              className="pr-[24px] text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50"
            >
              {t("Сохранить")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function SurveyPlanView() {
  const { t } = useLanguage()
  const [surveys, setSurveys] = useState<SurveyOption[]>([])
  const [plans, setPlans] = useState<Record<string, PlanEntry[]>>({})
  const [link, setLink] = useState<ReturnType<typeof readLink> | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<string[]>([])
  const [dialog, setDialog] = useState<"plans" | "copy" | "import" | null>(null)
  const [importMonth, setImportMonth] = useState<number | null>(null)
  const [importYear, setImportYear] = useState(new Date().getFullYear())
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/surveys")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: unknown) => {
        if (cancelled || !Array.isArray(rows)) return
        setSurveys(
          rows
            .map((row) => ({ id: Number((row as SurveyOption).id), name: String((row as SurveyOption).name ?? "").trim(), active: Boolean((row as SurveyOption).active) }))
            .filter((row) => row.id > 0 && row.name)
            .sort((a, b) => a.id - b.id),
        )
      })
      .catch(() => {})
    fetch("/api/survey-plans")
      .then((response) => (response.ok ? (response.json() as Promise<Array<PlanEntry & { period: string }>>) : Promise.reject()))
      .then((entries) => {
        if (cancelled) return
        const grouped: Record<string, PlanEntry[]> = {}
        for (const entry of entries) (grouped[entry.period] ??= []).push({ employee: entry.employee, survey: entry.survey, plan: planValue(entry.plan) })
        setPlans(grouped)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Link → state on mount and on Back / Forward.
  useEffect(() => {
    const sync = () => setLink(readLink())
    sync()
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  const navigate = useCallback((next: NonNullable<typeof link>, replace = false) => {
    setLink(next)
    setPage(1)
    const params = new URLSearchParams(window.location.search)
    params.set("month", String(next.month + 1))
    params.set("year", String(next.year))
    if (next.search) params.set("search", next.search)
    else params.delete("search")
    if (next.showCheckboxes) params.set("showCheckboxes", "true")
    else params.delete("showCheckboxes")
    const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`
    if (replace) window.history.replaceState(window.history.state, "", url)
    else window.history.pushState(window.history.state, "", url)
  }, [])

  const key = link ? periodKey(link.month, link.year) : ""
  const surveyOrder = useMemo(() => new Map(surveys.map((survey) => [survey.name, survey.id])), [surveys])
  const rows = useMemo<PlanRow[]>(() => {
    if (!link) return []
    const needle = link.search.trim().toLowerCase()
    const byEmployee = new Map<string, PlanRow>()
    for (const entry of plans[key] ?? []) {
      const row = byEmployee.get(entry.employee) ?? { employee: entry.employee, plans: [] }
      row.plans.push({ survey: entry.survey, plan: entry.plan })
      byEmployee.set(entry.employee, row)
    }
    return [...byEmployee.values()]
      .map((row) => ({ ...row, plans: [...row.plans].sort((a, b) => (surveyOrder.get(a.survey) ?? Infinity) - (surveyOrder.get(b.survey) ?? Infinity)) }))
      .filter((row) => !needle || row.employee.toLowerCase().includes(needle) || row.plans.some((item) => item.survey.toLowerCase().includes(needle)))
  }, [plans, key, link, surveyOrder])

  if (!link) return <RefPage><RefHeader title={t("План опроса")} /></RefPage>
  const current = link
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const shown = rows.slice(start, start + pageSize)
  const selectMode = current.showCheckboxes
  const inSelection = selectMode && selected.length > 0
  const allTicked = shown.length > 0 && shown.every((row) => selected.includes(row.employee))

  async function savePeriod(period: string, entries: PlanEntry[]) {
    try {
      const response = await fetch("/api/survey-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, entries }),
      })
      if (!response.ok) {
        notify(t("Не удалось сохранить план"))
        return false
      }
      setPlans((all) => ({ ...all, [period]: entries }))
      return true
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
      return false
    }
  }

  async function copyTo(toMonth: number, toYear: number) {
    const target = periodKey(toMonth, toYear)
    const source = (plans[key] ?? []).filter((entry) => !selected.length || selected.includes(entry.employee))
    // The copied employees' plans replace theirs in the target month; the target's other employees keep theirs.
    const copied = new Set(source.map((entry) => entry.employee))
    const kept = (plans[target] ?? []).filter((entry) => !copied.has(entry.employee))
    if (await savePeriod(target, [...kept, ...source])) setDialog(null)
  }

  async function saveImport() {
    if (!importFile || importing) return
    setImporting(true)
    try {
      const entries = parseImportedRows(await readExcelRows(importFile))
      if (!entries.length) {
        notify(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const month = importMonth ?? current.month
      if (await savePeriod(periodKey(month, importYear), entries)) {
        setDialog(null)
        setImportFile(null)
      }
    } finally {
      setImporting(false)
    }
  }

  const toggle = (employee: string) => setSelected((list) => (list.includes(employee) ? list.filter((item) => item !== employee) : [...list, employee]))
  const pager = { pageSize, from: rows.length ? start + 1 : 0, to: Math.min(start + pageSize, rows.length), total: rows.length, page: safePage, pageCount }

  const actions = (
    <>
      <RefTip text={selected.length ? "" : t("Выберите хотя бы один сотрудник !")} side="left">
        <button
          type="button"
          aria-disabled={!selected.length}
          onClick={() => selected.length && setDialog("plans")}
          className={`inline-flex h-[30px] items-center gap-2 rounded-[5px] bg-[#1E4A9A] px-[16px] text-[13px] font-semibold text-white ${selected.length ? "hover:brightness-95" : "cursor-default"}`}
        >
          <svg viewBox="0 0 24 24" className="mb-[2px] h-[18px] w-[18px] fill-white" aria-hidden><path d={EDIT} /></svg>
          {t("Изменить планы")}
        </button>
      </RefTip>
      <RefTip text={t("Дублировать")} side="bottom">
        <button type="button" onClick={() => setDialog("copy")} aria-label={t("Дублировать")} className="ml-[10px] flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={COPY} /></svg>
        </button>
      </RefTip>
    </>
  )

  return (
    <RefPage>
      <RefHeader title={t("План опроса")}>
        <button type="button" onClick={() => { setImportMonth(current.month); setImportYear(current.year); setDialog("import") }} className="mr-[15px] flex h-[30px] items-center gap-2 rounded-[5px] bg-[#1E4A9A] px-4 text-[13px] font-semibold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="mb-[2px] h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.autorenew} /></svg>
          {t("Установить с EXCEL")}
        </button>
      </RefHeader>

      <RefCard>
        {inSelection ? (
          <div className="flex h-[50px] items-center bg-[#f2f5f8] px-[5px] text-[13px]">
            <strong className="pl-[5px] font-semibold">{t("Выбрано")}: {selected.length}</strong>
            <div className="ml-auto flex items-center text-[#5d6474]">
              <span className="mr-[10px] whitespace-nowrap">{pager.from} - {pager.to} {t("из")} {pager.total}</span>
              {actions}
              <RefTip text={t("Снять выделение")} side="left">
                <button type="button" aria-label={t("Снять выделение")} onClick={() => setSelected([])} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={MINUS_BOX} /></svg></button>
              </RefTip>
            </div>
          </div>
        ) : (
          <RefToolbar
            hideFilter
            leftSlot={
              <div className="relative -mt-[3px] h-[50px]">
                <div className="absolute left-0 top-[-2.5px] w-[190px]">
                  <SalaryMonthSelect bare value={current.month} onChange={(value) => navigate({ ...current, month: value ?? new Date().getMonth() })} />
                </div>
                <div className="absolute left-[200px] top-[-2.2px] w-[100px]">
                  <SalaryYearField bare lower value={current.year} onChange={(value) => value >= 2000 && value <= 2100 && navigate({ ...current, year: value }, true)} />
                </div>
              </div>
            }
            filterWidth={379}
            query={current.search}
            onQuery={(value) => navigate({ ...current, search: value }, true)}
            pageSize={pager.pageSize}
            onPageSize={(size) => { setPageSize(size); setPage(1) }}
            from={pager.from}
            to={pager.to}
            total={pager.total}
            page={pager.page}
            pageCount={pager.pageCount}
            onPage={setPage}
            icons={
              <RefTip text={t("Выбрать из списка")} side="left">
                <button type="button" aria-label={t("Выбрать из списка")} aria-pressed={selectMode} onClick={() => { navigate({ ...current, showCheckboxes: !selectMode }); setSelected([]) }} className="flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]" aria-hidden><path d={selectMode ? RI.eyeOff : RI.checklist} /></svg>
                </button>
              </RefTip>
            }
            extra={actions}
          />
        )}
        <RefTable
          cols="minmax(0,1fr) minmax(0,1fr)"
          heads={[
            selectMode ? (
              <div key="employee" className="-ml-[8px] flex items-center gap-[4px]">
                {/* The reference's select-all: a dotted square, ✓✓ once every row of the page is ticked. */}
                <button
                  type="button"
                  aria-label={t("Выбрать все")}
                  onClick={() => setSelected((list) => (allTicked ? list.filter((item) => !shown.some((row) => row.employee === item)) : [...new Set([...list, ...shown.map((row) => row.employee)])]))}
                  className="flex h-6 w-6 items-center justify-center"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden><path d={allTicked ? DONE_ALL : SELECT_ALL} /></svg>
                </button>
                {t("Сотрудник")}
              </div>
            ) : (
              t("Сотрудник")
            ),
            t("Опрос"),
          ]}
          rows={shown}
          rowKey={(row) => row.employee}
          empty={<div className="-my-16"><RefNothingFound /></div>}
          render={(row) => [
            selectMode ? (
              <div key="employee" className="-ml-[8px] flex items-center gap-[9px]">
                <Box checked={selected.includes(row.employee)} label={row.employee} onClick={() => toggle(row.employee)} />
                {row.employee}
              </div>
            ) : (
              row.employee
            ),
            <div key="plans" className="flex min-h-[50px] flex-wrap items-center">
              {row.plans.map((item, index) => <PlanChip key={`${item.survey}-${index}`} survey={item.survey} plan={item.plan} />)}
            </div>,
          ]}
        />
      </RefCard>

      {dialog === "plans" && (
        <PlansDialog
          month={current.month}
          year={current.year}
          employees={selected}
          plans={plans[key] ?? []}
          surveys={surveys}
          onClose={() => setDialog(null)}
          onSave={async (entries) => {
            const ok = await savePeriod(key, entries)
            if (ok) setSelected([])
            return ok
          }}
        />
      )}
      {dialog === "copy" && <CopyDialog month={current.month} year={current.year} onClose={() => setDialog(null)} onSave={copyTo} />}
      {dialog === "import" && (
        <RefImportDialog
          file={importFile}
          onFile={setImportFile}
          onTemplate={() => downloadExcelTable("plan-oprosa", [[t("Сотрудник"), t("Опрос"), t("План")]])}
          onSave={() => void saveImport()}
          onClose={() => { setDialog(null); setImportFile(null) }}
          saving={importing}
          bigTitle
          top={
            <div className="mb-[15px]">
              <SalaryMonthSelect rs className="-mt-[5px]" value={importMonth} onChange={setImportMonth} />
              <SalaryYearField rs lower className="mt-[20px]" value={importYear} onChange={setImportYear} />
            </div>
          }
        />
      )}
    </RefPage>
  )
}
