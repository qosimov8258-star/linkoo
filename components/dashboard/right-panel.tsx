"use client"

import { useState } from "react"
import { SelectField } from "./select-field"
import { CARD_CLASS } from "./stat-cards"
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

  // Base currency first (the API returns every currency of the period).
  const sales = summary?.sales ?? []
  const primary = sales.find((amount) => amount.currency === "SUM") ?? sales[0]
  const total = measure === "Факт АКБ" ? (summary?.akb ?? 0) : (primary?.value ?? 0)
  const suffix = measure === "Факт АКБ" ? "" : ` ${primary?.currency ?? ""}`

  return (
    <div className={`${CARD_CLASS} flex min-h-[450px] flex-col gap-[10px] p-[10px]`}>
      <div className={`${CARD_CLASS} grid h-[70px] grid-cols-2 gap-5 px-[10px] pt-[10px]`}>
        <SelectField label={t("Группировка")} options={GROUPINGS} value={grouping} onChange={setGrouping} />
        <SelectField label={t("Измерять")} options={MEASURES} value={measure} onChange={setMeasure} />
      </div>

      <div className={`${CARD_CLASS} flex flex-1 flex-col items-center justify-center`}>
        <span className="text-[12px] font-semibold leading-4">{total.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}{suffix}</span>
        <span className="text-[13px]">{t("итого")}</span>
      </div>
    </div>
  )
}
