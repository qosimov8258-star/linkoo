"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportGridTable, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"
import { formatDateText } from "@/lib/i18n/format-date"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { useLanguage } from "@/lib/i18n/language-context"

// Filter lists come from the factory's own directories (branches, clients,
// employees). Surveys have no directory yet, so that list is empty.
const surveys: string[] = []
const productGroups = ["Наши продукты", "Продукты конкурентов"]

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function monthStart() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1))
}

function monthEnd() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth() + 1, 0))
}

/** One visit with a measured stay (GET /api/agent-visits?view=store-time, lib/agent-visits-repo.ts StoreTimeRow). */
type StoreTimeRow = {
  visitId: number
  date: string
  branch: string
  employeeId: number
  agent: string
  start: string
  end: string
  minutes: number
  clientId: number
  client: string
  agentGps: string
  clientGps: string
  distance: number | null
  planned: boolean
}

/** "2,4" — minutes with one decimal and a decimal comma, as the reference prints them. */
const minutesText = (value: number) => (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "").replace(".", ",")

export function StoreTimeView({ storeCheckMode = false, productCheckMode = false, title }: { storeCheckMode?: boolean; productCheckMode?: boolean; title?: string }) {
  const { t, language } = useLanguage()
  const stayMode = !storeCheckMode && !productCheckMode && !title
  const today = useMemo(() => inputDate(new Date()), [])
  // ?beginDate=&endDate= (the reference's #/dynamic-reports/market_service_time/?beginDate=…) opens a period.
  const search = useSearchParams()
  const isDay = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
  const urlFrom = search.get("beginDate")
  const urlTo = search.get("endDate")
  const [from, setFrom] = useState(isDay(urlFrom) ? urlFrom : storeCheckMode || productCheckMode ? monthStart : today)
  const [to, setTo] = useState(isDay(urlTo) ? urlTo : storeCheckMode || productCheckMode ? monthEnd : today)
  const [agent, setAgent] = useState("")
  const [branch, setBranch] = useState("")
  const [contractor, setContractor] = useState("")
  const [planned, setPlanned] = useState("")
  const [creator, setCreator] = useState("")
  const [survey, setSurvey] = useState("")
  const [productGroup, setProductGroup] = useState("")
  const [, setApplied] = useState("")
  // "Время нахождения в магазинах": the visits of the period with a measured stay, narrowed by the filters.
  const [stays, setStays] = useState<StoreTimeRow[]>([])
  const [staysLoading, setStaysLoading] = useState(false)
  const [stayFilter, setStayFilter] = useState({ agent: "", branch: "", contractor: "", planned: "" })
  const loadStays = (periodFrom: string, periodTo: string) => {
    if (!stayMode || periodFrom > periodTo) return
    setStaysLoading(true)
    fetch(`/api/agent-visits?view=store-time&from=${periodFrom}&to=${periodTo}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<StoreTimeRow[]>) : Promise.reject()))
      .then((rows) => setStays(Array.isArray(rows) ? rows : []))
      .catch(() => setStays([]))
      .finally(() => setStaysLoading(false))
  }
  useEffect(() => {
    loadStays(from, to)
    // The period of the first render only; later periods load on "Применить".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const shownStays = useMemo(
    () =>
      stays.filter(
        (row) =>
          (!stayFilter.agent || row.agent === stayFilter.agent) &&
          (!stayFilter.branch || row.branch === stayFilter.branch) &&
          (!stayFilter.contractor || row.client === stayFilter.contractor) &&
          (!stayFilter.planned || (stayFilter.planned === "Да") === row.planned),
      ),
    [stays, stayFilter],
  )
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const overlayOpen = dashboardOpen

  useEffect(() => {
    if (!overlayOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDashboardOpen(false)
      }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [overlayOpen])

  // No table tracks actual store dwell time: the filters list real
  // employees / branches / clients, and the result panel reports "not found".
  const agentNames = useDirectoryNames("employees")
  const creators = agentNames
  const contractors = useDirectoryNames("clients")
  const [branches, setBranches] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/branches")
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string }[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setBranches(data.map((branch) => branch.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")))
      })
      .catch(() => {
        if (!cancelled) setBranches([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  function downloadCsv() {
    if (stayMode) {
      downloadExcelTable("store-time.xls", [
        ["Дата", "Филиал", "Агент", "Начало", "Конец", "В магазине, мин", "ИД контрагента", "Контрагент", "GPS Агента", "GPS ТТ", "Погрешность, м", "По плану"],
        ...shownStays.map((row) => [row.date, row.branch, row.agent, row.start, row.end, minutesText(row.minutes), String(row.clientId), row.client, row.agentGps, row.clientGps, row.distance === null ? "" : String(row.distance), row.planned ? "Да" : "Нет"]),
      ])
      return
    }
    const rows = productCheckMode
      ? [["Дата от", "Дата до", "Создал", "Опрос", "Продукты"], [from, to, creator || "Все", survey || "Все", productGroup || "Все"]]
      : [["Дата от", "Дата до", "Агент", "Филиал", "Контрагент", "По плану"], [from, to, agent || "Не найдено", branch || "Все", contractor || "Все", planned || "Все"]]
    downloadExcelTable(title ? "price-analysis.xls" : productCheckMode ? "product-store-check.xls" : storeCheckMode ? "store-check.xls" : "store-time.xls", rows)
  }

  return (
    <ReportPage>
      <ReportHeader
        title={title ?? (productCheckMode ? "Store check по продуктам" : storeCheckMode ? "Выполнение Store Check" : "Время нахождения в магазинах")}
        onExcel={downloadCsv}
        onDashboard={() => setDashboardOpen(true)}
      />

      <ReportBand>
        <ReportFilters
          onApply={() => {
            if (from <= to) setApplied([branch, contractor, planned, creator, survey, productGroup].filter(Boolean).join(" · "))
            if (stayMode && from <= to) {
              setStayFilter({ agent, branch, contractor, planned })
              loadStays(from, to)
            }
          }}
          applyDisabled={from > to}
        >
          <ReportDateField label="Дата создания от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата создания до" value={to} min={from} onChange={setTo} />
          {productCheckMode && (
            <>
              <ReportSelectField label="Создал" value={creator} onChange={setCreator} options={creators} />
              <ReportSelectField label="Опрос" value={survey} onChange={setSurvey} options={surveys} />
              <ReportSelectField label="Продукты" value={productGroup} onChange={setProductGroup} options={productGroups} />
            </>
          )}
          {!storeCheckMode && !productCheckMode && (
            <>
              <ReportSelectField label="Агент" value={agent} onChange={setAgent} options={agentNames} />
              <ReportSelectField label="Филиал" value={branch} onChange={setBranch} options={branches} />
              <ReportSelectField label="Контрагент" value={contractor} onChange={setContractor} options={contractors} />
              <ReportSelectField label="По плану" value={planned} onChange={setPlanned} options={["Да", "Нет"]} />
            </>
          )}
        </ReportFilters>

        {/* No stays: the reference shows its robot «По вашему запросу ничего не найдено…», not an empty grid. */}
        {stayMode && (staysLoading || shownStays.length) ? (
          <ReportGridTable
            minWidth={1500}
            loading={staysLoading}
            emptyText={t("По вашему запросу ничего не найдено")}
            colWidths={["100px", "150px", "300px", "100px", "100px", "150px", "100px", "250px", "150px", "150px", "120px", "100px"]}
            heads={["Дата", "Филиал", "Агент", "Начало", "Конец", "В магазине, мин", "ИД контрагента", "Контрагент", "GPS Агента", "GPS ТТ", "Погрешность, м", "По плану"].map((head) => t(head))}
            rows={shownStays.map((row) => [
              formatDateText(row.date, language),
              row.branch,
              row.agent,
              row.start,
              row.end,
              <span key="m" className="block text-right">{minutesText(row.minutes)}</span>,
              String(row.clientId),
              row.client,
              row.agentGps,
              row.clientGps,
              <span key="d" className="block text-right">{row.distance === null ? "" : row.distance}</span>,
              t(row.planned ? "Да" : "Нет"),
            ])}
          />
        ) : (
          <ReportEmpty />
        )}
      </ReportBand>

      {overlayOpen && <button type="button" aria-label={t("Закрыть окно")} onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] cursor-default bg-black/55" />}
      {dashboardOpen && (
        <DashboardDialog
          reportSlug="store-time"
          reportLabel="Время на точке"
          visibility={visibility}
          setVisibility={setVisibility}
          dashboard={dashboard}
          setDashboard={setDashboard}
          onClose={() => setDashboardOpen(false)}
        />
      )}
    </ReportPage>
  )
}

export function StoreCheckView() {
  return <StoreTimeView storeCheckMode />
}

export function ProductStoreCheckView() {
  return <StoreTimeView productCheckMode />
}
