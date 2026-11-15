"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ListFilter } from "lucide-react"
import { useRouter } from "next/navigation"
import { RI, RefHeader } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { SortArrows, nextSort, sortBy, type SortState } from "@/components/ref/sort-arrows"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// «Выполнения KPI» (Linko's #/widget-kpi/?toggleTab=kpi&month=M&year=Y[&kpi=<id>]): the KPIs of the month on the
// left (fact, % of the plan, progress), the employees' rows of the chosen KPI (or of all of them) on the right, and
// «Перерасчет», which recomputes the month (POST /api/salary-records/recalculate, the same as Linko's salary
// calculation). The numbers are the stored snapshot of the last recalculation (lib/kpi-performance-repo.ts).

type KpiCard = {
  id: number
  name: string
  planType: string
  planAmount: number
  factAmount: number | null
  factPercent: number | null
  forecastAmount: number | null
  forecastPercent: number | null
  bonusAmount: number | null
}

type KpiRow = {
  userId: number
  firstName: string
  secondName: string
  kpiId: number
  kpiName: string
  planType: string
  plan: number
  level: number
  fact: number | null
  bonus: number | null
  forecast: number | null
  factPercent: number | null
  forecastPercent: number | null
  dailyPlan: number | null
  dailyFact: number | null
  dailyFactPercent: number | null
}

type KpiData = { month: number; year: number; lastDate: string | null; cards: KpiCard[]; rows: KpiRow[] }

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const SHADOW = "shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
const NONE = "—"

/** Linko's number format: spaces between thousands, a comma and up to three decimals. */
const fmt = (value: number | null | undefined) => (value === null || value === undefined ? NONE : formatMoney(value, 3))

/** Linko's percent badge: up to 2 % red, above 70 % green, blue between. */
function PercentBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[#999]">{NONE}</span>
  const tone = value <= 2 ? "bg-[#ffdede] text-[#FF5E5E]" : value > 70 ? "bg-[#daf5e6] text-[#3AC977]" : "bg-[#e8f5ff] text-[#0D99FF]"
  return <span className={`inline-flex w-min items-center whitespace-nowrap rounded-[0.25rem] px-[12px] py-[5px] ${tone}`}>{Math.round(value)}%</span>
}

/** "2026-01-26T11:31:36" → "26.01.2026 11:31". */
function stamp(value: string | null) {
  if (!value) return ""
  const [day, time = ""] = value.split("T")
  const [y, m, d] = day.split("-")
  return `${d}.${m}.${y} ${time.slice(0, 5)}`.trim()
}

type SortKey = "user" | "kpi" | "dailyFact" | "dailyFactPercent" | "plan" | "fact" | "factPercent" | "forecast" | "bonus"

const sortValue = (row: KpiRow, key: SortKey): string | number | null => {
  switch (key) {
    case "user":
      return `${row.firstName} ${row.secondName}`
    case "kpi":
      return row.kpiName
    case "dailyFact":
      return row.dailyFact
    case "dailyFactPercent":
      return row.dailyFactPercent
    case "plan":
      return row.plan
    case "fact":
      return row.fact
    case "factPercent":
      return row.factPercent
    case "forecast":
      return row.forecast
    case "bonus":
      return row.bonus
  }
}

/** variant "page" is the standalone report of the analytics menu (#/widget-kpi); "tab" is the dashboard KPI tab. */
export function KpiPerformanceView({ variant = "page" }: { variant?: "page" | "tab" }) {
  const { t } = useLanguage()
  const router = useRouter()
  const today = new Date()
  // The period and the chosen KPI live in the address, like Linko's ?month=&year=&kpi=.
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [year, setYear] = useState(today.getFullYear())
  const [kpi, setKpi] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<KpiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [sort, setSort] = useState<SortState<SortKey>>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const m = Number(params.get("month"))
    const y = Number(params.get("year"))
    const k = Number(params.get("kpi"))
    if (Number.isInteger(m) && m >= 1 && m <= 12) setMonth(m)
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) setYear(y)
    if (Number.isInteger(k) && k > 0) setKpi(k)
    if (params.get("openKpiTabFilterDialog") === "true") setShowFilter(true)
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const url = new URL(window.location.href)
    url.searchParams.set("month", String(month))
    url.searchParams.set("year", String(year))
    if (kpi) url.searchParams.set("kpi", String(kpi))
    else url.searchParams.delete("kpi")
    if (showFilter) url.searchParams.set("openKpiTabFilterDialog", "true")
    else url.searchParams.delete("openKpiTabFilterDialog")
    if (url.search !== window.location.search) window.history.replaceState(window.history.state, "", url.pathname + url.search)
  }, [ready, month, year, kpi, showFilter])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/kpi-performance?month=${month}&year=${year}`)
      if (!response.ok) throw new Error(String(response.status))
      setData((await response.json()) as KpiData)
    } catch {
      setData(null)
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setLoading(false)
    }
  }, [month, year, t])

  useEffect(() => {
    if (ready) void load()
  }, [ready, load])

  async function recalc() {
    if (recalculating) return
    setRecalculating(true)
    try {
      const response = await fetch("/api/salary-records/recalculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, year }) })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        notify(t(body?.error ?? "Не удалось пересчитать KPI"))
        return
      }
      await load()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setRecalculating(false)
    }
  }

  const cards = data?.cards ?? []
  const selected = kpi ? cards.find((card) => card.id === kpi) ?? null : null
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    return sortBy(kpi ? all.filter((row) => row.kpiId === kpi) : all, sort, sortValue)
  }, [data, kpi, sort])

  function downloadExcel() {
    // Linko's KPI file: the same columns as its excelTitles (Уровень twice).
    const head = [t("Агент"), "KPI", t("Уровень"), t("Уровень"), t("План"), t("Факт"), "%", t("План"), t("Факт"), "%"]
    const body = rows.map((row) => [
      `${row.firstName} ${row.secondName}`.trim(),
      row.kpiName,
      row.fact === null ? "" : row.level,
      row.fact === null ? "" : row.level,
      row.dailyPlan ?? "",
      row.dailyFact ?? "",
      row.dailyFactPercent === null ? "" : `${Math.round(row.dailyFactPercent)} %`,
      row.plan,
      row.fact ?? "",
      row.factPercent === null ? "" : `${Math.round(row.factPercent)} %`,
    ])
    downloadExcelTable("KPI", [head, ...body])
  }

  const actionButtons = (
    <>
      <button type="button" onClick={() => router.push("/analytics/kpi-tasks")} className="h-[30px] rounded-[3px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("KPI задачи")}</button>
      <button type="button" onClick={() => router.push("/analytics/salary-planning")} className="h-[30px] rounded-[3px] bg-[#1E4A9A] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("Зарплата и установка планов")}</button>
      <button type="button" onClick={() => router.push("/analytics/visits-by-day")} className="h-[30px] rounded-[3px] bg-[#fa8072] px-4 text-[13px] font-semibold text-white hover:brightness-95">{t("Посещения")}</button>
    </>
  )
  const standalone = variant === "page"
  const sortHead = (key: SortKey, label: string, extra = "") => (
    <th className={`h-[37px] border-b border-r border-[#efefef] px-[18px] text-left font-semibold ${extra}`}>
      <button type="button" onClick={() => setSort((current) => nextSort(current, key))} className="inline-flex items-center whitespace-nowrap">
        {label}
        <SortArrows dir={sort?.key === key ? sort.dir : null} />
      </button>
    </th>
  )

  return (
    <ReportPage>
      {standalone ? (
        <>
          <div className="pl-[30px] pr-[36px]">
            <RefHeader title="">
              <div className="flex gap-[22px]">{actionButtons}</div>
            </RefHeader>
          </div>
          <section className={`mx-[28px] flex h-[77px] gap-[15px] bg-white px-[30px] pt-[12px] ${SHADOW}`}>
            <div className="w-[269px] [&>label>span:first-child]:!top-px">
              <ReportSelectField label="Месяц" value={MONTHS[month - 1]} onChange={(value) => value && setMonth(MONTHS.indexOf(value) + 1)} options={MONTHS} clearable={false} />
            </div>
            <div className="w-[269px] [&>label>span:first-child]:!top-px">
              <ReportSelectField label="Год" value={String(year)} onChange={(value) => value && setYear(Number(value))} options={["2024", "2025", "2026", "2027"]} clearable={false} />
            </div>
          </section>
        </>
      ) : (
        <>
          <WidgetHeader active="KPI" />
          <WidgetUserCard showPeriods={false}>
            <div className="ml-auto mr-[23px] flex gap-[18px]">
              {actionButtons}
              <button type="button" onClick={() => setShowFilter(true)} className="flex h-[30px] items-center gap-[6px] rounded-[3px] bg-[#1E4A9A] px-4 text-[13px] font-semibold text-white hover:brightness-95">
                <ListFilter className="h-4 w-4" />
                {t("Показать фильтр")}
              </button>
            </div>
          </WidgetUserCard>
        </>
      )}
      {showFilter && !standalone && (
        <KpiFilterDialog
          onClose={() => setShowFilter(false)}
          onApply={(nextMonth, nextYear) => {
            if (nextMonth) setMonth(MONTHS.indexOf(nextMonth) + 1)
            if (nextYear) setYear(Number(nextYear))
            setShowFilter(false)
          }}
        />
      )}
      <section className={`${standalone ? "mx-[28px] mt-[27px]" : "mx-[30px] mt-[10px]"} grid gap-x-[28px] pb-[28px] md:grid-cols-[250px_minmax(0,1fr)]`}>
        <div>
          <div className={`${standalone ? "mb-[3px]" : "mb-[10px]"} flex h-[30px] items-center px-[5px]`}>
            <h2 className="text-[13px] font-semibold leading-4">KPI</h2>
          </div>
          <div className={`min-h-[720px] bg-white ${SHADOW}`}>
            <div className="border border-b-0 border-[#d9dde1]">
              <button
                type="button"
                aria-current={kpi === null}
                onClick={() => setKpi(null)}
                className={`block w-full border-b border-[#efefef] px-[17px] pb-[10px] pt-[17px] text-left text-[13px] text-[#2c2c2c] ${kpi === null ? "bg-[#f2f5f8]" : "bg-white"}`}
              >
                {t("Общий объем")} <span data-no-translate>{"во всех кпэ"}</span>
              </button>
              {loading && !data ? (
                <div className="flex h-[200px] items-center justify-center text-[#999]">…</div>
              ) : (
                cards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    aria-current={kpi === card.id}
                    onClick={() => setKpi(card.id)}
                    className={`flex w-full flex-col justify-between border-b border-[#efefef] px-[17px] pb-[10px] pt-[17px] text-left ${kpi === card.id ? "bg-[#f2f5f8]" : "bg-white"}`}
                  >
                    <span className="flex flex-col gap-[5px]">
                      <span className="text-[13px] font-normal text-[#2c2c2c]" data-no-translate>{card.name}</span>
                      <span className={`text-[17px] font-semibold ${card.factAmount === null || card.factAmount === 0 ? "text-black" : card.factAmount > 0 ? "text-[#48a34b]" : "text-[#e57373]"}`}>{fmt(card.factAmount)}</span>
                    </span>
                    <span className="mt-[5px] block w-full">
                      <span className="flex items-center justify-between text-[13px] text-[#888]">
                        <span>{t("План")}</span>
                        <span>{card.factPercent === null ? NONE : `${fmt(card.factPercent)} %`} / {fmt(card.planAmount)}</span>
                      </span>
                      <span className="mt-[5px] block h-[0.313rem] overflow-hidden rounded-[4px] bg-[#e6eaee]">
                        <span className="block h-full bg-[#0d99ff]" style={{ width: `${Math.max(0, card.factPercent ?? 0)}%` }} />
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <div className={`${standalone ? "mb-[3px]" : "mb-[10px]"} flex h-[30px] items-center justify-between px-[5px]`}>
            <h2 className="text-[13px] font-semibold leading-4" data-no-translate={selected ? true : undefined}>{selected ? selected.name : t("Общий объем")}</h2>
            <div className="-mr-[5px] flex items-center gap-[10px] text-[13px] font-semibold">
              {standalone ? (
                <button type="button" onClick={downloadExcel} aria-label={t("Скачать")} className="mr-[20px] flex h-6 w-6 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
                </button>
              ) : (
                <button type="button" onClick={downloadExcel} className="flex h-[30px] items-center gap-[6px] rounded-[3px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d={RI.chart ?? RI.download} /></svg>
                  {t("Скачать")}
                </button>
              )}
              <span>
                {t("данные за")} {stamp(data?.lastDate ?? null)}
              </span>
              <button type="button" onClick={() => void recalc()} disabled={recalculating} className={`ml-[5px] text-[#81c784] ${recalculating ? "opacity-60" : ""}`}>
                {t("Перерасчет")}
              </button>
            </div>
          </div>
          <div className={`overflow-x-auto bg-white ${SHADOW}`}>
            {!rows.length ? (
              <ReportEmpty className="pb-[46px] pt-[54px]" text={loading ? "…" : t("По вашему запросу ничего не найдено...")} />
            ) : (
              <table data-no-sort className={`w-full border-collapse text-[13px] text-[#333] ${loading || recalculating ? "opacity-60" : ""}`}>
                <thead>
                  <tr>
                    <th rowSpan={2} className="h-[74px] border-b border-r border-[#efefef] px-[18px] text-left font-semibold">
                      <button type="button" onClick={() => setSort((current) => nextSort(current, "user"))} className="inline-flex items-center whitespace-nowrap">
                        {t("Агент")}
                        <SortArrows dir={sort?.key === "user" ? sort.dir : null} />
                      </button>
                    </th>
                    <th rowSpan={2} className="border-b border-r border-[#efefef] px-[18px] text-left font-semibold">
                      <button type="button" onClick={() => setSort((current) => nextSort(current, "kpi"))} className="inline-flex items-center whitespace-nowrap">
                        {kpi ? t("Уровень") : "KPI"}
                        <SortArrows dir={sort?.key === "kpi" ? sort.dir : null} />
                      </button>
                    </th>
                    <th colSpan={3} className="h-[37px] border-b border-r border-[#efefef] text-center font-semibold">{t("Сегодня")}</th>
                    <th colSpan={5} className="border-b border-[#efefef] text-center font-semibold">{t("Месяц")}</th>
                  </tr>
                  <tr>
                    <th className="h-[37px] border-b border-r border-[#efefef] px-[18px] text-left font-semibold">{t("План")}</th>
                    {sortHead("dailyFact", t("Факт"))}
                    {sortHead("dailyFactPercent", "%")}
                    {sortHead("plan", t("План"))}
                    {sortHead("fact", t("Факт."))}
                    {sortHead("factPercent", "%")}
                    {sortHead("forecast", t("Прогноз"))}
                    {sortHead("bonus", t("Бонус"), "border-r-0")}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const computed = row.fact !== null
                    return (
                      <tr key={`${row.userId}:${row.kpiId}`} className="border-b border-[#efefef] hover:bg-[#f9fafb]" title={computed ? undefined : t("Факт этого типа KPI не рассчитывается")}>
                        <td className="h-[46px] border-r border-[#efefef] px-[18px]" data-no-translate>{`${row.firstName} ${row.secondName}`.trim()}</td>
                        <td className="border-r border-[#efefef] px-[18px]" data-no-translate>{kpi ? (computed ? row.level : NONE) : row.kpiName}</td>
                        <td className="border-r border-[#efefef] px-[18px]">{fmt(row.dailyPlan)}</td>
                        <td className="border-r border-[#efefef] px-[18px]">{fmt(row.dailyFact)}</td>
                        <td className="border-r border-[#efefef] px-[18px]"><PercentBadge value={row.dailyFactPercent} /></td>
                        <td className="border-r border-[#efefef] px-[18px]">{fmt(row.plan)}</td>
                        <td className="border-r border-[#efefef] px-[18px]">{fmt(row.fact)}</td>
                        <td className="border-r border-[#efefef] px-[18px]"><PercentBadge value={row.factPercent} /></td>
                        <td className="border-r border-[#efefef] px-[18px]">{computed ? `${fmt(row.forecast)} (${fmt(row.forecastPercent)} %)` : NONE}</td>
                        <td className="px-[18px]">{fmt(row.bonus)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </ReportPage>
  )
}

function KpiFilterDialog({ onClose, onApply }: { onClose: () => void; onApply: (month: string, year: string) => void }) {
  const { t } = useLanguage()
  const [month, setMonth] = useState("")
  const [year, setYear] = useState("")
  const [organization, setOrganization] = useState("")
  const [branch, setBranch] = useState("")
  const [organizations, setOrganizations] = useState<string[]>([])
  const [branches, setBranches] = useState<string[]>([])

  useEffect(() => {
    const names = (url: string, set: (list: string[]) => void) =>
      fetch(url)
        .then((response) => (response.ok ? response.json() : []))
        .then((rows: Array<{ name?: string }>) => set([...new Set(rows.map((row) => row.name ?? "").filter(Boolean))]))
        .catch(() => {})
    void names("/api/organizations", setOrganizations)
    void names("/api/branches", setBranches)
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="absolute left-[30px] top-[110px] z-[60] h-[186px] w-[1440px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="absolute left-[20px] top-[25px] text-[15px] leading-[18px] text-[#666]">{t("Фильтр")}</div>
      <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[20px] top-[22px] h-6 w-6">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.59-13L12 10.59 8.41 7 7 8.41 10.59 12 7 15.59 8.41 17 12 13.41 15.59 17 17 15.59 13.41 12 17 8.41z" /></svg>
      </button>
      <div className="absolute left-[20px] right-[20px] top-[65px] grid grid-cols-4 gap-x-[13px]">
        <ReportSelectField label="Месяц" value={month} onChange={setMonth} options={MONTHS} />
        <ReportSelectField label="Год" value={year} onChange={setYear} options={["2024", "2025", "2026", "2027"]} />
        <ReportSelectField label="Организации" value={organization} onChange={setOrganization} options={organizations} />
        <ReportSelectField label="Филиал" value={branch} onChange={setBranch} options={branches} />
      </div>
      <button type="button" onClick={() => onApply(month, year)} className="absolute left-[20px] top-[140px] h-[36px] rounded-[4px] bg-[#5d6474] px-4 text-[13px] font-semibold uppercase text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-110">
        {t("Применить")}
      </button>
    </div>
  )
}
