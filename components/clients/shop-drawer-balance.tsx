"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { builderDayLabel, formatStatementDate } from "@/lib/finance/dates"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { readShopDrawerParam, writeShopDrawerParams } from "./shop-drawer-url"

// АКТИВНОСТЬ → «Баланс» of the shop drawer, as Linko's: a period (the last 30 days unless the address names one:
// activityFromDate / activityToDate) chosen with a date-range picker, up to seven tiles — each only when it is not zero,
// SUM and USD only, like Linko, to the decimals of Настройки → Округление сумм (its ROUND_AMOUNT_FOR_CURRENCY) — that open «Баланс клиентов» on the shop
// for that period, and «Последняя дата платежа» (Linko's last_payment_date of a copied shop, moved on only by a payment
// made here after the copy; the ledger's last payment of any other shop; «Платежи не осуществлялись» without one).

type SummaryCurrency = {
  currency: string
  begin: number
  end: number
  beginExact?: number
  endExact?: number
  order?: number
  orderReturn?: number
  payment?: number
  otherIncome?: number
  otherExpense?: number
}
type Summary = { currencies: SummaryCurrency[]; lastPayment: string | null }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const pad = (value: number) => String(value).padStart(2, "0")
const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

function defaultPeriod(): { from: string; to: string } {
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 30)
  return { from: isoOf(start), to: isoOf(today) }
}

function initialPeriod(): { from: string; to: string } {
  const fallback = defaultPeriod()
  const from = readShopDrawerParam("activityFromDate") ?? ""
  const to = readShopDrawerParam("activityToDate") ?? ""
  return { from: ISO_DAY.test(from) ? from : fallback.from, to: ISO_DAY.test(to) ? to : fallback.to }
}

const TILES: Array<{ label: string; pick: (entry: SummaryCurrency) => number }> = [
  { label: "Баланс на начало периода", pick: (entry) => entry.beginExact ?? entry.begin },
  { label: "Продажи", pick: (entry) => entry.order ?? 0 },
  { label: "Возврат", pick: (entry) => entry.orderReturn ?? 0 },
  { label: "Оплачено", pick: (entry) => entry.payment ?? 0 },
  { label: "Прочие приходы", pick: (entry) => entry.otherIncome ?? 0 },
  { label: "Прочие расходы", pick: (entry) => entry.otherExpense ?? 0 },
  { label: "Баланс на конец периода", pick: (entry) => entry.endExact ?? entry.end },
]

export function ShopBalanceBlock({
  clientId,
  clientName,
  lastPayment: cardPayment,
  bottomPadding,
}: {
  clientId: number
  clientName: string
  /** The card's payment days (null while they load): Linko's of a copied shop and the latest one made here since. */
  lastPayment: { copied: boolean; linko: string; own: string } | null
  bottomPadding?: boolean
}) {
  const { t, language } = useLanguage()
  const [period, setPeriod] = useState(initialPeriod)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerAt, setPickerAt] = useState({ top: 0, right: 0 })
  const [summary, setSummary] = useState<{ key: string; data: Summary | null } | null>(null)
  const key = `${clientId}:${period.from}:${period.to}`

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/clients/${clientId}/summary?from=${period.from}&to=${period.to}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<Summary>) : null))
      .then((data) => setSummary({ key, data }))
      .catch((cause: { name?: string }) => {
        if (cause?.name !== "AbortError") setSummary({ key, data: null })
      })
    return () => controller.abort()
  }, [clientId, period.from, period.to, key])

  const data = summary?.key === key ? summary.data : null
  // Linko counts SUM (UZS) and USD only.
  const currencies = (data?.currencies ?? []).filter((entry) => entry.currency === "SUM" || entry.currency === "USD").sort((a, b) => (a.currency === "SUM" ? -1 : b.currency === "SUM" ? 1 : 0))
  const href = `/analytics/client-balance?${new URLSearchParams({ dPageSize: "25", pageSize: "25", openClient: String(clientId), clientName, fromDate: period.from, toDate: period.to })}`
  const tiles = TILES.map((tile) => ({ label: tile.label, values: currencies.map((entry) => ({ currency: entry.currency, value: tile.pick(entry) })).filter((entry) => entry.value) })).filter((tile) => tile.values.length)
  const loaded = summary?.key === key && cardPayment !== null
  // A copied shop: Linko's own day ("2020-01-01" for one that never paid, as Linko prints it); the copied ledger's
  // payments are not counted again, only those made here after the copy.
  const days = cardPayment?.copied ? [cardPayment.linko, cardPayment.own] : [data?.lastPayment ?? ""]
  const lastPayment = days.filter((day) => ISO_DAY.test(day.slice(0, 10))).map((day) => day.slice(0, 10)).sort().pop() ?? ""

  // Escape closes the period picker (the drawer itself stays open).
  useEffect(() => {
    if (!pickerOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false)
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [pickerOpen])

  return (
    // Linko: 30 px under the routes, the title at the top of the 35 px row (20 px line), the period centred in it.
    <div className={bottomPadding ? "mt-[30px] pb-[15px]" : "mt-[30px]"}>
      <div className="relative mb-[15px] flex h-[35px] items-center justify-between">
        <span className="self-start text-base font-bold leading-[20px]">{t("Баланс")}</span>
        <button
          type="button"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            // Below the period, or above it when the 319 px picker would leave the window.
            const below = box.bottom + 6
            setPickerAt({ top: below + 325 > window.innerHeight ? Math.max(8, box.top - 325) : below, right: Math.max(8, window.innerWidth - box.right - 15) })
            setPickerOpen((open) => !open)
          }}
          className="mr-[15px] w-[200px] text-right text-[13px] font-bold text-[#1E4A9A]"
        >
          {builderDayLabel(period.from, language)} – {builderDayLabel(period.to, language)}
        </button>
        {pickerOpen && (
          // Fixed, so the drawer's scrolling box does not clip the 750 px picker.
          <div className="fixed z-[60]" style={{ top: pickerAt.top, right: pickerAt.right }}>
            <DateRangePicker
              openOnBeginMonth
              positionClassName="right-0 top-0"
              begin={period.from}
              end={period.to}
              onClose={() => setPickerOpen(false)}
              onApply={(from, to) => {
                setPickerOpen(false)
                setPeriod({ from, to })
                writeShopDrawerParams({ activityFromDate: from, activityToDate: to })
              }}
            />
          </div>
        )}
      </div>
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-[15px]">
          {tiles.map((tile) => (
            <Link key={tile.label} href={href} className="block rounded-[10px] bg-[#f3f3f3] p-[10px]">
              <div className="ml-[9px] cursor-pointer">
                <div className="pb-1 text-[#8c8c8c]">{t(tile.label)}</div>
                {/* One line per currency (SUM, then USD), red below zero. */}
                {tile.values.map((entry) => (
                  <div key={entry.currency} className={`font-semibold ${entry.value < 0 ? "text-[#e57373]" : "text-[#48a34b]"}`}>
                    {formatMoney(entry.value)} {entry.currency}
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
      <div className="mt-[15px]">
        {t("Последняя дата платежа")}:
        <span className="ml-[5px] font-semibold">{!loaded ? "…" : lastPayment ? formatStatementDate(lastPayment, language, false) : t("Платежи не осуществлялись")}</span>
      </div>
    </div>
  )
}
