"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportMultiChipField, ReportPage, ReportSelectField } from "@/components/ref/report-kit"
import { nextMatrixSort } from "@/components/ref/sort-arrows"
import { ReportMatrix, matrixNumber, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { useDirectoryNames } from "@/components/clients/use-directory"
import type { ClientSalesColumn, ClientSalesResult } from "@/lib/finance/client-sales-payments"
import { useLanguage } from "@/lib/i18n/language-context"

// "Продажа и оплата по магазинам" (Linko's dynamic report market_order_and_payment): per shop the period's sales,
// returns, their cost, the fact, payments and discounts in the base currency (GET /api/client-sales-payments). The
// table is the reference's dynamic-report grid: 400px shop column, 200px figure columns, sortable, «Итого» last.

const COLUMNS: Array<{ key: ClientSalesColumn; title: string }> = [
  { key: "order_price", title: "Продажа" },
  { key: "order_net_cost", title: "Себестоимость продаж" },
  { key: "return_price", title: "Возврат" },
  { key: "return_net_cost", title: "Себестоимость возврата" },
  { key: "fact_price", title: "Факт продаж" },
  { key: "fact_net_cost", title: "Себестоимость факт" },
  { key: "payment", title: "Оплата" },
  { key: "discount_price", title: "Сумма скидок" },
]
type FilterKey = "responsible" | "organization" | "storeType" | "zone" | "branch"
const EMPTY_FILTERS: Record<FilterKey, string> = { responsible: "", organization: "", storeType: "", zone: "", branch: "" }
/** «Колонка» (Linko's header_filter): several columns, «Магазин» among them; none chosen = every column. */
const SHOP = "Магазин"
const COLUMN_CHOICES = [SHOP, ...COLUMNS.map((column) => column.title)]

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function ClientSalesPaymentsView() {
  const { t } = useLanguage()
  const now = useMemo(() => new Date(), [])
  const [from, setFrom] = useState(() => iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  // Linko's menu opens it from the month's first day to today (market_order_and_payment/?beginDate=<1st>&endDate=<today>).
  const [to, setTo] = useState(() => iso(now))
  const [filters, setFilters] = useState<Record<FilterKey, string>>(EMPTY_FILTERS)
  const [columns, setColumns] = useState<string[]>([])
  const [applied, setApplied] = useState(() => ({ from, to, ...EMPTY_FILTERS, columns: [] as string[] }))
  const [data, setData] = useState<ClientSalesResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sort, setSort] = useState<{ key: number | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" })
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")

  const options: Record<FilterKey, string[]> = {
    responsible: useDirectoryNames("employees"),
    organization: useDirectoryNames("organizations"),
    storeType: useDirectoryNames("clientTypes"),
    zone: useDirectoryNames("zones"),
    branch: useDirectoryNames("branches"),
  }

  useEffect(() => {
    const params = new URLSearchParams({ from: applied.from, to: applied.to })
    const sent: Array<[string, string]> = [
      ["agent", applied.responsible],
      ["organization", applied.organization],
      ["clientType", applied.storeType],
      ["zone", applied.zone],
      ["branch", applied.branch],
    ]
    for (const [name, value] of sent) if (value) params.append(name, value)
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(`/api/client-sales-payments?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (ClientSalesResult & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || "Не удалось загрузить данные")
        setData(body)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [applied])

  // «Колонка»: only the chosen columns, in the report's order (the shop too only when chosen); none = every column.
  const chosen = applied.columns
  const withShop = !chosen.length || chosen.includes(SHOP)
  const shown = useMemo(() => (chosen.length ? COLUMNS.filter((column) => chosen.includes(column.title)) : COLUMNS), [chosen])
  const heads = useMemo<MatrixHead[]>(
    () => [
      ...(withShop ? [{ label: t(SHOP), width: 400, sortable: true, align: "left" as const }] : []),
      ...shown.map((column) => ({ label: t(column.title), width: 200, sortable: true })),
    ],
    [shown, withShop, t],
  )
  const ordered = useMemo(() => {
    const list = data?.rows ?? []
    if (sort.key === null) return list
    const dir = sort.dir === "asc" ? 1 : -1
    const index = withShop ? sort.key - 1 : sort.key
    const column = index < 0 ? null : shown[index]?.key
    return [...list].sort((a, b) => (column ? a[column] - b[column] : a.market.localeCompare(b.market, "ru")) * dir)
  }, [data, sort, shown, withShop])
  const matrixRows = useMemo<MatrixRow[]>(
    () => [
      ...ordered.map((row, index) => ({ key: `${row.clientId ?? "none"}-${index}`, cells: [...(withShop ? [row.market] : []), ...shown.map((column) => matrixNumber(row[column.key]))] })),
      { key: "total", tone: "total" as const, cells: [...(withShop ? [t("Итого")] : []), ...shown.map((column) => matrixNumber(data?.total[column.key] ?? 0))] },
    ],
    [ordered, shown, withShop, data, t],
  )

  function setFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }
  function download() {
    downloadExcelTable("client-sales-payments.xls", [
      [...(withShop ? [t(SHOP)] : []), ...shown.map((column) => t(column.title))],
      ...ordered.map((row) => [...(withShop ? [row.market] : []), ...shown.map((column) => row[column.key])]),
      [...(withShop ? [t("Итого")] : []), ...shown.map((column) => data?.total[column.key] ?? 0)],
    ])
  }

  return (
    <ReportPage>
      <ReportHeader title={t("Продажа и оплата по магазинам")} onExcel={download} onDashboard={() => setDashboardOpen(true)} inDashboard={saved} />

      <ReportBand>
        <ReportFilters
          applyDisabled={from > to}
          onApply={() => {
            if (from > to) return
            setApplied({ from, to, ...filters, columns })
            setSort({ key: null, dir: "asc" })
          }}
        >
          <ReportDateField label="Дата от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата до" value={to} min={from} onChange={setTo} />
          {(Object.keys(labels) as FilterKey[]).map((key) => (
            <ReportSelectField key={key} label={labels[key]} value={filters[key]} onChange={(value) => setFilter(key, value)} options={options[key]} />
          ))}
          <ReportMultiChipField label="Колонка" values={columns} options={COLUMN_CHOICES} onChange={setColumns} />
        </ReportFilters>
        {error ? <p className="mt-[8px] text-[12px] text-[#e53935]">{t(error)}</p> : null}

        {loading && !data ? null : !data?.rows.length ? (
          <ReportEmpty />
        ) : (
          <ReportMatrix
            heads={heads}
            sortKey={sort.key}
            sortDir={sort.dir}
            onSort={(index) => setSort((current) => nextMatrixSort(current, index))}
            rows={matrixRows}
          />
        )}
      </ReportBand>

      {dashboardOpen && <button type="button" aria-label={t("Закрыть")} onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] bg-black/55" />}
      {dashboardOpen && (
        <DashboardDialog
          reportSlug="client-sales-payments"
          reportLabel="Продажа и оплата по магазинам"
          visibility={visibility}
          setVisibility={setVisibility}
          dashboard={dashboard}
          setDashboard={setDashboard}
          onClose={() => setDashboardOpen(false)}
          onSave={() => setSaved(true)}
        />
      )}
    </ReportPage>
  )
}

const labels: Record<FilterKey, string> = { responsible: "Отв.агент магазина", organization: "Организация", storeType: "Тип магазина", zone: "Зона", branch: "Филиал" }
