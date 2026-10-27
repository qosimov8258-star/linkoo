"use client"

import { useState } from "react"
import { SelectField } from "./select-field"
import { CARD_CLASS } from "./stat-cards"
import type { DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"

const GROUPINGS = [
  "По товарам",
  "По родительскому типу продукта",
  "По типам продуктов",
  "По брендам",
  "По агентам",
  "По доставщикам",
  "По клиентам",
  "Территории",
  "По складам",
  "По филиалам",
  "По дням",
  "По неделям",
  "По месяцам",
]
const MEASURES = [
  "Факт продажи",
  "Факт АКБ",
  "Факт",
  "Фактическая скидка",
  "Обьем без учета возвратов",
  "КГ без учета возвратов",
  "Сумма возвратов",
  "Кол-во возвратов",
  "Продажа без учета возвратов",
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
      <div className={`${CARD_CLASS} grid h-[70px] grid-cols-[200px_200px] gap-x-[9.3px] pl-[29.7px] pt-[6.2px]`}>
        <SelectField label={t("Группировка")} options={GROUPINGS} value={grouping} onChange={setGrouping} />
        <SelectField label={t("Измерять")} options={MEASURES} value={measure} onChange={setMeasure} />
      </div>

      <div className={`${CARD_CLASS} flex flex-1 flex-col items-center justify-center`}>
        <span className="text-[13px] font-semibold leading-[18px]">{total.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}{suffix}</span>
        <span className="text-[10px] font-semibold leading-[14px] text-[#675c5c]">{t("итого")}</span>
      </div>
    </div>
  )
}
