"use client"

import { useState } from "react"
import { SelectField } from "./select-field"
import type { DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"

const GROUPINGS = ["По брендам", "По категориям", "По клиентам", "По регионам", "По агентам"]
const MEASURES = [
  "Факт продажи",
  "Факт АКБ",
  "Факт",
  "Фактическая скидка",
  "Обьем без учета возвратов",
  "КГ без учета возвратов",
]

export function RightPanel({ summary }: { summary: DashboardSummary | null }) {
  const { t } = useLanguage()
  const [grouping, setGrouping] = useState("По брендам")
  const [measure, setMeasure] = useState("Факт продажи")

  const total = measure === "Факт АКБ" ? (summary?.akb ?? 0) : (summary?.sales.value ?? 0)

  return (
    <div className="flex flex-col rounded-lg bg-white p-5 shadow-sm">
      <div className="grid grid-cols-2 gap-4">
        <SelectField label={t("Группировка")} options={GROUPINGS} value={grouping} onChange={setGrouping} />
        <SelectField label={t("Измерять")} options={MEASURES} value={measure} onChange={setMeasure} />
      </div>

      {/* Empty chart area */}
      <div className="flex flex-1 flex-col items-center justify-center py-16">
        <span className="text-2xl font-bold text-slate-700">{total.toLocaleString("ru-RU")}</span>
        <span className="mt-1 text-sm uppercase tracking-wide text-slate-500">{t("итого")}</span>
      </div>
    </div>
  )
}
