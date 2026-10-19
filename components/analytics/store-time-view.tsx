"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"

const branches = ["777", "878", "agent", "Andijon", "AURUM samarqand", "baby still", "Buxoro"]
const contractors = [
  "Markus Vitinha",
  "Usman Dembele",
  "Ashraf Hakimi",
  "Doston market",
  "3333333333333333333333333333",
  "Наталья Лина",
]
const creators = ["05,08,2025 (1)", "Otaw Original3 Mardonov", "shohrux Avazhonov", "xodim1 1", "Suxrob Akramxodjaev", "Zaynillo Sadullayev"]
const surveys = ["distr", "oprosnik taski", "so'rovnoma 1", "наблюдатель", "narxlar royxat", "obforfhbihf1"]
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

export function StoreTimeView({ storeCheckMode = false, productCheckMode = false, title }: { storeCheckMode?: boolean; productCheckMode?: boolean; title?: string }) {
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(storeCheckMode || productCheckMode ? monthStart : today)
  const [to, setTo] = useState(storeCheckMode || productCheckMode ? monthEnd : today)
  const [agent, setAgent] = useState("")
  const [agentNames, setAgentNames] = useState<string[]>([])
  const [branch, setBranch] = useState("")
  const [contractor, setContractor] = useState("")
  const [planned, setPlanned] = useState("")
  const [creator, setCreator] = useState("")
  const [survey, setSurvey] = useState("")
  const [productGroup, setProductGroup] = useState("")
  const [, setApplied] = useState("")
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

  // No table tracks actual store dwell time, so the agent filter is wired to
  // real employees but the result panel below still reports "not found".
  useEffect(() => {
    let cancelled = false
    fetch("/api/employees")
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string }[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setAgentNames(data.map((employee) => employee.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")))
      })
      .catch(() => {
        if (!cancelled) setAgentNames([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  function downloadCsv() {
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

        <ReportEmpty />
      </ReportBand>

      {overlayOpen && <button type="button" aria-label="Закрыть окно" onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] cursor-default bg-black/55" />}
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
