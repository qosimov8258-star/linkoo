"use client"

import type { DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"

// No agent-visit tracking exists in the data model yet, so these stay at
// zero until a visits feature is built to back them with real records.
const statusBoxes = [
  { value: "0", label: "Вовремя", color: "bg-brand-green" },
  { value: "0", label: "Опоздали", color: "bg-brand-orange" },
  { value: "0", label: "Не пришли", color: "bg-brand-red" },
  { value: "0", label: "Выходной", color: "bg-brand-sky" },
]

function Donut({
  percent,
  label,
  gradient,
}: {
  percent: number
  label: string
  gradient: string
}) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference
  const accessibleLabel = `${label}: ${percent}%`

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative h-36 w-36 sm:h-40 sm:w-40"
        role="img"
        aria-label={accessibleLabel}
      >
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="100%">
              {gradient === "grad-visits" ? (
                <>
                  <stop offset="0%" stopColor="#27ae60" />
                  <stop offset="100%" stopColor="#2f9bf5" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#27ae60" />
                  <stop offset="100%" stopColor="#2f9bf5" />
                </>
              )}
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#e9edf2" strokeWidth="14" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-slate-700">{percent}%</span>
          <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </span>
        </div>
      </div>
    </div>
  )
}

export function CenterPanel({
  summary,
  showAttendance,
  showKpi,
}: {
  summary: DashboardSummary | null
  showAttendance: boolean
  showKpi: boolean
}) {
  const { t } = useLanguage()

  if (!showAttendance && !showKpi) return null

  const counts = summary?.orderStatusCounts
  const shipped = counts?.shipped ?? 0
  const inTransit = counts?.inTransit ?? 0
  const delivered = counts?.delivered ?? 0
  const cancelledShipped = counts?.cancelledShipped ?? 0
  const deliveredPercent = shipped > 0 ? Math.round((delivered / shipped) * 100) : 0

  const colorCards = [
    { value: String(shipped), label: "Отгружен", color: "bg-brand-sky" },
    { value: String(inTransit), label: "В пути", color: "bg-brand-orange" },
    { value: String(cancelledShipped), label: "Возврат с отгруженных заказов", color: "bg-brand-red" },
    { value: String(delivered), label: "Доставлен", color: "bg-brand-green" },
  ]

  return (
    <div className="flex flex-col gap-6">
      {showAttendance && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statusBoxes.map((box) => (
            <div
              key={box.label}
              className={`${box.color} flex min-h-24 flex-col items-center justify-center rounded-lg px-2 py-4 text-center text-white shadow-sm`}
            >
              <span className="text-3xl font-bold">{box.value}</span>
              <span className="mt-1 text-sm font-semibold">{t(box.label)}</span>
            </div>
          ))}
        </div>
      )}

      {showKpi && (
        <div className="grid grid-cols-1 place-items-center gap-4 py-4 sm:grid-cols-2">
          <Donut percent={0} label={t("Успешные визиты")} gradient="grad-visits" />
          <Donut percent={deliveredPercent} label={t("Доставлено")} gradient="grad-delivered" />
        </div>
      )}

      {showAttendance && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {colorCards.map((card) => (
            <div
              key={card.label}
              className={`${card.color} flex flex-col items-center justify-center rounded-lg px-3 py-6 text-center text-white shadow-sm`}
            >
              <span className="text-3xl font-bold">{card.value}</span>
              <span className="mt-1 text-sm font-semibold">{t(card.label)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
