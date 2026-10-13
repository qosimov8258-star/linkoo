"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
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

function SummaryTile({ label, color }: { label: string; color: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 border-r border-[#efefef] px-3 py-4 text-center last:border-r-0">
      <span className="text-[16px] leading-5" style={{ color }}>0 SUM</span>
      <span className="text-[13px] text-[#666]">{t(label)}</span>
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
    <div className="overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(149,157,165,0.2)]">
      {!loading && cashboxes.length === 0 ? (
        <p className="p-5 text-[13px] text-[#666]">{t("Нет данных за выбранный период")}</p>
      ) : (
        <>
          <div className="flex flex-wrap overflow-hidden">
            <SummaryTile label="Баланс на начало периода" color="#0d99ff" />
            <SummaryTile label="Приход за период" color="#81c784" />
            <SummaryTile label="Расход за период" color="#e57373" />
            <SummaryTile label="Перевод в кассу" color="#81c784" />
            <SummaryTile label="Перевод с кассы" color="#e57373" />
            <SummaryTile label="Баланс на конец периода" color="#0d99ff" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#f2f5f8] text-[#333]">
                  {COLUMNS.map((column) => (
                    <th key={column} className="whitespace-nowrap px-[17px] py-[10px] text-left text-[13px] font-semibold">
                      {t(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={row[0] as string} className="border-b border-[#efefef] bg-white">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="whitespace-nowrap border-r border-[#efefef] px-[17px] py-[9px] last:border-r-0">
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
              className="mx-[18px] my-[10px] flex h-[30px] w-[calc(100%-36px)] items-center justify-center gap-1.5 rounded-full bg-[#f2f5f8] text-[13px] text-[#4f71dc]"
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
