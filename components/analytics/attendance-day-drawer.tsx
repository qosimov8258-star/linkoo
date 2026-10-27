"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react"

import { ICONS, Icon, TYPE_STYLE } from "@/components/analytics/attendance-cells"
import { callApi } from "@/components/analytics/attendance-dialogs"
import { formatLate, TYPE_LABELS, type AttendanceDayDetail } from "@/lib/attendance-types"
import { formatMoney } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// The agent-day drawer of Посещаемость (a click on a day cell, URL ?date=…&id=…): the
// employee's day — attendance status, arrival / leave, the check-in events with their place —
// and the orders he took that day (count and totals per currency).

const SOURCE_LABELS: Record<string, string> = { auto: "Автоматически", manual: "Изменено вручную", import: "Импорт из Excel" }

function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export function AttendanceDayDrawer({ employeeId, date, onDate, onClose }: { employeeId: number; date: string; onDate: (date: string) => void; onClose: () => void }) {
  const { t, language } = useLanguage()
  const [state, setState] = useState<{ key: string; data: AttendanceDayDetail | null; error: string }>({ key: "", data: null, error: "" })
  const key = `${employeeId}|${date}`
  useEffect(() => {
    let cancelled = false
    void callApi<AttendanceDayDetail>(`/api/work-attendance/day?employeeId=${employeeId}&date=${encodeURIComponent(date)}`).then((result) => {
      if (cancelled) return
      setState({ key, data: result.ok ? result.data : null, error: result.ok ? "" : result.error })
    })
    return () => {
      cancelled = true
    }
  }, [employeeId, date, key])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  const loading = state.key !== key
  const data = loading ? null : state.data
  const day = data?.day ?? null
  const type = day?.type ?? (data?.holiday ? "holiday" : null)
  const prev = shiftDay(date, -1)
  const next = shiftDay(date, 1)
  return (
    <div className="fixed inset-0 z-[900] bg-black/30" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={data?.employee.name ?? t("Посещаемость")} className="absolute bottom-0 right-0 top-0 flex w-[800px] max-w-full flex-col bg-[#f5f7fa] shadow-2xl">
        <header className="flex items-center gap-[12px] border-b border-[#e8ebf0] bg-white px-[20px] py-[14px]">
          <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-[#b0bac5]">
            <Icon path={ICONS.person} color="#fff" size={26} />
          </span>
          <strong className="min-w-0 flex-1 truncate text-[14px] uppercase text-[#333]">{data?.employee.name ?? ""}</strong>
          <Link href={`/tracking?view=agents&agent=${employeeId}&date=${encodeURIComponent(date)}`} className="flex shrink-0 items-center gap-[6px] text-[13px] text-[#4f71dc] hover:underline">
            <Icon path={ICONS.reply} color="#999" size={18} />
            {t("Просмотреть на карте")}
          </Link>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="shrink-0 text-[#555] hover:text-black">
            <X className="h-6 w-6" />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-4 border-b border-[#e8ebf0] bg-white px-[24px] py-[14px]">
          <div className="flex items-center gap-3">
            <Icon path={ICONS.clock} color="#b0bac5" size={30} />
            <div>
              <b className="block text-[18px] leading-6 text-[#333]">
                {data && data.orders.totals.length
                  ? data.orders.totals.map((total) => `${formatMoney(total.amount)} ${total.currency}`).join(" · ")
                  : "0"}
              </b>
              <span className="text-[12px] text-[#777]">{t("сделки")}</span>
            </div>
          </div>
          <div className="flex items-center justify-self-end gap-3">
            <Icon path={ICONS.done} color="#b0bac5" size={30} />
            <div>
              <b className="block text-[18px] leading-6 text-[#333]">{data?.orders.count ?? 0}</b>
              <span className="text-[12px] text-[#777]">{t("Заказ оформлен")}</span>
            </div>
          </div>
        </div>

        <div className="mx-[24px] mt-[16px] flex items-center justify-between rounded-[4px] bg-[#20abc8] px-[10px] py-[6px] text-[14px] font-semibold text-white">
          <button type="button" onClick={() => onDate(prev)} disabled={prev < "2000-01-01"} aria-label={t("Предыдущий день")} className="disabled:opacity-40">
            <ChevronLeft className="h-5 w-5" />
          </button>
          {formatDateText(date, language, { withTime: false })}
          <button type="button" onClick={() => onDate(next)} disabled={next > "2100-12-31"} aria-label={t("Следующий день")} className="disabled:opacity-40">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[16px]">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-[#4f71dc]" />
            </div>
          ) : state.error ? (
            <p className="py-10 text-center text-[13px] text-[#e57373]">{t(state.error)}</p>
          ) : data ? (
            <>
              <section className="rounded-[6px] bg-white p-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
                <div className="flex items-center gap-[10px]">
                  <Icon path={type ? TYPE_STYLE[type].path : ICONS.blank} color={type ? TYPE_STYLE[type].color : "#d9d9d9"} size={22} />
                  <b className="text-[14px] text-[#333]">{type ? t(TYPE_LABELS[type]) : t("Нет данных за этот день")}</b>
                  {day && day.type === "late" && day.lateMinutes > 0 && (
                    <span className="text-[13px] text-[rgb(79,113,220)]">
                      ({t("Опоздал на")} {formatLate(day.lateMinutes)})
                    </span>
                  )}
                </div>
                <dl className="mt-[12px] grid grid-cols-2 gap-x-6 gap-y-[8px] text-[13px] sm:grid-cols-4">
                  <div>
                    <dt className="text-[#777]">{t("Приход")}</dt>
                    <dd className="font-semibold text-[#333]">{day?.time ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#777]">{t("Уход")}</dt>
                    <dd className="font-semibold text-[#333]">{day?.leaveTime ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[#777]">{t("Считать опозданием после")}</dt>
                    <dd className="font-semibold text-[#333]">{data.lateAfter}</dd>
                  </div>
                  <div>
                    <dt className="text-[#777]">{t("Источник")}</dt>
                    <dd className="font-semibold text-[#333]">{day ? t(SOURCE_LABELS[day.source] ?? "Автоматически") : "—"}</dd>
                  </div>
                </dl>
                {day?.updatedBy && (
                  <p className="mt-[10px] text-[12px] text-[#777]">
                    {t("Изменил")}: {day.updatedBy}
                    {day.updatedAt ? `, ${formatDateText(day.updatedAt, language, { utc: true })}` : ""}
                  </p>
                )}
                {day?.comment && <p className="mt-[8px] whitespace-pre-wrap break-words text-[13px] text-[#333]">{day.comment}</p>}
              </section>

              <h3 className="mb-[8px] mt-[18px] text-[13px] font-semibold uppercase text-[#5d6474]">{t("Отметки")}</h3>
              {data.checkIns.length === 0 ? (
                <div className="flex flex-col items-center rounded-[6px] bg-white py-[30px] shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/robot-empty.png" alt="" className="w-[110px]" />
                  <span className="mt-[10px] text-[13px] text-[#8c8c8c]">{t("Нет отметок за этот день")}</span>
                </div>
              ) : (
                <ol className="space-y-[8px]">
                  {data.checkIns.map((event) => (
                    <li key={event.id} className="flex items-start gap-[12px] rounded-[6px] bg-white p-[12px] shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
                      <Icon path={event.kind === "in" ? ICONS.login : ICONS.logout} color={event.kind === "in" ? "#71ce87" : "#FF5E5E"} size={22} />
                      <div className="min-w-0 flex-1 text-[13px]">
                        <div className="flex flex-wrap items-baseline gap-x-[10px]">
                          <b className="text-[14px] text-[#333]">{event.time.slice(0, 5)}</b>
                          <span className="font-semibold">{t(event.kind === "in" ? "Приход" : "Уход")}</span>
                          <span className="text-[12px] text-[#999]">{t(event.source === "web" ? "Веб" : "Мобильное приложение")}</span>
                        </div>
                        {event.place && <p className="mt-[2px] break-words text-[#555]">{event.place}</p>}
                        {event.lat !== null && event.lng !== null && (
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lng}#map=17/${event.lat}/${event.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-[2px] inline-flex items-center gap-[4px] text-[12px] text-[#4f71dc] hover:underline"
                          >
                            <Icon path={ICONS.pin} color="#4f71dc" size={14} />
                            {event.lat.toFixed(5)}, {event.lng.toFixed(5)}
                            {event.accuracy !== null ? ` (± ${Math.round(event.accuracy)} ${t("м")})` : ""}
                          </a>
                        )}
                        {event.comment && <p className="mt-[2px] whitespace-pre-wrap break-words text-[#777]">{event.comment}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
