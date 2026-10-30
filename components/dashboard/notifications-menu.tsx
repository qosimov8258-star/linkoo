"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { formatDate, formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

import { fillNotificationText, notificationHref, useNotifications, type NotificationItem } from "./notifications-feed"

type TaskItem = {
  id: number
  client: string
  address: string
  dateKey: string
  dateLabel: string
  done: boolean
}

type Tab = "notifications" | "incomplete" | "all"

const PAGE_SIZE = 15

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** Pointy hexagon avatar of a notification (green check for orders, grey bell for the rest). */
function HexIcon({ order }: { order: boolean }) {
  return (
    <span className="relative block h-[41.6px] w-[36px] shrink-0">
      <svg viewBox="0 0 36 41.6" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon points="18,0 36,10.4 36,31.2 18,41.6 0,31.2 0,10.4" fill={order ? "#8dc572" : "#dadada"} />
      </svg>
      <svg viewBox="0 0 24 24" className="absolute left-[9.5px] top-[12px] h-[17px] w-[17px] fill-white" aria-hidden>
        <path d={order ? "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" : "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"} />
      </svg>
    </span>
  )
}

function EmptyBell({ text }: { text: string }) {
  return (
    <div className="relative px-0 pb-[20px] pt-[160px] text-center text-[13px] font-bold text-[#999]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/nav/empty-bell.png" alt="" className="absolute left-1/2 top-[23px] h-[130px] w-[120px] -translate-x-1/2" />
      <div className="leading-[16.25px]">{text}</div>
    </div>
  )
}

interface NotificationsMenuProps {
  onClose: () => void
}

export function NotificationsMenu({ onClose }: NotificationsMenuProps) {
  const { t, language } = useLanguage()
  const router = useRouter()
  const today = useMemo(() => new Date(), [])
  const [tab, setTab] = useState<Tab>("notifications")
  // The signed-in user's own notifications (GET /api/notifications), newest first. Their filled
  // texts carry data-no-translate: t() translates the template, the names inside are data.
  const { items: notifications, hasMore, loading, failed, loadMore, remove, markViewed } = useNotifications(PAGE_SIZE)
  // The agent plans ("Следует посетить") of the signed-in user: empty for the admin, like the reference.
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [viewDate, setViewDate] = useState(today)

  function openNotification(item: NotificationItem) {
    void markViewed(item)
    const href = notificationHref(item)
    if (!href) return
    onClose()
    router.push(href)
  }

  const toggleTask = (id: number) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
  }

  const incompleteTasks = tasks.filter((task) => !task.done)
  const tasksForViewDate = tasks.filter((task) => task.dateKey === toDateKey(viewDate))

  const shiftDate = (deltaDays: number) => {
    setViewDate((current) => {
      const next = new Date(current)
      next.setDate(next.getDate() + deltaDays)
      return next
    })
  }

  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-[1200] bg-black/[0.54]" />
      <div className="fixed right-0 top-0 z-[1300] flex h-full w-[500px] max-w-full flex-col overflow-hidden bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <div className={`flex shrink-0 items-center justify-between border-b border-[#efefef] px-[30px] ${tab === "all" ? "h-[70px]" : "h-[58.5px]"}`}>
          <div className="text-[14px] font-semibold leading-[17.5px]">{t("Уведомления")}</div>
          {tab === "all" && (
            <div className="flex items-center gap-[10px] text-[14px] font-medium">
              <button type="button" aria-label={t("Предыдущий день")} onClick={() => shiftDate(-1)} className="flex h-6 w-6 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
              </button>
              <span className="whitespace-nowrap">{formatDate(viewDate, language)}</span>
              <button type="button" aria-label={t("Следующий день")} onClick={() => shiftDate(1)} className="flex h-6 w-6 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
              </button>
            </div>
          )}
        </div>

        <div className="grid h-12 shrink-0 grid-cols-3">
          {(
            [
              ["notifications", "Уведомления"],
              ["incomplete", "Не выполненные задачи"],
              ["all", "Все задачи"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`h-12 border-b-2 text-[13px] font-medium text-black ${tab === key ? "border-[#129fdd]" : "border-transparent"}`}>
              {t(label)}
            </button>
          ))}
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => {
            const box = event.currentTarget
            if (tab === "notifications" && hasMore && !loading && box.scrollTop + box.clientHeight >= box.scrollHeight - 80) void loadMore()
          }}
        >
          {tab === "notifications" &&
            (notifications.length === 0 ? (
              loading ? null : <EmptyBell text={t(failed ? "Не удалось загрузить данные" : "Нет уведомлений")} />
            ) : (
              <ul>
                {notifications.map((item) => (
                  <li key={item.id} onClick={() => openNotification(item)} className={`group relative flex h-[74.8px] cursor-pointer items-center border-b border-[#efefef] py-[10px] pl-[20px] pr-[10px] ${item.viewed ? "opacity-50" : ""}`}>
                    <HexIcon order={item.template === "order_delivered"} />
                    <div className="ml-[20.5px] w-[250px]">
                      <div className="mb-[5px] flex items-start justify-between">
                        <div data-no-translate className="text-[13px] font-semibold leading-[16.25px]">{fillNotificationText(t(item.title), item.params)}</div>
                        <span className="mt-[1.3px] text-[11px] leading-[13.75px] text-[#999]">{formatDateText(item.createdDate, language, { withTime: true, utc: true })}</span>
                      </div>
                      <div data-no-translate className="line-clamp-2 text-[13px] leading-[16.25px]">{fillNotificationText(t(item.text), item.params)}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={t("Удалить")}
                      onClick={(event) => {
                        event.stopPropagation()
                        void remove(item.id)
                      }}
                      className="absolute right-[10px] top-[19.4px] flex h-12 w-12 items-center justify-center"
                    >
                      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#dadada] hover:fill-[#e57373]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "incomplete" &&
            (incompleteTasks.length === 0 ? (
              <EmptyBell text={t("Не выполненные задачи")} />
            ) : (
              <ul>
                {incompleteTasks.map((task) => (
                  <li key={task.id} className="border-b border-[#efefef] px-[30px] py-4">
                    <p className="font-semibold text-[#333]">{task.client}</p>
                    <p className="text-[13px] text-[#999]">{task.address}</p>
                    <button
                      type="button"
                      onClick={() => toggleTask(task.id)}
                      className="mt-2 flex w-full items-center gap-3 rounded-md bg-slate-50 px-4 py-3 text-left text-[13px] text-[#333] hover:bg-slate-100"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-slate-300" />
                      {t("Следует посетить")} {task.dateLabel}
                    </button>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "all" &&
            (tasksForViewDate.length === 0 ? (
              <EmptyBell text={t("Задачи не найдены")} />
            ) : (
              <ul>
                {tasksForViewDate.map((task) => (
                  <li key={task.id} className="border-b border-[#efefef] px-[30px] py-4">
                    <p className="font-semibold text-[#333]">{task.client}</p>
                    <p className="text-[13px] text-[#129fdd]">{task.address}</p>
                    <button
                      type="button"
                      onClick={() => toggleTask(task.id)}
                      className="mt-2 flex w-full items-center gap-3 rounded-md bg-slate-50 px-4 py-3 text-left text-[13px] text-[#333] hover:bg-slate-100"
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${task.done ? "border-[#129fdd] bg-[#129fdd]" : "border-slate-300"}`} />
                      {t("Следует посетить")} {task.dateLabel}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </>
  )
}
