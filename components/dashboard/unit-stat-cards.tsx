"use client"

import { formatStatTitle } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"

export function UnitStatCards({ begin, end, visible }: { begin: Date; end: Date; visible: Set<string> }) {
  const { t } = useLanguage()
  const cards = [
    { key: "salesUnits", title: formatStatTitle(t("Продажи в Штуках"), begin, end), value: "0 шт" },
    { key: "salesBlocks", title: formatStatTitle(t("Продажи в Блоках"), begin, end), value: "0 блок" },
    { key: "salesWeight", title: formatStatTitle(t("Продажи в Весе"), begin, end), value: "0 кг" },
  ].filter((card) => visible.has(card.key))

  if (cards.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-6 px-6 pt-6 sm:grid-cols-3">
      {cards.map((card) => (
        <div key={card.key} className="min-h-[130px] rounded-lg bg-white px-6 py-5 shadow-sm">
          <p className="text-[15px] text-slate-500">{card.title}</p>
          <p className="mt-3 text-3xl font-bold text-slate-800">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
