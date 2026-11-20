"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { ActivityAgent } from "@/lib/activity-types"
import type { MoneyTotal } from "@/lib/field-activity/types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Agent strip of the Активность page, drawn like Linko's: "Все" (Σ visits) and one card per employee, each as wide
// as its name, with the visit count in an indigo bar and the sales sum (counted orders, one line per currency —
// Linko adds the bare numbers of different currencies). The picked card takes the page colour, like a tab open
// onto the board below. Grey half-discs at the edges scroll the strip. Clicking a card narrows the board to that
// agent; "Все" clears it.

export function moneyLines(lines: MoneyTotal[], baseCurrency: string): string[] {
  if (!lines.length) return [`${formatMoney(0)} ${currencyLabel(baseCurrency)}`]
  return lines.map((line) => `${formatMoney(line.amount)} ${currencyLabel(line.currency)}`)
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 scale-[1.2] fill-white" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  )
}

/** Linko's strip arrow: a grey half-disc with «‹‹» that turns white and larger on hover. */
function EdgeArrow({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`group absolute top-[2px] z-[10] flex h-[63px] w-[51px] items-center justify-center bg-black/30 pb-[5px] text-[13px] leading-none text-[#333] ${
        side === "left" ? "left-0 rounded-r-[90px] pr-[10px]" : "right-0 rounded-l-[90px] pl-[10px]"
      }`}
    >
      <span className="transition-[font-size,color] group-hover:text-[25px] group-hover:text-white" aria-hidden="true">
        {side === "left" ? "‹‹" : "››"}
      </span>
    </button>
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
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    const element = scroller.current
    if (!element) return
    const left = element.scrollLeft > 1
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }))
  }, [])
  useEffect(() => {
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [measure, agents])
  const scroll = (direction: number) => scroller.current?.scrollBy({ left: direction * 320, behavior: "smooth" })
  // The picked card shows the page colour reaching 10px past the strip (Linko's ::after), its text above it.
  const card = (active: boolean) =>
    `relative flex shrink-0 cursor-pointer items-center border-l border-[#efefef] bg-white px-[15px] text-[13px] text-[#333] ${
      active ? "after:absolute after:inset-x-0 after:-bottom-[11px] after:-top-[10px] after:z-[2] after:bg-[#f2f5f8] after:content-['']" : ""
    }`

  return (
    <section className={`relative bg-white transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
      <div
        ref={scroller}
        onScroll={measure}
        className="flex min-h-[66px] items-stretch overflow-x-auto overflow-y-hidden leading-[1.2] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <button type="button" onClick={() => onSelect(null)} aria-pressed={selected === null} className={card(selected === null)}>
          <span className="relative z-[8] flex items-center py-[8px]">
            <span className="mr-[5px] flex h-[35px] w-[35px] min-w-[35px] items-center justify-center overflow-hidden rounded-full bg-[rgb(154,166,179)]">
              <PersonIcon />
            </span>
            <span className="flex flex-col items-start">
              <span className="block whitespace-pre font-semibold leading-[18px]">{t("Все")}</span>
              <span className="block whitespace-pre leading-[18px] text-[#666]">{totalVisits}</span>
            </span>
          </span>
        </button>
        {agents.map((agent) => (
          <button
            key={agent.employeeId}
            type="button"
            onClick={() => onSelect(agent.employeeId)}
            aria-pressed={selected === agent.employeeId}
            className={card(selected === agent.employeeId)}
          >
            <span className="relative z-[8] flex flex-col py-[8px] text-left">
              <span className={`block whitespace-pre font-semibold leading-[18px] ${agent.active ? "text-[#333]" : "text-[#999]"}`}>{agent.name || t("Не указано")}</span>
              <span className="block bg-[rgb(88,105,240)] text-center leading-[18px] text-white">{agent.visits}</span>
              {moneyLines(agent.sales, baseCurrency).map((line) => (
                <span key={line} className="block whitespace-pre text-center leading-[18px] text-[#666]">
                  {line}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
      {edges.left && <EdgeArrow side="left" label={t("Назад")} onClick={() => scroll(-1)} />}
      {edges.right && <EdgeArrow side="right" label={t("Вперед")} onClick={() => scroll(1)} />}
    </section>
  )
}
