"use client"

import { Loader2, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { SearchSelect, type PickOption } from "@/components/analytics/cash-management-shared"
import { CheckBox } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  TASK_PLAN_FREQUENCIES,
  TASK_REPEAT_MAX,
  TASK_TITLE_MAX,
  isTaskDate,
  repeatPlanDates,
  todayTaskDate,
  type TaskDetail,
  type TaskInputBody,
  type TaskOptions,
} from "./tasks-data"

// "ДОБАВИТЬ ЗАДАЧУ" / "ИЗМЕНИТЬ ЗАДАЧУ": Описание *, Магазин *, Ответственный пользователь *,
// Дата задачи * and, when adding, "Повторять план" (Недельный период + Количество планов, with the
// plan days previewed). Choosing a store fills in its agent as the responsible employee. Errors are
// shown under the fields and go away once the field is fixed; Escape closes the dialog.

type Draft = { title: string; clientId: string; employeeId: string; taskDate: string; repeat: boolean; frequency: string; count: string }

type Field = "title" | "clientId" | "employeeId" | "taskDate" | "frequency" | "count"

function draftOf(task: TaskDetail | null): Draft {
  return {
    title: task?.title ?? "",
    clientId: task?.clientId ? String(task.clientId) : "",
    employeeId: task?.responsibleId ? String(task.responsibleId) : "",
    taskDate: task?.taskDate || (task ? "" : todayTaskDate()),
    repeat: false,
    frequency: "7",
    count: "",
  }
}

/** Russian i18n key of the field's problem, or "". */
function fieldError(draft: Draft, field: Field): string {
  switch (field) {
    case "title":
      if (!draft.title.trim()) return "Это поле обязательно к заполнению"
      return draft.title.trim().length > TASK_TITLE_MAX ? "Не более 1000 символов" : ""
    case "clientId":
      return draft.clientId ? "" : "Выберите магазин"
    case "employeeId":
      return draft.employeeId ? "" : "Выберите ответственного"
    case "taskDate":
      if (!draft.taskDate) return "Укажите дату"
      return isTaskDate(draft.taskDate) ? "" : "Неверная дата"
    case "frequency":
      return !draft.repeat || draft.frequency === "7" || draft.frequency === "14" ? "" : "Выберите период"
    case "count": {
      if (!draft.repeat) return ""
      const count = /^\d{1,3}$/.test(draft.count.trim()) ? Number(draft.count.trim()) : Number.NaN
      return Number.isInteger(count) && count >= 1 && count <= TASK_REPEAT_MAX ? "" : "Введите целое число от 1 до 52"
    }
  }
}

const FIELDS: Field[] = ["title", "clientId", "employeeId", "taskDate", "frequency", "count"]

/** The server's `field` of a refusal → the dialog field. */
function dialogField(field: unknown): Field | null {
  const name = String(field ?? "")
  if (name === "repeat.count") return "count"
  if (name === "repeat.frequency") return "frequency"
  return (FIELDS as string[]).includes(name) ? (name as Field) : null
}

function Info({ text }: { text: string }) {
  const { t } = useLanguage()
  return (
    <span title={t(text)} aria-label={t(text)} role="img" className="ml-2 inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#4f71dc]" aria-hidden>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
      </svg>
    </span>
  )
}

function DialogField({ label, required, error, children, info }: { label: string; required?: boolean; error?: string; children: ReactNode; info?: string }) {
  const { t } = useLanguage()
  return (
    <div className="mt-[16px] first:mt-0">
      <div className="mb-[4px] flex items-center text-[11px] font-bold text-[#333]">
        {t(label)}
        {required && <span className="text-[#e57373]">&nbsp;*</span>}
        {info && <Info text={info} />}
      </div>
      {children}
      {error && <p className="mt-1 text-[12px] text-[#e57373]">{t(error)}</p>}
    </div>
  )
}

const underline = "w-full border-b bg-transparent text-[13px] text-[#333] outline-none focus:border-[#5d6474]"

export function TaskDialog({
  task,
  options,
  onClose,
  onSaved,
}: {
  /** null = "Добавить задачу". */
  task: TaskDetail | null
  options: TaskOptions
  onClose: () => void
  onSaved: (saved: TaskDetail) => void
}) {
  const { t } = useLanguage()
  const editing = task !== null
  const [draft, setDraft] = useState<Draft>(() => draftOf(task))
  const [showErrors, setShowErrors] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({})
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Auto-height of the description.
  useEffect(() => {
    const element = titleRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [draft.title])

  const clientOptions: PickOption[] = useMemo(
    () => options.clients.map((client) => ({ value: String(client.id), label: client.name, hint: client.hint })),
    [options.clients],
  )
  // Active employees; the task's current (now inactive) employee stays choosable when editing.
  const employeeOptions: PickOption[] = useMemo(
    () =>
      options.employees
        .filter((employee) => employee.active || (task?.responsibleId !== null && employee.id === task?.responsibleId))
        .map((employee) => ({ value: String(employee.id), label: employee.name, hint: employee.hint })),
    [options.employees, task],
  )

  const errorOf = (field: Field) => serverErrors[field] || (showErrors ? fieldError(draft, field) : "")

  function change(patch: Partial<Draft>, fields: Field[]) {
    setDraft((current) => ({ ...current, ...patch }))
    setServerErrors((current) => {
      const next = { ...current }
      for (const field of fields) delete next[field]
      return next
    })
    setFormError("")
  }

  const frequency = Number(draft.frequency)
  const count = /^\d{1,3}$/.test(draft.count.trim()) ? Number(draft.count.trim()) : 0
  const preview = !editing && draft.repeat ? repeatPlanDates(draft.taskDate, frequency, count) : []

  async function save() {
    setShowErrors(true)
    setFormError("")
    if (FIELDS.some((field) => fieldError(draft, field))) return
    setSaving(true)
    try {
      const body: TaskInputBody = {
        title: draft.title.trim(),
        clientId: Number(draft.clientId),
        employeeId: Number(draft.employeeId),
        taskDate: draft.taskDate,
        ...(editing ? {} : { repeat: draft.repeat ? { frequency: frequency as 7 | 14, count } : null }),
      }
      const response = await fetch(editing ? `/api/tasks/${task.id}` : "/api/tasks", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string; field?: string } & Partial<TaskDetail>
      if (!response.ok) {
        const message = response.status === 403 ? "Недостаточно прав" : data.error || "Не удалось сохранить задачу"
        const field = dialogField(data.field)
        if (field) setServerErrors((current) => ({ ...current, [field]: message }))
        else setFormError(message)
        return
      }
      onSaved(data as TaskDetail)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[1400] flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t(editing ? "Изменить задачу" : "Добавить задачу")} className="w-[400px] max-w-full bg-white text-[13px] text-[#333] shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[24px] pr-[18px]">
          <h3 className="text-[13px] font-bold uppercase">{t(editing ? "Изменить задачу" : "Добавить задачу")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#5d6474] hover:text-[#333]">
            <X className="h-6 w-6" />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="px-[24px] pb-[20px] pt-[20px]">
            <DialogField label="Описание" required error={errorOf("title")}>
              <textarea
                ref={titleRef}
                autoFocus
                rows={1}
                value={draft.title}
                maxLength={TASK_TITLE_MAX + 100}
                onChange={(event) => change({ title: event.target.value }, ["title"])}
                className={`${underline} min-h-[30px] resize-none py-[5px] ${errorOf("title") ? "border-[#e57373]" : "border-[#d5dae1]"}`}
              />
            </DialogField>
            <DialogField label="Магазин" required error={errorOf("clientId")}>
              <SearchSelect
                value={draft.clientId}
                options={clientOptions}
                invalid={Boolean(errorOf("clientId"))}
                selectedLabel={task?.client}
                onChange={(value) => {
                  const agentId = options.clients.find((client) => String(client.id) === value)?.agentId ?? null
                  // The store's agent becomes the responsible employee (as the reference app does).
                  if (value && agentId !== null && options.employees.some((employee) => employee.id === agentId && employee.active)) {
                    change({ clientId: value, employeeId: String(agentId) }, ["clientId", "employeeId"])
                  } else {
                    change({ clientId: value }, ["clientId"])
                  }
                }}
              />
              {!options.clients.length && <p className="mt-1 text-[12px] text-[#e5a04f]">{t("Нет клиентов — добавьте их в разделе «Клиенты»")}</p>}
            </DialogField>
            <DialogField label="Ответственный пользователь" required error={errorOf("employeeId")}>
              <SearchSelect
                value={draft.employeeId}
                options={employeeOptions}
                invalid={Boolean(errorOf("employeeId"))}
                selectedLabel={task?.responsible}
                onChange={(value) => change({ employeeId: value }, ["employeeId"])}
              />
              {!employeeOptions.length && <p className="mt-1 text-[12px] text-[#e5a04f]">{t("Нет сотрудников — добавьте их в разделе «Сотрудники»")}</p>}
            </DialogField>
            <DialogField label="Дата задачи" required error={errorOf("taskDate")}>
              <input
                type="date"
                value={draft.taskDate}
                min="2000-01-01"
                max="2100-12-31"
                aria-label={t("Дата задачи")}
                onChange={(event) => change({ taskDate: event.target.value }, ["taskDate", "count"])}
                className={`${underline} h-[32px] ${errorOf("taskDate") ? "border-[#e57373]" : "border-[#d5dae1]"}`}
              />
            </DialogField>
            {!editing && (
              <>
                <div className="mt-[18px]">
                  <CheckBox checked={draft.repeat} onChange={(repeat) => change({ repeat }, ["frequency", "count"])} label="Повторять план" />
                </div>
                {draft.repeat && (
                  <>
                    <DialogField label="Недельный период" required error={errorOf("frequency")} info="С какой периодичностью ставить в план данную задачу">
                      <select
                        value={draft.frequency}
                        aria-label={t("Недельный период")}
                        onChange={(event) => change({ frequency: event.target.value }, ["frequency", "count"])}
                        className={`${underline} h-[32px] border-[#d5dae1]`}
                      >
                        {TASK_PLAN_FREQUENCIES.map((option) => (
                          <option key={option.value} value={String(option.value)}>
                            {t(option.label)}
                          </option>
                        ))}
                      </select>
                    </DialogField>
                    <DialogField label="Количество планов" required error={errorOf("count")} info="Сколько раз поставить в план сотруднику выполнение этой задачи">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={TASK_REPEAT_MAX}
                        step={1}
                        value={draft.count}
                        aria-label={t("Количество планов")}
                        onChange={(event) => change({ count: event.target.value }, ["count"])}
                        className={`${underline} h-[32px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${errorOf("count") ? "border-[#e57373]" : "border-[#d5dae1]"}`}
                      />
                    </DialogField>
                    {preview.length > 0 && (
                      <p className="mt-[12px] break-words text-[12px] leading-[18px] text-[#5d6474]">
                        {t("Планы установятся на даты")}: {preview.join(", ")}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
            {formError && <p className="mt-3 text-[13px] text-[#e57373]">{t(formError)}</p>}
          </div>
          <footer className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 min-w-[111px] items-center justify-center gap-2 rounded-[3px] bg-[#71ce87] px-[16px] text-[12px] font-bold uppercase text-white hover:brightness-95 disabled:bg-[#ade3b9]"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("Сохранить")}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  )
}
