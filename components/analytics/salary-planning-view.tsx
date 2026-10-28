"use client"

import Image from "next/image"
import { useEffect, useMemo, useRef, useState } from "react"
import { FilterSelect, RI, RefButton, RefCard, RefHeader, RefImportDialog, RefPage, RefTabs } from "@/components/ref/list-kit"
import { REF_PAGE_SIZES, RefPager } from "@/components/ref/pager-controls"
import { RefTip } from "@/components/ref/ref-tip"
import { SalaryAddDialog } from "@/components/analytics/salary-add-dialog"
import { SalaryCopyDialog } from "@/components/analytics/salary-copy-dialog"
import { SalaryMonthSelect, SalaryYearField } from "@/components/analytics/salary-fields"
import { SalaryPlansDialog, type PlanSavePayload, type SalaryKpi } from "@/components/analytics/salary-plans-dialog"

import { downloadExcelTable } from "@/lib/excel-export"
import { buildKpiSheet, type KpiSheetStats } from "@/lib/salary-kpi-sheet"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"
import { refDateTime } from "@/lib/ref-date"

type Indicator = { id: number; name: string; plan: number; planType: string }
type CurrencyTotal = { name: string; totalBonus: number; totalSalary: number }
type SalaryRecord = {
  id: number
  userId: number
  name: string
  firstName: string
  secondName: string
  position: string
  month: number
  year: number
  salary: number
  currency: string
  currencies: CurrencyTotal[]
  totalBonus: number
  totalSalary: number
  isApproved: boolean
  indicators: Indicator[]
}
type ListResult = { count: number; results: SalaryRecord[]; lastDate: string | null }
type KpiTask = { id: number; name: string; planType: string; active: boolean; tillDate?: string | null }
type Employee = { id: number; login: string; firstName: string; lastName: string; active?: boolean }

const TABS = ["Не зачислено", "Зачислено", "Все"]
const TAB_PARAM: Record<string, string> = { "Не зачислено": "false", "Зачислено": "true", "Все": "all" }

/** "22 501 020 100", "352,543": groups of three, comma decimals (up to three), like the reference. */
function fmt(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value).replace(/ | /g, " ")
}

/** Names compare without spaces and case, code point by code point (the order of the reference's KPI lists). */
function kpiOrder(a: string, b: string) {
  const x = a.replace(/\s/g, "").toLowerCase()
  const y = b.replace(/\s/g, "").toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

function isActiveKpi(task: KpiTask) {
  if (!task.active) return false
  return !task.tillDate || task.tillDate >= new Date().toISOString().slice(0, 10)
}

const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const EYE_OFF = RI.eyeOff
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"
const SEARCH = "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"

function Box({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={checked} onClick={onClick} className="flex h-6 w-6 items-center justify-center">
      <span className={`flex h-[18px] w-[18px] items-center justify-center border-2 ${checked ? "border-[#5d6474] bg-[#5d6474]" : "border-[#5d6474]"}`}>
        {checked && <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" /></svg>}
      </span>
    </button>
  )
}

/** One value per currency on its own line ("39 600 SUM" / "0,486 USD"). */
function Money({ lines }: { lines: Array<{ value: number; currency: string }> }) {
  return (
    <div>
      {lines.map((line) => <div key={line.currency} className="leading-[16px]">{fmt(line.value)} {line.currency}</div>)}
    </div>
  )
}

export function SalaryPlanningView() {
  const { t } = useLanguage()
  const today = new Date()
  const [month, setMonth] = useState<number | null>(today.getMonth())
  const [year, setYear] = useState(today.getFullYear())
  const [tab, setTab] = useState("Все")
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListResult>({ count: 0, results: [], lastDate: null })
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [kpis, setKpis] = useState<SalaryKpi[]>([])
  // The Excel template lists every KPI flagged active (the reference's template also has the ones whose period has ended).
  const [templateKpis, setTemplateKpis] = useState<SalaryKpi[]>([])
  const [currencies, setCurrencies] = useState<string[]>([])
  const [orgOptions, setOrgOptions] = useState<string[]>([])
  const [impMonth, setImpMonth] = useState<number | null>(today.getMonth())
  const [impYear, setImpYear] = useState(today.getFullYear())
  const [impOrg, setImpOrg] = useState("")
  const [impCur, setImpCur] = useState("")
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)

  const effMonth = (month ?? today.getMonth()) + 1

  // The reference keeps its filters in the address (?month=&year=&showTab=&search=&page=&pageSize=): read them once, then write back the ones
  // that were given or changed.
  const touched = useRef(new Set<string>())
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const num = (key: string) => (/^\d+$/.test(params.get(key) ?? "") ? Number(params.get(key)) : null)
    const m = num("month")
    if (m && m >= 1 && m <= 12) { setMonth(m - 1); touched.current.add("month") }
    const y = num("year")
    if (y && y >= 1970 && y <= 2200) { setYear(y); touched.current.add("year") }
    const showTab = Object.entries(TAB_PARAM).find(([, value]) => value === params.get("showTab"))?.[0]
    if (showTab) { setTab(showTab); touched.current.add("showTab") }
    const search = params.get("search")
    if (search) { setQuery(search); setDebounced(search); touched.current.add("search") }
    const size = num("pageSize")
    if (size && (REF_PAGE_SIZES as readonly number[]).includes(size)) { setPageSize(size); touched.current.add("pageSize") }
    const pg = num("page")
    if (pg && pg > 0) { setPage(pg); touched.current.add("page") }
    setReady(true)
  }, [])
  useEffect(() => {
    if (!ready) return
    const values: Record<string, string> = { month: String(effMonth), page: String(page), pageSize: String(pageSize), search: debounced, showTab: TAB_PARAM[tab], year: String(year) }
    const params = new URLSearchParams()
    for (const key of Object.keys(values).sort()) if (touched.current.has(key) && values[key] !== "") params.set(key, values[key])
    const query = params.toString()
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
  }, [ready, effMonth, year, tab, debounced, page, pageSize])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const params = new URLSearchParams({ month: String(effMonth), year: String(year), tab: TAB_PARAM[tab], search: debounced, page: String(page), pageSize: String(pageSize) })
    fetch(`/api/salary-records?${params}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("load")
        return (await response.json()) as ListResult
      })
      .then((result) => {
        if (cancelled) return
        setData(result)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) notify("Не удалось загрузить зарплаты с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [ready, effMonth, year, tab, debounced, page, pageSize, reload])

  // Active KPIs and currencies are needed by the "Изменить планы" step and by the Excel template.
  useEffect(() => {
    fetch("/api/kpi-tasks")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: KpiTask[]) => {
        const toKpi = (row: KpiTask) => ({ id: row.id, name: row.name, planType: row.planType })
        setKpis(rows.filter(isActiveKpi).map(toKpi).sort((a, b) => kpiOrder(a.name, b.name)))
        setTemplateKpis(rows.filter((row) => row.active).map(toKpi).sort((a, b) => kpiOrder(a.name, b.name)))
      })
      .catch(() => {})
    fetch("/api/currencies")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Array<{ name?: string }>) => setCurrencies(rows.map((row) => row.name ?? "").filter(Boolean)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!importOpen || orgOptions.length) return
    fetch("/api/organizations")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Array<{ name?: string }>) => setOrgOptions([...new Set(rows.map((item) => item.name ?? "").filter(Boolean))]))
      .catch(() => {})
  }, [importOpen, orgOptions.length])

  const pageCount = Math.max(1, Math.ceil(data.count / pageSize))
  const rows = data.results
  const selectedRows = rows.filter((row) => selected.includes(row.userId))
  const hasSelection = selected.length > 0
  const allOnPage = rows.length > 0 && rows.every((row) => selected.includes(row.userId))

  const refresh = () => setReload((current) => current + 1)

  /** Called from the filter handlers only (never during render): the URL keeps the filters that were changed. */
  function markFilter(key: string) {
    touched.current.add(key)
    setPage(1)
  }

  function toggleRow(userId: number) {
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]))
  }

  function toggleAll() {
    const ids = rows.map((row) => row.userId)
    setSelected((current) => (allOnPage ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]))
  }

  async function post(url: string, body: unknown, failure: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (response.ok) return true
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      notify(payload?.error ?? failure)
    } catch {
      notify(failure)
    }
    return false
  }

  async function setApproved(approved: boolean) {
    if (!hasSelection) return
    if (await post("/api/salary-records/change-approve", { month: effMonth, year, users: selected, is_approved: approved }, "Не удалось обновить записи")) refresh()
  }

  async function recalc() {
    if (await post("/api/salary-records/recalculate", { month: effMonth, year }, "Не удалось пересчитать KPI")) refresh()
  }

  async function addSalaries(entries: Array<{ userId: number; salary: number }>, currency: string) {
    if (entries.length && (await post("/api/salary-records", { month: effMonth, year, currency, salaries: entries.map((entry) => ({ user: entry.userId, salary: entry.salary })) }, "Не удалось добавить зарплату"))) refresh()
    setAddOpen(false)
  }

  async function savePlans(payload: PlanSavePayload) {
    const ok = await post("/api/salary-records/bulk-plans", { month: payload.month, year: payload.year, users: payload.users.map((user) => ({ user: user.userId, plans: user.plans })) }, "Не удалось сохранить планы")
    if (!ok) return
    setPlansOpen(false)
    refresh()
  }

  async function saveSalary(salary: number, currency: string) {
    if (!(await post("/api/salary-records/bulk-salary", { month: effMonth, year, users: selected, salary, currency }, "Не удалось сохранить зарплату"))) return
    setPlansOpen(false)
    refresh()
  }

  async function copyMonth(to: { month: number; year: number }, options: { copyKpi: boolean; copySalary: boolean }) {
    const ok = await post("/api/salary-records/copy", { from_month: effMonth, from_year: year, to_month: to.month, to_year: to.year, users: selected, copy_indicator: options.copyKpi, copy_salary: options.copySalary }, "Не удалось дублировать")
    if (!ok) return
    setCopyOpen(false)
    refresh()
  }

  async function monthRecords(m: number, y: number) {
    const response = await fetch(`/api/salary-records?month=${m}&year=${y}&all=1`)
    return response.ok ? (((await response.json()) as { results: SalaryRecord[] }).results) : []
  }

  /** "Скачать EXCEL": the reference's KPI statistics sheet (plan, sales, returns, fact, %, level and bonus per KPI). */
  async function exportExcel() {
    const [records, statsResponse] = await Promise.all([monthRecords(effMonth, year), fetch(`/api/salary-records?month=${effMonth}&year=${year}&stats=1`)])
    const stats: KpiSheetStats = statsResponse.ok ? ((await statsResponse.json()) as KpiSheetStats) : { columns: [], rows: {} }
    const sheet = buildKpiSheet(records, stats, t)
    downloadExcelTable("kpi", sheet.rows, { merges: sheet.merges, widths: sheet.widths })
  }

  async function activeEmployees(): Promise<Employee[]> {
    const response = await fetch("/api/employees")
    return response.ok ? ((await response.json()) as Employee[]).filter((row) => row.active !== false) : []
  }

  /** "1. Скачать шаблон": logins with the current salary and one plan column per active KPI. */
  async function downloadTemplate() {
    const [people, records] = await Promise.all([activeEmployees(), monthRecords((impMonth ?? today.getMonth()) + 1, impYear)])
    const head = [t("Логин"), t("Имя"), t("Фамилия"), t("Зарплата"), ...templateKpis.map((kpi) => kpi.name)]
    const body = people.map((person) => {
      const record = records.find((item) => item.userId === person.id)
      return [person.login, person.firstName, person.lastName, record?.salary || "", ...templateKpis.map((kpi) => record?.indicators.find((item) => item.id === kpi.id)?.plan ?? "")]
    })
    downloadExcelTable("SalaryExcel", [head, ...body])
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const excelRows = await readExcelRows(importFile)
      const headerIndex = excelRows.findIndex((row) => row.some((cell) => cell.trim().toLowerCase() === t("Логин").toLowerCase() || cell.trim().toLowerCase() === "логин"))
      if (headerIndex < 0) {
        notify("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const header = excelRows[headerIndex].map((cell) => cell.trim())
      const columns = mapHeaderColumns(header, { логин: "login", login: "login", зарплата: "salary", salary: "salary" })
      const loginCol = [...columns.entries()].find(([, field]) => field === "login")?.[0] ?? 0
      const salaryCol = [...columns.entries()].find(([, field]) => field === "salary")?.[0] ?? 3
      const kpiCols = header.map((name, index) => ({ index, kpi: templateKpis.find((kpi) => kpi.name === name) })).filter((item) => item.kpi)
      const people = await activeEmployees()
      const m = (impMonth ?? today.getMonth()) + 1
      const salaries: Array<{ user: number; salary: number }> = []
      const planUsers: Array<{ user: number; plans: Array<{ id: number; name: string; planType: string; plan: number }> }> = []
      for (const row of excelRows.slice(headerIndex + 1)) {
        const person = people.find((item) => item.login === (row[loginCol] ?? "").trim())
        if (!person) continue
        const salary = Number((row[salaryCol] ?? "").replace(/\s/g, "").replace(",", "."))
        if (salary > 0) salaries.push({ user: person.id, salary })
        const plans = kpiCols
          .map(({ index, kpi }) => ({ id: kpi!.id, name: kpi!.name, planType: kpi!.planType, plan: Number((row[index] ?? "").replace(/\s/g, "").replace(",", ".")) || 0 }))
          .filter((item) => item.plan > 0)
        if (plans.length) planUsers.push({ user: person.id, plans })
      }
      if (!salaries.length && !planUsers.length) {
        notify("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      if (salaries.length && !(await post("/api/salary-records", { month: m, year: impYear, currency: impCur, salaries }, "Не удалось импортировать"))) return
      if (planUsers.length && !(await post("/api/salary-records/bulk-plans", { month: m, year: impYear, users: planUsers }, "Не удалось импортировать"))) return
      setImportOpen(false)
      setImportFile(null)
      refresh()
    } finally {
      setImportSaving(false)
    }
  }

  // Totals of the selected rows (the green bar), per currency.
  const sums = useMemo(() => {
    const sum = (pick: (row: SalaryRecord) => Array<{ currency: string; value: number }>) => {
      const map = new Map<string, number>()
      for (const row of selectedRows) for (const item of pick(row)) map.set(item.currency, (map.get(item.currency) ?? 0) + item.value)
      const parts = [...map.entries()].map(([currency, value]) => `${fmt(value)} ${currency}`)
      return parts.length ? parts.join(", ") : "0 SUM"
    }
    return {
      salary: sum((row) => [{ currency: row.currency, value: row.salary }]),
      bonus: sum((row) => row.currencies.map((item) => ({ currency: item.name, value: item.totalBonus }))),
      total: sum((row) => row.currencies.map((item) => ({ currency: item.name, value: item.totalSalary }))),
    }
  }, [selectedRows])

  const planTargets = selectedRows.length
    ? selectedRows.map((row) => ({ userId: row.userId, name: row.name, plans: Object.fromEntries(row.indicators.map((item) => [item.id, item.plan])) as Record<number, number> }))
    : []

  const tip = t("Выберите хотя бы один сотрудник !")
  const inSelection = selectMode && hasSelection
  const actionButtons = (
    <>
      <RefTip text={hasSelection ? "" : tip} side="left" gap={12.5}><RefButton exact green label={t("Зачислить")} onClick={() => void setApproved(true)} /></RefTip>
      <RefTip text={hasSelection ? "" : tip} side="left" gap={12.5}><RefButton exact red label={t("Отменить зачисление")} onClick={() => void setApproved(false)} /></RefTip>
      <RefTip text={hasSelection ? "" : tip} side="left" gap={12.5}><RefButton exact iconLow icon={RI.edit} label={t("Изменить планы")} onClick={() => hasSelection && setPlansOpen(true)} /></RefTip>
      <RefTip text={t("Дублировать")} side="left" gap={12.5}>
        <button type="button" aria-label={t("Дублировать")} onClick={() => setCopyOpen(true)} className="flex h-12 w-12 items-center justify-center text-[#5d6474]"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg></button>
      </RefTip>
    </>
  )
  const pager = (
    <RefPager
      lowered
      pageSize={pageSize}
      onPageSize={(size) => { touched.current.add("pageSize"); setPageSize(size); setPage(1) }}
      from={data.count ? (page - 1) * pageSize + 1 : 1}
      to={Math.min(page * pageSize, data.count)}
      total={data.count}
      page={page}
      pageCount={pageCount}
      onPage={(next) => { touched.current.add("page"); setPage(next) }}
    />
  )

  return (
    <RefPage>
      <RefHeader title={t("Зарплата и установка планов")} titleTop={0.8}>
        <div className="mr-[8px] flex items-center">
          {data.lastDate && <span className="mr-[10px] whitespace-nowrap text-[13px] font-semibold text-black"><span className="uppercase">{t("Данные за")}</span> {refDateTime(data.lastDate)}</span>}
          <span className={data.lastDate ? "flex w-[130px] justify-center [&>button]:px-[15px]" : ""}><RefButton exact green label={t("Перерасчет KPI")} onClick={() => void recalc()} /></span>
          <span className={data.lastDate ? "ml-[25px]" : "ml-[33px]"}><RefButton exact icon={RI.autorenew} label={t("Обновить с excel")} onClick={() => { setImpMonth(month); setImpYear(year); setImportOpen(true) }} /></span>
          <span className="ml-[15px]"><RefButton exact icon={RI.download} green label={t("Скачать EXCEL")} onClick={() => void exportExcel()} /></span>
          <span className="ml-[10px]"><RefButton exact icon={RI.add} green label={t("Добавить зарплату")} onClick={() => setAddOpen(true)} /></span>
        </div>
      </RefHeader>

      <RefTabs stacked labels={TABS} value={tab} onChange={(value) => { touched.current.add("showTab"); setTab(value); setPage(1) }} />
      <RefCard className="relative bg-white">
        {inSelection && (
          <div className="flex h-[30px] items-center justify-between bg-[#09890f] pl-[5px] pr-[33px] text-[13px] font-semibold text-white">
            <span>{t("Зарплата:")} {sums.salary}</span>
            <span>{t("Сумма бонусов:")} {sums.bonus}</span>
            <span>{t("Итоговая зарплата:")} {sums.total}</span>
          </div>
        )}
        {inSelection ? (
          <div className="flex h-[50px] items-center bg-[#f2f5f8] px-[5px]">
            <strong className="font-semibold">{t("Выбрано")}: {selected.length}</strong>
            <div className="ml-auto flex items-center text-[#5d6474]">
              {pager}
              <div className="ml-5 flex shrink-0 items-center gap-[10px]">{actionButtons}</div>
              <RefTip text={t("Снять выделение")} side="left" gap={12.5}>
                <button type="button" aria-label={t("Снять выделение")} onClick={() => setSelected([])} className="flex h-12 w-12 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={MINUS_BOX} /></svg></button>
              </RefTip>
            </div>
          </div>
        ) : (
          <div className="relative flex h-[50px] items-center whitespace-nowrap px-[5px]">
            <div className="absolute left-[5px] top-[-2.5px] w-[200px]"><SalaryMonthSelect bare rs value={month} onChange={(value) => { markFilter("month"); setMonth(value) }} /></div>
            <div className="absolute left-[205px] top-[-2.2px] w-[100px]"><SalaryYearField bare rs lower value={year} onChange={(value) => { markFilter("year"); setYear(value) }} /></div>
            <div className="absolute left-[377.5px] top-0 flex h-[40px] w-[300px] items-start border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
              <input
                value={query}
                onChange={(event) => { touched.current.add("search"); setQuery(event.target.value); setPage(1) }}
                placeholder={t("Поиск")}
                className="h-12 w-[262px] bg-transparent text-[13px] outline-none placeholder:text-black/30"
              />
              <svg viewBox="0 0 24 24" className="ml-[12px] mt-[12px] h-6 w-6 shrink-0 fill-[#ccc]"><path d={SEARCH} /></svg>
            </div>
            <div className="relative top-[1px] z-10 ml-auto flex shrink-0 items-center text-[#5d6474]">
              {pager}
              <RefTip text={t("Выбрать из списка")} side="left" gap={12.5} className="ml-5 shrink-0">
                <button type="button" aria-label={t("Выбрать из списка")} onClick={() => { setSelectMode((current) => !current); setSelected([]) }} className="flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={selectMode ? EYE_OFF : RI.checklist} /></svg>
                </button>
              </RefTip>
              <div className="flex shrink-0 items-center gap-[18px]">{actionButtons}</div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto bg-white">
          <div style={{ minWidth: 1100 }}>
            <div className={`grid h-[50px] grid-cols-[1fr_1fr_1fr_1fr_2fr] items-center bg-[#5d6474] pr-[30px] font-semibold text-white ${selectMode ? "pl-[50px]" : "pl-[30px]"}`}>
              <div className="relative leading-[16px]">
                {selectMode && (
                  <button type="button" aria-label={t("Выбрать все")} onClick={toggleAll} className="absolute -left-[30px] top-[-4px] flex h-6 w-6 items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={SELECT_ALL} /></svg>
                  </button>
                )}
                {t("Сотрудник")}
              </div>
              <div className="pr-2 text-right leading-[16px]">{t("Зарплата")}</div>
              <div className="pr-2 text-right leading-[16px]">{t("Сумма бонусов")}</div>
              <div className="pr-2 text-right leading-[16px]">{t("Итоговая зарплата")}</div>
              <div className="pl-2 leading-[16px]">KPI</div>
            </div>
            {rows.length === 0 ? (
              loaded && (
                <div className="flex min-h-[276.25px] flex-col items-center gap-[12px] pt-[58.2px]">
                  <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={155} height={160} priority unoptimized className="h-[159.8px] w-[155px] object-contain" />
                  <p className="text-[13px] leading-[16.25px] text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
                </div>
              )
            ) : (
              rows.map((row) => {
                const checked = selected.includes(row.userId)
                return (
                  <div key={row.id} className={`relative grid min-h-[50px] grid-cols-[1fr_1fr_1fr_1fr_2fr] items-center border-b border-dotted border-[#d7dee3] text-[#333] ${selectMode ? "pl-[55px] pr-[80px]" : "pl-[30px] pr-[30px]"} ${checked ? "bg-[#f2f5f8]" : ""}`}>
                    {selectMode && <div className="absolute left-[20px] top-1/2 -translate-y-1/2"><Box checked={checked} label={row.name} onClick={() => toggleRow(row.userId)} /></div>}
                    <div className="px-2 leading-[16px]">{row.name}</div>
                    <div className="px-2 text-right leading-[16px]">{fmt(row.salary)} {row.currency}</div>
                    <div className="px-2 text-right"><Money lines={row.currencies.map((item) => ({ value: item.totalBonus, currency: item.name }))} /></div>
                    <div className="px-2 text-right"><Money lines={row.currencies.map((item) => ({ value: item.totalSalary, currency: item.name }))} /></div>
                    <div className="flex flex-wrap pl-2">
                      {row.indicators.map((item) => (
                        <div key={item.id} className="my-[5px] mr-[10px] ml-0 flex h-[28px] items-center rounded-[2px] bg-[#e9ecef] px-[10px]">
                          {item.name}:<span className="ml-1 font-semibold text-[#4f71dc]">{fmt(item.plan)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </RefCard>

      {addOpen && <SalaryAddDialog month={effMonth - 1} year={year} onClose={() => setAddOpen(false)} onSave={addSalaries} />}
      {plansOpen && (
        <SalaryPlansDialog
          month={effMonth - 1}
          year={year}
          targets={planTargets}
          kpis={kpis}
          currencies={currencies}
          onClose={() => setPlansOpen(false)}
          onSavePlans={savePlans}
          onSaveSalary={saveSalary}
        />
      )}
      {copyOpen && <SalaryCopyDialog month={effMonth - 1} year={year} onClose={() => setCopyOpen(false)} onSave={copyMonth} />}
      {importOpen && (
        <RefImportDialog
          file={importFile}
          onFile={setImportFile}
          onTemplate={() => void downloadTemplate()}
          onSave={() => void saveImport()}
          onClose={() => { setImportOpen(false); setImportFile(null) }}
          saving={importSaving}
          bigTitle
          top={
            <div className="h-[278px]">
              <SalaryMonthSelect rs className="-mt-[5px] w-[340px]" value={impMonth} onChange={setImpMonth} />
              <SalaryYearField rs lower className="mt-[20px]" value={impYear} onChange={setImpYear} />
              <FilterSelect className="mt-[18px]" label={t("Организация")} value={impOrg} onChange={setImpOrg} options={orgOptions} />
              <FilterSelect className="mt-[5px]" label={t("Валюта")} value={impCur} onChange={setImpCur} options={currencies} />
            </div>
          }
        />
      )}
    </RefPage>
  )
}
