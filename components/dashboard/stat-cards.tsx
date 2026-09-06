import { formatStatTitle } from "@/lib/dashboard-date-range"
import type { CurrencyAmount, DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"

function formatAmount(amount: CurrencyAmount | undefined, loadingLabel: string): string {
  if (!amount) return loadingLabel
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
  const loadingLabel = t("Загрузка ...")
  const cards = [
    { key: "sales", title: formatStatTitle(t("Продажи"), begin, end), value: formatAmount(summary?.sales, loadingLabel) },
    { key: "payments", title: formatStatTitle(t("Оплаты"), begin, end), value: formatAmount(summary?.payments, loadingLabel) },
    { key: "returns", title: formatStatTitle(t("Возвраты"), begin, end), value: formatAmount(summary?.returns, loadingLabel) },
    { key: "akb", title: formatStatTitle(t("АКБ"), begin, end), value: summary ? String(summary.akb) : loadingLabel },
  ].filter((card) => visible.has(card.key))

  if (cards.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-6 px-6 pt-6 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.title}
          className="min-h-[130px] rounded-lg bg-white px-6 py-5 shadow-sm"
        >
          <p className="text-[15px] text-slate-500">{card.title}</p>
          <p className="mt-3 text-3xl font-bold text-slate-800">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
