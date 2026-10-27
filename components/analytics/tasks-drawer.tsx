"use client"

import { Loader2, X } from "lucide-react"
import { useCallback, useEffect, useState, type ReactNode } from "react"

import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  TASK_COMMENT_MAX,
  TASK_PLAN_STATUS_LABELS,
  TASK_STATUS_LABELS,
  isTaskDate,
  type TaskDetail,
  type TaskPlan,
  type TaskPlanStatus,
  type TaskStatus,
} from "./tasks-data"

// The task's drawer ("Задача № N", right side, 580px): Детали, the plans with their status / the
// agent's answer / photo, "Добавить план", and for a done task "Принять". Clicking outside or
// Escape closes it.

const ICONS = {
  fiberNew:
    "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zM8.5 15H7.3l-2.55-3.5V15H3.5V9h1.25l2.5 3.5V9H8.5v6zm5-4.74H11v1.12h2.5v1.26H11v1.11h2.5V15h-4V9h4v1.26zm7 3.74c0 .55-.45 1-1 1h-4c-.55 0-1-.45-1-1V9h1.25v4.51h1.13V9.99h1.25v3.51h1.12V9h1.25v5z",
  clock:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  doneAll: "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z",
  cancel:
    "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z",
}

const TASK_ICON: Record<TaskStatus, { path: string; color: string }> = {
  new: { path: ICONS.fiberNew, color: "#2196f3" },
  in_progress: { path: ICONS.clock, color: "#ff9800" },
  done: { path: ICONS.check, color: "#4caf50" },
  finished: { path: ICONS.doneAll, color: "rgb(79,113,220)" },
}

const PLAN_ICON: Record<TaskPlanStatus, { path: string; color: string }> = {
  new: TASK_ICON.new,
  pending: TASK_ICON.in_progress,
  in_progress: TASK_ICON.in_progress,
  done: TASK_ICON.done,
  finished: TASK_ICON.finished,
  undone: { path: ICONS.cancel, color: "#e57373" },
}

/** The status icon with its tooltip (not a button: the status changes through its own actions). */
export function TaskStatusIcon({ status }: { status: TaskStatus }) {
  const { t } = useLanguage()
  const icon = TASK_ICON[status]
  const label = t(TASK_STATUS_LABELS[status])
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex h-6 w-6 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: icon.color }} aria-hidden>
        <path d={icon.path} />
      </svg>
    </span>
  )
}

function PlanStatusIcon({ status }: { status: TaskPlanStatus }) {
  const { t } = useLanguage()
  const icon = PLAN_ICON[status]
  const label = t(TASK_PLAN_STATUS_LABELS[status])
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex h-6 w-6 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: icon.color }} aria-hidden>
        <path d={icon.path} />
      </svg>
    </span>
  )
}

function DetailRow({ label, children, stacked }: { label: string; children: ReactNode; stacked?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className={`border-b border-[#efefef] py-[10px] text-[13px] ${stacked ? "" : "flex items-start justify-between gap-4"}`}>
      <span className="shrink-0 text-[#888]">{t(label)}:</span>
      <span className={`min-w-0 whitespace-pre-wrap break-words text-[#333] ${stacked ? "mt-[6px] block" : "text-right"}`}>{children}</span>
    </div>
  )
}

type Feedback = { text: string; tone: "success" | "error" }

export function TaskDrawer({
  taskId,
  canManage,
  paused,
  refreshKey,
  onClose,
  onEdit,
  onChanged,
  onNotify,
}: {
  taskId: number
  canManage: boolean
  /** A dialog is open over the drawer: Escape belongs to it. */
  paused?: boolean
  /** Bumped by the page after an edit, so the drawer reloads. */
  refreshKey: number
  onClose: () => void
  onEdit: (task: TaskDetail) => void
  onChanged: () => void
  onNotify: (message: Feedback) => void
}) {
  const { t, language } = useLanguage()
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [accepting, setAccepting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [planDate, setPlanDate] = useState("")
  const [planComment, setPlanComment] = useState("")
  const [planErrors, setPlanErrors] = useState<{ date?: string; comment?: string; form?: string }>({})
  const [planSaving, setPlanSaving] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/tasks/${taskId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as TaskDetail & { error?: string }
        if (!response.ok) throw new Error(response.status === 404 ? "Задача не найдена" : data.error || "Не удалось загрузить задачу")
        setTask(data)
        setError("")
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setTask(null)
        setError(reason instanceof Error && reason.message ? reason.message : "Не удалось загрузить задачу")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [taskId, reload, refreshKey])

  const closeTop = useCallback(() => {
    if (photo) setPhoto(null)
    else onClose()
  }, [photo, onClose])

  useEffect(() => {
    if (paused) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTop()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [paused, closeTop])

  async function accept() {
    if (!task || accepting) return
    setAccepting(true)
    try {
      const response = await fetch(`/api/tasks/${task.id}/accept`, { method: "POST" })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        onNotify({ text: response.status === 403 ? "Недостаточно прав" : data.error || "Не удалось принять задачу", tone: "error" })
        setReload((value) => value + 1)
        return
      }
      onNotify({ text: "Задача принята", tone: "success" })
      onChanged()
      onClose()
    } catch {
      onNotify({ text: "Сервер недоступен, попробуйте ещё раз", tone: "error" })
    } finally {
      setAccepting(false)
    }
  }

  function toggleAdd() {
    setAddOpen((open) => !open)
    setPlanDate("")
    setPlanComment("")
    setPlanErrors({})
  }

  async function addPlan() {
    if (!task || planSaving) return
    const errors: typeof planErrors = {}
    if (!planDate) errors.date = "Укажите дату"
    else if (!isTaskDate(planDate)) errors.date = "Неверная дата"
    if (planComment.trim().length > TASK_COMMENT_MAX) errors.comment = "Не более 1000 символов"
    setPlanErrors(errors)
    if (errors.date || errors.comment) return
    setPlanSaving(true)
    try {
      const response = await fetch(`/api/tasks/${task.id}/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: planDate, comment: planComment.trim() }),
      })
      const data = (await response.json().catch(() => ({}))) as TaskDetail & { error?: string; field?: string }
      if (!response.ok) {
        const message = response.status === 403 ? "Недостаточно прав" : data.error || "Не удалось добавить план"
        setPlanErrors(data.field === "date" ? { date: message } : data.field === "comment" ? { comment: message } : { form: message })
        return
      }
      setTask(data)
      setAddOpen(false)
      setPlanDate("")
      setPlanComment("")
      onNotify({ text: "План добавлен", tone: "success" })
      onChanged()
    } catch {
      setPlanErrors({ form: "Сервер недоступен, попробуйте ещё раз" })
    } finally {
      setPlanSaving(false)
    }
  }

  const iconButton = "flex h-9 w-9 items-center justify-center rounded-full text-[#5d6474] hover:bg-black/5"

  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-[1200] bg-black/[0.54]" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={task ? `${t("Задача")} № ${task.id}` : t("Задача")}
        className="fixed right-0 top-0 z-[1300] flex h-full w-[580px] max-w-full flex-col overflow-y-auto bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"
      >
        <div className="m-[15px] flex min-h-[50px] items-center justify-between rounded-[6px] bg-[#f2f5f8] pl-[20px] pr-[8px]">
          <h2 className="text-[15px] font-bold text-[#333]">
            {t("Задача")} № {task?.id ?? taskId}
          </h2>
          <div className="flex items-center gap-[4px]">
            {canManage && task?.status === "done" && (
              <button
                type="button"
                onClick={() => void accept()}
                disabled={accepting}
                className="mr-[6px] inline-flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60"
              >
                {accepting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Принять")}
              </button>
            )}
            {canManage && task && (
              <button type="button" onClick={() => onEdit(task)} aria-label={t("Изменить")} title={t("Изменить")} className={iconButton}>
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={t("Закрыть")} title={t("Закрыть")} className={iconButton}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading && !task ? (
          <div className="flex flex-1 items-center justify-center py-16 text-[#5d6474]">
            <Loader2 className="h-6 w-6 animate-spin" aria-label={t("Загрузка...")} />
          </div>
        ) : !task ? (
          <p className="px-[30px] py-10 text-center text-[#e57373]">{t(error || "Задача не найдена")}</p>
        ) : (
          <div className="px-[30px] pb-[30px]">
            <h3 className="mb-[6px] mt-[6px] text-[14px] font-semibold text-[#5d6474]">{t("Детали")}</h3>
            <DetailRow label="Ответственный">{task.responsible || t("Не указано")}</DetailRow>
            <DetailRow label="Создал">{task.createdBy || t("Не указано")}</DetailRow>
            <DetailRow label="Клиент">{task.client || t("Не указано")}</DetailRow>
            <DetailRow label="Статус">{t(TASK_STATUS_LABELS[task.status])}</DetailRow>
            <DetailRow label="Дата создания">{task.createdAt ? formatDateText(task.createdAt, language, { withTime: true, utc: true }) : t("Не указано")}</DetailRow>
            <DetailRow label="Дата задачи">{task.taskDate ? formatDateText(task.taskDate, language, { withTime: false }) : t("Не указано")}</DetailRow>
            <DetailRow label="Описание" stacked={task.title.length > 30}>
              {task.title}
            </DetailRow>

            <div className="mt-[24px] flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-[#5d6474]">{t("Планы")}</h3>
              {canManage && task.status !== "finished" && (
                <button type="button" onClick={toggleAdd} className="h-[30px] rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95">
                  {t(addOpen ? "Закрыть" : "Добавить план")}
                </button>
              )}
            </div>

            {addOpen && canManage && task.status !== "finished" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void addPlan()
                }}
                className="mt-[12px] rounded-[8px] bg-white p-[16px] shadow-[0_1px_6px_rgba(0,0,0,0.16)]"
              >
                <label className="block text-[11px] font-bold text-[#333]">
                  {t("Дата выполнения задачи")}
                  <span className="text-[#e57373]">&nbsp;*</span>
                  <input
                    type="date"
                    value={planDate}
                    min="2000-01-01"
                    max="2100-12-31"
                    onChange={(event) => {
                      setPlanDate(event.target.value)
                      setPlanErrors((current) => ({ ...current, date: undefined, form: undefined }))
                    }}
                    className={`mt-[4px] block h-[32px] w-full border-b bg-transparent text-[13px] font-normal outline-none ${planErrors.date ? "border-[#e57373]" : "border-[#d5dae1]"}`}
                  />
                </label>
                {planErrors.date && <p className="mt-1 text-[12px] text-[#e57373]">{t(planErrors.date)}</p>}
                <textarea
                  value={planComment}
                  rows={3}
                  maxLength={TASK_COMMENT_MAX + 100}
                  placeholder={t("Комментарий...")}
                  aria-label={t("Комментарий...")}
                  onChange={(event) => {
                    setPlanComment(event.target.value)
                    setPlanErrors((current) => ({ ...current, comment: undefined, form: undefined }))
                  }}
                  className={`mt-[14px] block w-full resize-none rounded-[4px] border p-[8px] text-[13px] outline-none focus:border-[#5d6474] ${planErrors.comment ? "border-[#e57373]" : "border-[#d5dae1]"}`}
                />
                {planErrors.comment && <p className="mt-1 text-[12px] text-[#e57373]">{t(planErrors.comment)}</p>}
                {planErrors.form && <p className="mt-2 text-[12px] text-[#e57373]">{t(planErrors.form)}</p>}
                <button
                  type="submit"
                  disabled={planSaving}
                  className="mt-[14px] inline-flex h-[36px] w-full items-center justify-center gap-2 rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60"
                >
                  {planSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("Создать")}
                </button>
              </form>
            )}

            {task.plans.length === 0 ? (
              <p className="py-6 text-center text-[#999]">{t("Планов нет")}</p>
            ) : (
              <ol className="mt-[10px]">
                {task.plans.map((plan: TaskPlan, index) => (
                  <li key={plan.id} className="flex items-start gap-[12px] border-b border-[#efefef] py-[10px]">
                    <span className="w-[22px] shrink-0 pt-[2px] text-[#888]">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words font-semibold text-[#333]">{plan.comment || "—"}</p>
                      <p className="mt-[2px] text-[12px] text-[#888]">{isTaskDate(plan.date) ? formatDateText(plan.date, language, { withTime: false }) : t("Не указано")}</p>
                      {plan.photoUrl && (
                        <button type="button" onClick={() => setPhoto(plan.photoUrl)} className="mt-[4px] text-[12px] text-[#4f71dc] hover:underline">
                          {t("Просмотреть")}
                        </button>
                      )}
                    </div>
                    <div className="flex max-w-[45%] shrink-0 flex-col items-end text-right">
                      <PlanStatusIcon status={plan.status} />
                      {plan.response && <p className="mt-[2px] whitespace-pre-wrap break-words text-[12px] text-[#5d6474]">{plan.response}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </aside>

      {photo && (
        <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/80 p-6" onClick={() => setPhoto(null)}>
          <button type="button" onClick={() => setPhoto(null)} aria-label={t("Закрыть")} className="absolute right-4 top-4 text-white">
            <X className="h-7 w-7" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={t("Фото")} className="max-h-full max-w-full object-contain" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  )
}
