"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"
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

export function StoreTimeView({ storeCheckMode = false, productCheckMode = false, title }: { storeCheckMode?: boolean; productCheckMode?: boolean; title?: string }) {
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(storeCheckMode || productCheckMode ? monthStart : today)
  const [to, setTo] = useState(storeCheckMode || productCheckMode ? monthEnd : today)
  const [agent, setAgent] = useState("")
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
