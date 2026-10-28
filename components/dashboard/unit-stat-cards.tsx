"use client"

import { formatStatTitle } from "@/lib/dashboard-date-range"
import type { DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"
import { CARD_CLASS } from "./stat-cards"

// Sold quantities of the period (orders the ledger counts): pieces, blocks
// (quantity / units per box of the product) and weight (quantity × product weight, kg).
export function UnitStatCards({ begin, end, visible, summary }: { begin: Date; end: Date; visible: Set<string>; summary: DashboardSummary | null }) {
  const { t, language } = useLanguage()
  // Other languages get the date part translated (no Russian "на" / "с … по").
  const dateT = language === "ru" ? undefined : t
  const number = (value: number | undefined, digits: number) => (value ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: digits })
  const cards = [
    { key: "salesUnits", title: formatStatTitle(t("Продажи в Штуках"), begin, end, dateT), value: `${number(summary?.units.pieces, 3)} ${t("шт.")}` },
    { key: "salesBlocks", title: formatStatTitle(t("Продажи в Блоках"), begin, end, dateT), value: `${number(summary?.units.blocks, 2)} ${t("блок")}` },
    { key: "salesWeight", title: formatStatTitle(t("Продажи в Весе"), begin, end, dateT), value: `${number(summary?.units.weight, 3)} ${t("кг")}` },
  ].filter((card) => visible.has(card.key))

  if (cards.length === 0) return null

  return (
    <div className="mt-5 grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <div key={card.key} className={`${CARD_CLASS} min-h-[92.3px] px-5 pb-5 pt-[17px]`}>
          <p className="text-[13px] leading-[18px]">{card.title}</p>
          <p className="mt-2 text-[16px] font-bold leading-5">{summary ? card.value : ""}</p>
        </div>
      ))}
    </div>
  )
}
