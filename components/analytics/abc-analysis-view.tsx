"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportChipField, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"
import { currencyLabel } from "@/lib/finance/currency"
import type { AbcResult } from "@/lib/finance/pnl-types"
import { useLanguage } from "@/lib/i18n/language-context"

// ABC analysis computed on the server (GET /api/balances/abc): the orders
// created in the period (cancelled / unconfirmed excluded), sales in the base
// currency, grouped by product / brand / branch; filters come from the
// factory's own product types, brands, branches and order agents.

const GROUP_BY: Record<string, "product" | "brand" | "branch"> = { "Продукт": "product", "Бренд": "brand", "Филиал": "branch" }

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

export function AbcAnalysisView() {
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [productType, setProductType] = useState("")
  const [brand, setBrand] = useState("")
  const [branch, setBranch] = useState("")
  const [orderUser, setOrderUser] = useState("")
  const [groupBy, setGroupBy] = useState("Продукт")
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
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [overlayOpen])

  const { t } = useLanguage()
  const [query, setQuery] = useState(() => ({ from: monthStart(), to: inputDate(new Date()), productType: "", brand: "", branch: "", orderUser: "", groupBy: "Продукт" }))
  const [data, setData] = useState<AbcResult | null>(null)
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState("")

  useEffect(() => {
    const params = new URLSearchParams({ from: query.from, to: query.to, groupBy: GROUP_BY[query.groupBy] ?? "product" })
    if (query.productType) params.append("productType", query.productType)
    if (query.brand) params.append("brand", query.brand)
    if (query.branch) params.append("branch", query.branch)
    if (query.orderUser) params.append("agent", query.orderUser)
    const controller = new AbortController()
    setItemsLoading(true)
    fetch(`/api/balances/abc?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные")
        return (await response.json()) as AbcResult
      })
      .then((body) => {
        setData(body)
        setItemsError("")
      })
      .catch(() => {
        if (!controller.signal.aborted) setItemsError("Не удалось загрузить данные с сервера")
      })
      .finally(() => {
        if (!controller.signal.aborted) setItemsLoading(false)
      })
    return () => controller.abort()
  }, [query])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const totals = data?.totals ?? { quantity: 0, sales: 0 }
  const options = data?.options

  function downloadCsv() {
    downloadExcelTable("abc-analysis.xls", [
      ["ИД", "Наименование", "Кол-во проданного товара", "Кол-во проданного товара в %", "Сумма продаж", "Сумма продаж в %", "Класс"],
      ...rows.map((row) => [row.id, row.name, row.quantity, row.quantityPercent.toFixed(1), row.sales, row.salesPercent.toFixed(1), row.abcClass]),
      ["", "Итого", totals.quantity, 100, totals.sales, 100, ""],
    ])
  }

  return (
    <ReportPage>
      <ReportHeader title="ABC анализ" onExcel={downloadCsv} onDashboard={() => setDashboardOpen(true)} />
      <ReportBand>
        <ReportFilters onApply={() => from <= to && setQuery({ from, to, productType, brand, branch, orderUser, groupBy })} applyDisabled={from > to}>
          <ReportDateField label="Дата создания от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата создания до" value={to} min={from} onChange={setTo} />
          <ReportSelectField label="Тип продукта" value={productType} onChange={setProductType} options={options?.productTypes ?? []} />
          <ReportSelectField label="Бренд" value={brand} onChange={setBrand} options={options?.brands ?? []} />
          <ReportSelectField label="Филиал" value={branch} onChange={setBranch} options={options?.branches ?? []} />
          <ReportSelectField label="Заказ оформил" value={orderUser} onChange={setOrderUser} options={options?.agents ?? []} />
          <ReportChipField
            label="Группировать по"
            value={groupBy}
            options={["Продукт", "Бренд", "Филиал"]}
            onChange={(value) => {
              // Group by follows the chip at once; the other filters apply with "Применить".
              setGroupBy(value)
              setQuery((current) => ({ ...current, groupBy: value }))
            }}
          />
        </ReportFilters>
        <p className="mt-2 text-[12px] text-[#666]">
          {t("Суммы в основной валюте")}: {currencyLabel(data?.baseCurrency ?? "SUM")}
          {data?.missingRates.length ? <span className="ml-2 text-[#e57373]">{t("Нет курса валюты, суммы не учтены")}: {data.missingRates.map(currencyLabel).join(", ")}</span> : null}
        </p>
        {!itemsLoading && !itemsError && rows.length === 0 ? (
          <ReportEmpty />
        ) : (
        <div className="mt-3 overflow-x-auto border visits-scrollbar">
          <table className="min-w-[1250px] w-full border-collapse">
            <thead className="bg-slate-50"><tr><th className="border px-4 py-5 text-left">{t("ИД")}</th><th className="min-w-[600px] border px-4 py-5 text-center">{t("Наименование")}</th><th className="border px-4 py-5 text-center">{t("Кол-во проданного товара")}</th><th className="border px-4 py-5 text-center">{t("Кол-во проданного товара в %")}</th><th className="border px-4 py-5 text-center">{t("Сумма продаж")}</th><th className="border px-4 py-5 text-center">{t("Сумма продаж в %")}</th><th className="border px-4 py-5 text-center">{t("Класс")}</th></tr></thead>
            <tbody>
              {itemsLoading ? (
                <tr><td colSpan={7} className="border px-2 py-16 text-center text-slate-400">{t("Загрузка...")}</td></tr>
              ) : itemsError ? (
                <tr><td colSpan={7} className="border px-2 py-16 text-center text-red-600">{t(itemsError)}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="border px-2 py-16 text-center text-slate-400">{t("Нет данных за выбранный период")}</td></tr>
              ) : (
                <>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="border px-2 py-4">{row.id}</td>
                      <td className="border px-2 py-4">{row.name}</td>
                      <td className="border px-2 py-4 text-right">{row.quantity.toLocaleString("ru-RU")}</td>
                      <td className="border px-2 py-4 text-right">{row.quantityPercent.toFixed(1)}</td>
                      <td className="border px-2 py-4 text-right">{row.sales.toLocaleString("ru-RU")}</td>
                      <td className="border px-2 py-4 text-right">{row.salesPercent.toFixed(1)}</td>
                      <td className={`border px-2 py-4 ${row.abcClass === "A" ? "bg-[#94f56f]" : row.abcClass === "B" ? "bg-yellow-300" : "bg-red-300"}`}>{row.abcClass}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="border" />
                    <td className="border px-2 py-4">{t("Итого")}</td>
                    <td className="border px-2 py-4 text-right">{totals.quantity.toLocaleString("ru-RU")}</td>
                    <td className="border px-2 py-4 text-right">100</td>
                    <td className="border px-2 py-4 text-right">{totals.sales.toLocaleString("ru-RU")}</td>
                    <td className="border px-2 py-4 text-right">100</td>
                    <td className="border" />
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
        )}
      </ReportBand>
      {overlayOpen && <button type="button" aria-label={t("Закрыть окно")} onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] cursor-default bg-black/55" />}
      {dashboardOpen && <DashboardDialog reportSlug="abc-analysis" reportLabel="ABC анализ" visibility={visibility} setVisibility={setVisibility} dashboard={dashboard} setDashboard={setDashboard} onClose={() => setDashboardOpen(false)} />}
    </ReportPage>
  )
}
