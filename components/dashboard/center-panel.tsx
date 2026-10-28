"use client"

import { useEffect, useState } from "react"
import type { DashboardSummary } from "@/lib/dashboard-summary-repo"
import { useLanguage } from "@/lib/i18n/language-context"
import { CARD_CLASS } from "./stat-cards"

const STATUS_BOXES = [
  { key: "onTime", label: "Вовремя", color: "bg-[#3ac977]" },
  { key: "late", label: "Опоздали", color: "bg-[#ff9f00]" },
  { key: "absent", label: "Не пришли", color: "bg-[#ff5e5e]" },
  { key: "weekend", label: "Выходной", color: "bg-[#0d99ff]" },
] as const

const NO_ATTENDANCE: DashboardSummary["field"]["attendance"] = { onTime: 0, late: 0, absent: 0, weekend: 0 }

function Donut({ percent, label, gradient }: { percent: number; label: string; gradient: string }) {
  const radius = 57
  const circumference = 2 * Math.PI * radius
  // The reference radial bar starts at -135° and sweeps up to 270°.
  const arc = (Math.min(100, percent) / 100) * 0.75 * circumference

  return (
    <div className="relative h-[156px] flex-1" role="img" aria-label={`${label}: ${percent}%`}>
      <span className="absolute left-1/2 top-[21px] h-[122px] w-[122px] -translate-x-1/2 rounded-full bg-[#f1f1f1] shadow-[0_0_2px_rgba(0,0,0,0.22)]" />
      <span className="absolute left-1/2 top-[29px] h-[106px] w-[106px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_9px_3px_rgba(0,0,0,0.3)]" />
      {percent > 0 && (
        <svg viewBox="0 0 122 122" className="absolute left-1/2 top-[21px] h-[122px] w-[122px] -translate-x-1/2 -rotate-[225deg]" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0%" y1="100%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#abe5a1" />
              <stop offset="100%" stopColor="#3ac977" />
            </linearGradient>
          </defs>
          <circle
            cx="61"
            cy="61"
            r={radius}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
          />
        </svg>
      )}
      <div className="absolute left-1/2 top-[62px] w-[104px] -translate-x-1/2 text-center">
        <span className="block text-[24px] font-bold leading-[30px] text-[#333]">{percent}%</span>
        <p className="-mx-[8px] text-[10px] font-semibold uppercase leading-[12.5px] text-[#675c5c]">{label}</p>
      </div>
    </div>
  )
}

function AttendanceDrawer({ open, begin, end, users, onClose }: { open: boolean; begin: string; end: string; users: DashboardSummary["field"]["users"]; onClose: () => void }) {
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
        {users.length === 0 ? (
          <div className="flex flex-col items-center pt-8 text-[#666]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/robot-empty.png" alt="" className="w-[150px]" />
            <span className="-mt-[34px]">{t("Нет данных...")}</span>
          </div>
        ) : (
          users.map((user, index) => (
            <div key={`${user.name}-${index}`} className="mx-[22px] grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-8 border-b border-dotted border-[#ccc] py-[14px]">
              <span>{user.name}</span>
              <span className="w-[52px] text-center">{user.onTime}</span>
              <span className="w-[52px] text-center">{user.late}</span>
              <span className="w-[64px] text-center">{user.absent}</span>
              <span className="w-[64px] text-center">{user.weekend}</span>
            </div>
          ))
        )}
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

  const attendance = summary?.field?.attendance ?? NO_ATTENDANCE
  const visitPercent = summary?.field?.visits.successPercent ?? 0
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
          {STATUS_BOXES.map((box) => (
            <button type="button" onClick={() => setAttendanceOpen(true)} key={box.label} className={`${box.color} flex h-[60px] flex-col items-center justify-center rounded-[4px] text-white`}>
              <span className="text-[20px] font-semibold leading-[25px]">{attendance[box.key]}</span>
              <span className="text-[11px] font-semibold leading-[13.8px]">{t(box.label)}</span>
            </button>
          ))}
        </div>
      )}

      <AttendanceDrawer open={attendanceOpen} begin={begin} end={end} users={summary?.field?.users ?? []} onClose={() => setAttendanceOpen(false)} />

      {(showKpi || showAttendance) && (
        <div className={`${CARD_CLASS} flex ${showKpi ? "h-[306px]" : ""} flex-col p-[10px]`}>
          {showKpi && (
            <div className="flex">
              <Donut percent={visitPercent} label={t("Успешные визиты")} gradient="grad-visits" />
              <Donut percent={deliveredPercent} label={t("Доставлено")} gradient="grad-delivered" />
            </div>
          )}
          {showAttendance && (
            <div className="mt-auto grid grid-cols-2 gap-[10px] pl-[4px] pr-[3px]">
              {colorCards.map((card) => (
                <div key={card.label} className={`${card.color} flex h-[60px] flex-col items-center justify-center rounded-[4px] px-1 text-center text-white`}>
                  <span className="text-[20px] font-semibold leading-[25px]">{card.value}</span>
                  <span className="text-[11px] font-semibold leading-[13.8px]">{t(card.label)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
