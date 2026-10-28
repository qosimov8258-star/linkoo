"use client"

import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import type { MoveField, MoveNumbers } from "@/lib/stock-movement-columns"
import type { MoveSumResult } from "@/lib/stock-movement-report"

// The 9 summary cards of "Остаток на определенную дату" (demo m3877) in five
// columns, plus — with "Показать прочие" — the "Прочие приходы / расходы"
// breakdown boxes. Quantity mode: "N шт"; cost / price mode: "sum SUM (N шт)".
// Outflows are shown as positive numbers, as in the demo.

type Card = { label: string; field: MoveField; out?: boolean }

const CARD_COLUMNS: Card[][] = [
  [
    { label: "Остаток на начало периода", field: "begin" },
    { label: "Остаток на конец периода", field: "end" },
  ],
  [
    { label: "Поставки за период", field: "supply" },
    { label: "Возврат по поставкам за период", field: "supply_return", out: true },
  ],
  [
    { label: "Прочие приходы на склад", field: "other_in" },
    { label: "Прочие расходы на склад", field: "other_out", out: true },
  ],
  [
    { label: "Выдано по заказу", field: "order", out: true },
    { label: "Возврат", field: "return" },
  ],
  [{ label: "Списано за период", field: "writeoff", out: true }],
]

const OTHER_BOXES: Array<{ title: string; items: Card[] }> = [
  {
    title: "Прочие приходы",
    items: [
      { label: "Передача между складами", field: "transfer_in" },
      { label: "Инвентаризация", field: "inventory_in" },
      { label: "Производства", field: "manufacture_in" },
      { label: "Прочее", field: "none_in" },
    ],
  },
  {
    title: "Прочие расходы",
    items: [
      { label: "Передача между складами", field: "transfer_out", out: true },
      { label: "Инвентаризация", field: "inventory_out", out: true },
      { label: "Производства", field: "manufacture_out", out: true },
      { label: "Прочее", field: "none_out", out: true },
    ],
  },
]

const shown = (numbers: MoveNumbers | null | undefined, card: Card) => {
  const value = numbers?.[card.field] ?? 0
  return card.out ? -value || 0 : value
}

export function StockMoveCards({ sum, loading, showOthers }: { sum: MoveSumResult | null; loading: boolean; showOthers: boolean }) {
  const { t } = useLanguage()
  const money = Boolean(sum?.value)
  const unit = t("шт")
  const currency = sum ? currencyLabel(sum.currency) : ""
  const quantity = (card: Card) => `${formatMoney(shown(sum?.qty, card), 3)} ${unit}`
  const amount = (card: Card) => `${formatMoney(shown(sum?.value, card), 2)} ${currency}`
  return (
    <section className={`pb-[34.5px] pt-[25px] ${loading ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-1 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
        {CARD_COLUMNS.map((column, index) => (
          <div key={index} className={`flex flex-col gap-[10px] ${index === CARD_COLUMNS.length - 1 ? "lg:items-end lg:text-right" : ""}`}>
            {column.map((card) => (
              <div key={card.field}>
                <p className="text-[13px] leading-[16.3px] text-[#666]">{t(card.label)}</p>
                {money ? (
                  <p className="text-[16px] font-semibold leading-5 text-[#333]">
                    {amount(card)} <span className="text-[13px] font-normal text-[#666]">({quantity(card)})</span>
                  </p>
                ) : (
                  <p className="text-[16px] font-semibold leading-5 text-[#333]">{quantity(card)}</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {showOthers && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {OTHER_BOXES.map((box) => (
            <div key={box.title} className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-white">
              <p className="border-b border-[#e5e5e5] bg-[#f7f7f7] px-3 py-2 text-[14px] font-semibold">{t(box.title)}</p>
              {box.items.map((card) => (
                <div key={card.field} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[#f0f0f0] px-3 py-2 last:border-b-0">
                  <span className="min-w-0 text-[#666]">{t(card.label)}</span>
                  <span className="whitespace-nowrap text-right font-semibold">
                    {money ? (
                      <>
                        {amount(card)} <span className="text-[13px] font-medium">/ {quantity(card)}</span>
                      </>
                    ) : (
                      quantity(card)
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
