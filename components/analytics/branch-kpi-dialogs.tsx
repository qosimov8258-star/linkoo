"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"

import {
  BRANCH_KPI_API,
  fetchJson,
  KpiDialogAction,
  KpiDialogFrame,
  KpiMonthYearFilter,
  sendJson,
  useMonthName,
} from "@/components/analytics/branch-kpi-shared"
import {
  BRANCH_KPI_MONTHS,
  type BranchKpiIndicator,
  type BranchKpiListRow,
} from "@/lib/branch-kpi-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of "KPI план филиалов":
// - "Изменить план филиалов на <Месяц> <Год>" (demo 5083): step 1 "Все активные KPI" /
//   "Выбранные KPI" → "Далее"; step 2 full screen: Месяц/Год + grid branch × KPI ("Количество").
// - "Дублировать с месяца <Месяц> <Год>" (demo 5082): Месяц + Год → copy.

function parsePlan(text: string): number | null {
  const normalized = text.replace(/\s/g, "").replace(",", ".")
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : NaN
}

function cleanNumberInput(text: string): string {
  return text.replace(/[^\d.,]/g, "")
}

export function useKpiIndicators(version = 0) {
  const [indicators, setIndicators] = useState<BranchKpiIndicator[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    fetchJson<BranchKpiIndicator[]>(`${BRANCH_KPI_API}/indicators`, { signal: controller.signal })
      .then((list) => {
        setIndicators(list)
        setError("")
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [version])
  return { indicators, error }
}

type Draft = Record<number, Record<number, string>>

function draftFromRows(rows: BranchKpiListRow[]): Draft {
  return Object.fromEntries(rows.map((row) => [row.id, Object.fromEntries(row.performanceIndicators.map((item) => [item.id, String(item.plan)]))]))
}

export function BranchKpiBulkDialog({
  month,
  year,
  branches,
  onPeriodChange,
  onClose,
  onSaved,
}: {
  month: number
  year: number
  /** Selected rows of the current list page (reloaded when the period changes). */
  branches: BranchKpiListRow[]
  onPeriodChange: (next: { month: number; year: number }) => void
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useLanguage()
  const monthName = useMonthName()
  const { indicators, error: loadError } = useKpiIndicators()
  const [next, setNext] = useState(false)
  const [kpiType, setKpiType] = useState<"allKpi" | "selectedKpi">("allKpi")
  const [chosen, setChosen] = useState<number[]>([])
  const [kpiSearch, setKpiSearch] = useState("")
  const [draft, setDraft] = useState<{ key: string; values: Draft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const active = useMemo(() => (indicators ?? []).filter((item) => item.active), [indicators])
  const kpis = kpiType === "allKpi" ? active : active.filter((item) => chosen.includes(item.id))
  const title = `${t("Изменить план филиалов")} ${t("на")} ${monthName(month)}  ${year}`

  // Demo withPropsOnChange(next): (re)initialise the grid from the list plans of the shown month.
  const periodKey = `${year}-${month}`
  const rowsReady = branches.length > 0 && branches.every((row) => row.month === month && row.year === year)
  if (next && rowsReady && draft?.key !== periodKey) setDraft({ key: periodKey, values: draftFromRows(branches) })

  const setCell = (branchId: number, kpiId: number, text: string) =>
    setDraft((current) => {
      const values = current?.values ?? {}
      return { key: current?.key ?? periodKey, values: { ...values, [branchId]: { ...(values[branchId] ?? {}), [kpiId]: cleanNumberInput(text) } } }
    })

  const save = async () => {
    if (!draft || draft.key !== periodKey) return
    const payload = {
      month,
      year,
      indicators: kpis.map((item) => item.id),
      branches: branches.map((row) => ({
        branch: row.id,
        performanceIndicators: kpis.flatMap((item) => {
          const plan = parsePlan(draft.values[row.id]?.[item.id] ?? "")
          return plan === null ? [] : [{ performanceIndicator: item.id, plan }]
        }),
      })),
    }
    if (payload.branches.some((row) => row.performanceIndicators.some((item) => Number.isNaN(item.plan)))) {
      setError(t("Введите корректное число"))
      return
    }
    setSaving(true)
    setError("")
    try {
      await sendJson(`${BRANCH_KPI_API}/bulk`, "POST", payload)
      onSaved(t("Успешно обновлено"))
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const goNext = () => {
    if (!kpis.length) {
      setError(t("Выберите KPI"))
      return
    }
    setError("")
    setNext(true)
  }

  if (!next) {
    const filtered = active.filter((item) => item.name.toLowerCase().includes(kpiSearch.trim().toLowerCase()))
    return (
      <KpiDialogFrame title={title} width={600} onClose={onClose} footerPadRight={17} footer={<KpiDialogAction label={t("Далее")} onClick={goNext} disabled={!indicators} />}>
        <div className="min-h-[214px] space-y-4 px-[30px] pt-[27px] text-[13px] text-[#333]">
          {loadError && <p className="text-[#e57373]">{t(loadError)}</p>}
          {!indicators && !loadError && <p className="text-[#999]">{t("Загрузка...")}</p>}
          {indicators && !active.length && (
            <p className="rounded bg-[#f2f5f8] px-4 py-3 text-[#666]">
              {t("Нет KPI")}.{" "}
              <Link href="/analytics/kpi-tasks" className="font-semibold text-[#4f71dc] hover:underline">
                {t("KPI задачи")}
              </Link>
            </p>
          )}
          {indicators && active.length > 0 && (
            <>
              <div className="flex items-center">
                {(["allKpi", "selectedKpi"] as const).map((value) => (
                  <label key={value} className="flex w-[270px] cursor-pointer items-center gap-[16px]">
                    <input type="radio" name="kpi-type" checked={kpiType === value} onChange={() => setKpiType(value)} className="peer sr-only" />
                    <svg viewBox="0 0 24 24" className={`relative -top-[2px] h-6 w-6 shrink-0 ${kpiType === value ? "fill-[#5d6474]" : "fill-[#333]"}`}><path d={kpiType === value ? "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" : "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"} /></svg>
                    <span className="relative -top-px text-black">{t(value === "allKpi" ? "Все активные KPI" : "Выбранные KPI")}</span>
                  </label>
                ))}
              </div>
              {kpiType === "selectedKpi" && (
                <div>
                  <input
                    value={kpiSearch}
                    onChange={(event) => setKpiSearch(event.target.value)}
                    placeholder="KPI"
                    aria-label="KPI"
                    className="h-9 w-full border-b border-[#e0e0e0] text-[13px] outline-none focus:border-[#4f71dc]"
                  />
                  <div className="mt-2 max-h-[260px] overflow-y-auto">
                    {filtered.map((item) => (
                      <label key={item.id} className="flex cursor-pointer items-center gap-3 border-b border-[#f2f5f8] py-2">
                        <input
                          type="checkbox"
                          checked={chosen.includes(item.id)}
                          onChange={() => setChosen((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))}
                          className="h-4 w-4 accent-[#4f71dc]"
                        />
                        <span className="font-semibold">{item.name}</span>
                        <span className="ml-auto truncate text-[12px] text-[#999]">{t(item.planType)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {error && <p className="text-[#e57373]">{error}</p>}
        </div>
      </KpiDialogFrame>
    )
  }

  const values = draft?.key === periodKey ? draft.values : null
  return (
    <KpiDialogFrame
      fullScreen
      onClose={() => setNext(false)}
      title={
        <>
          <button type="button" onClick={() => setNext(false)} aria-label={t("Назад")} className="ml-[4px] -mr-[2px] flex h-[38px] w-[38px] items-center justify-center text-[#666]">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <span className="truncate">{title}</span>
        </>
      }
      titleActions={<KpiDialogAction label={saving ? t("Сохранение...") : t("Сохранить")} onClick={() => void save()} disabled={saving || !values} />}
    >
      <div className="flex shrink-0 flex-wrap items-end gap-6 px-[15px] pb-2 pt-[10px]">
        <KpiMonthYearFilter dialog month={month} year={year} onChange={onPeriodChange} monthWidth={200} yearWidth={151} gap={10} />
        {error && <span className="pb-1 text-[13px] text-[#e57373]">{error}</span>}
      </div>
      {!values ? (
        <div className="min-h-0 flex-1 overflow-auto px-[10px] pb-10 text-[13px] text-[#333]">
          <div className="py-16 text-center text-[#999]">{branches.length ? t("Загрузка...") : t("Выберите хотя бы один сотрудник !")}</div>
        </div>
      ) : (
        <BranchKpiPlanGrid branches={branches} kpis={kpis} values={values} onCell={setCell} />
      )}
    </KpiDialogFrame>
  )
}

/** Step 2 grid: branches × KPI columns (250px each); the reference scrolls the columns while the pointer rests on the "»" / "«" discs. */
function BranchKpiPlanGrid({
  branches,
  kpis,
  values,
  onCell,
}: {
  branches: BranchKpiListRow[]
  kpis: BranchKpiIndicator[]
  values: Draft
  onCell: (branchId: number, kpiId: number, text: string) => void
}) {
  const { t } = useLanguage()
  const scroller = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const stop = () => {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
  }
  const start = (direction: 1 | -1) => {
    stop()
    timer.current = window.setInterval(() => {
      const element = scroller.current
      if (!element) return stop()
      element.scrollLeft += 90 * direction
      setScrolled(element.scrollLeft > 0)
      if (direction === -1 && element.scrollLeft <= 0) stop()
    }, 100)
  }
  useEffect(() => stop, [])
  const disc = "fixed top-[265px] z-[12] h-[60px] w-[40px] cursor-pointer bg-black/[0.31] opacity-80 transition-all duration-300"
  const chevron = "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
  const cell = "flex h-[50px] w-[250px] shrink-0 items-center border-b border-[#f2f5f8]"
  return (
    <div className="relative min-h-0 flex-1 text-[13px] text-[#333]">
      <div ref={scroller} onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)} className="h-full overflow-x-hidden overflow-y-auto">
        <div className="w-max min-w-full">
          <div className="flex font-semibold leading-[16.3px]">
            <div className={`${cell} pl-[10px]`}>{t("Филиал")}</div>
            {kpis.map((item) => (
              <div key={item.id} className={`${cell} px-[8px]`}>
                <span className="line-clamp-2">{item.name}</span>
              </div>
            ))}
          </div>
          {branches.map((row) => (
            <div key={row.id} className="flex hover:bg-[#f2f5f8]">
              <div className={`${cell} pl-[10px] font-semibold`}>{row.name}</div>
              {kpis.map((item) => {
                const value = values[row.id]?.[item.id] ?? ""
                return (
                  <div key={item.id} className={`${cell} px-[8px]`}>
                    <div className="group relative h-[45px] w-[234px] translate-y-[3px]">
                      {value !== "" && <span className="pointer-events-none absolute -top-[6px] left-0 origin-top-left scale-75 text-[13px] font-semibold leading-[18px] text-black">{t("Количество")}</span>}
                      <input
                        value={value}
                        onChange={(event) => onCell(row.id, item.id, event.target.value)}
                        placeholder={t("Количество")}
                        aria-label={`${row.name} · ${item.name}`}
                        inputMode="decimal"
                        className="peer h-[45px] w-full bg-transparent pb-[8px] pt-[8px] text-[13px] font-semibold leading-[18px] outline-none placeholder:font-semibold placeholder:text-black"
                      />
                      <span className="pointer-events-none absolute inset-x-0 top-[36.5px] h-px bg-[#e0e0e0] peer-focus:bg-[#4f71dc]" />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {scrolled && (
        <div
          onMouseEnter={() => start(-1)}
          onMouseLeave={stop}
          className={`${disc} left-0 rounded-r-[60px] hover:scale-90`}
        >
          <svg viewBox="0 0 24 24" className="absolute left-[6px] top-[16.4px] h-6 w-6 fill-white"><path d={chevron} /></svg>
          <svg viewBox="0 0 24 24" className="absolute left-[13px] top-[16.4px] h-6 w-6 fill-white"><path d={chevron} /></svg>
        </div>
      )}
      <div
        onMouseEnter={() => start(1)}
        onMouseLeave={stop}
        className={`${disc} right-0 rotate-180 rounded-r-[60px] hover:rotate-180 hover:scale-90`}
      >
        <svg viewBox="0 0 24 24" className="absolute left-[6px] top-[16.4px] h-6 w-6 fill-white"><path d={chevron} /></svg>
        <svg viewBox="0 0 24 24" className="absolute left-[13px] top-[16.4px] h-6 w-6 fill-white"><path d={chevron} /></svg>
      </div>
    </div>
  )
}

export function BranchKpiDuplicateDialog({
  month,
  year,
  selected,
  onClose,
  onSaved,
}: {
  month: number
  year: number
  /** Selected branch ids (empty = every branch, demo is_all). */
  selected: number[]
  onClose: () => void
  onSaved: (message: string, target: { month: number; year: number }) => void
}) {
  const { t } = useLanguage()
  const monthName = useMonthName()
  const now = new Date()
  const [toMonth, setToMonth] = useState(now.getMonth() + 1)
  const [toYear, setToYear] = useState(String(now.getFullYear()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    const yearValue = Number(toYear)
    if (!Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100) {
      setError(t("Введите корректный год"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const result = await sendJson<{ copied: number }>(`${BRANCH_KPI_API}/copy`, "POST", {
        branches: selected,
        isAll: !selected.length,
        fromMonth: month,
        fromYear: year,
        toMonth,
        toYear: yearValue,
      })
      onSaved(result.copied ? `${t("Скопировано филиалов")}: ${result.copied}` : t("Нет планов для копирования"), { month: toMonth, year: yearValue })
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <KpiDialogFrame
      title={`${t("Дублировать с месяца")} ${monthName(month)}  ${year}`}
      width={450}
      onClose={onClose}
      footerInset={30}
      footer={<KpiDialogAction label={saving ? t("Сохранение...") : t("Сохранить")} onClick={() => void save()} disabled={saving} />}
    >
      <form
        className="min-h-[243px] px-[30px] text-[13px]"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="relative block h-[58px] border-b border-[#e0e0e0] focus-within:border-[#4f71dc]">
          <span className="absolute left-0 top-[10px] text-[10px] font-bold leading-3 text-black">{t("Месяц")}</span>
          <span className="absolute left-0 top-[36px] text-[13px] font-semibold leading-[18px] text-[#333]">{t(BRANCH_KPI_MONTHS[toMonth - 1] ?? "")}</span>
          <select value={toMonth} onChange={(event) => setToMonth(Number(event.target.value))} aria-label={t("Месяц")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
            {BRANCH_KPI_MONTHS.map((name, index) => (
              <option key={name} value={index + 1}>
                {t(name)}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-[28.7px] top-[36.9px] text-[18px] leading-[18px] text-[#999]">×</span>
          <svg viewBox="0 0 10 7" className="pointer-events-none absolute right-[8px] top-[43px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
        </label>
        <label className="relative mt-[23px] block h-[49px] border-b border-[#e0e0e0] focus-within:border-[#4f71dc]">
          <span className="absolute left-0 top-[4.5px] text-[10px] font-bold leading-3 text-black">{t("Год")}</span>
          <input
            value={toYear}
            inputMode="numeric"
            maxLength={4}
            onChange={(event) => setToYear(event.target.value.replace(/\D/g, ""))}
            className="absolute inset-x-0 bottom-0 h-[27px] bg-transparent text-[13px] font-semibold text-[#333] outline-none"
          />
        </label>
        {selected.length > 0 && <p className="mt-3 text-[12px] text-[#999]">{`${t("Выбрано")}: ${selected.length}`}</p>}
        {error && <p className="mt-3 text-[#e57373]">{error}</p>}
      </form>
    </KpiDialogFrame>
  )
}
