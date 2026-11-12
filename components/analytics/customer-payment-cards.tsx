"use client"

import type { CustomerPaymentTotal } from "@/lib/cash/customer-payments-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// The cards above Оплаты от клиентов, as Linko shows its total_payment: «Принятый» — one card per currency and
// cashbox the accepted payments went to; «Не принятый» — per agent cashbox holding the payments not accepted yet
// (Не указано = none). Each: «На кассу <name>», the amount, «Количество оплат: N»; a coloured bar on the left.

const CURRENCY_ORDER = ["SUM", "USD", "EUR"]
const order = (code: string) => {
  const index = CURRENCY_ORDER.indexOf(code)
  return index < 0 ? CURRENCY_ORDER.length : index
}

function Section({ title, color, totals, field }: { title: string; color: string; totals: CustomerPaymentTotal[]; field: "cashboxes" | "agentCashboxes" }) {
  const { t } = useLanguage()
  const cards = [...totals]
    .sort((a, b) => order(a.currency) - order(b.currency) || a.currency.localeCompare(b.currency))
    .flatMap((total) => [...total[field]].sort((a, b) => Number(a.id) - Number(b.id)).map((cashbox) => ({ currency: total.currency, cashbox })))
  if (!cards.length) return null
  return (
    <div className="mb-4">
      <div className="mb-[10px] flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.4px] text-[#333]">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {title}
        <span className="rounded-[10px] bg-[#f2f4f7] px-2 py-px text-[12px] font-medium normal-case tracking-normal text-[#667085]">{cards.length}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto px-[2px] pb-[10px] pt-[2px] [scroll-snap-type:x_proximity]">
        {cards.map(({ currency, cashbox }) => (
          <div
            key={`${currency}-${cashbox.id}`}
            className="relative min-w-[230px] shrink-0 overflow-hidden rounded-[10px] border border-[#eaecf0] bg-white py-[14px] pl-[18px] pr-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(16,24,40,0.1)] [scroll-snap-align:start]"
          >
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
            <div className="mb-2 truncate text-[12px] text-[#667085]" title={cashbox.name}>
              {t("На кассу")} <span className="font-semibold text-[#344054]">{cashbox.name}</span>
            </div>
            <div className="mb-2 whitespace-nowrap text-[18px] font-bold text-[#101828]">{`${formatMoney(cashbox.total, 3)} ${currencyLabel(currency)}`}</div>
            <div className="inline-block rounded-md bg-[#f9fafb] px-2 py-[2px] text-[12px] text-[#475467]">
              {t("Количество оплат")}: {cashbox.count}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CustomerPaymentCards({ totals }: { totals: CustomerPaymentTotal[] }) {
  const { t } = useLanguage()
  return (
    <div>
      <Section title={t("Принятый")} color="#12aaeb" totals={totals} field="cashboxes" />
      <Section title={t("Не принятый")} color="#f5a623" totals={totals} field="agentCashboxes" />
    </div>
  )
}
