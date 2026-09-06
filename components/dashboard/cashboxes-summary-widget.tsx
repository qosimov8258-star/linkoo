"use client"

import { useEffect, useMemo, useState } from "react"
import { BarChart3, ChevronDown, Download } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import type { Cashbox } from "@/components/analytics/cashboxes-data"
import { useLanguage } from "@/lib/i18n/language-context"

const VISIBLE_ROWS = 6
const COLUMNS = [
  "Кассы",
  "Баланс на начало",
  "Приход за период",
  "Расход за период",
  "Перевод в кассу",
  "Перевод с кассы",
  "Баланс на конец",
  "Разница",
]

function SummaryTile({ label }: { label: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center gap-1 border-r border-slate-100 px-3 py-4 text-center last:border-r-0">
      <span className="text-base font-bold text-slate-700">0 SUM</span>
      <span className="text-xs font-semibold text-slate-500">{t(label)}</span>
    </div>
  )
}

export function CashboxesSummaryWidget() {
  const { t } = useLanguage()
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/cashboxes")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Cashbox[]) => {
        if (!cancelled) setCashboxes(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(
    () => cashboxes.map((box) => [box.name, `0 ${box.currency}`, `0 ${box.currency}`, `0 ${box.currency}`, `0 ${box.currency}`, `0 ${box.currency}`, `0 ${box.currency}`, "0 %"]),
    [cashboxes],
  )
  const visibleRows = expanded ? rows : rows.slice(0, VISIBLE_ROWS)

  function handleDownload() {
    downloadExcelTable("kassy.xls", [COLUMNS, ...rows])
  }

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="text-[15px] font-semibold text-slate-700">{t("Кассы")}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:brightness-95"
          >
            <Download className="h-3.5 w-3.5" />
            {t("Скачать")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-[#4f70e7] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:brightness-95"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            {t("Отчет")}
          </button>
        </div>
      </div>

      {!loading && cashboxes.length === 0 ? (
        <p className="px-5 pb-5 text-sm font-medium text-slate-500">{t("Нет данных за выбранный период")}</p>
      ) : (
        <>
          <div className="flex flex-wrap overflow-hidden border-y border-slate-100">
            <SummaryTile label="Баланс на начало периода" />
            <SummaryTile label="Приход за период" />
            <SummaryTile label="Расход за период" />
            <SummaryTile label="Перевод в кассу" />
            <SummaryTile label="Перевод с кассы" />
            <SummaryTile label="Баланс на конец периода" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="text-slate-600">
                  {COLUMNS.map((column) => (
                    <th key={column} className="whitespace-nowrap px-4 py-3 text-left font-semibold">
                      {t(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={row[0] as string} className={index % 2 ? "bg-slate-50" : "bg-white"}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="whitespace-nowrap px-4 py-3">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > VISIBLE_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-3 text-sm font-semibold text-[#4f70e7] hover:bg-slate-50"
            >
              {expanded ? t("Свернуть") : t("Показать еще")}
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
