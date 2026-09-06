"use client"

import { useMemo, useState } from "react"
import { Bell, ChevronLeft, ChevronRight, ShieldCheck, Trash2 } from "lucide-react"

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
    <div className="absolute right-0 top-full z-50 w-[400px] max-w-[92vw] overflow-hidden rounded-b-md border-t-2 border-rose-300 bg-white text-foreground shadow-2xl sm:w-[500px]">
      <div className="flex items-center justify-between px-6 py-4">
        <h2 className="text-lg font-semibold text-slate-800">{t("Уведомления")}</h2>
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

      <div className="flex border-b border-slate-100 px-6">
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
            className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
              tab === key ? "border-sky-500 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <div className="max-h-[480px] overflow-y-auto">
        {tab === "notifications" && (
          notifications.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">{t("Уведомлений нет")}</p>
          ) : (
            <ul>
              {notifications.map((item) => (
                <li key={item.id} className="group flex items-start gap-3 border-b border-slate-50 px-6 py-4">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.kind === "delivered" ? "bg-emerald-100 text-emerald-500" : "bg-slate-100 text-slate-400"}`}>
                    {item.kind === "delivered" ? <ShieldCheck className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-semibold text-slate-800">{item.title}</p>
                      <span className="shrink-0 text-xs text-slate-400">{item.time}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={t("Удалить")}
                    onClick={() => removeNotification(item.id)}
                    className="shrink-0 text-slate-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
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

      <div className="border-t border-slate-100 px-6 py-3 text-right">
        <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          {t("Закрыть")}
        </button>
      </div>
    </div>
  )
}
