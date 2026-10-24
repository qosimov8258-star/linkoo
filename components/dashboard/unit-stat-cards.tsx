"use client"

import { formatStatTitle } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"
import { CARD_CLASS } from "./stat-cards"

export function UnitStatCards({ begin, end, visible }: { begin: Date; end: Date; visible: Set<string> }) {
  const { t } = useLanguage()
  const cards = [
    { key: "salesUnits", title: formatStatTitle(t("Продажи в Штуках"), begin, end) },
    { key: "salesBlocks", title: formatStatTitle(t("Продажи в Блоках"), begin, end) },
    { key: "salesWeight", title: formatStatTitle(t("Продажи в Весе"), begin, end) },
  ].filter((card) => visible.has(card.key))

  if (cards.length === 0) return null

  return (
    <div className="mt-5 grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <div key={card.key} className={`${CARD_CLASS} min-h-[92.3px] px-5 pb-5 pt-[17px]`}>
          <p className="text-[13px] leading-[18px]">{card.title}</p>
        </div>
      ))}
    </div>
  )
}
