import { formatStatTitle } from "@/lib/dashboard-date-range"
import type { CurrencyAmount, DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"

export const CARD_CLASS = "rounded-[10px] bg-white shadow-[0_8px_24px_rgba(149,157,165,0.2)]"

function formatAmount(amount: CurrencyAmount | undefined): string {
  if (!amount || !amount.value) return ""
  const maximumFractionDigits = amount.currency === "SUM" ? 0 : 2
  return `${amount.value.toLocaleString("ru-RU", { maximumFractionDigits })} ${amount.currency}`
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
  const { t } = useLanguage()
  const cards = [
    { key: "sales", title: formatStatTitle(t("Продажи"), begin, end), value: formatAmount(summary?.sales) },
    { key: "payments", title: formatStatTitle(t("Оплаты"), begin, end), value: formatAmount(summary?.payments) },
    { key: "returns", title: formatStatTitle(t("Возвраты"), begin, end), value: formatAmount(summary?.returns) },
    { key: "akb", title: formatStatTitle(t("АКБ"), begin, end), value: summary ? String(summary.akb) : "0", compact: true },
  ].filter((card) => visible.has(card.key))

  if (cards.length === 0) return null

  return (
    <div className="mt-5 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.key} className={`${CARD_CLASS} px-5 pb-5 pt-[17px] ${card.compact ? "min-h-[118.5px]" : "min-h-[92px]"}`}>
          <p className="text-[13px] leading-[18px]">{card.title}</p>
          <p className="-mt-[0.7px] text-[19.5px] font-bold leading-[26.2px]">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
