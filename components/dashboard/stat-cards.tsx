import { formatStatTitle } from "@/lib/dashboard-date-range"
import type { CurrencyAmount, DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"

export const CARD_CLASS = "rounded-[10px] bg-white shadow-[0_8px_24px_rgba(149,157,165,0.2)]"

/** One line per currency ("0 SUM" when there is nothing). */
export function formatAmounts(amounts: CurrencyAmount[] | undefined, fallbackCurrency = "SUM"): string[] {
  const lines = (amounts ?? [])
    .filter((amount) => amount.value)
    .map((amount) => `${amount.value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${amount.currency}`)
  return lines.length ? lines : [`0 ${fallbackCurrency}`]
}

export function StatCards({
  begin,
  end,
  summary,
  visible,
}: {
  begin: Date
  end: Date
  summary: DashboardSummary | null
  visible: Set<string>
}) {
  const { t, language } = useLanguage()
  // Other languages get the date part translated (no Russian "на" / "с … по").
  const dateT = language === "ru" ? undefined : t
  const cards = [
    { key: "sales", title: formatStatTitle(t("Продажи"), begin, end, dateT), lines: summary ? formatAmounts(summary.sales) : [] },
    { key: "payments", title: formatStatTitle(t("Оплаты"), begin, end, dateT), lines: summary ? formatAmounts(summary.payments) : [] },
    { key: "returns", title: formatStatTitle(t("Возвраты"), begin, end, dateT), lines: summary ? formatAmounts(summary.returns) : [] },
    { key: "akb", title: formatStatTitle(t("АКБ"), begin, end, dateT), lines: [summary ? String(summary.akb) : "0"], compact: true },
  ].filter((card) => visible.has(card.key))

  if (cards.length === 0) return null

  return (
    <div className="mt-5 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.key} className={`${CARD_CLASS} p-5 ${card.compact ? "min-h-[118px]" : "min-h-[92px]"}`}>
          <p className="text-[13px]">{card.title}</p>
          <div className={`font-bold ${card.compact ? "text-[16px] leading-5" : "mt-2 text-[16px] leading-5"}`}>
            {card.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
