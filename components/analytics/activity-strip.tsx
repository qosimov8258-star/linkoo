"use client"

import { useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import type { ActivityAgent } from "@/lib/activity-types"
import type { MoneyTotal } from "@/lib/field-activity/types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Agent strip of the Активность page: "Все" (Σ visits) and one card per employee with the
// visit count in an indigo bar and the sales sum (counted orders, one line per currency).
// Clicking a card narrows the board to that agent; "Все" clears it.

export function moneyLines(lines: MoneyTotal[], baseCurrency: string): string[] {
  if (!lines.length) return [`${formatMoney(0)} ${currencyLabel(baseCurrency)}`]
  return lines.map((line) => `${formatMoney(line.amount)} ${currencyLabel(line.currency)}`)
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-white" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  )
}

export function ActivityStrip({
  agents,
  totalVisits,
  baseCurrency,
  selected,
  loading,
  onSelect,
}: {
  agents: ActivityAgent[]
  totalVisits: number
  baseCurrency: string
  selected: number | null
  loading: boolean
  onSelect: (employeeId: number | null) => void
}) {
  const { t } = useLanguage()
  const scroller = useRef<HTMLDivElement>(null)
  const scroll = (direction: number) => scroller.current?.scrollBy({ left: direction * 320, behavior: "smooth" })
  const card = (active: boolean) =>
    `flex shrink-0 flex-col items-center justify-center border-l border-[#efefef] px-[15px] py-[6px] text-center transition-shadow first:border-l-0 ${
      active ? "relative z-[1] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.16),0_1px_4px_rgba(0,0,0,0.12)]" : "hover:bg-[#f7f8fa]"
    }`

  return (
    <section className={`relative bg-white transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
      <button type="button" onClick={() => scroll(-1)} aria-label={t("Назад")} title={t("Назад")} className="absolute left-0 top-0 z-[2] flex h-full w-6 items-center justify-center bg-white/90 text-[#4f71dc] hover:bg-white">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div
        ref={scroller}
        className="mx-6 flex min-h-[64px] overflow-x-auto [scrollbar-color:#4f71dc_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-[#4f71dc] [&::-webkit-scrollbar]:h-[4px]"
      >
        <button type="button" onClick={() => onSelect(null)} aria-pressed={selected === null} className={`${card(selected === null)} min-w-[120px] flex-row gap-[10px]`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#c4c4c4]">
            <PersonIcon />
          </span>
          <span className="flex flex-col items-start leading-[18px]">
            <b className="text-[13px] font-semibold text-[#333]">{t("Все")}</b>
            <span className="text-[13px] text-[#333]">{totalVisits}</span>
          </span>
        </button>
        {agents.map((agent) => (
          <button
            key={agent.employeeId}
            type="button"
            onClick={() => onSelect(agent.employeeId)}
            aria-pressed={selected === agent.employeeId}
            title={agent.name}
            className={`${card(selected === agent.employeeId)} w-[180px]`}
          >
            <span className={`w-full truncate text-[13px] font-semibold leading-[18px] ${agent.active ? "text-[#333]" : "text-[#999]"}`}>{agent.name || t("Не указано")}</span>
            <span className="my-[2px] flex h-[14px] w-full items-center justify-center bg-[rgb(88,105,240)] text-[11px] font-semibold leading-none text-white">{agent.visits}</span>
            {moneyLines(agent.sales, baseCurrency).map((line) => (
              <span key={line} className="w-full truncate text-[12px] leading-[16px] text-[#999]">
                {line}
              </span>
            ))}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => scroll(1)} aria-label={t("Вперед")} title={t("Вперед")} className="absolute right-0 top-0 z-[2] flex h-full w-6 items-center justify-center bg-white/90 text-[#4f71dc] hover:bg-white">
        <ChevronRight className="h-4 w-4" />
      </button>
    </section>
  )
}
