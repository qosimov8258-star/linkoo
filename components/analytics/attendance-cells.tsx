"use client"

import { formatLate, TYPE_LABELS, type AttendanceDay, type AttendanceType } from "@/lib/attendance-types"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// Cells of the Посещаемость matrix (demo staff/attendance icons and colours).

export const ICONS = {
  done: "M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z",
  clock:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  hospital: "M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z",
  beach:
    "M13.127 14.56l1.43-1.43 6.44 6.443L19.57 21zm4.293-5.73l2.86-2.86c-3.95-3.95-10.35-3.96-14.3-.02 3.93-1.3 8.31-.25 11.44 2.88zM5.95 5.98c-3.94 3.95-3.93 10.35.02 14.3l2.86-2.86C5.7 14.29 4.65 9.91 5.95 5.98zm.02-.02l-.01.01c-.38 3.01 1.17 6.88 4.3 10.02l5.73-5.73c-3.13-3.13-7.01-4.68-10.02-4.3z",
  event: "M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z",
  blank: "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  checked: "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  selectAll:
    "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z",
  info: "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  login: "M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z",
  logout: "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
  pin: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
}

export const TYPE_STYLE: Record<AttendanceType, { path: string; color: string }> = {
  on_time: { path: ICONS.done, color: "#81c784" },
  late: { path: ICONS.clock, color: "rgb(79,113,220)" },
  not_come: { path: ICONS.close, color: "#FF5E5E" },
  holiday: { path: ICONS.event, color: "#FF5E5E" },
  sick_leave: { path: ICONS.hospital, color: "#E57373" },
  vacation: { path: ICONS.beach, color: "#4DB6AC" },
}

export function Icon({ path, color, size = 17, className = "" }: { path: string; color?: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={{ fill: color }} aria-hidden>
      <path d={path} />
    </svg>
  )
}

/** One day cell: the icon of its type (holiday without a record = calendar, nothing = grey square),
 * with a tooltip (the date, the type, late by / arrival / leave, the comment). */
export function DayCell({ date, entry, holiday, onOpen }: { date: string; entry: AttendanceDay | undefined; holiday: boolean; onOpen: () => void }) {
  const { t, language } = useLanguage()
  const type: AttendanceType | null = entry?.type ?? (holiday ? "holiday" : null)
  const style = type ? TYPE_STYLE[type] : { path: ICONS.blank, color: "#d9d9d9" }
  const label = type ? t(TYPE_LABELS[type]) : ""
  const lines = [formatDateText(date, language, { withTime: false }), label]
  if (entry?.type === "late" && entry.lateMinutes > 0) lines.push(`${t("Опоздал на")} ${formatLate(entry.lateMinutes)}`)
  if (entry?.time) lines.push(`${t("Приход")}: ${entry.time}`)
  if (entry?.leaveTime) lines.push(`${t("Уход")}: ${entry.leaveTime}`)
  if (entry?.comment) lines.push(entry.comment)
  const title = lines.filter(Boolean).join("\n")
  return (
    <td className="px-[5px] py-[7.8px] text-center">
      <button type="button" onClick={onOpen} title={title} aria-label={title} className="mx-auto flex h-[20px] w-[20px] cursor-pointer items-center justify-center">
        <Icon path={style.path} color={style.color} />
      </button>
    </td>
  )
}
