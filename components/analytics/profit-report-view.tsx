"use client"

import { useCallback, useEffect, useState } from "react"
import { Info, Maximize2, Search } from "lucide-react"

import { BalanceFilterButton, BalanceFilterDialog } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { PnlRow, PnlStats } from "@/lib/pnl-stats-repo"

// "Прибыль от агентов" / "Прибыль по типам продуктов" (demo #/statistics/agent): nothing is listed until a
// "Период передачи со склада" is chosen in the filter ("Пожалуйста укажите дату передачи со склада"); then the
// realised sales, returns and profit per agent / product type for that period (GET /api/pnl-stats).

type Source = "agents" | "products" | "productTypes" | "brands"
type Grouping = { label: string; entity: string; source: Source }

type Props = {
  title: string
  /** First column header, e.g. "Агент" (single grouping). */
  entity?: string
  /** Which breakdown of /api/pnl-stats to list (single grouping). */
  source?: Source
  /** "Группировка" select: one entry per breakdown (the first is the default). */
  groupings?: Grouping[]
  /** Label of the active toggle button. */
  realizedLabel: string
  fileName: string
}

export function ProfitReportView({ title, entity: entityProp = "", source: sourceProp = "agents", groupings, realizedLabel, fileName }: Props) {
  const { t } = useLanguage()
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [paging, setPaging] = useState({ page: 1, pageSize: 25 })
  const [byCreation, setByCreation] = useState(false)
  const [groupIndex, setGroupIndex] = useState(0)
  const [stats, setStats] = useState<PnlStats | null>(null)
  const active = groupings?.[groupIndex] ?? { label: "", entity: entityProp, source: sourceProp }
  const entity = active.entity
  const rows: PnlRow[] = stats?.[active.source] ?? []

  const load = useCallback(async (range: { from: string; to: string }) => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ first_begin: range.from, first_end: range.to, second_begin: range.from, second_end: range.to })
      const response = await fetch(`/api/pnl-stats?${query}`, { cache: "no-store" })
      const body = (await response.json()) as PnlStats
      setStats(response.ok ? body : null)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (period) void load(period)
  }, [period, load])

  const visible = rows.filter((row) => row.name.toLowerCase().includes(search.trim().toLowerCase()))
  const pageRows = visible.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize)
  const total = (field: "sales" | "returns" | "factSales") => visible.reduce((sum, row) => sum + row.first[field], 0)
  const cards = [
    { label: "Сумма от продаж", value: total("sales") },
    { label: "Сумма возвратов", value: total("returns") },
    { label: "Фактические продажи", value: total("factSales"), right: true },
  ]
  const draft = period ?? { from: monthStartIso(todayIso()), to: monthEndIso(todayIso()) }

  const exportExcel = () =>
    downloadExcelTable(fileName, [
      [entity, "Продажи", "Возвраты", "Фактические продажи", "Прибыль"],
      ...visible.map((row) => [row.name, row.first.sales, row.first.returns, row.first.factSales, row.first.profit]),
    ])

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[60px] items-center px-[28px]">
        <div className="flex items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-[18px] font-bold text-[#5d6474]">{t(title)}</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-[30px] pt-5">
        <BalanceFilterButton count={0} from={draft.from} to={draft.to} hidePeriod onOpen={() => setFilterOpen(true)} />
        <div className="ml-auto">
          <BalanceDownloadMenu disabled={!visible.length} items={[{ label: "Скачать все", onClick: exportExcel }]} />
        </div>
      </section>

      <section className="mx-[30px] my-[10px] grid grid-cols-1 border border-[#efefef] sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className={`border-[#efefef] px-[15px] py-[10px] sm:border-r sm:last:border-r-0 ${card.right ? "sm:text-right" : ""}`}>
            <p className="text-[13px] font-medium leading-[18px] text-[#333]">{t(card.label)}</p>
            <p className="text-[16px] font-semibold leading-[20px] text-[#333]">
              {formatMoney(card.value)}
              {stats?.currency ? ` ${currencyLabel(stats.currency)}` : ""}
              <span className="text-[13px] font-normal">(0 {t("шт")})</span>
            </p>
          </div>
        ))}
      </section>
      {stats?.missingRates?.length ? (
        <p className="mx-[30px] text-[13px] text-[#e57373]">
          {t("Нет курса валюты, суммы не учтены")}: {stats.missingRates.map(currencyLabel).join(", ")}
        </p>
      ) : null}

      <section className="flex flex-wrap items-center gap-4 px-[30px] pt-3">
        <label className="relative w-[320px] border-b border-[#dbe0e8] pb-1">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Поиск")}
            className="w-full bg-transparent pr-7 text-[13px] font-semibold outline-none placeholder:font-semibold placeholder:text-black"
          />
          <Search className="pointer-events-none absolute right-0 top-0 h-5 w-5 text-[#333]" />
        </label>
        <div className="ml-auto flex items-center gap-4">
          <BalancePagination page={paging.page} pageSize={paging.pageSize} count={visible.length} onChange={setPaging} />
          <Maximize2 className="h-4 w-4 text-[#333]" aria-hidden />
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 px-[10px] pt-4">
        <p className="flex items-center gap-2 text-[16px] font-semibold text-[#4f71dc]">
          <Info className="h-5 w-5" /> {t("В этом отчете показываются только реализованные заказы и возвраты")}
        </p>
        <div className="flex items-center gap-4 pr-5 text-[13px]">
          {groupings && (
            <label className="flex flex-col text-[11px] font-semibold text-black">
              {t("Группировка")}
              <select
                value={groupIndex}
                onChange={(event) => setGroupIndex(Number(event.target.value))}
                className="mt-1 w-[200px] border-b border-[#dbe0e8] bg-transparent py-1 text-[13px] font-normal outline-none"
              >
                {groupings.map((group, index) => (
                  <option key={group.label} value={index}>
                    {t(group.label)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => setByCreation(true)}
            className={`h-8 border px-4 ${byCreation ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e1e5eb] bg-white text-[#333]"}`}
          >
            {t("ПОКАЗАТЬ ПРОДАЖУ ПО ДАТЕ СОЗДАНИЯ")}
          </button>
          <button
            type="button"
            onClick={() => setByCreation(false)}
            className={`h-8 border px-4 ${byCreation ? "border-[#e1e5eb] bg-white text-[#333]" : "border-[#4f71dc] bg-[#4f71dc] text-white"}`}
          >
            {t(realizedLabel)}
          </button>
        </div>
      </section>

      {!period ? (
        <p className="py-[110px] text-center text-[20px] font-semibold text-[#4f71dc]">{t("Пожалуйста укажите дату передачи со склада")}</p>
      ) : (
        <div className={`px-[30px] pb-10 pt-4 ${loading ? "opacity-60" : ""}`}>
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-[#5d6474] text-white">
              <tr>
                {[entity, "Продажа", "Возврат", "Фактическая продажа", "Прибыль"].map((head) => (
                  <th key={head} className="px-4 text-left font-semibold">
                    {t(head)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{formatMoney(row.first.sales)}</td>
                  <td>{formatMoney(row.first.returns)}</td>
                  <td>{formatMoney(row.first.factSales)}</td>
                  <td>{formatMoney(row.first.profit)}</td>
                </tr>
              ))}
              {!pageRows.length && (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-[#9aa3b6]">
                    {loading ? t("Загрузка...") : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <BalanceFilterDialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        from={draft.from}
        to={draft.to}
        dateLabel="Период передачи со склада"
        onApply={(next) => {
          setPaging((current) => ({ ...current, page: 1 }))
          setPeriod(next)
        }}
      />
    </main>
  )
}
