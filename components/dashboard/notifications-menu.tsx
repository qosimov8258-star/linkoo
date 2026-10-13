"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

type NotificationItem = {
  id: number
  kind: "delivered" | "transfer"
  title: string
  time: string
  description: string
}

type TaskItem = {
  id: number
  client: string
  address: string
  dateKey: string
  dateLabel: string
  done: boolean
}

const initialNotifications: NotificationItem[] = []

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function formatRu(date: Date) {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
}

function makeInitialTasks(today: Date): TaskItem[] {
  return []
}

interface NotificationsMenuProps {
  onClose: () => void
}

export function NotificationsMenu({ onClose }: NotificationsMenuProps) {
  const { t } = useLanguage()
  const today = useMemo(() => new Date(), [])
  const [tab, setTab] = useState<"notifications" | "incomplete" | "all">("notifications")
  const [notifications, setNotifications] = useState(initialNotifications)

  // Delivered orders become "order delivered" notifications.
  useEffect(() => {
    let cancelled = false
    fetch("/api/orders")
      .then((response) => (response.ok ? response.json() : []))
      .then((orders: { id: number; client: string; agent: string; delivery: string; status: string }[]) => {
        if (cancelled || !Array.isArray(orders)) return
        setNotifications(
          orders
            .filter((order) => order.status === "Доставлено")
            .sort((a, b) => b.id - a.id)
            .slice(0, 40)
            .map((order) => ({
              id: order.id,
              kind: "delivered" as const,
              title: "Заказ доставлен",
              time: order.delivery,
              description: `Заказ №${order.id} был доставлен клиенту ${order.client} доставщиком ${order.agent}`,
            })),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const [tasks, setTasks] = useState<TaskItem[]>(() => makeInitialTasks(today))
  const [viewDate, setViewDate] = useState(today)

  const removeNotification = (id: number) => {
    setNotifications((current) => current.filter((item) => item.id !== id))
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
      <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#efefef] px-[30px]">
        <h2 className="text-[14px] font-semibold text-[#333]">{t("Уведомления")}</h2>
        {tab === "all" && (
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <button aria-label={t("Предыдущий день")} onClick={() => shiftDate(-1)} className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="whitespace-nowrap">{formatRu(viewDate)}</span>
            <button aria-label={t("Следующий день")} onClick={() => shiftDate(1)} className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-3 border-b border-[#efefef]">
        {(
          [
            ["notifications", "Уведомления"],
            ["incomplete", "Не выполненные задачи"],
            ["all", "Все задачи"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`h-12 border-b-2 text-[13px] font-normal text-black transition-colors ${
              tab === key ? "border-[#0a9ddb]" : "border-transparent"
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "notifications" && (
          notifications.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">{t("Уведомлений нет")}</p>
          ) : (
            <ul>
              {notifications.map((item) => (
                <li key={item.id} className="group flex items-center gap-3 border-b border-[#efefef] px-[20px] py-[14px]">
                  <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0" aria-hidden>
                    <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill={item.kind === "delivered" ? "#c8e6c9" : "#eceff1"} />
                    <path d="M14 20l4 4 8-8" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-4">
                      <p className="font-semibold text-[#888]">{item.title}</p>
                      <span className="shrink-0 text-[12px] text-[#aaa]">{item.time}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-[#888]">{item.description}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={t("Удалить")}
                    onClick={() => removeNotification(item.id)}
                    className="shrink-0 text-[#ccc] hover:text-[#e57373]"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === "incomplete" && (
          incompleteTasks.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">{t("Невыполненных задач нет")}</p>
          ) : (
            <ul>
              {incompleteTasks.map((task) => (
                <li key={task.id} className="border-b border-slate-50 px-6 py-4">
                  <p className="font-semibold text-slate-800">{task.client}</p>
                  <p className="text-sm text-slate-500">{task.address}</p>
                  <button
                    type="button"
                    onClick={() => toggleTask(task.id)}
                    className="mt-2 flex w-full items-center gap-3 rounded-md bg-slate-50 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-slate-300" />
                    {t("Следует посетить")} {task.dateLabel}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === "all" && (
          tasksForViewDate.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">{t("На эту дату задач нет")}</p>
          ) : (
            <ul>
              {tasksForViewDate.map((task) => (
                <li key={task.id} className="border-b border-slate-50 px-6 py-4">
                  <p className="font-semibold text-slate-800">{task.client}</p>
                  <p className="text-sm text-sky-700/80">{task.address}</p>
                  <button
                    type="button"
                    onClick={() => toggleTask(task.id)}
                    className="mt-2 flex w-full items-center gap-3 rounded-md bg-slate-50 px-4 py-3 text-left text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${task.done ? "border-sky-500 bg-sky-500" : "border-slate-300"}`} />
                    {t("Следует посетить")} {task.dateLabel}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      <div className="shrink-0 border-t border-[#efefef] px-[30px] py-3 text-right">
        <button type="button" onClick={onClose} className="text-[13px] font-semibold uppercase text-[#0a9ddb]">
          {t("Закрыть")}
        </button>
      </div>
    </div>
    </>
  )
}
