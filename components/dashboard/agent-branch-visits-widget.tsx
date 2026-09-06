"use client"

import { useState } from "react"
import { ArrowUpDown, SlidersHorizontal } from "lucide-react"
import { SelectField } from "./select-field"
import { AgentVisitsFilterPanel } from "./agent-visits-filter-panel"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

const COLUMN_DEFS: { key: string; label: string }[] = [
  { key: "firstVisit", label: "Первый визит" },
  { key: "lastVisit", label: "Посл.Визит" },
  { key: "visitPlan", label: "План визитов" },
  { key: "visited", label: "Посещено" },
  { key: "orders", label: "Заказы" },
  { key: "refusals", label: "Отказы" },
  { key: "akb", label: "АКБ" },
  { key: "routeCompletion", label: "Вып.мар." },
  { key: "sales", label: "Продажи" },
]

const GROUPINGS = ["По товарам", "По брендам", "По категориям", "По клиентам"]
const MEASURES = ["Факт продажи", "Факт АКБ", "Факт"]
const ORDER_DATES = ["По дате создания", "По дате доставки"]

function SummaryBox({ value, label, tone }: { value: string; label: string; tone: "green" | "red" | "neutral" }) {
  const { t } = useLanguage()
  if (tone === "neutral") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 border-r border-slate-200 px-3 py-4 text-center last:border-r-0">
        <span className="text-lg font-bold text-slate-700">{value}</span>
        <span className="text-xs font-semibold text-slate-500">{t(label)}</span>
      </div>
    )
  }
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center gap-1 px-3 py-4 text-center text-white ${
        tone === "green" ? "bg-brand-green" : "bg-brand-red"
      }`}
    >
      <span className="text-lg font-bold">{value}</span>
      <span className="text-xs font-semibold">{t(label)}</span>
    </div>
  )
}

export function AgentBranchVisitsWidget() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<"all" | "one">("all")
  const [grouping, setGrouping] = useState(GROUPINGS[0])
  const [measure, setMeasure] = useState(MEASURES[0])
  const [orderDate, setOrderDate] = useState(ORDER_DATES[0])
  const [filterOpen, setFilterOpen] = useState(false)
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(() => COLUMN_DEFS.map((column) => column.key))

  const visibleColumns = COLUMN_DEFS.filter((column) => visibleColumnKeys.includes(column.key))

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm">
      <p className="px-5 pt-5 text-base font-bold text-slate-700">{t("Визиты агента по филиалам")}</p>

      <div className="mt-4 flex overflow-hidden border-y border-slate-200">
        <SummaryBox value="0" label="Активные" tone="green" />
        <SummaryBox value="0 / 0 (0%)" label="Визиты по маршруту" tone="neutral" />
        <SummaryBox value="0 / 0 (0%)" label="Не посещено" tone="neutral" />
        <SummaryBox value="0 / 0 (0%)" label="Вне маршрута" tone="neutral" />
        <SummaryBox value="0" label="Проблемные" tone="red" />
      </div>

      <div className="grid grid-cols-3 text-center text-sm font-bold text-white">
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`py-3 transition-colors ${tab === "all" ? "bg-brand-green-dark" : "bg-brand-green hover:brightness-95"}`}
        >
          {t("Все")}
        </button>
        <button
          type="button"
          onClick={() => setTab("one")}
          className={`py-3 transition-colors ${tab === "one" ? "bg-brand-green-dark" : "bg-brand-green hover:brightness-95"}`}
        >
          {t("Один")}
        </button>
        <button
          type="button"
          onClick={() =>
            downloadExcelTable("visity-agenta-po-filialam.xls", [
              ["Агент", ...visibleColumns.map((column) => column.label)],
            ])
          }
          className="bg-brand-green py-3 transition-colors hover:brightness-95"
        >
          {t("Скачать Excel")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="text-slate-600">
              <th className="whitespace-nowrap border-b border-slate-200 px-3 py-3 text-left font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  {t("Агент")}
                  <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
                </span>
              </th>
              {visibleColumns.map((column) => (
                <th key={column.key} className="whitespace-nowrap border-b border-slate-200 px-3 py-3 text-left font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    {t(column.label)}
                    <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField label={t("Группировка")} options={GROUPINGS} value={grouping} onChange={setGrouping} />
          <SelectField label={t("Измерять")} options={MEASURES} value={measure} onChange={setMeasure} />
          <SelectField label={t("Дата заказа")} options={ORDER_DATES} value={orderDate} onChange={setOrderDate} />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            aria-expanded={filterOpen}
            className="flex items-center gap-2 rounded-md bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t("Показать фильтр")}
          </button>
          {filterOpen && (
            <AgentVisitsFilterPanel
              columns={COLUMN_DEFS}
              selected={visibleColumnKeys}
              onClose={() => setFilterOpen(false)}
              onSave={(keys) => {
                setVisibleColumnKeys(keys)
                setFilterOpen(false)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
