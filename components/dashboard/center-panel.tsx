"use client"

import { useEffect, useState } from "react"
import type { DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"
import { CARD_CLASS } from "./stat-cards"

// No agent-visit tracking exists in the data model yet, so these stay at
// zero until a visits feature is built to back them with real records.
const statusBoxes = [
  { value: "0", label: "Вовремя", color: "bg-[#3ac977]" },
  { value: "0", label: "Опоздали", color: "bg-[#ff9f00]" },
  { value: "0", label: "Не пришли", color: "bg-[#ff5e5e]" },
  { value: "0", label: "Выходной", color: "bg-[#0d99ff]" },
]

function Donut({ percent, label, gradient }: { percent: number; label: string; gradient: string }) {
  const radius = 46
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference

  return (
    <div className="relative h-[110px] w-[110px]" role="img" aria-label={`${label}: ${percent}%`}>
      <span className="absolute inset-[3px] rounded-full bg-white shadow-[0_0_8px_3px_rgba(0,0,0,0.18)]" />
      <svg viewBox="0 0 110 110" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3ac977" />
            <stop offset="100%" stopColor="#0d99ff" />
          </linearGradient>
        </defs>
        <circle cx="55" cy="55" r={radius} fill="none" stroke="#e4e7ea" strokeWidth="5" />
        <circle
          cx="55"
          cy="55"
          r={radius}
          fill="none"
          stroke={`url(#${gradient})`}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-[11px] flex flex-col items-center justify-center rounded-full bg-white text-center">
        <span className="text-[24px] font-bold leading-7 text-[#333]">{percent}%</span>
        <span className="max-w-[70px] text-[10px] font-semibold uppercase leading-3 text-[#5d6474]">{label}</span>
      </div>
    </div>
  )
}

function AttendanceDrawer({ open, begin, end, onClose }: { open: boolean; begin: string; end: string; onClose: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-[1200] bg-black/[0.54] transition-opacity duration-[400ms] ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-[1300] h-full w-[580px] max-w-full overflow-y-auto bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] transition-transform duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "translate-x-0" : "invisible translate-x-full"}`}
      >
        <header className="flex items-center justify-between px-[30px] pb-1 pt-5">
          <h4 className="text-[13px] font-bold uppercase">{t("Посещение")}</h4>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>
        <div className="flex justify-between border-b border-[#efefef] px-[30px] pb-3 text-[13px] font-semibold">
          <span>{t("С")} {begin}</span>
          <span>{t("По")} {end}</span>
        </div>
        <div className="mx-[22px] mt-[22px] grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-8 border-b border-dotted border-[#ccc] pb-4 font-semibold">
          <span>{t("Пользователь")}</span>
          <span>{t("Вовремя")}</span>
          <span>{t("Опоздал")}</span>
          <span>{t("Не пришел")}</span>
          <span>{t("Выходные")}</span>
        </div>
        <div className="flex flex-col items-center pt-8 text-[#666]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[150px]" />
          <span className="-mt-[34px]">{t("Нет данных...")}</span>
        </div>
      </aside>
    </>
  )
}

export function CenterPanel({
  summary,
  showAttendance,
  showKpi,
  begin,
  end,
}: {
  summary: DashboardSummary | null
  showAttendance: boolean
  showKpi: boolean
  begin: string
  end: string
}) {
  const { t } = useLanguage()
  const [attendanceOpen, setAttendanceOpen] = useState(false)

  if (!showAttendance && !showKpi) return null

  const counts = summary?.orderStatusCounts
  const shipped = counts?.shipped ?? 0
  const inTransit = counts?.inTransit ?? 0
  const delivered = counts?.delivered ?? 0
  const cancelledShipped = counts?.cancelledShipped ?? 0
  const deliveredPercent = shipped > 0 ? Math.round((delivered / shipped) * 100) : 0

  const colorCards = [
    { value: String(shipped), label: "Отгружен", color: "bg-[#0d99ff]" },
    { value: String(inTransit), label: "В пути", color: "bg-[#ff9f00]" },
    { value: String(cancelledShipped), label: "Возврат с отгруженных заказов", color: "bg-[#ff5e5e]" },
    { value: String(delivered), label: "Доставлен", color: "bg-[#3ac977]" },
  ]

  return (
    <div className="flex flex-col gap-[10px]">
      {showAttendance && (
        <div className={`${CARD_CLASS} grid grid-cols-4 gap-[10px] p-[10px] pl-[10px]`}>
          {statusBoxes.map((box) => (
            <button type="button" onClick={() => setAttendanceOpen(true)} key={box.label} className={`${box.color} flex h-[60px] flex-col items-center justify-center rounded-[4px] text-white`}>
              <span className="text-[18px] font-semibold leading-5">{box.value}</span>
              <span className="text-[11px] font-semibold leading-4">{t(box.label)}</span>
            </button>
          ))}
        </div>
      )}

      <AttendanceDrawer open={attendanceOpen} begin={begin} end={end} onClose={() => setAttendanceOpen(false)} />

      {(showKpi || showAttendance) && (
        <div className={`${CARD_CLASS} flex h-[285px] flex-col p-[13px] pb-[10px]`}>
          {showKpi && (
            <div className="flex flex-1 items-center justify-around">
              <Donut percent={0} label={t("Успешные визиты")} gradient="grad-visits" />
              <Donut percent={deliveredPercent} label={t("Доставлено")} gradient="grad-delivered" />
            </div>
          )}
          {showAttendance && (
            <div className="grid grid-cols-2 gap-[10px]">
              {colorCards.map((card) => (
                <div key={card.label} className={`${card.color} flex h-[60px] flex-col items-center justify-center rounded-[4px] px-1 text-center text-white`}>
                  <span className="text-[18px] font-semibold leading-5">{card.value}</span>
                  <span className="text-[11px] font-semibold leading-4">{t(card.label)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
